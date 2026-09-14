// Pins where a tooltip is placed.
//
// It hung off the top-centre of the shape's bounding box. Right for a
// rectangle — its box top IS its top — and wrong for anything diagonal: a
// line drawn corner to corner has a bbox whose top-centre is out in empty
// canvas, so the tooltip floated far from the line it described.
//
// Hanging it ON the midpoint instead was worse: a big bubble lying across a
// shape hides the thing you are trying to identify. An open stroke now
// parks BESIDE the middle of its line — pushed off along the perpendicular
// by exactly the bubble's own support in that direction, which is the
// closest a rectangle can sit to a line without crossing it.
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

{
  const m = src.match(/var LINE_WEIGHT_PX = ([\d.]+);/);
  assert.ok(m, "could not find LINE_WEIGHT_PX");
  global.LINE_WEIGHT_PX = Number(m[1]);
}

const strokeMidpoint = extract("_strokeMidpointImage");
const arrowPath = extract("_arrowPath");
const positionTooltip = extract("_positionTooltip");
const placeBeside = extract("_placeTooltipBesideStroke");
const renderedStrokePx = extract("_renderedStrokePx");
const clearancePts = extract("_tooltipClearancePts");

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

// ── and the tooltip is placed beside it ───────────────────────────────────

const TIP_W = 120, TIP_H = 40;

function tooltipFor(shape, opts) {
  opts = opts || {};
  const tip = {
    style: {},
    getBoundingClientRect: () => ({
      top: opts.tipTop == null ? 500 : opts.tipTop,
      width: TIP_W, height: TIP_H,
    }),
  };
  const self = {
    tooltipEl: tip,
    handleKind: opts.handleKind || "canvas",
    handle: {
      container: {
        scrollLeft: 0, scrollTop: 0,
        getBoundingClientRect: () => ({
          left: 0, top: 0,
          width: opts.cw || 2000, height: opts.ch || 2000,
        }),
      },
    },
    _isMediaKind: () => false,
    _shapeBBoxImagePx: () => null,
    // Identity projection, so container px == image px in these checks.
    _imageToContainer: (p) => ({ x: p.x, y: p.y }),
    _strokeMidpointImage: strokeMidpoint,
    _placeTooltipBesideStroke: placeBeside,
    _tooltipClearancePts: clearancePts,
    _renderedStrokePx: renderedStrokePx,
    _isShaftKind: (k) => ["line", "arrow", "dimension"].indexOf(k) !== -1,
    _shaftStrokePx: () => opts.strokePx == null ? 2 : opts.strokePx,
    _markerScale: () => 1,
    _arrowPath: arrowPath,
    _freehandFlatten: (g) => g.points || [],
  };
  positionTooltip.call(self, shape);
  return tip.style;
}

// The report's case: a 45° line from (0,0) to (400,300)... use a true 45°
// so the perpendicular maths is checkable by hand.
const diagonal = {
  kind: "line",
  geometry: { a: [200, 200], b: [600, 600] },
  el: { getBoundingClientRect: () => ({ left: 200, top: 200, width: 400, height: 400 }) },
};

{
  const style = tooltipFor(diagonal);
  const x = parseFloat(style.left), y = parseFloat(style.top);
  assert.strictEqual(style.transform, "translate(-50%, -50%)",
    "the bubble is centred on its placement point, not hung below it");

  // Midpoint is (400,400). The stroke runs at 45° down-right, so the upward
  // normal is (1,-1)/√2. Support of a 120×40 box in that direction is
  // 60·0.707 + 20·0.707 = 56.57; clearance is half the 2px stroke + 6 = 7.
  // So the centre lands 63.57 along (0.707, -0.707) from the midpoint.
  const d = (60 + 20) / Math.SQRT2 + 7;
  assert.ok(Math.abs(x - (400 + d / Math.SQRT2)) < 0.01, `x was ${x}`);
  assert.ok(Math.abs(y - (400 - d / Math.SQRT2)) < 0.01, `y was ${y}`);

  // The property that matters, stated directly: the bubble does not cross
  // the line. Every corner must be on the same side of it.
  const sides = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
    const cx = x + sx * TIP_W / 2, cy = y + sy * TIP_H / 2;
    // The line through (400,400) with direction (1,1): sign of the cross
    // product says which side a point is on.
    return Math.sign((cx - 400) * 1 - (cy - 400) * 1);
  });
  assert.ok(sides.every((s) => s === sides[0] && s !== 0),
    `every corner of the tooltip should clear the line, got ${sides}`);

  // And it is CLOSE — the whole point of using the support distance rather
  // than a fixed stand-off. The nearest corner is within a stroke's width
  // and the 6px gap of the line.
  const dist = Math.abs((x - 400) - (y - 400)) / Math.SQRT2;
  assert.ok(dist - (60 + 20) / Math.SQRT2 <= 7.001,
    "no further from the line than clearance demands");
}

