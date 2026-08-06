// Pins the red pointer's bookkeeping — the trail behind it, and when a
// pointer stops existing.
//
// A shared pointer is the one thing on the board that is not a drawing:
// nothing is stored, nothing is undone, and it has to disappear on its own.
// That last part is the whole risk. A pointer arrives as a stream of
// positions from someone else's machine, and the stream simply stops when
// they close the tab — there is no goodbye to rely on. Get the eviction
// wrong and everyone is left with a red dot stuck on their board that they
// cannot remove, on a board they may be presenting from.
//
// Time is injected rather than read from the clock, so these are exact
// rather than "sleep and hope".
//
//   node test/js/pointer_test.js

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

function constant(name) {
  const found = (src.match(new RegExp(`var ${name} = ([\\d.]+);`)) || [])[1];
  assert.ok(found !== undefined, `could not read ${name} from etcher.js`);
  return Number(found);
}

const TRAIL_MS = constant("POINTER_TRAIL_MS");
const STALE_MS = constant("POINTER_STALE_MS");
const DOT_R = constant("POINTER_DOT_R");
global.POINTER_TRAIL_MS = TRAIL_MS;
global.POINTER_STALE_MS = STALE_MS;
global.POINTER_DOT_R = DOT_R;
global.POINTER_COLOR = (src.match(/var POINTER_COLOR = "([^"]+)";/) || [])[1];
assert.ok(global.POINTER_COLOR, "could not read POINTER_COLOR");

const pointerState = lift("_pointerState", "");
const notePointer = lift("_notePointer", "id, x, y, opts");
const trimTrail = lift("_trimPointerTrail", "p, now");
const dropPointer = lift("_dropPointer", "id");

// A layer with the clock under our control and the drawing stubbed out —
// these checks are about what is remembered, not what is painted.
function layer() {
  const l = {
    now: 1000,
    drawn: 0,
    _pointerState: pointerState,
    _notePointer: notePointer,
    _trimPointerTrail: trimTrail,
    _dropPointer: dropPointer,
    _pointerNow() { return this.now; },
    _startPointerLoop() {},
    _drawPointers() { this.drawn++; }
  };
  return l;
}

// ── the trail ───────────────────────────────────────────────────────────────

// Every position is remembered, so the trail traces the actual path taken
// rather than a straight line between wherever two frames happened to land.
{
  const l = layer();
  for (let i = 0; i < 5; i++) { l.now = 1000 + i * 50; l._notePointer("a", i, i * 2); }
  const p = l._pointerState().a;
  assert.strictEqual(p.trail.length, 5);
  assert.deepStrictEqual(p.trail.map((s) => s.x), [0, 1, 2, 3, 4]);
  assert.strictEqual(p.x, 4, "the head is the latest position");
  assert.strictEqual(p.y, 8);
}

// The trail is a WINDOW on time, not a fixed number of samples: it has to be
// the same length in seconds whether the machine sending it manages 20
// updates a second or 200.
{
  const l = layer();
  l._notePointer("a", 0, 0);                       // t=1000, will age out
  l.now = 1000 + TRAIL_MS - 1;
  l._notePointer("a", 1, 0);                       // still inside the window
  l.now = 1000 + TRAIL_MS + 1;
  l._notePointer("a", 2, 0);                       // pushes the first out
  const p = l._pointerState().a;
  assert.deepStrictEqual(p.trail.map((s) => s.x), [1, 2],
    "samples older than the window are dropped, newer ones kept");
}

// A fast sender must not grow the trail without limit — every sample is a
// segment to draw, on every frame.
{
  const l = layer();
  for (let i = 0; i < 500; i++) { l.now = 1000 + i * 0.5; l._notePointer("a", i, 0); }
  const p = l._pointerState().a;
  assert.ok(p.trail.length <= 64, `capped, got ${p.trail.length}`);
  assert.strictEqual(p.trail[p.trail.length - 1].x, 499,
    "and it is the OLDEST that go, so the head is still the latest position");
}

// ── who a pointer belongs to ────────────────────────────────────────────────

// Pointers are kept apart by id, so two people pointing at once is two dots.
{
  const l = layer();
  l._notePointer("teacher", 10, 10);
  l._notePointer("student", 90, 90);
  assert.deepStrictEqual(Object.keys(l._pointerState()).sort(), ["student", "teacher"]);
  assert.strictEqual(l._pointerState().teacher.x, 10);
  assert.strictEqual(l._pointerState().student.x, 90);
}

// Colour and name stick once given, so a host that sends them on the first
// message only doesn't lose them on every message after.
{
  const l = layer();
  l._notePointer("a", 0, 0, { color: "#00f", name: "Ada" });
  l.now += 10;
  l._notePointer("a", 1, 1);
  const p = l._pointerState().a;
  assert.strictEqual(p.color, "#00f");
  assert.strictEqual(p.name, "Ada");
}

// Without one, a pointer is red — it is a laser pointer, not a name tag.
{
  const l = layer();
  l._notePointer("a", 0, 0);
  assert.strictEqual(l._pointerState().a.color, global.POINTER_COLOR);
}

// ── going away ──────────────────────────────────────────────────────────────

// The explicit path: the host knows they stopped.
{
  const l = layer();
  l._notePointer("a", 0, 0);
  l._dropPointer("a");
  assert.deepStrictEqual(Object.keys(l._pointerState()), []);
  assert.strictEqual(l.drawn, 1, "and the board is repainted without it");
}

// Dropping one nobody has is not an error, and must not repaint — the host
// may call it on every disconnect whether or not that peer ever pointed.
{
  const l = layer();
  l._dropPointer("nobody");
  assert.strictEqual(l.drawn, 0);
}

// The implicit path is the one that matters: a closed tab sends no goodbye.
// The trail window alone would empty the trail, and the eviction in
// `_drawPointers` is what removes the pointer itself. Both thresholds are
// checked here because the trail window is much shorter than the stale
// window — a pointer held still is NOT stale, and must keep its dot.
assert.ok(STALE_MS > TRAIL_MS,
  "a pointer held still must survive longer than its trail, or someone " +
  "pointing steadily at one thing would blink out");

// ── drawing constants ───────────────────────────────────────────────────────

// The dot is a screen size, not a canvas size. A pointer is someone's finger
// on the board: it is the same size for everyone whatever they have zoomed
// to, which is the opposite of everything else drawn here.
assert.ok(
  !/POINTER_DOT_R\s*\*\s*(?:scale|this\._markerScale|_boardLineScale)/.test(src),
  "the pointer dot must not be scaled with the canvas"
);
assert.ok(DOT_R > 0);

console.log("pointer: all checks passed");
