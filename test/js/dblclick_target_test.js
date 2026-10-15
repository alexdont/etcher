// A double-click edits the shape its first click selected, never one under
// it; and a draft waiting for its second click shows no dots.
//
//   node test/js/dblclick_target_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher.js"), "utf8");
function lift(name) {
  const start = src.indexOf(`    ${name}: function(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf("\n    },", start);
  return eval("(function" + src.slice(src.indexOf("(", start), end + "\n    }".length) + ")");
}

const target = lift("_dblClickTarget");
const box = { uuid: "b", kind: "text" }, callout = { uuid: "c", kind: "callout" };
const layer = (editing, inside) => ({
  editingShape: editing, _toImage: () => ({ x: 1, y: 1 }),
  _shapeContainsPoint: (s) => s === editing && inside
});
assert.strictEqual(target.call(layer(box, true), callout, {}), box,
  "the point lies on the selected text box: it is edited, not the callout under it");
assert.strictEqual(target.call(layer(box, false), callout, {}), callout,
  "off the selected shape, the shape that was hit");
assert.strictEqual(target.call(layer(null, false), callout, {}), callout);

assert.ok(/if \(samePlace && now - prev\.t < self\._TAP_CYCLE_DBL_MS\) \{/.test(src),
  "a double-click's second tap stays on the same shape instead of cycling under it");
assert.ok(src.includes("hit = self._dblClickTarget(hit, e);") &&
  src.includes("var target = self._dblClickTarget(shape, e);"),
  "both double-click paths resolve the target the same way");

// armed draft: no dots
const sync = lift("_syncDraftHandles");
let removed = 0, rendered = 0;
sync.call({
  editingShape: null, _draftActive: () => ({ kind: "rectangle", armed: true }),
  _removeHandles: () => removed++, _renderHandles: () => rendered++
});
assert.strictEqual(rendered, 0, "a draft waiting for its second click shows no dots");
assert.strictEqual(removed, 1);
sync.call({
  editingShape: null, _draftActive: () => ({ kind: "rectangle" }),
  _removeHandles: () => removed++, _renderHandles: () => rendered++
});
assert.strictEqual(rendered, 0, "a press that hasn't moved shows no dots — it may be a click");
sync.call({
  editingShape: null, _draftActive: () => ({ kind: "rectangle", pulled: true }),
  _removeHandles: () => removed++, _renderHandles: () => rendered++
});
assert.strictEqual(rendered, 1, "a press-drag shows its dots");
sync.call({
  editingShape: null, _draftActive: () => ({ kind: "polygon" }),
  _removeHandles: () => removed++, _renderHandles: () => rendered++
});
assert.strictEqual(rendered, 2, "a polygon's vertex dots are its placement, always shown");
assert.ok(/dPull\.pulled = true;/.test(src) && src.includes("if (pulledNow) this._syncDraftHandles();"),
  "the dots come up once the press travels past a click");
assert.strictEqual((src.match(/armed = true;\n        this\._syncDraftHandles\(\);/g) || []).length, 5,
  "every place that arms a draft drops its dots");

console.log("dblclick target + armed dots: all checks passed");
