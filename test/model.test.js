const test = require("node:test");
const assert = require("node:assert");
const Model = require("../Model.js");

test("Model.clampInt parses and clamps values within [0, 100]", () => {
  assert.strictEqual(Model.clampInt("80", -1), 80);
  assert.strictEqual(Model.clampInt("100", -1), 100);
  assert.strictEqual(Model.clampInt("0", -1), 0);
  assert.strictEqual(Model.clampInt("150", -1), 100);
  assert.strictEqual(Model.clampInt("-5", -1), 0);
  assert.strictEqual(Model.clampInt("  75 \n", -1), 75);
});

test("Model.clampInt falls back on non-numeric or invalid input", () => {
  assert.strictEqual(Model.clampInt("", -1), -1);
  assert.strictEqual(Model.clampInt("abc", -1), -1);
  assert.strictEqual(Model.clampInt(null, -1), -1);
  assert.strictEqual(Model.clampInt(undefined, -1), -1);
});

test("Model.clampInt bounds excessively long strings", () => {
  // Input larger than 16 characters is sliced safely before parseInt
  const oversized = "80" + "0".repeat(100);
  // Sliced to 16 chars: "8000000000000000" -> clamped to 100
  assert.strictEqual(Model.clampInt(oversized, -1), 100);
});

test("Model.modeFor returns 'full' only for 100", () => {
  assert.strictEqual(Model.modeFor(100), "full");
  assert.strictEqual(Model.modeFor("100"), "full");
  assert.strictEqual(Model.modeFor(80), "saver");
  assert.strictEqual(Model.modeFor(75), "saver");
  assert.strictEqual(Model.modeFor(0), "saver");
  assert.strictEqual(Model.modeFor(-1), "saver");
  assert.strictEqual(Model.modeFor(""), "saver");
});
