// Pins the geometry behind connectors — the arrows that bind to a shape's
// anchor points and follow it.
//
// Two things are worth locking down here, both pure and both easy to get
// subtly wrong in a way no rendering test would catch:
//
//   1. The anchor table. Eight points, expressed as fractions of a shape's
//      bounding box. If a fraction drifts, arrows silently attach slightly
//      off the corner they claim; if an id is renamed, every arrow already
//      persisted with that id resolves to nothing and detaches on load.
//   2. The arrowhead. `_vArrowPoints` decides which way the V opens, and
//      pointing it at the wrong end is the classic bug — an arrow that
//      reads backwards.
//
// Both are lifted out of the source by name and driven directly, the same
// approach as the strip-chrome checks: no DOM needed, and a rename fails
// loudly rather than quietly testing nothing.
//
//   node test/js/connector_test.js

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
  const body = src
    .slice(start, end + "\n    }".length)
    .replace(`${name}: function`, "function");
  return eval("(" + body + ")");
}

// The anchor table is a module-level constant the lifted functions close
// over, so it has to be evaluated into scope the same way.
const tableSrc = (src.match(/var ARROW_ANCHORS = \[[\s\S]*?\];/) || [])[0];
assert.ok(tableSrc, "could not read ARROW_ANCHORS from etcher.js");
global.ARROW_ANCHORS = eval(tableSrc.replace("var ARROW_ANCHORS = ", ""));

const anchorPointsFor = lift("_anchorPointsFor", "shape");
const anchorPointImage = lift("_anchorPointImage", "shape, anchorId");
const vArrowPoints = lift("_vArrowPoints", "tip, toward, len, halfWidth");
const connectorHitRadius = lift("_connectorHitRadius", "shape");
const arrowPath = lift("_arrowPath", "g");
const nearestOnSegment = lift("_nearestOnSegment", "pt, p, q");
const nearSegmentRaw = lift("_nearSegment", "pt, p, q, tol");

// `_nearSegment` delegates to `_nearestOnSegment`, so drive it through a
// stand-in that carries both — the same pairing the layer has.
const segLayer = { _nearestOnSegment: nearestOnSegment };
segLayer._nearSegment = nearSegmentRaw;
const nearSegment = (pt, p, q, tol) => segLayer._nearSegment(pt, p, q, tol);

function constant(name) {
  const found = (src.match(new RegExp(`var ${name} = ([\\d.]+);`)) || [])[1];
  assert.ok(found !== undefined, `could not read ${name} from etcher.js`);
  return Number(found);
}

const HIT_MAX = constant("CONNECTOR_HIT_RADIUS");
const HIT_MIN = constant("CONNECTOR_HIT_RADIUS_MIN");
const HIT_RATIO = constant("CONNECTOR_HIT_SHAPE_RATIO");
global.CONNECTOR_HIT_RADIUS = HIT_MAX;
global.CONNECTOR_HIT_RADIUS_MIN = HIT_MIN;
global.CONNECTOR_HIT_SHAPE_RATIO = HIT_RATIO;

// ── the anchor table ────────────────────────────────────────────────────────

assert.strictEqual(ARROW_ANCHORS.length, 8,
  "four corners and four side midpoints");

const ids = ARROW_ANCHORS.map((a) => a.id);
assert.deepStrictEqual(
  [...ids].sort(),
  ["e", "n", "ne", "nw", "s", "se", "sw", "w"],
  "anchor ids are persisted inside every arrow's geometry — renaming one " +
  "detaches every arrow already saved with it"
);
assert.strictEqual(new Set(ids).size, 8, "ids must be unique");

// Fractions stay on the box: no anchor floats outside the shape.
for (const a of ARROW_ANCHORS) {
  assert.ok(a.fx >= 0 && a.fx <= 1, `${a.id}: fx on the box`);
  assert.ok(a.fy >= 0 && a.fy <= 1, `${a.id}: fy on the box`);
  // Every anchor is on the *perimeter* — at least one axis is pinned to an
  // edge. A 0.5/0.5 entry would be the box's centre, which is not bindable.
  assert.ok(
    a.fx === 0 || a.fx === 1 || a.fy === 0 || a.fy === 1,
    `${a.id}: anchors sit on the perimeter, not inside the box`
  );
}

// ── resolving anchors against a box ─────────────────────────────────────────

// A stand-in layer: `_anchorPointsFor` only reaches back for the bbox.
function layerWithBox(box) {
  return { _shapeBBoxImagePx: () => box };
}

