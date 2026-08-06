// Pins that a line of text breaks the same way at every zoom.
//
// Where a label wraps, and how far its font is shrunk to fit its box, are
// decisions about the label — not about how closely you happen to be looking
// at it. Both are made by measuring text, and text metrics are NOT linear in
// font size: hinting and rounding make small text proportionally wider, and
// browsers clamp very small sizes outright. Measuring at the size the text
// will actually be drawn at therefore folds the zoom into the answer, and a
// label that sat on one line zoomed in broke onto two zoomed out.
//
// The fix is to measure at a fixed reference size and scale the result. The
// stub below reproduces the non-linearity — a per-character constant that
// does not shrink with the font — so these checks fail against a measurement
// taken at the rendered size, which is the whole point of having them.
//
//   node test/js/text_wrap_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

function lift(name, signature) {
  const needle = `    ${name}: function(${signature}) {`;
  const start = src.indexOf(needle);
  assert.notStrictEqual(start, -1, `could not find ${name} in etcher.js`);
  const end = src.indexOf("\n    },", start);
  assert.notStrictEqual(end, -1, `could not find the end of ${name}`);
  return eval(
    "(" +
      src.slice(start, end + "\n    }".length).replace(`${name}: function`, "function") +
      ")"
  );
}

const refSrc = (src.match(/var TEXT_MEASURE_FONT_PX = (\d+);/) || [])[1];
assert.ok(refSrc, "could not read TEXT_MEASURE_FONT_PX from etcher.js");
global.TEXT_MEASURE_FONT_PX = Number(refSrc);

// A stand-in for the browser's text metrics. Width is mostly proportional to
// font size, plus a fixed per-character amount that does NOT scale — the
// hinting/rounding floor that makes small text relatively wider. That extra
// is what made the wrap depend on the zoom.
const PER_CHAR_EM = 0.55;
const PER_CHAR_FIXED = 0.4;
let measuredAt = [];
global.document = {
  createElement() {
    return {
      getContext() {
        return {
          set font(v) { this._font = v; },
          get font() { return this._font; },
          measureText(s) {
            const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(this._font)[1]);
            measuredAt.push(size);
            return { width: s.length * (size * PER_CHAR_EM + PER_CHAR_FIXED) };
          }
        };
      }
    };
  }
};

// `_fillTextWithWrappedTspans` builds <tspan>s through the module-level
// `svgEl`, and reads back from the element it is given.
global.svgEl = (tag, attrs) => ({
  tag,
  attrs: attrs || {},
  textContent: "",
  appendChild() {}
});

const measureTextWidth = lift("_measureTextWidth", "text, fontSize, fontFamily, fontWeight");
const fillWrapped = lift("_fillTextWithWrappedTspans", "textEl, content, maxWidth, fontSize");

const layer = { _measureTextWidth: measureTextWidth, _fillTextWithWrappedTspans: fillWrapped };

function textEl() {
  const kids = [];
  return {
    kids,
    firstChild: null,
    getAttribute: (k) => (k === "font-family" ? "sans" : k === "font-weight" ? "500" : "0"),
    removeChild() {},
    appendChild(c) { kids.push(c); }
  };
}

function wrap(content, maxWidth, fontSize) {
  const el = textEl();
  const out = fillWrapped.call(layer, el, content, maxWidth, fontSize);
  return { lines: el.kids.map((k) => k.textContent), measured: out };
}

// ── measurement is taken at the reference size, never the rendered one ──────

measuredAt = [];
measureTextWidth.call(layer, "hello", 7, "sans", "500");
measureTextWidth.call(layer, "hello", 400, "sans", "500");
assert.deepStrictEqual(
  [...new Set(measuredAt)], [global.TEXT_MEASURE_FONT_PX],
  "every measurement is taken at the reference size, whatever size will be drawn"
);

// It still answers in the rendered scale: twice the font, twice the width.
{
  const a = measureTextWidth.call(layer, "hello", 20, "sans", "500");
  const b = measureTextWidth.call(layer, "hello", 40, "sans", "500");
  assert.ok(Math.abs(b - a * 2) < 1e-9, "the answer scales with the font size");
}
assert.strictEqual(measureTextWidth.call(layer, "", 20, "sans", "500"), 0);
assert.strictEqual(measureTextWidth.call(layer, null, 20, "sans", "500"), 0);

// ── the wrap is the same at every zoom ──────────────────────────────────────

// The label: a box and a font size, both of which scale with the zoom. Only
// their RATIO is a property of the label, and only the ratio may decide where
// the line breaks.
const CONTENT = "Rebuilding kit_test and committing";
const BOX_AT_1 = 300;
const FONT_AT_1 = 24;

const atUnitZoom = wrap(CONTENT, BOX_AT_1, FONT_AT_1).lines;
assert.ok(atUnitZoom.length >= 1);

// A 500x range of zooms, which is wider than any board would use — the point
// is that nothing in the decision can see the zoom at all.
for (const zoom of [0.002, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 20]) {
  const got = wrap(CONTENT, BOX_AT_1 * zoom, FONT_AT_1 * zoom).lines;
  assert.deepStrictEqual(got, atUnitZoom,
    `at zoom ${zoom} the text must break exactly as it does at 1:1`);
}

// The same holds for a box that fits on one line, and for one so narrow that
// every word gets its own — the two ends where a drifting measurement is most
// likely to tip the answer over.
for (const [box, font] of [[2000, 24], [40, 24]]) {
  const base = wrap(CONTENT, box, font).lines;
  for (const zoom of [0.005, 0.1, 1, 8]) {
    assert.deepStrictEqual(wrap(CONTENT, box * zoom, font * zoom).lines, base,
      `box ${box} at zoom ${zoom}`);
  }
}

// A word longer than the box still occupies its own line rather than being
// dropped or looping — the `|| !current` escape.
{
  const { lines } = wrap("Supercalifragilistic and more", 10, 24);
  assert.ok(lines.length >= 2);
  assert.strictEqual(lines[0], "Supercalifragilistic",
    "an over-long word takes its own line rather than vanishing");
  assert.strictEqual(lines.join(" "), "Supercalifragilistic and more",
    "no word is lost");
}

// Reported height follows the line count and the rendered font size.
{
  const one = wrap(CONTENT, 4000, 20).measured;
  const many = wrap(CONTENT, 40, 20).measured;
  assert.ok(many.height > one.height, "more lines is taller");
  assert.ok(Math.abs(one.height - 20) < 1e-9, "a single line is one font-size tall");
}

// Empty content is not a wrap at all.
assert.deepStrictEqual(wrap("", 100, 20).lines, []);
assert.deepStrictEqual(wrap("   ", 100, 20).lines, []);

console.log("text wrap: all checks passed");
