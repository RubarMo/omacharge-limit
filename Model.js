// Pure helpers for the charge-limit widget. No I/O, no shell — safe to test
// with plain node by stubbing `module`.

// Threshold pairs. Saver persists; full is a one-shot that reverts on unplug.
var END_SAVER = 80
var START_SAVER = 75
var END_FULL = 100
var START_FULL = 99

function clampInt(raw, fallback) {
  var n = parseInt(String(raw || "").trim(), 10)
  if (isNaN(n)) return fallback
  return Math.max(0, Math.min(100, n))
}

// Parse the two sysfs threshold readings. Returns { end, start } or null.
function parseThresholds(endRaw, startRaw) {
  var end = clampInt(endRaw, -1)
  var start = clampInt(startRaw, -1)
  if (end < 0 || start < 0) return null
  return { end: end, start: start }
}

// Which mode do the live thresholds represent? "full" only when the end
// stop-point is 100; anything else (including firmware defaults) reads
// as saver so the widget never claims a full charge it does not hold.
function modeFor(end) {
  return Number(end) === END_FULL ? "full" : "saver"
}

function thresholdsFor(mode) {
  if (mode === "full") return { end: END_FULL, start: START_FULL }
  return { end: END_SAVER, start: START_SAVER }
}

// Write order that keeps start <= end at every intermediate step.
function writeOrder(current, target) {
  if (Number(target.start) < Number(current.start)) return ["start", "end"]
  return ["end", "start"]
}

if (typeof module !== "undefined") {
  module.exports = {
    END_SAVER: END_SAVER,
    START_SAVER: START_SAVER,
    END_FULL: END_FULL,
    START_FULL: START_FULL,
    clampInt: clampInt,
    parseThresholds: parseThresholds,
    modeFor: modeFor,
    thresholdsFor: thresholdsFor,
    writeOrder: writeOrder
  }
}