const BOX = { x: 100, y: 200, w: 400, h: 300 };
const layer = layerWithBox(BOX);
const shape = { kind: "rectangle" };

const byId = {};
for (const p of anchorPointsFor.call(layer, shape)) byId[p.id] = p;

assert.deepStrictEqual(
  { x: byId.nw.x, y: byId.nw.y }, { x: 100, y: 200 }, "nw is the top-left");
assert.deepStrictEqual(
  { x: byId.se.x, y: byId.se.y }, { x: 500, y: 500 }, "se is the bottom-right");
assert.deepStrictEqual(
  { x: byId.ne.x, y: byId.ne.y }, { x: 500, y: 200 }, "ne is the top-right");
assert.deepStrictEqual(
  { x: byId.sw.x, y: byId.sw.y }, { x: 100, y: 500 }, "sw is the bottom-left");
assert.deepStrictEqual(
  { x: byId.n.x, y: byId.n.y }, { x: 300, y: 200 }, "n is the top edge's middle");
assert.deepStrictEqual(
  { x: byId.s.x, y: byId.s.y }, { x: 300, y: 500 }, "s is the bottom edge's middle");
assert.deepStrictEqual(
  { x: byId.w.x, y: byId.w.y }, { x: 100, y: 350 }, "w is the left edge's middle");
assert.deepStrictEqual(
  { x: byId.e.x, y: byId.e.y }, { x: 500, y: 350 }, "e is the right edge's middle");

// The single-anchor lookup has to agree with the full sweep — they're
// separate code paths (one is the render-time resolve, the other draws the
// dots), and an arrow landing somewhere other than the dot the user aimed
// at is exactly the drift this catches.
for (const id of ids) {
  assert.deepStrictEqual(
    anchorPointImage.call(layer, shape, id),
    { x: byId[id].x, y: byId[id].y },
    `${id}: single lookup must match the swept set`
  );
}

// Unknown ids resolve to nothing rather than a plausible-looking point —
// that's what lets a stale binding fall back to its cached coordinates.
assert.strictEqual(anchorPointImage.call(layer, shape, "middle"), null);
assert.strictEqual(anchorPointImage.call(layer, shape, undefined), null);

// A shape with no computable bbox (an empty freehand, say) offers nothing
// to bind to instead of throwing.
const noBox = layerWithBox(null);
assert.deepStrictEqual(anchorPointsFor.call(noBox, shape), []);
assert.strictEqual(anchorPointImage.call(noBox, shape, "n"), null);
assert.deepStrictEqual(anchorPointsFor.call(layer, null), []);

// A zero-area box collapses every anchor onto one point — degenerate, but it
// must not produce NaN, which would blank the whole arrow.
const flat = layerWithBox({ x: 7, y: 9, w: 0, h: 0 });
for (const p of anchorPointsFor.call(flat, shape)) {
  assert.strictEqual(p.x, 7, `${p.id}: no NaN on a zero-width box`);
  assert.strictEqual(p.y, 9, `${p.id}: no NaN on a zero-height box`);
}

// ── the routed path ─────────────────────────────────────────────────────────

// An arrow is drawn through tail → bends → head. Four separate consumers
// read this list (render, bbox, hit test, handle list), so the ordering is
// load-bearing: get it wrong and the handle you grab moves a different bend
// than the one under the cursor.
assert.deepStrictEqual(
  arrowPath({ a: [0, 0], points: [[10, 10], [20, 5]], b: [30, 0] }),
  [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 5 }, { x: 30, y: 0 }],
  "tail first, bends in order, head last");

// Arrows saved before waypoints existed have no `points` key at all, and
// must keep reading as the plain two-point case rather than breaking.
assert.deepStrictEqual(
  arrowPath({ a: [1, 2], b: [3, 4] }),
  [{ x: 1, y: 2 }, { x: 3, y: 4 }],
  "a connector with no `points` key is a straight arrow");
assert.deepStrictEqual(
  arrowPath({ a: [1, 2], points: [], b: [3, 4] }),
  [{ x: 1, y: 2 }, { x: 3, y: 4 }],
  "an empty bend list is the same thing");

// Half-built geometry yields nothing rather than a path with holes in it.
assert.deepStrictEqual(arrowPath({ a: [1, 2] }), []);
assert.deepStrictEqual(arrowPath({ b: [1, 2] }), []);
assert.deepStrictEqual(arrowPath(null), []);

// ── segment midpoints (the "add a bend here" ghosts) ────────────────────────

const midpointPositions = lift("_midpointPositionsForShape", "shape");

