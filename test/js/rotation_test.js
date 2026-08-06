// Pins how the overlay behaves when the canvas is turned.
//
// Fresco rotates its *stage*; etcher's overlay hangs off the un-rotated
// container and only inherits rotation through `_imageToContainer`
// transforming individual points. That is enough for anything drawn as a
// point list and not enough for two other things, both checked here:
//
//   1. Scale probes. Measuring "container px per image px" by projecting a
//      unit vector and reading ONE axis of the result gives ~0 at 90°/270°,
//      because an image-y offset projects entirely onto container x there.
//      Every `|| 1` guard downstream then quietly substituted a scale of 1,
//      so stroke widths, hit tolerances and default text boxes came out at
//      raw image-px on a rotated board — a 1.3px line rendered at 18.6px.
//
//   2. Oriented boxes. Two transformed corners give a shape's *rotated*
//      bounding box, whose width and height are swapped at 90°. Drawing a
//      picture or a line of text into that box leaves the content upright
//      while the board turns under it.
//
// Both are silent failures — nothing throws, the numbers are merely wrong —
// which is exactly the kind of thing that comes back.
//
//   node test/js/rotation_test.js

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
  return eval(
    "(" +
      src.slice(start, end + "\n    }".length).replace(`${name}: function`, "function") +
      ")"
  );
}

const markerScale = lift("_markerScale", "");
const orientedBox = lift("_orientedBox", "g");
const canvasRotation = lift("_canvasRotation", "");
const setRotateTransform = lift("_setRotateTransform", "el, box");
const rotatePoint = lift("_rotatePoint", "pt, cx, cy, deg");

// A stand-in for the real coordinate transform: the same composition fresco
// applies — scale, then rotate, then translate by the container origin.
function layer(deg, scale) {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const sn = Math.sin(rad);
  return {
    handleKind: "canvas",
    handle: { getRotation: () => deg },
    _imageToContainer(pt) {
      const px = pt.x * scale;
      const py = pt.y * scale;
      return { x: 500 + px * c - py * sn, y: 400 + px * sn + py * c };
    },
    _markerScale: markerScale,
    _canvasRotation: canvasRotation,
    _orientedBox: orientedBox
  };
}

// ── the scale probe ─────────────────────────────────────────────────────────

// The whole point: rotation is isometric, so the scale is the SAME at every
// angle. The old single-axis probe passed at 0° and 180° and collapsed to 1
// at 90° and 270° — so a test that only checks 0° proves nothing.
for (const deg of [0, 90, 180, 270]) {
  const got = layer(deg, 0.0716)._markerScale();
  assert.ok(
    Math.abs(got - 0.0716) < 1e-9,
    `scale at ${deg}° should be 0.0716, got ${got}`
  );
}

// Non-right angles too — nothing in the maths depends on the 90° snapping,
// and relying on it would break the day free rotation arrives.
for (const deg of [37, 45, 128, 315]) {
  const got = layer(deg, 0.25)._markerScale();
  assert.ok(Math.abs(got - 0.25) < 1e-9, `scale at ${deg}° should be 0.25, got ${got}`);
}

// Zoomed right out, the honest scale is tiny but must not be rounded away to
// the `|| 1` fallback — that fallback is for a dead viewport, not a small one.
assert.ok(Math.abs(layer(90, 0.004)._markerScale() - 0.004) < 1e-12);

// Strip mode draws in image-px user units, so its scale is 1 by construction
// and it has no rotation to speak of.
assert.strictEqual(markerScale.call({ handleKind: "strip" }), 1);

// A viewport that isn't up yet must yield 1 rather than 0 — a scale of 0
// would collapse every stroke to nothing.
assert.strictEqual(
  markerScale.call({
    handleKind: "canvas",
    _imageToContainer: () => { throw new Error("no viewport"); }
  }),
  1
);
assert.strictEqual(
  markerScale.call({ handleKind: "canvas", _imageToContainer: () => ({ x: 0, y: 0 }) }),
  1,
  "a degenerate transform falls back to 1, not 0"
);

