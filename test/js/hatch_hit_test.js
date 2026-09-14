// Pins what a HATCH-filled shape's click target is.
//
// The hatch fill ("lines") is mostly gaps — a region drawn with it is a
// window, not a surface. But the hit-test treated its whole interior as a
// target, so one big hatched annotation swallowed every click inside it,
// including on the shapes underneath that the user can plainly see and is
// reaching for. Hatched shapes are now grabbed by their OUTLINE, which is
// the part that's actually drawn.
//
// Every other fill is unchanged, "none" included: outline-only shapes have
// taken a body hit since the beginning, they're often a big empty box drawn
// around something, and quietly making those unclickable in the middle is a
// change nobody asked for.
//
//   node test/js/hatch_hit_test.js

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

const containsPoint = extract("_shapeContainsPoint");
const bodyIsHittable = extract("_bodyIsHittable");
const edgeGrabTolerance = extract("_edgeGrabTolerance");
const nearRectEdge = extract("_nearRectEdge");
const nearPolygonEdge = extract("_nearPolygonEdge");
const nearSegment = extract("_nearSegment");
const nearestOnSegment = extract("_nearestOnSegment");
const strokeNearPoint = extract("_strokeNearPoint");

// Zoom 1, so image px == screen px and the tolerance is a round number:
// `_textDefaultBoxImagePx` is 16 / scale, and the grab pad is 0.6 of it.
const SCALE = 1;
const TOL = (16 / SCALE) * 0.6;

const ctx = {
  _bodyIsHittable: bodyIsHittable,
  _edgeGrabTolerance: edgeGrabTolerance,
  _nearRectEdge: nearRectEdge,
  _nearPolygonEdge: nearPolygonEdge,
  _nearSegment: nearSegment,
  _nearestOnSegment: nearestOnSegment,
  _strokeNearPoint: strokeNearPoint,
  _markerScale: () => SCALE,
  _textDefaultBoxImagePx: () => 16 / SCALE,
  _shapeContainsImagePoint() { return true; },  // "the body would have hit"
  _freehandFlatten: (g) => (g.points || []),
};

function rect(fill) {
  return {
    kind: "rectangle",
    geometry: { x: 0, y: 0, w: 400, h: 300 },
    style: fill ? { fill } : null,
  };
}

const MIDDLE = { x: 200, y: 150 };
const ON_EDGE = { x: 200, y: 2 };          // just inside the top edge
const OUTSIDE = { x: 200, y: -TOL - 5 };   // clear of it

// ── the rule ───────────────────────────────────────────────────────────────

assert.strictEqual(bodyIsHittable({ style: { fill: "pattern" } }), false,
  "a hatched body is see-through, so it is not a target");
for (const fill of ["semi", "solid", "none", undefined]) {
  assert.strictEqual(bodyIsHittable({ style: { fill } }), true,
    `"${fill}" keeps its body hit`);
}
assert.strictEqual(bodyIsHittable(null), true, "a missing shape is not an error");
assert.strictEqual(bodyIsHittable({}), true, "nor is a shape with no style");

// ── a hatched rectangle ────────────────────────────────────────────────────

{
  const hatched = rect("pattern");
  assert.strictEqual(containsPoint.call(ctx, hatched, MIDDLE), false,
    "clicking through the stripes reaches what is underneath");
  assert.strictEqual(containsPoint.call(ctx, hatched, ON_EDGE), true,
    "the outline is still how you grab it");
  assert.strictEqual(containsPoint.call(ctx, hatched, OUTSIDE), false,
    "and the grab pad does not reach off into empty canvas");

  // Every edge, not just the one the test started on.
  for (const pt of [{ x: 2, y: 150 }, { x: 398, y: 150 }, { x: 200, y: 298 }]) {
    assert.strictEqual(containsPoint.call(ctx, hatched, pt), true,
      `edge at ${JSON.stringify(pt)} should be grabbable`);
  }
}

// ── every other fill is untouched ──────────────────────────────────────────