// The layer method dispatches by kind and reaches back for `_arrowPath`, so
// the stand-in has to carry it.
const midLayer = { _arrowPath: arrowPath };

// One ghost per segment — an arrow is an open path, so a straight one has a
// single midpoint and there is no wrap from head back round to tail. (A
// polygon, being closed, does wrap; that difference is why arrows don't just
// borrow the polygon branch.)
assert.deepStrictEqual(
  midpointPositions.call(midLayer, {
    kind: "arrow", geometry: { a: [0, 0], b: [100, 0] }
  }),
  [{ x: 50, y: 0 }],
  "a straight arrow offers one bend point, at its middle");

assert.deepStrictEqual(
  midpointPositions.call(midLayer, {
    kind: "arrow", geometry: { a: [0, 0], points: [[100, 0]], b: [100, 100] }
  }),
  [{ x: 50, y: 0 }, { x: 100, y: 50 }],
  "each leg of a routed arrow gets its own");

// The count is what ties the ghosts to `_startMidpointDrag`'s `edgeIdx`:
// segment N runs from path point N to N+1, so inserting into segment N makes
// bend N. An off-by-one here would add the bend to the wrong leg.
const routed = { a: [0, 0], points: [[10, 0], [20, 0]], b: [30, 0] };
assert.strictEqual(
  midpointPositions.call(midLayer, { kind: "arrow", geometry: routed }).length,
  arrowPath(routed).length - 1,
  "segments, not points — one ghost between each adjacent pair");

// Which kinds gate their dot on distance to the whole segment rather than to
// its midpoint. Only arrows — a polygon's edges are short enough that the two
// measurements amount to the same thing.
//
// Note this decides *when the dot shows*, not where it sits: it stays at the
// segment's middle either way, so it can't wander onto the bend handles at
// either end and cover the points the user is reaching for.
const segmentsFor = lift("_midpointSegmentsForShape", "shape");
const segLayer2 = { _arrowPath: arrowPath };

assert.strictEqual(
  segmentsFor.call(segLayer2, { kind: "arrow", geometry: routed }).length,
  3, "an arrow offers each of its legs");
assert.deepStrictEqual(
  segmentsFor.call(segLayer2, { kind: "arrow", geometry: { a: [0, 0], b: [8, 0] } }),
  [{ p: { x: 0, y: 0 }, q: { x: 8, y: 0 } }],
  "…as {p, q} pairs, in path order");

for (const kind of ["polygon", "rectangle", "circle", "freehand", "text"]) {
  assert.deepStrictEqual(
    segmentsFor.call(segLayer2, { kind, geometry: { points: [[0, 0], [1, 1]] } }),
    [], `${kind} keeps fixed midpoints`);
}
assert.deepStrictEqual(segmentsFor.call(segLayer2, null), []);

// The gate has to be on the KIND, not on whether the geometry happens to
// look path-shaped. `line` and `dimension` store the same `a`/`b` an arrow
// does, so a check that only asked "can I build a path from this?" would
// hand them sliding ghosts they have no drag code for.
for (const kind of ["line", "dimension"]) {
  assert.deepStrictEqual(
    segmentsFor.call(segLayer2, { kind, geometry: { a: [0, 0], b: [10, 0] } }),
    [], `${kind} has a/b too, but is not a connector`);
}

// ── hit-testing a segment ───────────────────────────────────────────────────

const P = { x: 0, y: 0 };
const Q = { x: 100, y: 0 };

assert.ok(nearSegment({ x: 50, y: 3 }, P, Q, 5), "just off the middle: a hit");
assert.ok(!nearSegment({ x: 50, y: 9 }, P, Q, 5), "further than tol: a miss");
assert.ok(nearSegment({ x: 0, y: 0 }, P, Q, 5), "on an endpoint: a hit");

// The parameter is clamped, so the segment does not extend into an infinite
// line — without the clamp, a click far off the end of one leg of a routed
// arrow would select it.
assert.ok(!nearSegment({ x: 400, y: 0 }, P, Q, 5),
  "past the end of the segment: a miss, not a hit on its extension");
assert.ok(!nearSegment({ x: -400, y: 0 }, P, Q, 5),
  "before the start: likewise");

// Just beyond an endpoint, within tolerance, still hits — the ends are round
// caps, not hard stops.
assert.ok(nearSegment({ x: 103, y: 0 }, P, Q, 5), "within tol past the end");

