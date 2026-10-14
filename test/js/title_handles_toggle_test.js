// Pins that a label's corner dots always show — the ⋯ "label dots" toggle is
// gone. Labels, text and callouts all work as point text now (older ones
// convert when picked up), and point text always has its handles.
//
//   node test/js/title_handles_toggle_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher.js"), "utf8");
function body(name) {
  const start = src.indexOf(`    ${name}: function(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf("\n    },", start);
  return "(function" + src.slice(src.indexOf("(", start), end + "\n    }".length) + ")";
}

assert.strictEqual(eval(body("_titleHandlesOn")).call({ _getPref: () => false }), true,
  "always on, whatever an old saved preference says");
assert.ok(!src.includes('self._setPref("title_handles"'), "no ⋯ toggle writes the preference");
assert.ok(!src.includes("self.titleHandlesBtn = self._makePopupAction"), "and there is no button for it");

console.log("label dots: always shown, no toggle");
