// The thickness readout is typeable. What is typed is held to the slider's
// range; anything that isn't a number keeps the previous size.
//
//   node test/js/typed_weight_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher.js"), "utf8");
global.WEIGHT_MIN = Number(src.match(/var WEIGHT_MIN = (\d+);/)[1]);
global.WEIGHT_MAX = Number(src.match(/var WEIGHT_MAX = (\d+);/)[1]);
const start = src.indexOf("    _typedWeight: function(");
const end = src.indexOf("\n    },", start);
const typed = eval("(function" + src.slice(src.indexOf("(", start), end + "\n    }".length) + ")");

assert.strictEqual(typed("4"), 4, "a size in range is the size");
assert.strictEqual(typed(" 37 "), 37);
assert.strictEqual(typed("7.6"), 8, "rounded to a whole size");
assert.strictEqual(typed("999"), WEIGHT_MAX, "past the top: the top");
assert.strictEqual(typed("0"), WEIGHT_MIN, "at the bottom: 1");
assert.strictEqual(typed("-5"), WEIGHT_MIN, "under the bottom: 1");
for (const junk of ["abc", "4px", "", "  ", "1e5", "--3", null]) {
  assert.strictEqual(typed(junk), null, `${JSON.stringify(junk)} is not a size: keep the previous one`);
}
assert.ok(src.includes("self._makeWeightTypeable(w.val, w.input, function(n) {\n        self._setLineParam(\"width\", n, true);"),
  "the panel's thickness readout is typeable");
assert.ok(src.includes("self._makeWeightTypeable(w.val, w.input, function(n) {\n        self._setMarkerStyleProp(\"width\", n, true);"),
  "and the marker's");
console.log("typed weight: all checks passed");
