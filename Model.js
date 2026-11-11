// Pure helpers for the charge-limit widget. No I/O, no shell — safe to test
// with plain node by stubbing `module`.

// The threshold pairs themselves live in tools/charge-limit-apply, which
// owns the writes and the constraint-safe ordering.
var END_FULL = 100

function clampInt(raw, fallback) {
  var n = parseInt(String(raw || "").trim(), 10)
  if (isNaN(n)) return fallback
  return Math.max(0, Math.min(100, n))
}

// Which mode does the live end threshold represent? "full" only when the end
// stop-point is 100; anything else (including firmware defaults) reads
// as saver so the widget never claims a full charge it does not hold.
function modeFor(end) {
  return Number(end) === END_FULL ? "full" : "saver"
}

if (typeof module !== "undefined") {
  module.exports = {
    END_FULL: END_FULL,
    clampInt: clampInt,
    modeFor: modeFor
  }
}
