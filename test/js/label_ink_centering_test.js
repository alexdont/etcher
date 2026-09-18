// Pins the label's INK centring.
//
// Two axes, one idea: what a reader sees is the PAINTED pixels, and
// neither SVG's baseline placement nor its advance box centres those.
//
// Vertically, SVG places text by its baseline, so a line of digits — no
// descenders — sits low in its em box: measured against the painted
// extents, the glyphs had roughly an x-height of slack above the rect
// and OVERHUNG its bottom edge.
//
// Horizontally, a glyph sits inside a cell with side bearings, and in
// this family the left bearing usually exceeds the right — so centring
// the advance box left the words a touch right of centre, by an amount
// PROPORTIONAL to the font ("RECT" was 1.2px off at 20px and 3.3px at
// 61px). Labels scale with the board, so that read as drift: the words
// crept right on zoom in and back left on zoom out. On a shaft-riding label that is the line grazing the
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

// ── horizontal: the painted ink centres, not the advance box ──────────────

{
  const m = src.match(/var TEXT_MEASURE_FONT_PX = (\d+);/);
  assert.ok(m, "the measurement base size must exist");
  global.TEXT_MEASURE_FONT_PX = Number(m[1]);
}

const shiftX = (() => {
  const start = src.indexOf("    _inkCenterShiftX: function");
  assert.notStrictEqual(start, -1, "could not find _inkCenterShiftX");
  const end = src.indexOf("\n    },", start);
  return eval("(" + src.slice(start, end + "\n    }".length)
    .replace("_inkCenterShiftX: function", "function") + ")");
})();

// The measure canvas, with the metrics a browser reports: a glyph run
// whose ink starts 2 units in and ends 2 short of the advance.
function measuringCtx(metrics) {
  return {
    _measureCanvas: {
      getContext: () => ({
        set font(v) { this._font = v; },
        get font() { return this._font; },
        measureText: () => metrics,
      }),
    },
  };
}

{
  // MEASURE_PX is 100, so a size of 50 halves every measurement.
  const self = measuringCtx({
    width: 100, actualBoundingBoxLeft: -10, actualBoundingBoxRight: 80,
  });
  // ink spans 10..80 (centre 45); advance centre is 50 → shift +5, halved.
  assert.strictEqual(shiftX.call(self, "text", 50), 2.5,
    "the pen moves so the painted pixels straddle the box centre");

  // Ink already centred in its advance: nothing to correct.
  const centred = measuringCtx({
    width: 100, actualBoundingBoxLeft: -10, actualBoundingBoxRight: 90,
  });
  assert.strictEqual(shiftX.call(centred, "text", 100), 0);

  // The correction scales with the font — which is exactly why the
  // uncorrected version looked like drift rather than a fixed nudge.
  const big = shiftX.call(self, "text", 100);
  const small = shiftX.call(self, "text", 25);
  assert.ok(big > small && small > 0 && Math.abs(big / small - 4) < 1e-9,
    "the offset is proportional to the size");
}

{
  // Empty, sizeless, and metric-less browsers all fall back to the
  // advance centring that came before.
  const self = measuringCtx({ width: 10, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 5 });
  assert.strictEqual(shiftX.call(self, "", 20), 0);
  assert.strictEqual(shiftX.call(self, "x", 0), 0);
  const old = measuringCtx({ width: 10 });
  assert.strictEqual(old.constructor === Object ? shiftX.call(old, "x", 20) : 0, 0,
    "a browser without actualBoundingBox metrics keeps the old behaviour");
  const nan = measuringCtx({ width: 10, actualBoundingBoxLeft: NaN, actualBoundingBoxRight: 5 });
  assert.strictEqual(shiftX.call(nan, "x", 20), 0);
  const throwing = { _measureCanvas: { getContext: () => { throw new Error("no 2d"); } } };
  assert.strictEqual(shiftX.call(throwing, "x", 20), 0);
}

// ── the render applies it to the text AND its tspans ──────────────────────

{
  const applyAt = render.indexOf("var inkShiftX = this._inkCenterShiftX(");
  assert.notStrictEqual(applyAt, -1,
    "the title render must correct the horizontal ink centre");
  assert.ok(applyAt < blockStart,
    "…before the vertical shift, which measures the box it just moved");
  const apply = render.slice(applyAt, blockStart);
  assert.ok(apply.includes('textEl.setAttribute("x", inkX);') &&
            apply.includes("this._shiftTspans(textEl, inkX);"),
    "both the <text> and its tspans move, or a multi-line label tears");
  assert.ok(render.includes("var inkWidest = inkLines[0];"),
    "the correction comes from the line that sets the box width");
}
