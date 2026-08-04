// Pins the corner radius image shapes are drawn with.
//
// The radius is proportional to the rendered box rather than a constant,
// because the overlay draws in container pixels and re-renders on every pan
// and zoom. A fixed 8px — the first attempt — reads as a rounded button on a
// board zoomed out far enough that a photo is 56px across, and is invisible
// once you zoom in. So the interesting behaviour is entirely in the ratio and
// its two clamps, and that is what these cases cover: the small end where the
// floor takes over, the large end where the cap does, and the range in
// between where it actually tracks the box.
//
// `_imageRadius` is lifted out of the source by name and driven directly,
// same approach as the strip-chrome checks: no DOM required, and a rename
// fails loudly rather than silently testing nothing.
//
//   node test/js/image_radius_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

function constant(name) {
  const found = (src.match(new RegExp(`var ${name} = ([\\d.]+);`)) || [])[1];
  assert.ok(found !== undefined, `could not read ${name} from etcher.js`);
  return Number(found);
}

const RATIO = constant("IMAGE_RADIUS_RATIO");
const MIN = constant("IMAGE_RADIUS_MIN");
const MAX = constant("IMAGE_RADIUS_MAX");

global.IMAGE_RADIUS_RATIO = RATIO;
global.IMAGE_RADIUS_MIN = MIN;
global.IMAGE_RADIUS_MAX = MAX;

const needle = "    _imageRadius: function(w, h) {";
const start = src.indexOf(needle);
assert.notStrictEqual(start, -1, "could not find _imageRadius in etcher.js");
const end = src.indexOf("\n    },", start);
assert.notStrictEqual(end, -1, "could not find the end of _imageRadius");
const imageRadius = eval(
  "(" +
    src.slice(start, end + "\n    }".length).replace("_imageRadius: function", "function") +
    ")"
);

// ── it tracks the box ───────────────────────────────────────────────────────

// Mid-range, comfortably inside both clamps: a 400x300 image rounds by the
// ratio applied to its *shorter* side.
assert.strictEqual(imageRadius(400, 300), 13.5, "300 * 0.045 = 13.5");

// Shorter side, not width — a wide letterbox rounds by its height.
assert.strictEqual(imageRadius(900, 200), imageRadius(200, 900),
  "orientation must not change the radius");
assert.strictEqual(imageRadius(900, 200), 9, "200 * 0.045 = 9");

// The whole point of the ratio: doubling the box doubles the radius, so the
// shape looks the same at every zoom level. Both sizes here sit inside the
// clamps and land on exact tenths, so the check is about the scaling and not
// about where rounding falls.
assert.strictEqual(imageRadius(100, 100), 4.5);
assert.strictEqual(imageRadius(200, 200), 9);
assert.strictEqual(imageRadius(100, 100) * 2, imageRadius(200, 200),
  "radius must scale with the rendered box");

// ── the clamps ──────────────────────────────────────────────────────────────

// Zoomed out. Unclamped this is 2.5px, which is the floor's neighbourhood but
// still above it — the first case that would actually be clipped is smaller.
assert.strictEqual(imageRadius(84, 56), 2.5, "56 * 0.045 = 2.52, rounded");

// Genuinely tiny: the ratio wants 0.9px, which reads as square. Floor wins.
assert.strictEqual(imageRadius(30, 20), MIN, "the floor keeps a hint of a curve");

// Zoomed in far. The ratio wants 175px, which would be a lozenge. Cap wins.
assert.strictEqual(imageRadius(6000, 3900), MAX, "the cap stops it becoming a pill");

// The cap has to bite before the radius reaches half the shorter side —
// past that, `inset(… round …)` collapses the straight edges entirely.
const capBox = MAX / RATIO;
assert.ok(MAX < capBox / 2,
  "the cap must engage well before the radius could round the box away");

// ── output shape ────────────────────────────────────────────────────────────

// One decimal place: enough to keep the curve smooth as you zoom, few enough
// that the emitted clip-path string doesn't churn on sub-pixel jitter.
for (const [w, h] of [[400, 300], [123, 457], [999, 731], [61, 43]]) {
  const r = imageRadius(w, h);
  assert.strictEqual(r, Math.round(r * 10) / 10, `${w}x${h}: radius must be 1dp`);
  assert.ok(r >= MIN && r <= MAX, `${w}x${h}: radius must stay inside the clamps`);
}

console.log("image corner radius: all checks passed");