// A degenerate segment (two bends dropped on the same spot) measures from
// the point itself rather than dividing by a zero length.
const Z = { x: 10, y: 10 };
assert.ok(nearSegment({ x: 12, y: 10 }, Z, Z, 5), "degenerate: near");
assert.ok(!nearSegment({ x: 40, y: 10 }, Z, Z, 5), "degenerate: far");

// ── distance to a segment ───────────────────────────────────────────────────

// How near the pointer is to a segment — which is what raises the "add a
// bend" dot. Measuring to the segment rather than to its midpoint is the
// whole point: on a long leg you can be right on the line while its middle
// is hundreds of px away.
assert.deepStrictEqual(
  nearestOnSegment({ x: 20, y: 40 }, P, Q), { x: 20, y: 0 },
  "projects perpendicularly onto the segment");
assert.deepStrictEqual(
  nearestOnSegment({ x: 90, y: -30 }, P, Q), { x: 90, y: 0 },
  "…anywhere along it, not just near the middle");

// Clamped at both ends, so hovering past a segment offers its endpoint
// rather than a point out on the line's extension.
assert.deepStrictEqual(nearestOnSegment({ x: 500, y: 20 }, P, Q), { x: 100, y: 0 });
assert.deepStrictEqual(nearestOnSegment({ x: -500, y: 20 }, P, Q), { x: 0, y: 0 });

// Degenerate segment: the segment is the point.
assert.deepStrictEqual(nearestOnSegment({ x: 99, y: 99 }, Z, Z), { x: 10, y: 10 });

// ── the grab zone ───────────────────────────────────────────────────────────

// The visible dot is a 4.5px target; the zone that accepts the press is a
// separate, larger disc underneath it. Its radius is clamped against the
// shape's *rendered* size, and both ends of that clamp matter:
//
//   - too small and the user is back to aiming at a dot;
//   - too large and eight discs carpet a small shape, leaving nowhere to
//     press to select or move the shape itself.
//
// `_connectorHitRadius` reads the bbox and projects it to container px, so
// the stand-in supplies both. A 1:1 projection keeps the arithmetic legible.
function layerAtScale(box, scale) {
  return {
    _shapeBBoxImagePx: () => box,
    _imageToContainer: (p) => ({ x: p.x * scale, y: p.y * scale })
  };
}

const big = layerAtScale({ x: 0, y: 0, w: 400, h: 300 }, 1);
assert.strictEqual(connectorHitRadius.call(big, shape), HIT_MAX,
  "a comfortably large shape gets the full zone");

// 24px tall rendered: the ratio wants 6.24, which is what it gets — the
// point at which the clamp starts protecting the shape's own hit area.
const small = layerAtScale({ x: 0, y: 0, w: 32, h: 24 }, 1);
const smallR = connectorHitRadius.call(small, shape);
assert.ok(smallR < HIT_MAX, "a small shape must not get the full zone");
assert.ok(Math.abs(smallR - 24 * HIT_RATIO) < 1e-9, "the ratio drives it");

// Whatever the ratio, the zones can never swallow the shape: eight discs of
// this radius still leave the middle pressable. Half the shorter side is the
// bar — at exactly half, the discs from opposite edges would meet.
assert.ok(smallR < 24 / 2,
  "grab zones must leave the shape itself clickable");

// Tiny: the ratio wants under a pixel, so the floor takes over rather than
// letting the zone collapse back to a pixel-perfect target.
const tiny = layerAtScale({ x: 0, y: 0, w: 6, h: 4 }, 1);
assert.strictEqual(connectorHitRadius.call(tiny, shape), HIT_MIN,
  "the floor keeps a grabbable zone on even a tiny shape");

// Zoom is what the clamp actually tracks — the same shape zoomed out is a
// smaller target and must tighten, or the zones merge as you zoom away.
const zoomedOut = layerAtScale({ x: 0, y: 0, w: 400, h: 300 }, 0.05);
assert.ok(connectorHitRadius.call(zoomedOut, shape) < HIT_MAX,
  "zooming out tightens the zones; the clamp is on rendered size, not image size");
assert.strictEqual(
  connectorHitRadius.call(layerAtScale({ x: 0, y: 0, w: 400, h: 300 }, 4), shape),
  HIT_MAX, "zooming in caps rather than growing without bound");

// The shorter side governs — a wide letterbox is constrained by its height.
assert.strictEqual(
  connectorHitRadius.call(layerAtScale({ x: 0, y: 0, w: 9000, h: 24 }, 1), shape),
  smallR, "a wide, short shape is clamped by its height");

