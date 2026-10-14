// Pins the style panel showing only what applies: label colours only where
// there are words (or nothing is focused — the defaults), label placement
// only for a shape's own label, groups in working order with rules only
// between groups that show, and square colour tiles.
//
//   node test/js/panel_relevance_test.js

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
const make = (n) => eval(body(n));

// Label placement: only labels that sit on a shape.
{
  const titleTargets = make("_titleTargetShapes");
  const ctx = {
    _isTextKind: (k) => k === "text" || k === "callout",
    _labelRidesShaft: (k) => k === "arrow" || k === "dimension",
    selectedShapes: [
      { kind: "rectangle", metadata: { title: "a" } },
      { kind: "text", metadata: { title: "b" } },
      { kind: "callout", metadata: { title: "c" } },
      { kind: "arrow", metadata: { title: "d" } },
      { kind: "circle", metadata: {} }
    ]
  };
  assert.deepStrictEqual(titleTargets.call(ctx).map((s) => s.kind), ["rectangle"]);
}

// Rules between groups only.
{
  const syncSeps = make("_syncPanelSeps");
  const el = (shown) => ({ style: { display: shown ? "" : "none" } });
  const seps = [el(true), el(true), el(true)];
  const run = (a, b, c, d) => {
    const kids = [a, seps[0], b, seps[1], c, seps[2], d].map((x) => (seps.includes(x) ? x : x));
    syncSeps.call({ _panelSeps: seps, paramsPopup: { children: kids } });
    return seps.map((s) => s.style.display !== "none");
  };
  assert.deepStrictEqual(run(el(1), el(1), el(1), el(1)), [true, true, true]);
  assert.deepStrictEqual(run(el(1), el(0), el(0), el(1)), [false, false, true], "one rule across hidden groups");
  assert.deepStrictEqual(run(el(0), el(1), el(0), el(0)), [false, false, false], "none at the top or bottom");
}

assert.ok(body("_refreshLabelSwatch").includes('onLabel || (!focused && !this._armedInkTool()) ? "" : "none";'),
  "Text/Behind only with words in focus, or nothing focused");
assert.ok(src.includes('[w.row, o.row, dashRow, fillRow, "|", fontRow, bgRow, "|", cs.row, "|", labelSection]'),
  "line, label, corners, placement — in that order");
assert.ok(body("_syncCornerRows").includes('this._paramsCornerInput.style.display = px > 0 ? "" : "none";'),
  "the corner slider shows once there are corners");
assert.ok(src.includes('".etcher-stylepanel .etcher-swatch { width: 100%; height: auto; aspect-ratio: 1 / 1; border-radius: 8px; }",'),
  "square colour tiles with soft corners");
console.log("panel relevance: all checks passed");
