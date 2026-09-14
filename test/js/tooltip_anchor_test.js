// Pins where a tooltip hangs from.
//
// It anchored to the top-centre of the shape's bounding box, which is right
// for a rectangle and wrong for anything diagonal: a line drawn corner to
// corner has a bbox whose top-centre is out in empty canvas, so the tooltip
// floated far off the line it was describing.
//
// Two separate questions, answered separately. HORIZONTALLY an open stroke
// centres on the middle of the line, measured along it. VERTICALLY it still
// clears the whole annotation — sitting ON the line was tried and is worse
// than being far away, because a big bubble lying across a shape hides the
// thing you are trying to identify.
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
  assert.strictEqual(style.left, "200px",
    "horizontally centred on the line's middle, not on the box's centre-top corner");
  assert.strictEqual(style.top, "-8px",
    "vertically clear of the shape — above the centre, not lying across it");
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

// A STRAIGHT line's midpoint x is its box centre x, so the case above
// cannot tell the two anchors apart. A bent arrow can: this one routes
// (0,0) → (0,100) → (100,0), whose box centre is x=50 while the middle of
// the route — 120.7 along a 241.4 path — lands at x≈14.6.
// (Placed away from the container edge so the horizontal clamp — which
// keeps the bubble on screen — isn't what we end up measuring.)
const bent = {
  kind: "arrow",
  geometry: { a: [400, 0], b: [500, 0], points: [[400, 100]] },
  el: { getBoundingClientRect: () => ({ left: 400, top: 0, width: 100, height: 100 }) },
};

{
  const style = tooltipFor(bent);
  const x = parseFloat(style.left);
  assert.ok(Math.abs(x - 414.64) < 0.1,
    `bent arrow should centre on its route's middle (~414.6), got ${x}`);
  assert.notStrictEqual(style.left, "450px", "not the bounding box's centre");
  assert.strictEqual(style.top, "-8px", "still clear of the shape");
}

{
  // Strip mode can't project image px to container px, so it keeps the box
  // anchor horizontally too rather than placing the tooltip somewhere
  // invented.
  const style = tooltipFor(bent, { handleKind: "strip" });
  assert.strictEqual(style.left, "450px", "strip falls back to the box centre");
  assert.strictEqual(style.top, "-8px");
}

{
  // No room above → flips below the shape, still centred on the line.
  const style = tooltipFor(diagonal, { tipTop: -100 });
  assert.strictEqual(style.left, "200px", "still centred on the line");
  assert.strictEqual(style.top, (300 + 8) + "px",
    "and below everything the annotation draws, not below its middle");
  assert.strictEqual(style.transform, "translate(-50%, 0)");
}

{
  // The label is part of what has to be cleared: it floats above the box,
  // so the tooltip goes above IT. Horizontal centring is unaffected.
  const labelled = Object.assign({}, diagonal, {
    titleGroup: {
      getBoundingClientRect: () => ({
        left: 160, right: 240, top: -30, bottom: -5, width: 80, height: 25,
      }),
    },
  });
  const style = tooltipFor(labelled);
  assert.strictEqual(style.left, "200px");
  assert.strictEqual(style.top, (-30 - 8) + "px",
    "above the label, so it never lands on the text it is describing");
}

console.log("tooltip anchor: all checks passed");