// No bbox to measure: fall back to the full radius rather than NaN, which
// would make the zone vanish entirely.
assert.strictEqual(
  connectorHitRadius.call(layerAtScale(null, 1), shape), HIT_MAX);

// ── the arrowhead ───────────────────────────────────────────────────────────

function parse(points) {
  return points.split(" ").map((pair) => pair.split(",").map(Number));
}

// Pointing right: tip at (100, 0), the shaft running back to the origin.
// The wings must land *behind* the tip — a head opening the other way is an
// arrow that reads backwards.
const right = parse(vArrowPoints({ x: 100, y: 0 }, { x: 0, y: 0 }, 10, 5));
assert.strictEqual(right.length, 3, "wing, tip, wing");
assert.deepStrictEqual(right[1], [100, 0], "the middle point is the tip");
assert.strictEqual(right[0][0], 90, "wings sit `len` back along the shaft");
assert.strictEqual(right[2][0], 90);
assert.deepStrictEqual(
  [right[0][1], right[2][1]].sort((a, b) => a - b), [-5, 5],
  "wings straddle the shaft by `halfWidth` either side");

// Pointing down: the same shape, rotated. Checks the perpendicular is taken
// from the direction rather than hardcoded to an axis.
const down = parse(vArrowPoints({ x: 0, y: 100 }, { x: 0, y: 0 }, 10, 5));
assert.deepStrictEqual(down[1], [0, 100], "tip");
assert.strictEqual(down[0][1], 90, "wings back along a vertical shaft");
assert.strictEqual(down[2][1], 90);
assert.deepStrictEqual(
  [down[0][0], down[2][0]].sort((a, b) => a - b), [-5, 5],
  "wings straddle a vertical shaft horizontally");

// Reversing the two arguments must flip which end is pointed at. This is the
// assertion that would fail if a call site passed (a, b) where it meant
// (b, a) — the arrowhead landing on the tail.
const forward = parse(vArrowPoints({ x: 100, y: 0 }, { x: 0, y: 0 }, 10, 5));
const backward = parse(vArrowPoints({ x: 0, y: 0 }, { x: 100, y: 0 }, 10, 5));
assert.deepStrictEqual(forward[1], [100, 0]);
assert.deepStrictEqual(backward[1], [0, 0]);
assert.notDeepStrictEqual(forward, backward,
  "the head must follow the tip argument, not the pair");

// Degenerate: no direction to open along, so no head at all. The draft's
// first pointermove tick hits this on every arrow ever drawn.
assert.strictEqual(vArrowPoints({ x: 5, y: 5 }, { x: 5, y: 5 }, 10, 5), "",
  "a zero-length arrow draws no head rather than a spike in some " +
  "arbitrary direction");

// Sub-threshold but non-zero is treated the same way — the guard is a
// distance, not an equality check.
assert.strictEqual(vArrowPoints({ x: 0, y: 0 }, { x: 0.0001, y: 0 }, 10, 5), "");

// The head's size comes from its arguments, not the shaft's length: a long
// arrow and a short one get the same V.
const short = parse(vArrowPoints({ x: 20, y: 0 }, { x: 0, y: 0 }, 10, 5));
const long = parse(vArrowPoints({ x: 9000, y: 0 }, { x: 0, y: 0 }, 10, 5));
assert.strictEqual(short[1][0] - short[0][0], long[1][0] - long[0][0],
  "head length is independent of shaft length");

// ── how heavy a connector is drawn ──────────────────────────────────────────

