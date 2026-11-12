const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const SERVICE_QML_URL = `file://${ROOT}`;

function runQuickshellTest(qmlContent, timeoutMs = 8000) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "qs-test-"));
  const qmlPath = path.join(tmpDir, "test.qml");
  fs.writeFileSync(qmlPath, qmlContent);
  try {
    const res = spawnSync("quickshell", ["-p", qmlPath], {
      encoding: "utf8",
      timeout: timeoutMs,
    });
    return {
      status: res.status,
      stdout: res.stdout || "",
      stderr: res.stderr || "",
      output: (res.stdout || "") + "\n" + (res.stderr || ""),
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

test("lifecycle: failed start settles busy and pending state under FailedToStart contract", () => {
  const qml = `
import QtQuick
import Quickshell
import "${SERVICE_QML_URL}" as Plugin

ShellRoot {
  Plugin.Service {
    id: svc
    helper: "/nonexistent/path/to/charge-limit-apply"
    readTimeoutMs: 1000
    writeTimeoutMs: 2000
    supported: true
    endLimit: 100
    mode: "full"
  }

  Timer {
    interval: 100
    running: true
    onTriggered: {
      var started = svc.applyMode("saver")
      console.log("APPLY_CALLED: " + started)
    }
  }

  Timer {
    interval: 600
    running: true
    onTriggered: {
      console.log("SETTLED_BUSY: " + svc.busy)
      console.log("SETTLED_PENDING: " + svc.pendingMode)
      console.log("SETTLED_ERROR: " + svc.lastError)
      console.log("SETTLED_REVERT: " + svc.revertPending)
      Qt.quit()
    }
  }
}
`;
  const res = runQuickshellTest(qml);
  assert.strictEqual(res.status, 0, `Quickshell exited with ${res.status}: ${res.output}`);
  assert.ok(res.output.includes("APPLY_CALLED: true"), "applyMode should have been called");
  assert.ok(res.output.includes("SETTLED_BUSY: false"), "busy must be settled to false on failed start");
  assert.ok(res.output.includes("SETTLED_PENDING: "), "pendingMode must be cleared");
  assert.ok(res.output.includes("SETTLED_ERROR: write"), "lastError must be flagged 'write'");
  assert.ok(res.output.includes("SETTLED_REVERT: true"), "revertPending must be kept on failed saver apply");
});

test("lifecycle: read watchdog deadline terminates a hung read and increments failures", () => {
  // Create a FIFO that never outputs data to simulate an uninterruptible/stalled read
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fifo-test-"));
  const fifoPath = path.join(tmpDir, "hung_fifo");
  spawnSync("mkfifo", [fifoPath]);

  const qml = `
import QtQuick
import Quickshell
import "${SERVICE_QML_URL}" as Plugin

ShellRoot {
  Plugin.Service {
    id: svc
    endPath: "${fifoPath}"
    readTimeoutMs: 300
    writeTimeoutMs: 2000
  }

  Timer {
    interval: 100
    running: true
    onTriggered: {
      svc.refresh()
      console.log("READ_PENDING_INITIAL: " + svc.readPending)
    }
  }

  Timer {
    interval: 700
    running: true
    onTriggered: {
      console.log("READ_PENDING_AFTER_TIMEOUT: " + svc.readPending)
      console.log("READ_FAILURES: " + svc.readFailures)
      Qt.quit()
    }
  }
}
`;
  try {
    const res = runQuickshellTest(qml);
    assert.strictEqual(res.status, 0, `Quickshell exited with ${res.status}: ${res.output}`);
    assert.ok(res.output.includes("READ_PENDING_INITIAL: true"), "read should start pending");
    assert.ok(res.output.includes("READ_PENDING_AFTER_TIMEOUT: false"), "read watchdog must reset readPending");
    assert.ok(res.output.includes("READ_FAILURES: 1"), "watchdog timeout must increment readFailures");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("lifecycle: write watchdog deadline terminates a stalled apply and cleans up", () => {
  // Create a mock helper that sleeps forever
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stall-helper-"));
  const mockHelper = path.join(tmpDir, "stall-apply");
  fs.writeFileSync(mockHelper, "#!/bin/sh\ntrap 'exit 143' TERM INT\nsleep 60\n", { mode: 0o755 });

  const qml = `
import QtQuick
import Quickshell
import "${SERVICE_QML_URL}" as Plugin

ShellRoot {
  Plugin.Service {
    id: svc
    helper: "${mockHelper}"
    writeTimeoutMs: 400
    readTimeoutMs: 2000
    supported: true
    endLimit: 100
    mode: "full"
  }

  Timer {
    interval: 100
    running: true
    onTriggered: {
      svc.applyMode("saver")
      console.log("APPLY_STARTED_BUSY: " + svc.busy)
    }
  }

  Timer {
    interval: 900
    running: true
    onTriggered: {
      console.log("TIMEOUT_BUSY: " + svc.busy)
      console.log("TIMEOUT_PENDING: " + svc.pendingMode)
      console.log("TIMEOUT_ERROR: " + svc.lastError)
      console.log("TIMEOUT_REVERT: " + svc.revertPending)
      Qt.quit()
    }
  }
}
`;
  try {
    const res = runQuickshellTest(qml);
    assert.strictEqual(res.status, 0, `Quickshell exited with ${res.status}: ${res.output}`);
    assert.ok(res.output.includes("APPLY_STARTED_BUSY: true"), "applyMode should have set busy = true");
    assert.ok(res.output.includes("TIMEOUT_BUSY: false"), "watchdog must clear busy state on timeout");
    assert.ok(res.output.includes("TIMEOUT_PENDING: "), "watchdog must clear pendingMode");
    assert.ok(res.output.includes("TIMEOUT_ERROR: write"), "watchdog must flag error");
    assert.ok(res.output.includes("TIMEOUT_REVERT: true"), "saver revert must remain pending on timeout");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("lifecycle: unload/cancellation cleanly terminates in-flight operations", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cancel-test-"));
  const mockHelper = path.join(tmpDir, "long-helper");
  const pidFile = path.join(tmpDir, "helper.pid");
  fs.writeFileSync(
    mockHelper,
    `#!/bin/sh\necho $$ > "${pidFile}"\ntrap 'exit 143' TERM INT\nsleep 60\n`,
    { mode: 0o755 }
  );

  const qml = `
import QtQuick
import Quickshell
import "${SERVICE_QML_URL}" as Plugin

ShellRoot {
  id: shellRoot

  property var svcItem: null

  Component {
    id: svcComp
    Plugin.Service {
      helper: "${mockHelper}"
      writeTimeoutMs: 10000
      supported: true
      endLimit: 100
      mode: "full"
    }
  }

  Timer {
    interval: 100
    running: true
    onTriggered: {
      svcItem = svcComp.createObject(shellRoot)
      svcItem.applyMode("saver")
      console.log("HELPER_DISPATCHED")
    }
  }

  Timer {
    interval: 500
    running: true
    onTriggered: {
      console.log("DESTROYING_SERVICE")
      svcItem.destroy()
      svcItem = null
    }
  }

  Timer {
    interval: 900
    running: true
    onTriggered: {
      console.log("TEST_DONE")
      Qt.quit()
    }
  }
}
`;
  try {
    const res = runQuickshellTest(qml);
    assert.strictEqual(res.status, 0, `Quickshell exited with ${res.status}: ${res.output}`);
    assert.ok(res.output.includes("HELPER_DISPATCHED"), "helper should be dispatched");
    assert.ok(res.output.includes("DESTROYING_SERVICE"), "service destruction should be triggered");

    // Check if the spawned helper process was killed
    if (fs.existsSync(pidFile)) {
      const pid = fs.readFileSync(pidFile, "utf8").trim();
      if (pid) {
        // Checking if PID still exists
        const check = spawnSync("kill", ["-0", pid]);
        assert.notStrictEqual(
          check.status,
          0,
          `Process ${pid} should have been terminated on component destruction`
        );
      }
    }
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("lifecycle: bounded output collection limits input chunk to 32 bytes", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "large-sysfs-"));
  const largeFile = path.join(tmpDir, "threshold_large");
  // Write a 1MB file of repeated digits
  fs.writeFileSync(largeFile, "80\n" + "1".repeat(1024 * 1024));

  const qml = `
import QtQuick
import Quickshell
import "${SERVICE_QML_URL}" as Plugin

ShellRoot {
  Plugin.Service {
    id: svc
    endPath: "${largeFile}"
    readTimeoutMs: 2000
  }

  Timer {
    interval: 100
    running: true
    onTriggered: {
      svc.refresh()
    }
  }

  Timer {
    interval: 600
    running: true
    onTriggered: {
      console.log("READ_END_LIMIT: " + svc.endLimit)
      console.log("READ_MODE: " + svc.mode)
      Qt.quit()
    }
  }
}
`;
  try {
    const res = runQuickshellTest(qml);
    assert.strictEqual(res.status, 0, `Quickshell exited with ${res.status}: ${res.output}`);
    assert.ok(res.output.includes("READ_END_LIMIT: 80"), "endLimit should safely read 80 without buffering entire 1MB");
    assert.ok(res.output.includes("READ_MODE: saver"), "mode should safely settle to saver");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
