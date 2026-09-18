// Pins the label's INK centring.
//
// SVG places text by its baseline, so a line of digits — no descenders —
// sits low in its em box: measured against the painted extents, the
// glyphs had roughly an x-height of slack above the rect and OVERHUNG
// its bottom edge. On a shaft-riding label that is the line grazing the
// digit bottoms while empty margin sits above, and the offset shrinks
// with the font, so the label appears to shift as you zoom out.
//
// The render measures what was actually painted and shifts the text so
// its visible centre IS the rect's centre. The rect, the plate, the cut
// and the handles all key off the rect and do not move.
//
//   node test/js/label_ink_centering_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

// ── the render does it, after the box is final ────────────────────────────

const renderStart = src.indexOf("    _renderTitleSibling: function");
assert.notStrictEqual(renderStart, -1, "could not find _renderTitleSibling");
const renderEnd = src.indexOf("\n    },", src.indexOf("if (lineEl) {", renderStart));
const render = src.slice(renderStart, renderEnd);

const blockStart = render.indexOf("          try {\n            var inkBox = textEl.getBBox();");
assert.notStrictEqual(blockStart, -1,
  "the render must measure the painted ink and re-centre the text on it");
const block = render.slice(blockStart, render.indexOf("} catch (_) {}", blockStart) + "} catch (_) {}".length);

// Ordering matters: the shift is measured against the FINAL box, so it
// has to run after the shrink-wrap and after the shaft/aligned
// re-anchors move `ty`.
const shrinkAt = render.indexOf("shape._renderedTitleImage = shrunk;");
assert.ok(shrinkAt !== -1 && shrinkAt < blockStart,
  "the ink shift must run after the box is shrink-wrapped and re-anchored");

// ── the arithmetic ────────────────────────────────────────────────────────

function runShift(inkY, inkH, ty, th, startY) {
  const textEl = {
    y: startY,
    getBBox: () => ({ x: 0, y: inkY, width: 10, height: inkH }),
    getAttribute: (k) => (k === "y" ? String(textEl.y) : null),
    setAttribute: (k, v) => { if (k === "y") textEl.y = Number(v); },
  };
  new Function("textEl", "ty", "th", block)(textEl, ty, th);
  return textEl.y;
}

{
  // The measured case: rect 100..140 (centre 120), ink painted 111..137
  // (centre 124) — 4px low. The baseline moves up by exactly that.
  const y = runShift(111, 26, 100, 40, 200);
  assert.strictEqual(y, 196, "the text shifts by the ink's offset from the rect centre");
}

{
  // Already centred: nothing moves — a no-op must not nudge.
  const y = runShift(107, 26, 100, 40, 200);
  assert.strictEqual(y, 200, "a centred label is left exactly where it is");
}

{
  // Smaller font, smaller offset — which is WHY the label looked like it
  // shifted while zooming: the error scaled with the glyphs.
  const big = 200 - runShift(111, 26, 100, 40, 200);
  const small = 200 - runShift(105.5, 13, 100, 20, 200);
  assert.ok(big > small && small > 0,
    "the uncorrected offset scales with the font, which is the apparent drift");
}

{
  // Degenerate measurements are ignored rather than throwing the render.
  const textEl = {
    y: 50,
    getBBox: () => ({ x: 0, y: 0, width: 0, height: 0 }),
    getAttribute: () => "50",
    setAttribute: (k, v) => { textEl.y = Number(v); },
  };
  new Function("textEl", "ty", "th", block)(textEl, 10, 20);
  assert.strictEqual(textEl.y, 50, "a zero-height measurement moves nothing");

  const throwing = {
    getBBox: () => { throw new Error("not rendered"); },
    getAttribute: () => "50",
    setAttribute: () => assert.fail("must not write after a failed measure"),
  };
  new Function("textEl", "ty", "th", block)(throwing, 10, 20);
}

console.log("label ink centering: all checks passed");
