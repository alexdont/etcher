// Pins the label's INK centring, both axes.
//
// The box is sized from the ADVANCE width — that is what reserves the
// space — but the glyphs never fill it symmetrically: side bearings
// differ left to right, SVG places text by its baseline (so a line of
// digits sits low in its em box), and at small sizes the painted
// extents round to device pixels. Those leftovers are a fixed fraction
// of a pixel, so they vanish on a big label and dominate a small one —
// at the viewer's zoom floor a font-3 label had 0.63px of space on its
// left and 0.33 on its right, which reads as the words sitting right of
// centre, and worsens as you zoom out.
//
// The render measures the text the engine just laid out and moves the
// pen so both gaps match. The box, plate, cut and handles all key off
// the rect and do not move.
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
// re-anchors move `tx`/`ty`.
const shrinkAt = render.indexOf("shape._renderedTitleImage = shrunk;");
assert.ok(shrinkAt !== -1 && shrinkAt < blockStart,
  "the ink shift must run after the box is shrink-wrapped and re-anchored");

// ── the arithmetic, on a stand-in text element ────────────────────────────

function run(ink, box, start) {
  const shifted = [];
  const textEl = {
    x: start.x, y: start.y,
    getBBox: () => ({ x: ink.x, y: ink.y, width: ink.w, height: ink.h }),
    getAttribute: (k) => String(k === "x" ? textEl.x : textEl.y),
    setAttribute: (k, v) => { if (k === "x") textEl.x = Number(v); else textEl.y = Number(v); },
  };
  const ctx = { _shiftTspans: (_el, x) => shifted.push(x) };
  new Function("textEl", "tx", "ty", "tw", "th", block)
    .call(ctx, textEl, box.x, box.y, box.w, box.h);
  return { x: textEl.x, y: textEl.y, shifted };
}

{
  // Box 100..180 (centre 140) and 50..90 (centre 70). Ink painted at
  // 108..176 (centre 142) and 61..87 (centre 74) — right and low by 2
  // and 4. The pen moves back by exactly that, on both axes.
  const out = run({ x: 108, y: 61, w: 68, h: 26 },
                  { x: 100, y: 50, w: 80, h: 40 },
                  { x: 300, y: 400 });
  assert.strictEqual(out.x, 298, "the pen moves so the ink straddles the box centre");
  assert.strictEqual(out.y, 396, "…on the vertical too");
  assert.deepStrictEqual(out.shifted, [298],
    "the tspans move with the text, or a multi-line label tears apart");
}

{
  // Already centred: nothing moves, and no tspan churn.
  const out = run({ x: 106, y: 57, w: 68, h: 26 },
                  { x: 100, y: 50, w: 80, h: 40 },
                  { x: 300, y: 400 });
  assert.strictEqual(out.x, 300, "a centred label is left exactly where it is");
  assert.strictEqual(out.y, 400);
  assert.deepStrictEqual(out.shifted, []);
}

{
  // The real numbers, measured in the viewer and the demo. The leftovers
  // are a fixed fraction of a pixel, so relative to its box the tiny
  // label needs an order of magnitude more correction — which is why the
  // words looked right zoomed in and crept right as the board zoomed out.
  //
  // font 3.13 at the viewer's zoom floor: 0.63px left, 0.33 right.
  const tiny = run({ x: 718.99, y: 0, w: 6.33, h: 3 },
                   { x: 718.36, y: 0, w: 7.29, h: 4 }, { x: 718.99, y: 0 });
  const tinyShift = Math.abs(718.99 - tiny.x);
  assert.ok(Math.abs(tinyShift - 0.15) < 0.01,
    "the tiny label's ink moves back by half its asymmetry");

  // font 20.75 in the demo: 3.99 left, 4.31 right — the same leftover,
  // spread over a box eleven times wider.
  const big = run({ x: 3.99, y: 0, w: 73.02, h: 20 },
                  { x: 0, y: 0, w: 81.32, h: 26 }, { x: 3.99, y: 0 });
  const bigShift = Math.abs(3.99 - big.x);
  assert.ok(bigShift > 0 && bigShift < 0.2);
  assert.ok(tinyShift / 7.29 > 8 * (bigShift / 81.32),
    "relative to its box the small label needed a far bigger nudge — " +
    "that ratio IS the drift the user saw on zoom out");
}

{
  // Degenerate and failed measurements leave the text exactly as it was.
  const flat = run({ x: 0, y: 0, w: 0, h: 0 },
                   { x: 100, y: 50, w: 80, h: 40 }, { x: 300, y: 400 });
  assert.strictEqual(flat.x, 300, "a zero-size measurement moves nothing");
  assert.strictEqual(flat.y, 400);

  const textEl = {
    getBBox: () => { throw new Error("not rendered"); },
    getAttribute: () => "50",
    setAttribute: () => assert.fail("must not write after a failed measure"),
  };
  new Function("textEl", "tx", "ty", "tw", "th", block)
    .call({ _shiftTspans: () => assert.fail("nor move the tspans") },
          textEl, 0, 0, 10, 10);
}

console.log("label ink centering: all checks passed");
