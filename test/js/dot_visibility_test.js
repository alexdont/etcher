// A dot is ink on the board, like everything else on it.
//
// Two reports, a day apart, and the second corrects the first. The dots
// placed with the marker could not be seen when zoomed out — and the fix for
// that gave them a floor, a minimum size on screen. Which made them phantoms:
// "when I zoom out the dots never change size, they get bigger relative to
// the other lines". Quite right. A dot drawn on a board is a mark ON the
// board: pull away and it gets smaller, exactly as the stroke beside it does.
//
// So there is no dot floor. A dot's size is its round cap, which is the
// stroke width, which scales with the zoom like any other ink and stops at
// the same hairline floor every marker stroke stops at.
//
// What a dot does need is a PATH the renderer believes in. `_commitFreehand`
// stores it a hundredth of an image px long, so the browser has a hit region;
// at 0.007 zoom that is seven hundred-thousandths of a screen px, and engines
// disagree about whether a subpath that short exists at all. Measured through
// the same rasteriser the SVG uses: the stored path paints one pixel at
// 64/255, where a real segment gives 0/255 — and WebKit drops degenerate
// subpaths outright, which is why an iPhone placed dots it never drew until
// you zoomed in far enough to give the thing some length. It is drawn one
// DEVICE pixel long instead: the least that always paints, and the least that
// can be seen, so what anyone looks at is the cap.
//
//   node test/js/dot_visibility_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

function extract(name) {
  const needle = `    ${name}: function`;
  const start = src.indexOf(needle);
  assert.notStrictEqual(start, -1, `could not find ${name}`);
  const end = src.indexOf("\n    },", start);
  assert.notStrictEqual(end, -1, `could not find the end of ${name}`);
  return eval("(" + src.slice(start, end + "\n    }".length)
    .replace(`${name}: function`, "function") + ")");
}

function constant(name) {
  const m = src.match(new RegExp(`var ${name} = ([\\d.]+);`));
  assert.ok(m, `could not find ${name}`);
  return Number(m[1]);
}

const DOT_LENGTH = constant("DOT_LENGTH");
const MARKER_MIN_SCREEN_PX = constant("MARKER_MIN_SCREEN_PX");
const DOT_RENDER_DEVICE_PX = constant("DOT_RENDER_DEVICE_PX");
global.DOT_LENGTH = DOT_LENGTH;
global.MARKER_MIN_SCREEN_PX = MARKER_MIN_SCREEN_PX;
global.DOT_RENDER_DEVICE_PX = DOT_RENDER_DEVICE_PX;
global.DOT_GAP_RATIO = 2;

const strokeIsDot = extract("_strokeIsDot");
const applyMarkerStyle = extract("_applyMarkerStyle");
const dotRenderLength = extract("_dotRenderLength");

// ── which strokes are dots ────────────────────────────────────────────────

{
  const l = { _strokeIsDot: strokeIsDot };

  // What `_commitFreehand` stores for a press that never moved.
  assert.strictEqual(l._strokeIsDot({ points: [[10, 20], [10 + DOT_LENGTH, 20]] }), true);
  assert.strictEqual(l._strokeIsDot({ points: [[0, 0]] }), true, "a single point is a dot too");

  // A stroke drawn by hand is thousands of times longer than this, so the
  // answer is never in doubt — even for the smallest flick anyone can make.
  assert.strictEqual(l._strokeIsDot({ points: [[0, 0], [1, 0]] }), false,
    "a whole image px is a stroke, not a dot");
  assert.strictEqual(l._strokeIsDot({ points: [[0, 0], [0, 3], [4, 3]] }), false);

  // Both axes, or a stroke drawn straight down — which is thin in x and
  // nothing but length in y — would be floored as if it were a dot.
  assert.strictEqual(l._strokeIsDot({ points: [[0, 0], [0, 5]] }), false,
    "a vertical line is a line");
  assert.strictEqual(l._strokeIsDot({ points: [[0, 0], [5, 0]] }), false,
    "and so is a horizontal one");

  // Measured in image px, so zoom cannot change the answer — a small stroke
  // must not turn into a dot on the way out and jump to the dot's floor.
  assert.strictEqual(l._strokeIsDot({ points: [[0, 0], [0.2, 0.2]] }), false);

  // Nothing to measure.
  assert.strictEqual(l._strokeIsDot(null), false);
  assert.strictEqual(l._strokeIsDot({}), false);
  assert.strictEqual(l._strokeIsDot({ points: [] }), false);
  assert.strictEqual(l._strokeIsDot({ nodes: [] }), false, "a bezier curve is not a dot");
}

