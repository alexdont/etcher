// Pins where a tooltip hangs from.
//
// It anchored to the top-centre of the shape's bounding box, which is right
// for a rectangle and wrong for anything diagonal: a line drawn corner to
// corner has a bbox whose top-centre is out in empty canvas, so the tooltip
// floated far off the line it was describing. Open strokes now anchor to
// the middle of the LINE, measured along it.
//
//   node test/js/tooltip_anchor_test.js

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

const strokeMidpoint = extract("_strokeMidpointImage");
const arrowPath = extract("_arrowPath");
const positionTooltip = extract("_positionTooltip");

const ctx = {
  _arrowPath: arrowPath,
  _freehandFlatten: (g) => g.points || [],
};

function near(actual, expected, what) {
  assert.ok(actual && Math.abs(actual.x - expected.x) < 0.001 &&
              Math.abs(actual.y - expected.y) < 0.001,
    `${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ── the middle of the line ─────────────────────────────────────────────────

// The case from the report: a diagonal. Its bbox top-centre is (50, 0) —
// a corner of empty canvas — while the line's middle is (50, 50).
near(strokeMidpoint.call(ctx, {
  kind: "line", geometry: { a: [0, 0], b: [100, 100] },
}), { x: 50, y: 50 }, "diagonal line");

near(strokeMidpoint.call(ctx, {
  kind: "dimension", geometry: { a: [20, 80], b: [80, 20] },
}), { x: 50, y: 50 }, "diagonal dimension");

// A bent arrow measures along its bends, not across the chord it never
// occupies: this L has two 100-long legs, so the middle is the corner.
near(strokeMidpoint.call(ctx, {
  kind: "arrow", geometry: { a: [0, 0], b: [100, 100], points: [[0, 100]] },
}), { x: 0, y: 100 }, "bent arrow follows its route");

// A marker / freehand stroke, half way along.
near(strokeMidpoint.call(ctx, {
  kind: "marker", geometry: { points: [[0, 0], [10, 0], [20, 0], [40, 0]] },
}), { x: 20, y: 0 }, "stroke midpoint");

{
  // By ARC LENGTH, not by index. Sampled densely at one end and sparsely at
  // the other, the middle SAMPLE is at x=3 while the middle of the LINE is
  // at x=50 — a hesitant stroke would otherwise anchor where the hand
  // happened to slow down.
  const lumpy = { kind: "freehand",
    geometry: { points: [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [100, 0]] } };
  near(strokeMidpoint.call(ctx, lumpy), { x: 50, y: 0 }, "arc length, not index");
}

// Degenerate inputs answer rather than throw.
near(strokeMidpoint.call(ctx, { kind: "marker", geometry: { points: [[7, 9]] } }),
  { x: 7, y: 9 }, "a single point is its own middle");
near(strokeMidpoint.call(ctx, { kind: "line", geometry: { a: [5, 5], b: [5, 5] } }),
  { x: 5, y: 5 }, "a zero-length line");
assert.strictEqual(strokeMidpoint.call(ctx, { kind: "marker", geometry: {} }), null);
assert.strictEqual(strokeMidpoint.call(ctx, { kind: "line", geometry: {} }), null);
assert.strictEqual(strokeMidpoint.call(ctx, { kind: "line" }), null);

// Closed shapes keep the anchor they have always had — a rectangle's bbox
// top IS its top, so there is nothing to correct.
for (const kind of ["rectangle", "circle", "polygon", "text", "image", "callout"]) {
  assert.strictEqual(
    strokeMidpoint.call(ctx, { kind, geometry: { x: 0, y: 0, w: 10, h: 10 } }), null,
    `${kind} is not an open stroke`);
}

// ── and the tooltip lands there ────────────────────────────────────────────

function tooltipFor(shape, opts) {
  opts = opts || {};
  const tip = {
    style: {},
    getBoundingClientRect: () => ({
      top: opts.tipTop == null ? 500 : opts.tipTop,
      width: 120, height: 40,
    }),
  };
  const self = {
    tooltipEl: tip,
    handleKind: opts.handleKind || "canvas",
    handle: {
      container: {
        scrollLeft: 0, scrollTop: 0,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
      },
    },
    _isMediaKind: () => false,
    _shapeBBoxImagePx: () => null,
    // Identity projection, so container px == image px in these checks.
    _imageToContainer: (p) => ({ x: p.x, y: p.y }),
    _strokeMidpointImage: strokeMidpoint,
    _arrowPath: arrowPath,
    _freehandFlatten: (g) => g.points || [],
  };
  positionTooltip.call(self, shape);
  return tip.style;
}

// The bbox of this diagonal spans (0,0)-(400,300); its top-centre is
// (200, 0). The line's middle is (200, 150).
const diagonal = {
  kind: "line",
  geometry: { a: [0, 0], b: [400, 300] },
  el: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) },
};

{
  const style = tooltipFor(diagonal);
  assert.strictEqual(style.left, "200px", "centred on the line's middle");
  assert.strictEqual(style.top, (150 - 8) + "px",
    "…and just above it, not 150px away at the top of the box");
  assert.strictEqual(style.transform, "translate(-50%, -100%)");
}

{
  // A closed shape is unchanged: still the top of its box.
  const rect = {
    kind: "rectangle",
    geometry: { x: 0, y: 0, w: 400, h: 300 },
    el: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) },
  };
  const style = tooltipFor(rect);
  assert.strictEqual(style.left, "200px");
  assert.strictEqual(style.top, "-8px", "a rectangle still hangs off its top edge");
}

{
  // Strip mode can't project image px to container px, so it keeps the
  // box anchor rather than placing the tooltip somewhere invented.
  const style = tooltipFor(diagonal, { handleKind: "strip" });
  assert.strictEqual(style.top, "-8px", "strip mode falls back to the box");
}

{
  // No room above → flips below the ANCHOR, not below the whole box.
  const style = tooltipFor(diagonal, { tipTop: -100 });
  assert.strictEqual(style.top, (150 + 8) + "px",
    "the flip measures from the same point the tooltip hangs from");
  assert.strictEqual(style.transform, "translate(-50%, 0)");
}

{
  // A label riding ON the stroke — a dimension's sits at its midpoint by
  // default — is the one thing that can already be where the tooltip wants
  // to go. Lift over it instead of landing on the text being described.
  const labelled = Object.assign({}, diagonal, {
    kind: "dimension",
    titleGroup: {
      getBoundingClientRect: () => ({
        left: 160, right: 240, top: 130, bottom: 170, width: 80, height: 40,
      }),
    },
  });
  const style = tooltipFor(labelled);
  assert.strictEqual(style.top, (130 - 8) + "px",
    "cleared the label sitting on the midpoint");
}

{
  // A label that floats above the box, well clear of the stroke's middle,
  // must NOT drag the tooltip back up there — that is the bug being fixed.
  const labelled = Object.assign({}, diagonal, {
    titleGroup: {
      getBoundingClientRect: () => ({
        left: 160, right: 240, top: -30, bottom: -5, width: 80, height: 25,
      }),
    },
  });
  const style = tooltipFor(labelled);
  assert.strictEqual(style.top, (150 - 8) + "px",
    "a label that isn't in the way leaves the anchor on the line");
}

console.log("tooltip anchor: all checks passed");
