import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Services.UPower
import "Model.js" as Model

// Owns the live charge-limit state. Reads go through a short cat process:
// sysfs pseudo-files misbehave under FileView watchers (transient empty
// reads flapped the widget into "unsupported"). Polling is deterministic.
Item {
  id: root

  // Live values, -1 while unknown.
  property int endLimit: -1
  property int startLimit: -1
  // "saver", "full", or "" while loading.
  property string mode: ""
  property bool supported: true
  property bool busy: false
  property string lastError: ""
  // The one-shot request: revert to saver on the next unplug.
  property bool fullArmed: false

  readonly property string sysfsDir: "/sys/class/power_supply/BAT0"
  readonly property string endPath: sysfsDir + "/charge_control_end_threshold"
  readonly property string startPath: sysfsDir + "/charge_control_start_threshold"

  function refresh() {
    if (readProc.running) return
    readProc.running = true
  }

  function flagError(kind) {
    lastError = kind
    errorTimer.restart()
  }

  function applyMode(next) {
    lastError = ""
    errorTimer.stop()
    var shown = busy ? pendingMode : mode
    if (busy || writeProc.running || next === shown) return
    if (!supported || endLimit < 0) {
      flagError("no-interface")
      return
    }
    var target = Model.thresholdsFor(next)
    var order = Model.writeOrder({ end: endLimit, start: startLimit }, target)
    busy = true
    pendingMode = next
    writeQueue = order.map(function(key) {
      return { kind: key, value: key === "start" ? String(target.start) : String(target.end) }
    })
    runNextWrite()
  }

  property string pendingMode: ""
  property var writeQueue: []

  function runNextWrite() {
    if (writeQueue.length === 0) {
      busy = false
      if (pendingMode === "full") fullArmed = true
      else if (pendingMode === "saver") fullArmed = false
      pendingMode = ""
      refresh()
      return
    }
    var next = writeQueue[0]
    writeQueue = writeQueue.slice(1)
    writeProc.command = ["sudo", "-n", "/usr/local/bin/charge-limit-apply", next.kind, next.value]
    writeProc.running = true
  }

  // Revert the one-shot full charge when the charger leaves.
  function onPowerSourceChanged() {
    if (UPower.onBattery && fullArmed && !busy && !writeProc.running) {
      applyMode("saver")
    }
  }

  Process {
    id: readProc
    command: ["cat", root.endPath, root.startPath]
    stdout: StdioCollector {
      id: readOut
      waitForEnd: true
    }
    onExited: function(code) {
      if (code !== 0) {
        root.supported = false
        return
      }
      var lines = String(readOut.text || "").split("\n")
      var kept = []
      for (var i = 0; i < lines.length; i++) {
        var t = String(lines[i] || "").trim()
        if (t !== "") kept.push(t)
      }
      var parsed = Model.parseThresholds(kept[0], kept[1])
      if (!parsed) {
        root.supported = false
        return
      }
      root.supported = true
      root.endLimit = parsed.end
      root.startLimit = parsed.start
      // While a write is in flight the panel shows the optimistic target.
      if (!root.busy) root.mode = Model.modeFor(parsed.end)
      if (root.mode === "saver") root.fullArmed = false
    }
  }

  Process {
    id: writeProc
    stderr: StdioCollector {
      waitForEnd: true
    }
    onExited: function(code) {
      if (code !== 0) {
        root.busy = false
        root.writeQueue = []
        root.pendingMode = ""
        root.flagError("write")
        root.refresh()
        return
      }
      root.runNextWrite()
    }
  }

  Connections {
    target: UPower
    function onOnBatteryChanged() {
      root.onPowerSourceChanged()
      root.refresh()
    }
  }

  // Errors clear themselves; they describe a moment, not a state.
  Timer {
    id: errorTimer
    interval: 6000
    onTriggered: root.lastError = ""
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

  Component.onCompleted: refresh()
}
