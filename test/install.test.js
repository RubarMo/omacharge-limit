const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");
const README_PATH = path.join(ROOT, "README.md");
const INSTALLER_PATH = path.join(ROOT, "tools", "install-helper.sh");
const HELPER_PATH = path.join(ROOT, "tools", "charge-limit-apply");

test("manifest.json defines plugin id rubar.omacharge-limit", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  assert.strictEqual(manifest.id, "rubar.omacharge-limit");
  assert.strictEqual(manifest.schemaVersion, 1);
});

test("install-helper.sh passes bash syntax check", () => {
  execSync(`bash -n "${INSTALLER_PATH}"`, { stdio: "pipe" });
});

test("charge-limit-apply passes bash syntax check", () => {
  execSync(`bash -n "${HELPER_PATH}"`, { stdio: "pipe" });
});

test("README documents setup script at manifest-derived path", () => {
  const readme = fs.readFileSync(README_PATH, "utf8");
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const expectedPath = `~/.config/omarchy/plugins/${manifest.id}/tools/install-helper.sh`;
  assert.ok(
    readme.includes(expectedPath),
    `README.md should document setup path: ${expectedPath}`
  );
  assert.ok(
    !readme.includes("rubar.charge-limit"),
    "README.md should not contain obsolete plugin id 'rubar.charge-limit'"
  );
});

test("install-helper.sh configures strict sudoers rule for exact subcommands check, saver, full", () => {
  const installer = fs.readFileSync(INSTALLER_PATH, "utf8");
  // Sudoers rule must strictly permit only check, saver, and full
  const expectedRulePattern = /NOPASSWD:\s*\$HELPER_DST\s+check,\s*\$HELPER_DST\s+saver,\s*\$HELPER_DST\s+full/;
  assert.match(
    installer,
    expectedRulePattern,
    "Sudoers rule must only permit exactly check, saver, full"
  );
  // Must not grant wildcard or broad command execution
  assert.ok(!installer.includes("NOPASSWD: ALL"), "Rule line should not grant broad ALL commands");
  assert.ok(installer.includes("omarchy plugin enable rubar.omacharge-limit"));
  assert.ok(!installer.includes("rubar.charge-limit"));
});

test("README documents removal matching installed paths", () => {
  const readme = fs.readFileSync(README_PATH, "utf8");
  assert.ok(readme.includes("omarchy plugin remove rubar.omacharge-limit"));
  assert.ok(readme.includes("sudo rm /usr/local/bin/charge-limit-apply"));
  assert.ok(readme.includes("sudo rm /etc/sudoers.d/charge-limit"));
});