for (const fill of ["semi", "solid", "none", undefined]) {
  assert.strictEqual(containsPoint.call(ctx, rect(fill), MIDDLE), true,
    `"${fill}" must still take a body hit — this fix is about the hatch only`);
}

// ── the other hatchable kinds ──────────────────────────────────────────────

{
  const circle = {
    kind: "circle", geometry: { cx: 100, cy: 100, r: 50 },
    style: { fill: "pattern" },
  };
  assert.strictEqual(containsPoint.call(ctx, circle, { x: 100, y: 100 }), false,
    "the middle of a hatched circle is click-through");
  assert.strictEqual(containsPoint.call(ctx, circle, { x: 100, y: 51 }), true,
    "its rim is not");
  assert.strictEqual(containsPoint.call(ctx, circle, { x: 100, y: 20 }), false,
    "and neither is the space outside it");
  // Filled, it behaves as before.
  assert.strictEqual(
    containsPoint.call(ctx, Object.assign({}, circle, { style: { fill: "semi" } }),
      { x: 100, y: 100 }), true);
}

{
  const poly = {
    kind: "polygon",
    geometry: { points: [[0, 0], [200, 0], [200, 200], [0, 200]] },
    style: { fill: "pattern" },
  };
  assert.strictEqual(containsPoint.call(ctx, poly, { x: 100, y: 100 }), false,
    "a hatched polygon's middle is click-through");
  assert.strictEqual(containsPoint.call(ctx, poly, { x: 100, y: 1 }), true,
    "an edge is a target");
  assert.strictEqual(containsPoint.call(ctx, poly, { x: 1, y: 100 }), true,
    "including the CLOSING edge — a polygon's last side is a side like any other");
}

{
  // Freehand already tried its stroke before its enclosed area, so
  // edge-only is just that first half.
  const free = {
    kind: "freehand",
    geometry: { points: [[0, 0], [100, 0]] },
    style: { fill: "pattern", width: 4 },
  };
  const near = Object.assign({}, ctx, {
    _strokeNearPoint: (s, pt) => pt.y < 5,
  });
  assert.strictEqual(containsPoint.call(near, free, { x: 50, y: 1 }), true,
    "on the stroke");
  assert.strictEqual(containsPoint.call(near, free, { x: 50, y: 90 }), false,
    "inside the loop, through the stripes");
}

// A marker is a stroke with no interior at all — nothing to change.
{
  const marker = {
    kind: "marker", geometry: { points: [[0, 0], [100, 0]] },
    style: { fill: "pattern" },
  };
  assert.strictEqual(containsPoint.call(ctx, marker, { x: 50, y: 0 }), true,
    "markers keep their own proximity test whatever the style says");
}

// ── the label is its own hit zone, whatever the fill ───────────────────────

{
  const labelled = Object.assign(rect("pattern"), {
    titleGroup: {},
    _renderedTitleImage: { x: 150, y: 120, w: 100, h: 40 },
  });
  assert.strictEqual(containsPoint.call(ctx, labelled, { x: 200, y: 140 }), true,
    "a label sitting over the stripes is still grabbable — it is drawn, so it is a target");
}

// ── the grab pad ───────────────────────────────────────────────────────────

{
  // Same tolerance a line or arrow is grabbed by, so aiming at a hatched
  // outline feels like aiming at any other stroke.
  assert.strictEqual(edgeGrabTolerance.call(ctx, rect("pattern")), TOL);

  // A fat outline is a bigger target: half its width is already "on the
  // line" before any pad is added.
  const fat = { style: { fill: "pattern", width: 80, width_units: "canvas" } };
  assert.strictEqual(edgeGrabTolerance.call(ctx, fat), 40);

  // Widths stored in screen px convert at the current zoom rather than
  // being read as image px.
  const zoomed = Object.assign({}, ctx, {
    _markerScale: () => 2, _textDefaultBoxImagePx: () => 8,
  });
  assert.strictEqual(
    edgeGrabTolerance.call(zoomed, { style: { fill: "pattern", width: 80 } }), 20);
}

console.log("hatch hit target: all checks passed");
