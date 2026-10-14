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
assert.ok(src.includes('[w.row, o.row, "|", fontRow, bgRow, "|", chipsRow, dashRow, fillRow, cs.row, labelSection]'),
  "line, label, then the choice buttons");
// The choice rows fold into one slim row of buttons with pop-ups.
assert.ok(src.includes('[dashRow, fillRow, cs.row, labelSection].forEach(function(r) { r.classList.add("etcher-in-chips"); });'));
assert.ok(src.includes('".etcher-stylepanel:not([data-size=\\"compact\\"]) .etcher-in-chips { display: none !important; }",'),
  "hidden as rows in the full panel, kept inline in the compact strip");
{
  const syncChips = make("_syncStyleChips");
  const btn = (sel, html) => ({ classList: { contains: (c) => c === "is-selected" && sel }, innerHTML: html, style: {} });
  const chip = (shown, btns) => ({ row: { style: { display: shown ? "" : "none" } }, btns: () => btns, el: { style: {}, innerHTML: "" } });
  const a = chip(true, [btn(false, "<i>a</i>"), btn(true, "<i>b</i>")]);
  const b = chip(false, [btn(true, "<i>c</i>")]);
  const ctx = { _chips: [a, b], _chipsRow: { style: {} } };
  syncChips.call(ctx);
  assert.ok(a.el.innerHTML.includes("<i>b</i>"), "a button wears its current choice");
  assert.strictEqual(b.el.style.display, "none", "and hides when its row would");
  assert.strictEqual(ctx._chipsRow.style.display, "");
}
assert.ok(body("_openChipPop").includes("orig.click();"), "a pop-up option presses the real button");
assert.ok(body("_syncCornerRows").includes('this._paramsCornerInput.style.display = px > 0 ? "" : "none";'),
  "the corner slider shows once there are corners");
assert.ok(src.includes('".etcher-stylepanel .etcher-swatch { width: 100%; height: auto; aspect-ratio: 1 / 1; border-radius: 8px; }",'),
  "square colour tiles with soft corners");
console.log("panel relevance: all checks passed");
