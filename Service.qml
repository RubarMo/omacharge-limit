import QtQuick
import Quickshell.Io
import Quickshell.Services.UPower
import "Model.js" as Model

// Owns the live charge-limit state. Reads go through a short head process:
// sysfs pseudo-files misbehave under FileView watchers (transient empty
// reads flapped the widget into "unsupported"). Polling is deterministic.
//
// Mode changes are a single helper invocation. The helper reads the fresh
// EC state, writes the start/end pair in an order that keeps start < end at
// every step, then verifies the settled result before reporting success.
// Computing the order in QML from cached sysfs values used to write the end
// threshold first while the EC still held start=99 — the kernel rejects
// that with EINVAL, the transition aborted, and the EC stayed stuck at 100%
// with the unplug-revert disarmed.
Item {
  id: root

  // Live end threshold, -1 while unknown.
  property int endLimit: -1
  // "saver", "full", or "" while loading.
  property string mode: ""
  property bool supported: true
  property bool busy: false
  property string lastError: ""
  // Set when the charger leaves while the EC may still hold the one-shot
  // 100% limit; cleared once a read confirms the limit is no longer full.
  property bool revertPending: false
  property int revertAttempts: 0
  // True for a few seconds after a write: the EC churns and reports stale
  // values, so reads are not trusted for mode changes in that window.
  property bool settling: false

  property string sysfsDir: "/sys/class/power_supply/BAT0"
  property string endPath: sysfsDir + "/charge_control_end_threshold"
  property string helper: "/usr/local/bin/charge-limit-apply"
  readonly property int maxRevertAttempts: 3

  // Watchdog deadlines for process operations (bounded execution)
  property int readTimeoutMs: 2500
  property int writeTimeoutMs: 6000

  property string pendingMode: ""
  property int readFailures: 0
  property bool readPending: false

  function refresh() {
    if (readProc.running || readPending) return
    readPending = true
    readWatchdog.restart()
    readProc.running = true
  }

  function flagError(kind) {
    lastError = kind
    errorTimer.restart()
  }

  function abortRead() {
    readWatchdog.stop()
    if (readProc.running) {
      readProc.running = false
      readProc.signal(15)
    }
    if (root.readPending) {
      root.readPending = false
      if (++root.readFailures >= 3) root.supported = false
    }
  }

  function abortWrite(reason) {
    writeWatchdog.stop()
    var applied = root.pendingMode
    if (writeProc.running) {
      writeProc.running = false
      writeProc.signal(15)
    }
    if (!root.busy) return
    root.busy = false
    root.pendingMode = ""
    root.flagError(reason || "write")
    if (applied === "saver") root.revertPending = true
  }

  function applyMode(next) {
    if (next !== "saver" && next !== "full") return false
    lastError = ""
    errorTimer.stop()
    if (busy || writeProc.running) return false
    if (next === mode) return false
    if (!supported || endLimit < 0) {
      flagError("no-interface")
      return false
    }
    busy = true
    pendingMode = next
    writeProc.command = ["sudo", "-n", helper, next]
    writeWatchdog.restart()
    writeProc.running = true
    return true
  }

  // One dispatch of the owed saver revert. Bounded so a persistently
  // unhappy EC cannot spin the helper forever; replugging or clicking
  // saver always gives it a fresh chance.
  function revertToSaver() {
    if (!revertPending) return false
    if (revertAttempts >= maxRevertAttempts) return false
    if (!UPower.onBattery) return false
    if (busy || writeProc.running || settling) return false
    if (endLimit !== 100 || mode !== "full") return false
    if (!applyMode("saver")) return false
    revertAttempts++
    return true
  }

  Process {
    id: readProc
    command: ["head", "-c", "32", root.endPath]
    stdout: StdioCollector {
      id: readOut
      waitForEnd: true
    }
    onExited: function(code) {
      readWatchdog.stop()
      if (!root.readPending) return
      root.readPending = false
      if (code !== 0) {
        // Transient EC hiccups happen; only report unsupported after
        // several consecutive failures so one bad poll doesn't kill the
        // widget until the next shell restart.
        if (++root.readFailures >= 3) root.supported = false
        return
      }
      var raw = String(readOut.text || "").slice(0, 32)
      var end = Model.clampInt(raw, -1)
      if (end < 0) {
        if (++root.readFailures >= 3) root.supported = false
        return
      }
      root.readFailures = 0
      root.supported = true
      root.endLimit = end
      if (!root.busy && !root.settling) root.mode = Model.modeFor(end)
      // Charger left and the EC still reads 100: dispatch the owed revert.
      // Reads that land mid-apply or mid-settle are skipped by the guards;
      // the post-settle refresh re-checks.
      if (root.revertPending && !root.busy && !root.settling && !writeProc.running) {
        if (end !== 100) root.revertPending = false
        else root.revertToSaver()
      }
    }
    onRunningChanged: {
      if (!running) {
        readWatchdog.stop()
        // FailedToStart contract: running emitted false without exited
        if (root.readPending) {
          root.readPending = false
          if (++root.readFailures >= 3) root.supported = false
        }
      }
    }
  }

  Timer {
    id: readWatchdog
    interval: root.readTimeoutMs
    repeat: false
    onTriggered: root.abortRead()
  }

  Process {
    id: writeProc
    stderr: StdioCollector {
      id: writeErr
      waitForEnd: true
    }
    onExited: function(code) {
      writeWatchdog.stop()
      if (!root.busy) return
      var applied = root.pendingMode
      root.busy = false
      root.pendingMode = ""
      if (code !== 0) {
        root.flagError("write")
        // A failed saver apply may leave the EC at 100 while on battery;
        // keep the owed revert alive and let the retry timer take it.
        if (applied === "saver") root.revertPending = true
        return
      }
      // The helper exits right after its writes; the EC keeps churning for
      // a moment and reads back stale. Give it time to settle before the
      // confirming refresh instead of hammering it with reads.
      root.settling = true
      settleTimer.restart()
    }
    onRunningChanged: {
      if (!running) {
        writeWatchdog.stop()
        // FailedToStart contract: running emitted false without exited
        if (root.busy) {
          var applied = root.pendingMode
          root.busy = false
          root.pendingMode = ""
          root.flagError("write")
          if (applied === "saver") root.revertPending = true
        }
      }
    }
  }

  Timer {
    id: writeWatchdog
    interval: root.writeTimeoutMs
    repeat: false
    onTriggered: root.abortWrite("write")
  }

  // Post-write settle window: reads during it are not trusted for mode
  // changes; this refresh is the authoritative confirmation.
  Timer {
    id: settleTimer
    interval: 3000
    onTriggered: {
      root.settling = false
      root.refresh()
    }
  }

  Connections {
    target: UPower
    function onOnBatteryChanged() {
      root.revertAttempts = 0
      if (UPower.onBattery) {
        root.revertPending = true
        // Fast path: the cached read already says 100. The post-apply
        // refresh settles the rest either way.
        root.revertToSaver()
      } else {
        root.revertPending = false
      }
      root.refresh()
    }
  }

  // Errors clear themselves; they describe a moment, not a state.
  Timer {
    id: errorTimer
    interval: 6000
    onTriggered: root.lastError = ""
  }

  // Retries an owed revert every few seconds until a read confirms the
  // limit dropped (or the attempt budget is spent).
  Timer {
    id: revertRetryTimer
    interval: 5000
    repeat: true
    running: root.revertPending && root.revertAttempts < root.maxRevertAttempts
    onTriggered: root.revertToSaver()
  }

  // Slow poll keeps the bar pill honest against external changes
  // (firmware, EC, another tool); fast poll while the panel is open.
  Timer {
    id: slowPoll
    interval: 15000
    repeat: true
    running: true
    onTriggered: root.refresh()
  }

  Timer {
    id: fastPoll
    interval: 3000
    repeat: true
    running: false
    onTriggered: root.refresh()
  }

  function setPolling(on) {
    fastPoll.running = on
  }

  Component.onCompleted: {
    // A leftover one-shot full charge from before a reboot or hibernate
    // still owes its revert if the shell comes up on battery.
    revertPending = UPower.onBattery
    refresh()
  }

  Component.onDestruction: {
    readWatchdog.stop()
    writeWatchdog.stop()
    errorTimer.stop()
    settleTimer.stop()
    if (readProc.running) {
      readProc.running = false
      readProc.signal(15)
    }
    if (writeProc.running) {
      writeProc.running = false
      writeProc.signal(15)
    }
  }
}