// ── and what that buys them ───────────────────────────────────────────────

function widthOf(style, scale) {
  const el = { style: {}, removeAttribute() {}, setAttribute() {} };
  applyMarkerStyle.call({}, el, style, scale);
  return parseFloat(el.style.strokeWidth);
}

{
  // Ink scales with the content. That is what makes a marker look like it was
  // drawn ON the board rather than stuck to the screen in front of it.
  assert.strictEqual(widthOf({ width: 10 }, 1), 10);
  assert.strictEqual(widthOf({ width: 10 }, 2), 20);
  assert.strictEqual(widthOf({ width: 10 }, 0.25), 2.5);
}

{
  // …down to the floor every marker stroke shares, and no further. There is
  // no separate dot size: a dot IS a stroke of this width, seen end-on, so a
  // dot that kept its size while the stroke beside it thinned would read as a
  // pin dropped on the board rather than a mark made on it.
  assert.strictEqual(widthOf({ width: 10 }, 0.0035), MARKER_MIN_SCREEN_PX);
  assert.strictEqual(widthOf({ width: 10 }, 0.0001), MARKER_MIN_SCREEN_PX);
  assert.ok(MARKER_MIN_SCREEN_PX < 1,
    "the floor is a hairline, not a size — it exists so a stroke never " +
    "stops existing, not to keep it legible");
}

{
  // The dash pattern is derived from the same width.
  const el = { style: {}, attrs: {},
    removeAttribute(k) { delete this.attrs[k]; },
    setAttribute(k, v) { this.attrs[k] = v; } };
  applyMarkerStyle.call({}, el, { width: 10, dash: "dashed" }, 0.0035);
  const w = parseFloat(el.style.strokeWidth);
  assert.strictEqual(el.attrs["stroke-dasharray"], (w * 2.2) + " " + (w * 1.6));
}

// ── the length it is painted with ─────────────────────────────────────────

{
  // One device pixel, whatever the screen: the least a rasteriser must treat
  // as a real subpath. Written in the CSS px the path itself is written in,
  // so on a phone at 3x it is a third of one.
  const l = { _dotRenderLength: dotRenderLength };

  global.window = { devicePixelRatio: 1 };
  assert.strictEqual(l._dotRenderLength(), DOT_RENDER_DEVICE_PX);

  global.window = { devicePixelRatio: 3 };
  assert.strictEqual(l._dotRenderLength(), DOT_RENDER_DEVICE_PX / 3);

  global.window = { devicePixelRatio: 2 };
  assert.strictEqual(l._dotRenderLength(), DOT_RENDER_DEVICE_PX / 2);

  // It does not scale with the zoom, and must not: it is not the dot's size,
  // it is the minimum a path can be and still be painted. The cap on top of
  // it is what scales.
  assert.ok(DOT_RENDER_DEVICE_PX >= 1,
    "below a device pixel it can be rounded away, which is the bug");

  // Nonsense from a browser that has no ratio, or a broken one.
  global.window = {};
  assert.strictEqual(l._dotRenderLength(), DOT_RENDER_DEVICE_PX);
  global.window = { devicePixelRatio: 0 };
  assert.strictEqual(l._dotRenderLength(), DOT_RENDER_DEVICE_PX);
  delete global.window;
  assert.strictEqual(l._dotRenderLength(), DOT_RENDER_DEVICE_PX,
    "and none at all — this runs in node, among other places");
}

console.log("dot visibility: all checks passed");
