// Pins where the floating chrome lands in strip mode.
//
// The bug this covers (0.10.0): the action bar, style panel and style trigger
// were positioned with container-relative offsets while being `position:
// fixed`, so they were correct only when the strip happened to sit at the
// viewport origin and drifted off the top of the screen by exactly scrollTop
// once the reader scrolled.
//
// Container-relative maths hides that: with the container at 0,0 the wrong
// answer and the right one are the same number. So EVERY case here puts the
// strip somewhere else — below a header, inside a column — which is the only
// arrangement that can tell them apart.
//
// The positioning functions read the DOM, so rather than stand up a DOM the
// three coordinate-space helpers are lifted out of the source and driven
// directly. If they are renamed or their signatures change, extraction fails
// loudly rather than silently testing nothing.
//
//   node test/js/strip_chrome_test.js

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

const chromeOrigin = lift("_chromeOrigin", "");
const chromeHeight = lift("_chromeHeight", "");
const chromeRightInset = lift("_chromeRightInset", "c");

// CHROME_MARGIN is a module-level constant in the source; the lifted
// functions close over it, so mirror it here for eval's scope.
const CHROME_MARGIN = Number(
  (src.match(/var CHROME_MARGIN = (\d+);/) || [])[1]
);
assert.ok(CHROME_MARGIN > 0, "could not read CHROME_MARGIN from etcher.js");
global.CHROME_MARGIN = CHROME_MARGIN;

// A strip deliberately NOT at the viewport origin: 80px below a header, 24px
// in from the left, in a 1200x900 window.
const WINDOW = { innerWidth: 1200, innerHeight: 900 };
const STRIP = { left: 24, top: 80, right: 1000, bottom: 900, width: 976, height: 820 };
global.window = WINDOW;

function ctx(kind, rect) {
  return { handleKind: kind, handle: { container: { getBoundingClientRect: () => rect } } };
}

const strip = ctx("strip", STRIP);
const canvas = ctx("canvas", STRIP);

// ── origin ──────────────────────────────────────────────────────────────────

// Fixed chrome is placed in viewport coordinates, so nothing is subtracted.
assert.deepStrictEqual(chromeOrigin.call(strip), { left: 0, top: 0 },
  "strip mode must position against the viewport origin");

// Absolute chrome is placed inside the container, so the container's own
// offset comes out.
assert.deepStrictEqual(chromeOrigin.call(canvas), { left: 24, top: 80 },
  "canvas mode must stay container-relative");

// The regression itself. A tool bar whose viewport top is 812 (fixed, near
// the bottom of a 900px window): the action bar sits above it.
const toolbarTop = 812;
const barHeight = 38;
const gap = 4;

const stripTop = Math.round(toolbarTop - chromeOrigin.call(strip).top - barHeight - gap);
assert.strictEqual(stripTop, 770,
  "strip: action bar must be at a viewport y, not shifted up by the strip's offset");

// The old code did exactly this, and it is wrong by the strip's top (80px) —
// far enough up to leave the screen entirely once scrolled.
const buggyTop = Math.round(toolbarTop - STRIP.top - barHeight - gap);
assert.strictEqual(buggyTop, 690, "sanity: the container-relative answer differs");
assert.notStrictEqual(stripTop, buggyTop,
  "a strip at the viewport origin would make these equal and prove nothing");

// ── height the `bottom` offsets measure from ────────────────────────────────

assert.strictEqual(chromeHeight.call(strip), 900,
  "strip: a fixed panel's bottom is measured from the viewport");
assert.strictEqual(chromeHeight.call(canvas), 820,
  "canvas: an absolute panel's bottom is measured from the container");

// A compact popup opening above a trigger at viewport y=770.
const triggerTop = 770;
assert.strictEqual(chromeHeight.call(strip) - triggerTop + 8, 138,
  "strip: popup bottom offset follows the viewport");

// ── right inset ─────────────────────────────────────────────────────────────

// The strip's right edge is 200px in from the window's, so a fixed surface
// has to clear that too or it pins to the window instead of the strip.
assert.strictEqual(chromeRightInset.call(strip, STRIP), 200 + CHROME_MARGIN,
  "strip: right inset must reach the strip's edge, not the window's");
assert.strictEqual(chromeRightInset.call(canvas, STRIP), CHROME_MARGIN,
  "canvas: right inset is the plain margin");

// A full-width strip is the degenerate case where both answers agree — worth
// pinning so nobody 'simplifies' the inset back to a constant on the strength
// of testing only this shape.
const FULL = { left: 0, top: 0, right: 1200, bottom: 900, width: 1200, height: 900 };
assert.strictEqual(chromeRightInset.call(ctx("strip", FULL), FULL), CHROME_MARGIN,
  "a full-width strip collapses to the plain margin");

console.log("strip chrome positioning: all checks passed");
