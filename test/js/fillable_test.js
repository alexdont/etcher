// Pins which SVG elements take a fill.
//
// This is the check that decides whether a shape has a *body* or is only an
// outline, and it regressed silently once: when the fill modes were added,
// the list was narrowed to rect/circle/polygon, which quietly dropped the
// tint from every closed freehand loop. Nothing failed — the stroke still
// drew, so a lassoed region just stopped being shaded.
//
// `_isFillableEl` reads `tagName` and `classList` and nothing else, so it's
// driven here with plain stand-ins.
//
//   node test/js/fillable_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

const NEEDLE = "    _isFillableEl: function(el) {";
const start = src.indexOf(NEEDLE);
assert.notStrictEqual(start, -1, "could not find _isFillableEl in etcher.js");
const end = src.indexOf("\n    },", start);
assert.notStrictEqual(end, -1, "could not find the end of _isFillableEl");
const isFillable = eval(
  "(" +
    src.slice(start, end + "\n    }".length).replace("_isFillableEl: function", "function") +
    ")"
);

// Minimal element stand-in: a tag and a class list.
function el(tagName, classes) {
  const list = classes || [];
  return { tagName, classList: { contains: (c) => list.indexOf(c) !== -1 } };
}

// ── shapes with a body ──────────────────────────────────────────────────────

for (const tag of ["rect", "circle", "polygon"]) {
  assert.ok(isFillable(el(tag)), `${tag} is a closed shape and takes a fill`);
}

// Freehand. `path` when the stroke was fitted to bezier nodes, `polyline`
// for the raw/legacy point list — both are the same shape kind to a user,
// and a loop drawn with either has to shade the same way.
assert.ok(isFillable(el("path")), "fitted freehand takes a fill");
assert.ok(isFillable(el("polyline")), "raw-point freehand takes a fill");

// Case shouldn't matter: `tagName` casing differs between HTML and XML
// documents, and SVG-in-HTML has bitten this kind of check before.
assert.ok(isFillable(el("PATH")), "tag matching is case-insensitive");
assert.ok(isFillable(el("Rect")));

// ── strokes, which must stay hollow ─────────────────────────────────────────

// A marker is a felt-tip stroke. It's a `path` like fitted freehand, so the
// tag alone can't tell them apart — the class is what does.
assert.ok(!isFillable(el("path", ["etcher-marker"])),
  "a marker is a stroke; filling one would blob it into a solid shape");
assert.ok(!isFillable(el("polyline", ["etcher-marker"])));

// Kinds with no body at all.
for (const tag of ["line", "text", "image", "g", "tspan"]) {
  assert.ok(!isFillable(el(tag)), `${tag} has no fillable body`);
}

// ── defensive ───────────────────────────────────────────────────────────────

assert.ok(!isFillable(null), "no element, no fill");
assert.ok(!isFillable({}), "an object with no tagName doesn't throw");
// An element without a classList (possible on a bare stub) must not throw on
// the marker check.
assert.ok(isFillable({ tagName: "rect" }), "classList is optional");

console.log("fillable elements: all checks passed");