// A connector's weight comes from the shapes it joins and from nothing else.
// Three properties matter, and each replaced an earlier scheme that got one
// of them wrong, so each is pinned:
//
//   * length is not part of it — two arrows between the same pair match
//     whether they cross the board or join adjacent edges;
//   * zoom is not part of it — an arrow drawn while zoomed right in matches
//     one drawn while zoomed out, which anchoring at first paint could not do;
//   * size IS part of it, proportionally — twice the shape, twice the line.
{
  const ratioSrc = (src.match(/var ARROW_WEIGHT_RATIO = [\d.]+;/) || [])[0];
  assert.ok(ratioSrc, "could not read ARROW_WEIGHT_RATIO from etcher.js");
  global.ARROW_WEIGHT_RATIO = eval(ratioSrc.replace("var ARROW_WEIGHT_RATIO = ", ""));

  const arrowWeight = lift("_arrowWeightImagePx", "shape");
  const bboxImagePx = lift("_shapeBBoxImagePx", "shape");

  // A board of rectangles, addressed by uuid the way the real lookup works.
  const board = (shapes) => ({
    shapes,
    _shapeByUuid(uuid) { return shapes.find((s) => s.uuid === uuid) || null; },
    _shapeBBoxImagePx: bboxImagePx
  });
  const box = (uuid, w, h) =>
    ({ uuid, kind: "rectangle", geometry: { x: 0, y: 0, w, h } });
  const conn = (from, to, pts) => ({
    kind: "arrow",
    geometry: {
      a: [0, 0], b: [100, 0], points: pts || [],
      from: from ? { uuid: from, anchor: "e" } : null,
      to: to ? { uuid: to, anchor: "w" } : null
    }
  });

  const small = board([box("s1", 700, 500), box("s2", 700, 500)]);
  const base = arrowWeight.call(small, conn("s1", "s2"));
  assert.ok(base > 0);

  // Length: the arrow's own geometry must not enter into it. A long shaft,
  // and one routed through bends, weigh exactly what a short one does.
  const stretched = conn("s1", "s2");
  stretched.geometry.b = [99999, 4321];
  assert.strictEqual(arrowWeight.call(small, stretched), base,
    "distance must not change the weight");
  assert.strictEqual(
    arrowWeight.call(small, conn("s1", "s2", [[10, 10], [40, 90], [80, 20]])),
    base, "routing through bends must not change the weight");

  // Zoom: there is no zoom term at all, which is the property the previous
  // scheme lacked. Nothing in the call can observe the viewport.
  assert.ok(!/_markerScale|_zoomPx|_arrowScale/.test(String(arrowWeight)),
    "the weight must not consult the zoom in any form");

  // Size: proportional, and measured as the geometric mean so it sits
  // between the two dimensions rather than following one.
  const twice = board([box("s1", 1400, 1000), box("s2", 1400, 1000)]);
  assert.ok(Math.abs(arrowWeight.call(twice, conn("s1", "s2")) - base * 2) < 1e-9,
    "twice the shape, twice the line");

  // A square and a long thin banner of the SAME area weigh the same — this
  // is what the geometric mean buys, and what width alone or the diagonal
  // would each get wrong.
  const sq = board([box("a", 1000, 1000), box("b", 1000, 1000)]);
  const banner = board([box("a", 4000, 250), box("b", 4000, 250)]);
  assert.ok(
    Math.abs(arrowWeight.call(sq, conn("a", "b")) -
             arrowWeight.call(banner, conn("a", "b"))) < 1e-9,
    "equal area weighs the same whatever the aspect ratio");

  // Both ends have a say: joining a large block to a small one lands between
  // the two, not on either.
  const mixed = board([box("big", 4000, 4000), box("wee", 400, 400)]);
  const mid = arrowWeight.call(mixed, conn("big", "wee"));
  const bigOnly = arrowWeight.call(board([box("big", 4000, 4000)]), conn("big", null));
  const weeOnly = arrowWeight.call(board([box("wee", 400, 400)]), conn("wee", null));
  assert.ok(mid > weeOnly && mid < bigOnly, "a mixed pair lands between its ends");
  assert.ok(Math.abs(mid - (bigOnly + weeOnly) / 2) < 1e-9, "and lands on the mean");

  // One end bound is enough — a connector being dragged out of a shape has
  // no target yet and still has to be drawn.
  assert.ok(arrowWeight.call(small, conn("s1", null)) > 0);
  assert.ok(arrowWeight.call(small, conn(null, "s2")) > 0);

  // Bound to nothing, or to shapes since deleted, there is nothing to
  // measure. Null tells the caller to fall back, rather than handing back a
  // zero-width invisible arrow.
  assert.strictEqual(arrowWeight.call(small, conn(null, null)), null);
  assert.strictEqual(arrowWeight.call(small, conn("gone", "alsogone")), null);
  assert.strictEqual(arrowWeight.call(board([]), conn("s1", "s2")), null);

  // A degenerate shape has no area to measure and must not drag the weight
  // to zero or NaN — it is skipped, and the other end carries it.
  const flatBoard = board([box("flat", 500, 0), box("s2", 700, 500)]);
  assert.ok(Math.abs(arrowWeight.call(flatBoard, conn("flat", "s2")) -
                     arrowWeight.call(flatBoard, conn(null, "s2"))) < 1e-9,
    "a zero-area shape is skipped, not averaged in as zero");
  assert.strictEqual(
    arrowWeight.call(board([box("flat", 500, 0)]), conn("flat", null)), null);
}

console.log("connectors: all checks passed");
