// Pins that a dimension's arrowheads are part of the shape you can click.
//
// The hit-test measured distance to the SHAFT and nothing else, so only the
// thin line answered. The V-arrowheads at each end scale with the stroke —
// that is what stops them being hairlines on a heavy line — so on a fat
// dimension they reach well outside the shaft's grab pad, and aiming at the
// chevron, which is the most obvious thing to aim at, landed on empty
// canvas.
//
//   node test/js/dim_head_hit_test.js

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

const containsPoint = extract("_shapeContainsPoint");
const shaftStrokePx = extract("_shaftStrokePx");
const shaftHalf = extract("_shaftHalfWidthImagePx");
const headExtent = extract("_dimHeadExtentImagePx");

// Zoom 1, so image px == screen px throughout.
function board() {
  return {
    _shaftStrokePx: shaftStrokePx,
    _shaftHalfWidthImagePx: shaftHalf,
    _dimHeadExtentImagePx: headExtent,
    _markerScale: () => 1,
    _textDefaultBoxImagePx: () => 16,
  };
}
const TOL = 16 * 0.6; // the shaft's own grab pad

// A horizontal dimension with a HEAVY stroke: 24px, so the heads are drawn
// at k = 24 / 2 = 12 → 120 long and 60 out to each side.
function heavy(kind) {
  return {
    kind: kind || "dimension",
    geometry: { a: [100, 200], b: [700, 200] },
    style: { width: 24 },
  };
}

{
  const k = 24 / LINE_WEIGHT_PX;
  const ext = headExtent.call(board(), heavy());
  assert.deepStrictEqual(ext, { len: 10 * k, half: 5 * k },
    "the head extent must mirror what the render draws");
  assert.strictEqual(headExtent.call(board(), heavy("line")), null,
    "a plain line has no heads to account for");
  assert.strictEqual(headExtent.call(board(), { kind: "rectangle" }), null);
}

// ── the chevrons are clickable ─────────────────────────────────────────────

{
  const self = board();
  const dim = heavy();

  // On a chevron: 40px back along the shaft from the left end, 40px above
  // it. Well inside the head (120 long, 60 out) and well outside the
  // shaft's pad, which is where this used to fall through.
  assert.ok(40 > TOL, "the test point must be outside the shaft's own pad");
  assert.strictEqual(containsPoint.call(self, dim, { x: 140, y: 160 }), true,
    "the left arrowhead is part of the shape");
  assert.strictEqual(containsPoint.call(self, dim, { x: 660, y: 240 }), true,
    "and so is the right one");

  // The shaft still answers, of course.
  assert.strictEqual(containsPoint.call(self, dim, { x: 400, y: 200 }), true);

  // Past the head's reach, the shape stops. The middle of a dimension is
  // not a 60px-wide target just because its ends are.
  assert.strictEqual(containsPoint.call(self, dim, { x: 400, y: 160 }), false,
    "the widening is local to the ends, not the whole line");
  assert.strictEqual(containsPoint.call(self, dim, { x: 140, y: 120 }), false,
    "and it stops where the chevron does");
}

{
  // A plain LINE has no heads, so its ends stay as thin as its middle.
  const self = board();
  const line = heavy("line");
  assert.strictEqual(containsPoint.call(self, line, { x: 140, y: 160 }), false,
    "a line's end is not widened — there is nothing drawn out there");
  // But its own thickness still counts: half of a 24px stroke is 12px.
  assert.strictEqual(containsPoint.call(self, line, { x: 400, y: 190 }), true,
    "half a heavy stroke is already on the line");
  assert.strictEqual(containsPoint.call(self, line, { x: 400, y: 160 }), false);
}

{
  // A default-weight dimension: the heads are small enough to sit inside
  // the shaft's existing pad, so nothing about the old behaviour changes.
  const self = board();
  const thin = { kind: "dimension", geometry: { a: [100, 200], b: [700, 200] }, style: {} };
  const ext = headExtent.call(self, thin);
  assert.ok(ext.half < TOL,
    "a default-weight head is inside the shaft pad — this fix is about heavy lines");
  assert.strictEqual(containsPoint.call(self, thin, { x: 400, y: 205 }), true);
  assert.strictEqual(containsPoint.call(self, thin, { x: 400, y: 260 }), false);
}

// ── it is a SCREEN measurement, like everything else you aim at ───────────

{
  // Zoomed out 4x: a 24px stroke is drawn 6px wide on screen and its heads
  // shrink with it, so the image-px reach grows rather than staying fixed.
  const zoomed = Object.assign(board(), { _markerScale: () => 0.25 });
  const ext = headExtent.call(zoomed, heavy());
  const base = headExtent.call(board(), heavy());
  assert.strictEqual(ext.half, base.half / 0.25,
    "the same on-screen chevron covers four times the image px when zoomed out");
  assert.strictEqual(shaftHalf.call(zoomed, heavy()), 24 / 2 / 0.25);
}

// ── the numbers match the render's ────────────────────────────────────────
//
// The extent is a copy of what the render computes, and a copy that drifts
// is worse than no copy: the chevrons would be drawn in one place and
// clickable in another.
{
  const start = src.indexOf('        case "dimension": {', src.indexOf("_renderShape: function"));
  assert.notStrictEqual(start, -1, "could not find the dimension render case");
  const body = src.slice(start, src.indexOf("\n        case ", start + 10));
  assert.ok(body.includes("var dimHeadK = dimStroke / LINE_WEIGHT_PX;"),
    "the render still scales its heads off stroke / LINE_WEIGHT_PX");
  assert.ok(body.includes("var dimHeadLen = 10 * dimHeadK;"),
    "…10x along the shaft");
  assert.ok(body.includes("var dimHeadHalf = 5 * dimHeadK;"),
    "…and 5x to each side — the hit-test's 10 and 5 mirror these");

  const hit = src.slice(src.indexOf("    _dimHeadExtentImagePx: function"),
                        src.indexOf("\n    },", src.indexOf("    _dimHeadExtentImagePx: function")));
  assert.ok(hit.includes("10 * k / scale") && hit.includes("5 * k / scale"),
    "the hit-test uses the same 10 and 5");
  assert.ok(hit.includes("_shaftStrokePx(shape, LINE_WEIGHT_PX) / LINE_WEIGHT_PX"),
    "off the same stroke width the render uses");
}

console.log("dimension head hit: all checks passed");