{
  // A horizontal stroke reproduces the old placement exactly: straight up.
  const flat = {
    kind: "line",
    geometry: { a: [200, 400], b: [600, 400] },
    el: { getBoundingClientRect: () => ({ left: 200, top: 390, width: 400, height: 20 }) },
  };
  const style = tooltipFor(flat);
  assert.strictEqual(parseFloat(style.left), 400, "centred on the middle");
  assert.strictEqual(parseFloat(style.top), 400 - (20 + 7),
    "directly above it, clear by its own half-height plus the gap");
}

{
  // A vertical stroke goes to the SIDE — there is no "above" that is near.
  const upright = {
    kind: "line",
    geometry: { a: [400, 200], b: [400, 600] },
    el: { getBoundingClientRect: () => ({ left: 390, top: 200, width: 20, height: 400 }) },
  };
  const style = tooltipFor(upright);
  assert.strictEqual(parseFloat(style.top), 400, "level with the middle of the line");
  assert.strictEqual(Math.abs(parseFloat(style.left) - 400), 60 + 7,
    "beside it by its own half-width plus the gap");
}

{
  // A fat stroke is stood off further, so a heavy line isn't half-covered.
  const style = tooltipFor(diagonal, { strokePx: 40 });
  const x = parseFloat(style.left), y = parseFloat(style.top);
  const d = (60 + 20) / Math.SQRT2 + 26;   // 40/2 + 6
  assert.ok(Math.abs(x - (400 + d / Math.SQRT2)) < 0.01, `x was ${x}`);
  assert.ok(Math.abs(y - (400 - d / Math.SQRT2)) < 0.01, `y was ${y}`);
}

{
  // No room above → the other normal, rather than hanging off the top.
  const highUp = {
    kind: "line",
    geometry: { a: [200, 5], b: [600, 5] },
    el: { getBoundingClientRect: () => ({ left: 200, top: 0, width: 400, height: 10 }) },
  };
  const style = tooltipFor(highUp);
  assert.strictEqual(parseFloat(style.top), 5 + 27, "flipped below the line");
}

{
  // A closed shape is untouched: still above its box, hung by its bottom
  // edge the way it always was.
  const rect = {
    kind: "rectangle",
    geometry: { x: 0, y: 0, w: 400, h: 300 },
    el: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }) },
  };
  const style = tooltipFor(rect);
  assert.strictEqual(style.left, "200px");
  assert.strictEqual(style.top, "-8px");
  assert.strictEqual(style.transform, "translate(-50%, -100%)");
}

{
  // Strip mode renders in image-px user units inside per-image overlays, so
  // the projection this needs is the identity there — it falls back to the
  // box rather than placing the bubble somewhere invented.
  const style = tooltipFor(diagonal, { handleKind: "strip" });
  assert.strictEqual(style.transform, "translate(-50%, -100%)");
  assert.strictEqual(style.left, "400px");
}

// ── the stroke width it stands clear of ────────────────────────────────────

{
  const scaled = { _isShaftKind: () => false, _markerScale: () => 3 };
  // A marker's width is image px, so it scales with the zoom.
  assert.strictEqual(
    renderedStrokePx.call(scaled, { kind: "marker", style: { width: 5 } }), 15);
  // So does any width stored in canvas units.
  assert.strictEqual(
    renderedStrokePx.call(scaled,
      { kind: "freehand", style: { width: 5, width_units: "canvas" } }), 15);
  // A plain screen-px width does not.
  assert.strictEqual(
    renderedStrokePx.call(scaled, { kind: "freehand", style: { width: 5 } }), 5);
  // No style at all still answers.
  assert.strictEqual(renderedStrokePx.call(scaled, { kind: "freehand" }), 2);
}

