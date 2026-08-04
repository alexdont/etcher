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

console.log("connectors: all checks passed");
