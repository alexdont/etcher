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
// Affinity-style: every setting is a small button showing its value; its
// controls open in a pop-up (the real rows, moved in and back out).
assert.ok(src.includes('[o.row, bgRow, dashRow, fillRow, cs.row, labelSection]\n        .forEach(function(r) { r.classList.add("etcher-in-chips"); });'),
  "the less-used settings fold into buttons");
assert.ok(src.includes('[w.row, fontRow, chipsRow, o.row, bgRow, dashRow, fillRow, cs.row, labelSection]'),
  "thickness and label size stay out as slim lines, the buttons below");
assert.ok(src.includes('row.classList.add("etcher-inline-row");') && src.includes('"Thickness");') && src.includes('"Label size");'),
  "each with its icon");
assert.ok(src.includes('".etcher-stylepanel:not([data-size=\\"compact\\"]) .etcher-in-chips { display: none !important; }",'),
  "hidden as rows in the full panel, kept inline in the compact strip");
{
  const syncChips = make("_syncStyleChips");
  const row = (shown, head) => ({ style: { display: shown ? "" : "none" }, classList: { contains: (c) => !!head && c === "etcher-marker-row-head" } });
  const a = { rows: [row(true)], face: () => "<b>3</b>", el: { style: {}, innerHTML: "" } };
  const b = { rows: [row(false, false), row(true, true)], face: () => "x", el: { style: {}, innerHTML: "" } };
  const ctx = { _chips: [a, b], _chipsRow: { style: {} } };
  syncChips.call(ctx);
  assert.ok(a.el.innerHTML.includes("<b>3</b>"), "a button shows its current value");
  assert.strictEqual(b.el.style.display, "none", "and hides when its controls would (a heading alone does not count)");
  assert.strictEqual(ctx._chipsRow.style.display, "");
}
assert.ok(body("_openChipPop").includes("pop.appendChild(row);") && body("_closeChipPop").includes("ph.parentNode.insertBefore(row, ph);"),
  "the pop-up holds the real controls and gives them back");
assert.ok(body("_syncCornerRows").includes('this._paramsCornerInput.style.display = px > 0 ? "" : "none";'),
  "the corner slider shows once there are corners");
assert.ok(src.includes('".etcher-stylepanel .etcher-swatch { width: 100%; height: auto; aspect-ratio: 1 / 1; border-radius: 8px; }",'),
  "square colour tiles with soft corners");
// The background switch is folded into the Behind chip.
assert.ok(!/key: "[a-z]+"[^\n]*rows: \[[^\]]*bgRow/.test(src), "no button opens the old switch row — it is the Behind chip's now");
assert.ok(body("_syncBgChoices").includes("self._setLabelBg(null, true);"), "the chip's popup offers No background");
assert.ok(body("_syncBgChoices").includes('row.style.display = this._labelBgPickTarget ? "" : "none";'), "only when aimed at the plate");

assert.ok(src.includes('".etcher-chips { display: flex; flex-wrap: nowrap; gap: 6px; }",') &&
  src.includes('"  flex: 1 1 0; min-width: 0; height: 42px; padding: 4px 2px 3px; overflow: hidden;",'),
  "the buttons share one row evenly and never wrap");

assert.ok(src.includes('<span class="etcher-chip-caption">') && src.includes('caption: "Corners"'),
  "each button says what it is for under its value");

console.log("panel relevance: all checks passed");