// ── nothing to work with → the caller falls back ──────────────────────────

{
  const geom = { width: TIP_W, height: TIP_H, containerWidth: 2000,
                 containerHeight: 2000, scrollLeft: 0, scrollTop: 0,
                 containerRect: { left: 0, top: 0, width: 2000, height: 2000 } };
  const self = Object.assign({}, ctx, {
    handleKind: "canvas",
    _strokeMidpointImage: strokeMidpoint,
    _tooltipClearancePts: clearancePts,
    _renderedStrokePx: renderedStrokePx,
    _isShaftKind: () => true,
    _shaftStrokePx: () => 2,
    _imageToContainer: (p) => ({ x: p.x, y: p.y }),
  });
  const tip = { style: {} };
  assert.strictEqual(
    placeBeside.call(self, { kind: "rectangle", geometry: {} }, tip, geom), false,
    "a closed shape has no stroke to sit beside");
  assert.strictEqual(
    placeBeside.call(self, { kind: "line", geometry: { a: [5, 5], b: [5, 5] } }, tip, geom),
    false, "a zero-length line has no direction to be perpendicular to");
  assert.deepStrictEqual(tip.style, {}, "and nothing was written on the way out");
}

// ── it clears the WHOLE shape, not just the tangent ───────────────────────
//
// Clearing the line through the midpoint is enough for a straight stroke
// and not for anything that wanders: a freehand loop doubles back across
// its own middle, so the bubble sat on a different part of the same stroke
// — and on the body, for a filled one. The tooltip now goes beyond the
// furthest the shape reaches in that direction.

// Does the tooltip rect touch any part of the stroke? Segment-level, not
// just vertices: a long segment can cross the bubble with both ends outside.
function overlapsStroke(style, pts) {
  const cx = parseFloat(style.left), cy = parseFloat(style.top);
  const x1 = cx - TIP_W / 2, x2 = cx + TIP_W / 2;
  const y1 = cy - TIP_H / 2, y2 = cy + TIP_H / 2;
  const inside = (p) => p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
  const cross = (a, b, c, d) => {
    const s = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
    return s(a, b, c) !== s(a, b, d) && s(c, d, a) !== s(c, d, b);
  };
  const edges = [
    [{ x: x1, y: y1 }, { x: x2, y: y1 }], [{ x: x2, y: y1 }, { x: x2, y: y2 }],
    [{ x: x2, y: y2 }, { x: x1, y: y2 }], [{ x: x1, y: y2 }, { x: x1, y: y1 }],
  ];
  for (let i = 0; i < pts.length; i++) {
    if (inside(pts[i])) return true;
    if (i === pts.length - 1) break;
    for (const [e1, e2] of edges) {
      if (cross(pts[i], pts[i + 1], e1, e2)) return true;
    }
  }
  return false;
}

{
  // A hairpin: out to the right and back, so the stroke passes above AND
  // below its own arc-length middle. Clearing only the tangent there would
  // drop the bubble straight onto the returning half.
  const raw = [[400, 400], [700, 400], [700, 460], [400, 460]];
  const hairpin = {
    kind: "freehand",
    geometry: { points: raw },
    el: { getBoundingClientRect: () => ({ left: 400, top: 400, width: 300, height: 60 }) },
  };
  const style = tooltipFor(hairpin);
  const pts = raw.map(([x, y]) => ({ x, y }));
  assert.ok(!overlapsStroke(style, pts),
    `the bubble is lying on the stroke: ${JSON.stringify(style)}`);
}

