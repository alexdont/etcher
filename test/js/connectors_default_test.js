// Pins how shapes get connected now: by the ARROW TOOL, which snaps its ends
// to a shape's anchors as it draws. The cursor's hover dots and the ⋯
// connector toggle are retired; only a host that has no use for anchors at
// all (`connectors={:off}` → `data-connectors="off"`) turns snapping off.
//
//   node test/js/connectors_default_test.js

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
const connectorsOn = eval(body("_connectorsOn"));
const hardOff = eval(body("_connectorsHardOff"));
const ctx = (attr) => ({ el: { dataset: attr === undefined ? {} : { connectors: attr } },
  _connectorsHardOff: hardOff, _getPref: () => false });

assert.strictEqual(connectorsOn.call(ctx()), true, "on, with no setting to turn off");
assert.strictEqual(connectorsOn.call(ctx("off")), false, "a host with no use for anchors turns them off");
assert.ok(!src.includes('self._setPref("connectors"'), "no ⋯ toggle writes a connectors preference");
assert.ok(body("_connectorsAvailableFor").includes("return false &&"), "the cursor's hover dots are retired");

// The arrow tool: dots on hover, the tail tied at a press near an anchor,
// the head snapping while it is drawn, and tied ends kept at commit.
assert.ok(src.includes('} else if (this.activeTool === "arrow") {\n          this._arrowToolHover(e);'));
assert.ok(body("_arrowToolHover").includes("this._paintTargetDots(this._arrowSnapState(pt, null));"));
assert.ok(body("_startArrow").includes("from: tailSnap ? { uuid: tailSnap.shape.uuid, anchor: tailSnap.anchor } : null,"));
const upd = body("_updateDimension");
assert.ok(upd.includes("patch.to = headSnap ? { uuid: headSnap.shape.uuid, anchor: headSnap.anchor } : null;"));
assert.ok(upd.includes("if (state.candidate && state.candidate.uuid === ds.sourceUuid) state = { candidate: null, snap: null };"),
  "the source shape is no target until the pointer has left it");

{
  const shaftGeometry = eval(body("_shaftGeometry"));
  const self = { draftState: { geometry: { a: [1, 2], b: [9, 9], from: { uuid: "s", anchor: "e" }, to: { uuid: "t", anchor: "w" }, points: [] } } };
  const g = shaftGeometry.call(self, { x: 5, y: 5 }, { x: 7, y: 7 });
  assert.deepStrictEqual([g.a, g.b], [[1, 2], [9, 9]], "tied ends stay on their anchors");
  const free = shaftGeometry.call({ draftState: { geometry: { a: [0, 0], b: [0, 0], from: null, to: null } } }, { x: 5, y: 5 }, { x: 7, y: 7 });
  assert.deepStrictEqual([free.a, free.b], [[5, 5], [7, 7]], "free ends go where the pointer did");
}

console.log("connectors (arrow tool): all checks passed");