// ── reading the canvas rotation ─────────────────────────────────────────────

assert.strictEqual(layer(90, 1)._canvasRotation(), 90);
assert.strictEqual(canvasRotation.call({ handleKind: "strip" }), 0);
// Older hosts, and the strip handle, have no `getRotation` at all. Treat a
// missing or nonsense answer as "not rotated" rather than propagating NaN
// into every transform on the board.
assert.strictEqual(canvasRotation.call({ handleKind: "canvas", handle: {} }), 0);
assert.strictEqual(canvasRotation.call({ handleKind: "canvas", handle: null }), 0);
for (const bad of [NaN, Infinity, "90", null, undefined]) {
  assert.strictEqual(
    canvasRotation.call({ handleKind: "canvas", handle: { getRotation: () => bad } }),
    0,
    `nonsense rotation ${bad} reads as 0`
  );
}

// ── the oriented box ────────────────────────────────────────────────────────

const rect = { x: 100, y: 200, w: 400, h: 100 }; // deliberately not square

// At 0° this must be EXACTLY the axis-aligned box the render produced before,
// or every unrotated board shifts by a pixel.
{
  const l = layer(0, 0.5);
  const box = l._orientedBox(rect);
  const tl = l._imageToContainer({ x: rect.x, y: rect.y });
  const br = l._imageToContainer({ x: rect.x + rect.w, y: rect.y + rect.h });
  assert.ok(Math.abs(box.x - Math.min(tl.x, br.x)) < 1e-9, "x matches the old bbox");
  assert.ok(Math.abs(box.y - Math.min(tl.y, br.y)) < 1e-9, "y matches the old bbox");
  assert.ok(Math.abs(box.w - Math.abs(br.x - tl.x)) < 1e-9, "w matches the old bbox");
  assert.ok(Math.abs(box.h - Math.abs(br.y - tl.y)) < 1e-9, "h matches the old bbox");
  assert.strictEqual(box.deg, 0);
}

// At every angle the box keeps the SHAPE's proportions. This is the bit the
// rotated-bbox approach got wrong: at 90° it handed back 50×200 for a
// 400×100 rect, so a photo was squeezed into a portrait box and drawn
// upright inside it.
for (const deg of [0, 90, 180, 270]) {
  const box = layer(deg, 0.5)._orientedBox(rect);
  assert.ok(Math.abs(box.w - 200) < 1e-9, `w at ${deg}° stays 200, got ${box.w}`);
  assert.ok(Math.abs(box.h - 50) < 1e-9, `h at ${deg}° stays 50, got ${box.h}`);
  assert.strictEqual(box.deg, deg);
}

// ...and it is centred on the same point the rotated bbox was centred on, so
// turning the content about that centre lands it exactly where the old box
// was. Without this the picture rotates correctly but sits in the wrong place.
for (const deg of [0, 90, 180, 270, 37]) {
  const l = layer(deg, 0.5);
  const tl = l._imageToContainer({ x: rect.x, y: rect.y });
  const br = l._imageToContainer({ x: rect.x + rect.w, y: rect.y + rect.h });
  const box = l._orientedBox(rect);
  assert.ok(Math.abs(box.cx - (tl.x + br.x) / 2) < 1e-9, `centre x at ${deg}°`);
  assert.ok(Math.abs(box.cy - (tl.y + br.y) / 2) < 1e-9, `centre y at ${deg}°`);
  // x/y are the top-left of the un-turned box around that centre.
  assert.ok(Math.abs(box.x - (box.cx - box.w / 2)) < 1e-9);
  assert.ok(Math.abs(box.y - (box.cy - box.h / 2)) < 1e-9);
}

// A shape dragged to negative width (handle pulled past the opposite edge)
// still has to produce a drawable box — SVG rejects a negative `width`.
{
  const box = layer(90, 0.5)._orientedBox({ x: 0, y: 0, w: -400, h: -100 });
  assert.ok(box.w > 0 && box.h > 0, "never hands back a negative extent");
}

