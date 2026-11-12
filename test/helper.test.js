const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { execSync, spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const HELPER = path.join(ROOT, "tools", "charge-limit-apply");

function makeMockSysfs(endVal = "80", startVal = "75") {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "omacharge-test-"));
  const batDir = path.join(tmpDir, "BAT0");
  fs.mkdirSync(batDir, { recursive: true });
  fs.writeFileSync(path.join(batDir, "charge_control_end_threshold"), String(endVal));
  fs.writeFileSync(path.join(batDir, "charge_control_start_threshold"), String(startVal));
  return {
    tmpDir,
    batDir,
    endPath: path.join(batDir, "charge_control_end_threshold"),
    startPath: path.join(batDir, "charge_control_start_threshold"),
    cleanup: () => fs.rmSync(tmpDir, { recursive: true, force: true }),
  };
}

test("charge-limit-apply rejects missing or invalid arguments with exit 2", () => {
  assert.throws(
    () => execSync(`"${HELPER}"`, { stdio: "pipe" }),
    (err) => err.status === 2
  );
  assert.throws(
    () => execSync(`"${HELPER}" invalid_mode`, { stdio: "pipe" }),
    (err) => err.status === 2
  );
});

test("charge-limit-apply exits 1 when no supported battery is found", () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "empty-sysfs-"));
  try {
    assert.throws(
      () =>
        execSync(`"${HELPER}" check`, {
          env: { ...process.env, CHARGE_LIMIT_SYSFS: emptyDir },
          stdio: "pipe",
        }),
      (err) => err.status === 1
    );
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test("charge-limit-apply check prints current thresholds", () => {
  const mock = makeMockSysfs("80", "75");
  try {
    const out = execSync(`"${HELPER}" check`, {
      env: { ...process.env, CHARGE_LIMIT_SYSFS: mock.tmpDir },
      encoding: "utf8",
    });
    assert.match(out.trim(), /^end=80 start=75$/);
  } finally {
    mock.cleanup();
  }
});

test("charge-limit-apply saver sets end threshold to 80 and drops start threshold if >= 80", () => {
  const mock = makeMockSysfs("100", "95");
  try {
    execSync(`"${HELPER}" saver`, {
      env: { ...process.env, CHARGE_LIMIT_SYSFS: mock.tmpDir },
      stdio: "pipe",
    });
    const end = fs.readFileSync(mock.endPath, "utf8").trim();
    const start = fs.readFileSync(mock.startPath, "utf8").trim();
    assert.strictEqual(end, "80");
    assert.strictEqual(start, "75");
  } finally {
    mock.cleanup();
  }
});

test("charge-limit-apply full sets end threshold to 100", () => {
  const mock = makeMockSysfs("80", "75");
  try {
    execSync(`"${HELPER}" full`, {
      env: { ...process.env, CHARGE_LIMIT_SYSFS: mock.tmpDir },
      stdio: "pipe",
    });
    const end = fs.readFileSync(mock.endPath, "utf8").trim();
    assert.strictEqual(end, "100");
  } finally {
    mock.cleanup();
  }
});

test("charge-limit-apply responds to SIGTERM promptly and cleanly", async () => {
  const mock = makeMockSysfs("80", "75");
  try {
    const child = spawn(HELPER, ["saver"], {
      env: { ...process.env, CHARGE_LIMIT_SYSFS: mock.tmpDir },
    });

    const exitPromise = new Promise((resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal }));
    });

    // Send SIGTERM immediately
    child.kill("SIGTERM");
    const res = await exitPromise;
    assert.ok(res.code === 143 || res.signal === "SIGTERM");
  } finally {
    mock.cleanup();
  }
});