{
  // A closed loop with a body. The midpoint is on the far side of the ring
  // from the start, and the fill covers everything between — so the bubble
  // has to end up outside the loop entirely.
  const ring = [];
  for (let a = 0; a <= 360; a += 15) {
    ring.push([400 + 150 * Math.cos(a * Math.PI / 180),
               400 + 150 * Math.sin(a * Math.PI / 180)]);
  }
  const loop = {
    kind: "freehand",
    geometry: { points: ring },
    style: { fill: "semi", width: 4 },
    el: { getBoundingClientRect: () => ({ left: 250, top: 250, width: 300, height: 300 }) },
  };
  const style = tooltipFor(loop);
  const pts = ring.map(([x, y]) => ({ x, y }));
  assert.ok(!overlapsStroke(style, pts), "the bubble is on the ring");

  // Outside the loop, not floating in the hole in the middle — the fill is
  // part of the shape and the tooltip must not sit on it.
  const cx = parseFloat(style.left), cy = parseFloat(style.top);
  const fromCentre = Math.sqrt((cx - 400) ** 2 + (cy - 400) ** 2);
  assert.ok(fromCentre > 150, `tooltip is inside the filled loop (r=${fromCentre})`);
}

{
  // As close as it can be: the bubble should hug the shape, not be flung to
  // the far side of the canvas. Its nearest edge stays within a bubble's
  // own height of the ring it is clearing.
  const ring = [];
  for (let a = 0; a <= 360; a += 15) {
    ring.push([400 + 100 * Math.cos(a * Math.PI / 180),
               400 + 100 * Math.sin(a * Math.PI / 180)]);
  }
  const loop = {
    kind: "freehand",
    geometry: { points: ring },
    el: { getBoundingClientRect: () => ({ left: 300, top: 300, width: 200, height: 200 }) },
  };
  const style = tooltipFor(loop);
  // Measured radially — the normal at a point on a circle points outward,
  // so the bubble is offset along the radius, not straight up.
  const cx = parseFloat(style.left), cy = parseFloat(style.top);
  const nx = Math.max(cx - TIP_W / 2, Math.min(400, cx + TIP_W / 2));
  const ny = Math.max(cy - TIP_H / 2, Math.min(400, cy + TIP_H / 2));
  const gap = Math.sqrt((400 - nx) ** 2 + (400 - ny) ** 2) - 100;
  assert.ok(gap >= 0 && gap < 40, `should hug the shape, gap was ${gap}`);
}

{
  // The near side wins. This stroke runs along x and then shoots a long way
  // UP from one end: going up would mean clearing all of that, so the
  // tooltip should take the short way down instead.
  const spike = {
    kind: "freehand",
    geometry: { points: [[300, 600], [700, 600], [700, 200]] },
    el: { getBoundingClientRect: () => ({ left: 300, top: 200, width: 400, height: 400 }) },
  };
  const style = tooltipFor(spike);
  const pts = [[300, 600], [700, 600], [700, 200]].map(([x, y]) => ({ x, y }));
  assert.ok(!overlapsStroke(style, pts), "the bubble is on the stroke");
}

{
  // The label travels with the shape, so it is something to clear too — a
  // tooltip covering the label is covering the annotation.
  const flat = {
    kind: "line",
    geometry: { a: [300, 400], b: [700, 400] },
    el: { getBoundingClientRect: () => ({ left: 300, top: 390, width: 400, height: 20 }) },
    titleGroup: {
      getBoundingClientRect: () => ({
        left: 450, right: 550, top: 330, bottom: 370, width: 100, height: 40,
      }),
    },
  };
  const style = tooltipFor(flat);
  const cx = parseFloat(style.left), cy = parseFloat(style.top);
  const x1 = cx - TIP_W / 2, x2 = cx + TIP_W / 2;
  const y1 = cy - TIP_H / 2, y2 = cy + TIP_H / 2;
  // Clear of the label's box…
  assert.ok(x2 <= 450 || x1 >= 550 || y2 <= 330 || y1 >= 370,
    `the tooltip overlaps the label: ${JSON.stringify(style)}`);
  // …and of the line it belongs to.
  assert.ok(!overlapsStroke(style, [{ x: 300, y: 400 }, { x: 700, y: 400 }]),
    "the tooltip overlaps the line");
  // With the label taking up the space above, below is the near side — and
  // near is what this picks. It does not have to be above.
  assert.ok(y1 > 400, "took the free side rather than reaching over the label");
}

console.log("tooltip anchor: all checks passed");