// Zero-size and missing dimensions must not become NaN — a shape mid-creation
// has no extent yet and still gets rendered.
{
  const box = layer(90, 0.5)._orientedBox({ x: 10, y: 10 });
  assert.strictEqual(box.w, 0);
  assert.strictEqual(box.h, 0);
  assert.ok(isFinite(box.cx) && isFinite(box.cy));
}

// ── rotating a lone point ───────────────────────────────────────────────────

// This is what lets an unturned leader line still meet a label that IS
// turning, so the two agree about where the corner is.
{
  const p = rotatePoint({ x: 110, y: 100 }, 100, 100, 90);
  assert.ok(Math.abs(p.x - 100) < 1e-9 && Math.abs(p.y - 110) < 1e-9,
    "+x about the centre goes to +y at 90°, matching SVG's clockwise rotate");
}
// The centre itself never moves, at any angle.
for (const deg of [0, 90, 180, 270, 41]) {
  const p = rotatePoint({ x: 7, y: 9 }, 7, 9, deg);
  assert.ok(Math.abs(p.x - 7) < 1e-9 && Math.abs(p.y - 9) < 1e-9);
}
// Distance from the centre is preserved — the same isometry the scale probe
// relies on. If this drifts, leaders come up short of their labels.
for (const deg of [90, 180, 270, 41, 300]) {
  const p = rotatePoint({ x: 130, y: 60 }, 100, 100, deg);
  assert.ok(Math.abs(Math.hypot(p.x - 100, p.y - 100) - 50) < 1e-9,
    `radius preserved at ${deg}°`);
}
// Four right-angle turns return exactly where it started.
{
  let p = { x: 33, y: 77 };
  for (let i = 0; i < 4; i++) p = rotatePoint(p, 10, 20, 90);
  assert.ok(Math.abs(p.x - 33) < 1e-9 && Math.abs(p.y - 77) < 1e-9);
}
// At 0° it must hand back a copy, not the caller's own object — these feed
// straight into attribute writes and aliasing would be a trap.
{
  const src = { x: 1, y: 2 };
  const out = rotatePoint(src, 0, 0, 0);
  assert.notStrictEqual(out, src);
  assert.deepStrictEqual(out, { x: 1, y: 2 });
}

// ── writing the transform ───────────────────────────────────────────────────

function fakeEl() {
  const attrs = {};
  return {
    attrs,
    setAttribute: (k, v) => { attrs[k] = String(v); },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    removeAttribute: (k) => { delete attrs[k]; }
  };
}

// Unrotated markup stays byte-identical to what it was before any of this —
// no `rotate(0)` left lying around. These run on every pan and zoom frame.
{
  const el = fakeEl();
  setRotateTransform(el, { deg: 0, cx: 10, cy: 20 });
  assert.strictEqual(el.getAttribute("transform"), null);
}

{
  const el = fakeEl();
  setRotateTransform(el, { deg: 90, cx: 10, cy: 20 });
  assert.strictEqual(el.getAttribute("transform"), "rotate(90 10 20)");
}

// Turning back to 0 must CLEAR the attribute, not leave the last angle on the
// element — otherwise rotating away and back leaves the board stuck sideways.
{
  const el = fakeEl();
  setRotateTransform(el, { deg: 270, cx: 1, cy: 2 });
  setRotateTransform(el, { deg: 0, cx: 1, cy: 2 });
  assert.strictEqual(el.getAttribute("transform"), null);
}

// Missing element or box are both ordinary — a shape may have no ring, and a
// render can run before the box is computed.
setRotateTransform(null, { deg: 90, cx: 0, cy: 0 });
{
  const el = fakeEl();
  setRotateTransform(el, null);
  assert.strictEqual(el.getAttribute("transform"), null);
}

console.log("rotation: all checks passed");
