// Pins that the scroll wheel still zooms while a drawing tool is held.
//
// Fresco bails out of its own wheel handler when the event comes from an
// element carrying `data-fresco-no-capture`. The drawing overlay carries
// it — that is how a press that draws doesn't also pan the canvas — but
// the attribute is read by the WHEEL handler too, and the wheel was never
// ours to claim. Arming a tool switches the overlay to `pointer-events:
// auto`, which makes it the target of scrolls as well as presses, so
// Fresco saw every scroll as coming from a no-capture overlay and zoom
// silently stopped working for as long as a tool was held.
//
// Panning kept working throughout (it is a drag, which the overlay does
// genuinely claim), which is what made this look like a quirk of drawing
// rather than a dead scroll wheel.
//
//   node test/js/wheel_zoom_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

// The rate constant the lifted handler closes over.
{
  const m = src.match(/var WHEEL_ZOOM_RATE = ([\d.]+);/);
  assert.ok(m, "could not find WHEEL_ZOOM_RATE");
  global.WHEEL_ZOOM_RATE = Number(m[1]);
}

// The overlay's wheel listener is built inline, so lift the handler out of
// the builder by running the registration against a stand-in element.
function wheelHandler(self) {
  const start = src.indexOf('      wrapper.addEventListener("wheel", function(e) {');
  assert.notStrictEqual(start, -1, "could not find the overlay's wheel listener");
  const end = src.indexOf("}, { passive: false });", start);
  assert.notStrictEqual(end, -1, "could not find the end of it");
  const body = src.slice(start, end + "}, { passive: false });".length);

  let captured = null;
  const wrapper = {
    addEventListener(name, fn, opts) {
      assert.strictEqual(name, "wheel");
      assert.deepStrictEqual(opts, { passive: false },
        "the listener must be non-passive, or preventDefault is ignored and " +
        "the page scrolls behind the zoom");
      captured = fn;
    },
  };
  eval("(function(wrapper, self){" + body + "})")(wrapper, self);
  return captured;
}

function board(over) {
  const zooms = [];
  const self = Object.assign({
    zooms,
    handle: {
      zoomAt: (px, py, k) => zooms.push([px, py, k]),
      container: { getBoundingClientRect: () => ({ left: 40, top: 10 }) },
    },
  }, over || {});
  return self;
}

function wheel(over) {
  let prevented = 0;
  return Object.assign({
    clientX: 140, clientY: 110, deltaY: -100,
    preventDefault() { prevented++; },
    get prevented() { return prevented; },
  }, over || {});
}

// ── a scroll over the drawing overlay zooms ───────────────────────────────

{
  const self = board();
  const e = wheel();
  wheelHandler(self)(e);

  assert.strictEqual(self.zooms.length, 1, "the scroll reaches Fresco's zoom");
  const [px, py, k] = self.zooms[0];
  // Anchored on the cursor, measured against the same rect Fresco measures
  // against (`handle.container` IS Fresco's host element), so the zoom
  // centres where the user is pointing rather than on the viewport middle.
  assert.strictEqual(px, 100, "x is viewport-relative");
  assert.strictEqual(py, 100, "y is viewport-relative");
  assert.ok(k > 1, "scrolling up zooms in");
  assert.ok(e.prevented > 0,
    "the default is prevented, or the page scrolls behind the zoom");
}

{
  // …and the other way.
  const self = board();
  wheelHandler(self)(wheel({ deltaY: 100 }));
  assert.ok(self.zooms[0][2] < 1, "scrolling down zooms out");
}

// ── at exactly Fresco's rate ──────────────────────────────────────────────
//
// Mirrored rather than shared: there is no API to ask Fresco what its rate
// is. If the two ever diverge, zoom would change speed depending on whether
// a tool happened to be armed — so the constant is named, and this reads
// the real number out of Fresco to compare.

{
  const frescoSrc = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "fresco", "priv", "static", "fresco.js"),
    "utf8"
  );
  const theirs = frescoSrc.match(/Math\.exp\(-e\.deltaY \* ([\d.]+)\)/);
  assert.ok(theirs, "could not find Fresco's wheel rate — did its handler change?");

  const ours = src.match(/var WHEEL_ZOOM_RATE = ([\d.]+);/);
  assert.ok(ours, "could not find WHEEL_ZOOM_RATE");
  assert.strictEqual(ours[1], theirs[1],
    "the overlay zooms at a different rate than bare canvas does");

  // And the forwarded factor really is that formula.
  const self = board();
  wheelHandler(self)(wheel({ deltaY: -200 }));
  assert.ok(Math.abs(self.zooms[0][2] - Math.exp(200 * Number(theirs[1]))) < 1e-12);
}

// ── it stays out of the way when there is nothing to zoom ─────────────────

{
  // Strip mode and any other host without a canvas zoom: no handle, no
  // zoomAt, no container. None of them may throw, and none may swallow the
  // event — a host that scrolls its own container still needs the scroll.
  for (const broken of [
    { handle: null },
    { handle: {} },
    { handle: { zoomAt: () => {} } },
    { handle: { container: {} } },
  ]) {
    const e = wheel();
    wheelHandler(board(broken))(e);
    assert.strictEqual(e.prevented, 0,
      "an unzoomable host must let the scroll through untouched");
  }
}

// ── the attribute that caused it is still there ───────────────────────────
//
// Dropping `data-fresco-no-capture` would also "fix" the wheel — and break
// what it is actually for, which is stopping a press that draws from also
// panning the canvas underneath.
{
  const build = src.slice(src.indexOf('wrapper.setAttribute("data-fresco-no-capture", "");'),
                          src.indexOf('wrapper.addEventListener("pointerdown"'));
  assert.ok(build.includes('wrapper.setAttribute("data-fresco-no-capture", "");'),
    "the overlay still claims pointer input");
  assert.ok(build.includes('wrapper.addEventListener("wheel"'),
    "…and forwards the wheel it never meant to claim");
}

console.log("wheel zoom: all checks passed");
