// Pins what a bare click with a drawing tool produces.
//
// User-testing feedback: clicking (or double-clicking) with a shape tool
// either did nothing — which reads as the tool being broken — or, with a
// pixel or two of jitter, placed a shape whose corners all sat within
// those pixels: visible as a speck, grabbable by nothing, erasable only by
// luck. Every comparable canvas tool turns that click into a default-sized
// shape centered on the point.
//
// Now: rectangle and circle click-place a default-sized shape centered on
// the cursor (and `_finalizeShape` selects it — click, drop, adjust);
// freehand and marker taps cancel instead of committing a speck; the
// thresholds are SCREEN px so a click is the same gesture at every zoom.
//
//   node test/js/click_place_test.js

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

// The constants as the bundle defines them — the tests derive expectations
// from these rather than restating magic numbers.
const THRESHOLD = Number((src.match(/var CLICK_PLACE_THRESHOLD_PX = (\d+);/) || [])[1]);
const SIZE = Number((src.match(/var CLICK_PLACE_SIZE_PX = (\d+);/) || [])[1]);
assert.ok(THRESHOLD > 0, "could not find CLICK_PLACE_THRESHOLD_PX");
assert.ok(SIZE > 0, "could not find CLICK_PLACE_SIZE_PX");
global.CLICK_PLACE_THRESHOLD_PX = THRESHOLD;
global.CLICK_PLACE_SIZE_PX = SIZE;

const isClickGesture = extract("_isClickGesture");
const clickPlaceSize = extract("_clickPlaceSizeImagePx");
const strokeIsClick = extract("_strokeIsClick");
const commitRectangle = extract("_commitRectangle");
const commitCircle = extract("_commitCircle");
const commitPolygon = extract("_commitPolygon");

// A test double that records what a commit did: finalized with what
// geometry, or canceled.
function harness(scale, draft) {
  const out = { finalized: null, canceled: false };
  return {
    ctx: {
      draftState: Object.assign(
        { el: { classList: { remove: () => {} } } }, draft
      ),
      _markerScale: () => scale,
      _isClickGesture: isClickGesture,
      _clickPlaceSizeImagePx: clickPlaceSize,
      _strokeIsClick: strokeIsClick,
      _finalizeShape: (kind, geom) => { out.finalized = { kind, geom }; },
      _cancelDraft: () => { out.canceled = true; }
    },
    out
  };
}

// ── the click judgment is zoom-independent ──────────────────────────────────

{
  const at = (scale) => ({ _markerScale: () => scale });
  assert.ok(isClickGesture.call(at(1), { x: 0, y: 0 }, { x: 3, y: 0 }),
    "3 image px at 1× is 3 screen px — that is a click");
  assert.ok(!isClickGesture.call(at(4), { x: 0, y: 0 }, { x: 3, y: 0 }),
    "the same 3 image px at 4× is 12 screen px — a deliberate drag, not a click; " +
    "the threshold is being judged in image px again");
  assert.ok(isClickGesture.call(at(0.05), { x: 0, y: 0 }, { x: 40, y: 0 }),
    "40 image px at 0.05× is 2 screen px of jitter — that is a click");
}

// ── a click places a centered default square ────────────────────────────────

{
  const { ctx, out } = harness(2, { anchor: { x: 100, y: 50 } });
  commitRectangle.call(ctx, { x: 101, y: 50 }); // 2 screen px of jitter
  assert.ok(out.finalized, "a click should place a rectangle, not cancel");
  const g = out.finalized.geom;
  const side = SIZE / 2; // screen size / scale 2 = image px
  assert.strictEqual(g.w, side, "click-placed square is the default size");
  assert.strictEqual(g.h, side, "click-placed square is square");
  assert.ok(
    Math.abs(g.x + g.w / 2 - 100) < 0.001 && Math.abs(g.y + g.h / 2 - 50) < 0.001,
    `the square must center on the click point, got ${JSON.stringify(g)}`
  );
}

// ── a click places a centered default circle ────────────────────────────────

{
  const { ctx, out } = harness(2, { center: { x: 30, y: 40 } });
  commitCircle.call(ctx, { x: 30, y: 41 });
  assert.ok(out.finalized, "a click should place a circle, not cancel");
  const g = out.finalized.geom;
  assert.strictEqual(g.cx, 30, "circle centers on the click point (x)");
  assert.strictEqual(g.cy, 40, "circle centers on the click point (y)");
  assert.strictEqual(g.r, SIZE / 2 / 2, "circle radius is half the default size");
}

// ── real drags still work exactly as drawn ──────────────────────────────────

{
  const { ctx, out } = harness(1, { anchor: { x: 0, y: 0 } });
  commitRectangle.call(ctx, { x: 80, y: 60 });
  assert.deepStrictEqual(out.finalized.geom, { x: 0, y: 0, w: 80, h: 60 },
    "a drawn rectangle keeps its drawn geometry");
}

// A deliberate SMALL drag at high zoom is a real shape now — the old
// image-px minimum canceled 20 screen px of intent as "under 2 image px".
{
  const { ctx, out } = harness(12, { anchor: { x: 0, y: 0 } });
  commitRectangle.call(ctx, { x: 1.7, y: 1.7 }); // ~20 screen px
  assert.ok(out.finalized && !out.canceled,
    "a 20-screen-px drag at high zoom must create a shape, not cancel");
}

// A sliver drag (extent on one axis only) still cancels — a
// zero-height rectangle is not a usable shape.
{
  const { ctx, out } = harness(1, { anchor: { x: 0, y: 0 } });
  commitRectangle.call(ctx, { x: 80, y: 0.5 });
  assert.ok(out.canceled && !out.finalized,
    "a zero-height swipe should cancel, not place a sliver");
}

// ── pen taps cancel instead of committing a speck ───────────────────────────

// The point count can't tell a tap from a stroke — a click with a pixel of
// jitter yields several samples. The extent can.
{
  const at1 = { _isClickGesture: (a, b) => isClickGesture.call({ _markerScale: () => 1 }, a, b) };
  assert.ok(strokeIsClick.call(at1, [[10, 10], [11, 10], [10, 11], [11, 11]]),
    "a few samples of click jitter is a tap");
  assert.ok(!strokeIsClick.call(at1, [[10, 10], [11, 10], [40, 30]]),
    "a stroke that travels is a drawing");

  // And the commit consults it: this is the wiring that stops the speck.
  const body = src.slice(
    src.indexOf("    _commitFreehand: function"),
    src.indexOf("\n    },", src.indexOf("    _commitFreehand: function"))
  );
  assert.ok(body.includes("_strokeIsClick(pts)"),
    "_commitFreehand no longer screens out tap-specks");
}

// ── polygon stays click-per-vertex, degenerate closes still cancel ──────────

{
  const out = { canceled: false };
  const ctx = {
    draftPolygon: { points: [[0, 0], [1, 1]] },
    _cancelDraft: () => { out.canceled = true; }
  };
  commitPolygon.call(ctx);
  assert.ok(out.canceled,
    "closing a polygon with fewer than 3 vertices (a double-click in place) must cancel cleanly");
}

console.log("click place: all checks passed");
