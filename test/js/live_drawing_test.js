// Pins the shape a peer can watch being drawn.
//
// A shape is emitted when it is FINISHED. That is right for storage and
// wrong for everyone else on the board: they watch nothing happen for the
// length of a stroke and then a finished stroke appears. In-flight MOVES
// were already reported for exactly this reason (`onShapesMoving`); this is
// the same idea one step earlier, while the shape is still being drawn.
//
// What makes drawing different from moving: there is no uuid yet. A draft
// becomes a shape in `_finalizeShape`, so until the pointer comes up there
// is nothing for a peer to patch against — the draft itself travels, and
// the host says which peer it came from. One person draws one shape at a
// time, so that key is all the identity a provisional shape needs.
//
// The provisional shape is a GHOST: built through the same factory a stored
// annotation goes through, so it looks like the shape that will replace it,
// and held out of `shapes` so it cannot be selected, emitted, undone, saved
// or hit-tested. It exists on screen and nowhere else.
//
//   node test/js/live_drawing_test.js

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

// ── reporting our own draft ───────────────────────────────────────────────

const noteLiveDraw = extract("_noteLiveDraw");
const flushLiveDraw = extract("_flushLiveDraw");
const endLiveDraw = extract("_endLiveDraw");
const isLiveDraft = extract("_isLiveDraft");

function layer(over) {
  const frames = [];
  return Object.assign({
    _liveDrawHandler: null,
    _liveDrawEndHandler: null,
    _liveDrawFrame: null,
    _liveDrawPending: null,
    _applyingGhostDraw: false,
    draftState: null,
    _noteLiveDraw: noteLiveDraw,
    _flushLiveDraw: flushLiveDraw,
    _endLiveDraw: endLiveDraw,
    _isLiveDraft: isLiveDraft,
    draftPolygon: null,
    draftCallout: null,
    frames: frames,
  }, over || {});
}

// The batching is a frame callback; run it by hand so the test is not a race.
global.requestAnimationFrame = function(fn) { global.__raf = fn; return 1; };
global.cancelAnimationFrame = function() { global.__raf = null; };

{
  // A report per frame, not per pointer event: a stroke renders on every
  // move and moves outrun the display.
  const draft = { kind: "marker", geometry: { points: [[0, 0]] }, style: { color: "#f00" } };
  const l = layer({ draftState: draft });
  l._liveDrawHandler = (d) => l.frames.push(d);

  l._noteLiveDraw(draft.kind, draft.geometry, draft.style);
  draft.geometry.points.push([10, 10]);
  l._noteLiveDraw(draft.kind, draft.geometry, draft.style);
  draft.geometry.points.push([20, 20]);
  l._noteLiveDraw(draft.kind, draft.geometry, draft.style);

  assert.strictEqual(l.frames.length, 0, "nothing is reported until the frame runs");

  global.__raf();
  assert.strictEqual(l.frames.length, 1, "three renders in one frame are one report");
  assert.strictEqual(l.frames[0].kind, "marker");
  assert.strictEqual(l.frames[0].geometry.points.length, 3,
    "and it carries the stroke as it stands, not the first point of it");
  assert.deepStrictEqual(l.frames[0].style, { color: "#f00" },
    "with the style, so a peer's ghost is the colour and weight being drawn");
}

{
  // Ending the draw sends whatever was batched, and only then says it is
  // over. Reporting is a frame at a time, so the points drawn after the last
  // frame had yet to go out — and a peer now HOLDS the ghost until the real
  // shape lands (see the hand-over below). A ghost that stopped a few points
  // short of the shape replacing it would show its own tail appearing at the
  // handover: the same flash the hand-over exists to remove, smaller.
  const draft = { kind: "marker", geometry: { points: [[0, 0], [5, 5]] } };
  const l = layer({ draftState: draft });
  const order = [];
  l._liveDrawHandler = (d) => { l.frames.push(d); order.push("frame"); };
  l._liveDrawEndHandler = () => order.push("end");

  l._noteLiveDraw(draft.kind, draft.geometry, draft.style);
  l._endLiveDraw();
  if (global.__raf) global.__raf();

  assert.strictEqual(l.frames.length, 1, "the batched frame goes out");
  assert.strictEqual(l.frames[0].geometry.points.length, 2,
    "carrying the stroke as it was finished");
  assert.deepStrictEqual(order, ["frame", "end"],
    "in that order — the end is what retires a ghost, so it cannot arrive " +
    "before the frame that completes it");
  assert.strictEqual(l.frames.length, 1, "and the cancelled frame does not fire a second one");
}

{
  // Which drafts count as "being drawn". Most tools use `draftState`; a
  // callout keeps its own while the label is placed, and both are rendered
  // through `_renderShape` — so the test is by identity, not by kind.
  const draftState = { kind: "marker" };
  const draftCallout = { kind: "callout" };
  const l = layer({ draftState: draftState, draftCallout: draftCallout });

  assert.strictEqual(l._isLiveDraft(draftState), true);
  assert.strictEqual(l._isLiveDraft(draftCallout), true,
    "a callout is drawn across clicks and is still being drawn");
  assert.strictEqual(l._isLiveDraft({ kind: "marker" }), false,
    "a shape that merely looks like the draft is somebody else's finished work");
  assert.strictEqual(l._isLiveDraft(null), false);
}

{
  // Applying a peer's ghost must not be mistaken for drawing one of our
  // own and sent straight back out — the same guard the moves carry.
  const draft = { kind: "marker", geometry: { points: [[0, 0]] } };
  const l = layer({ draftState: draft, _applyingGhostDraw: true });
  l._liveDrawHandler = (d) => l.frames.push(d);

  global.__raf = null;
  l._noteLiveDraw(draft.kind, draft.geometry, draft.style);
  assert.strictEqual(global.__raf, null,
    "no frame is even scheduled while a peer's shape is being applied");
}

// ── the ghost ─────────────────────────────────────────────────────────────

const applyGhost = extract("_applyGhostDraw");
const dropGhost = extract("_dropGhostDraw");

function ghostLayer() {
  const rendered = [];
  return {
    _ghostDraws: null,
    _applyingGhostDraw: false,
    shapes: [],
    rendered: rendered,
    built: [],
    _applyGhostDraw: applyGhost,
    _dropGhostDraw: dropGhost,
    _renderShape(shape) { rendered.push(shape); },
    _renderAnnotation(ann, opts) {
      this.built.push({ ann: ann, opts: opts });
      // What the real factory hands back for a ghost: the shape, unregistered.
      return { kind: ann.kind, geometry: ann.geometry, style: ann.style, uuid: null,
               el: { parentNode: { removeChild() { this.removed = true; } } } };
    },
  };
}

{
  const l = ghostLayer();
  l._applyGhostDraw("peer-1", { kind: "marker", geometry: { points: [[1, 1]] } });

  assert.strictEqual(l.built.length, 1, "the first report builds the ghost");
  assert.strictEqual(l.built[0].opts.ghost, true,
    "through the shared factory, in ghost mode — so it looks like the shape " +
    "that will replace it without becoming one");
  assert.strictEqual(l.built[0].ann.uuid, null, "a ghost is nobody");
  assert.strictEqual(l.shapes.length, 0,
    "and never joins `shapes`: not selectable, not emitted, not undoable, not saved");

  // The next report is the same shape, further along.
  l._applyGhostDraw("peer-1", { kind: "marker", geometry: { points: [[1, 1], [9, 9]] } });
  assert.strictEqual(l.built.length, 1, "no second element for the same stroke");
  assert.strictEqual(l.rendered.length, 1, "it is re-rendered in place");
  assert.strictEqual(l.rendered[0].geometry.points.length, 2);
}

{
  // Two people drawing at once are two ghosts.
  const l = ghostLayer();
  l._applyGhostDraw("peer-1", { kind: "marker", geometry: { points: [[1, 1]] } });
  l._applyGhostDraw("peer-2", { kind: "rectangle", geometry: { x: 0, y: 0, w: 5, h: 5 } });
  assert.strictEqual(Object.keys(l._ghostDraws).length, 2);

  l._dropGhostDraw("peer-1");
  assert.deepStrictEqual(Object.keys(l._ghostDraws), ["peer-2"],
    "one person letting go does not take the other's shape with it");
}

{
  // A different kind under the same key: they let go and started something
  // else, and the new report arrived before the end of the old one.
  const l = ghostLayer();
  l._applyGhostDraw("peer-1", { kind: "marker", geometry: { points: [[1, 1]] } });
  l._applyGhostDraw("peer-1", { kind: "rectangle", geometry: { x: 0, y: 0, w: 1, h: 1 } });

  assert.strictEqual(l.built.length, 2, "a rectangle is not a path — rebuild it");
  assert.strictEqual(Object.keys(l._ghostDraws).length, 1, "and only one survives");
  assert.strictEqual(l._ghostDraws["peer-1"].kind, "rectangle");
}

{
  // Junk from the wire is ignored rather than half-rendered.
  const l = ghostLayer();
  l._applyGhostDraw("peer-1", null);
  l._applyGhostDraw("peer-1", { kind: "marker" });
  l._applyGhostDraw("", { kind: "marker", geometry: { points: [] } });
  assert.strictEqual(l.built.length, 0);
  assert.doesNotThrow(() => l._dropGhostDraw("never-seen"));
}

// ── the hand-over ────────────────────────────────────────────────────────
//
// Letting go is not the end of the ghost. The real shape has a server round
// trip to make, and taking the ghost away at release leaves a hole exactly
// where the stroke was: it vanishes, then reappears when the edit lands —
// which is the flash at the end of every stroke that this removes. The ghost
// is held until the real shape is built and retired in that same task, so
// the frame in between shows neither a gap nor two copies of the line.

const retire = extract("_retireGhostDraw");
const dropRetired = extract("_dropRetiredGhost");
const handOver = extract("_handOverGhost");
const sameGeometry = extract("_sameGeometry");

global.GHOST_HANDOVER_MS = (() => {
  const m = src.match(/var GHOST_HANDOVER_MS = (\d+);/);
  assert.ok(m, "could not find GHOST_HANDOVER_MS");
  return Number(m[1]);
})();

let timers = [];
global.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
global.clearTimeout = (id) => { if (timers[id - 1]) timers[id - 1].cancelled = true; };

function handoverLayer() {
  const l = ghostLayer();
  return Object.assign(l, {
    _ghostDraws: null,
    _retiringGhosts: null,
    _retireGhostDraw: retire,
    _dropRetiredGhost: dropRetired,
    _handOverGhost: handOver,
    _sameGeometry: sameGeometry,
    gone: () => (l._retiringGhosts || []).length,
  });
}

// The ghost element records its own removal, so "still on screen" is
// answerable after the fact.
function ghostEl(l, key) {
  const g = l._ghostDraws[key];
  g.el = { parentNode: { removeChild() { g.removed = true; } } };
  return g;
}

{
  timers = [];
  const l = handoverLayer();
  l._applyGhostDraw("peer-1", { kind: "marker", geometry: { points: [[0, 0], [9, 9]] } });
  const g = ghostEl(l, "peer-1");

  l._retireGhostDraw("peer-1");
  assert.strictEqual(g.removed, undefined,
    "letting go does NOT take the stroke off screen — that is the flash");
  assert.strictEqual(l._ghostDraws["peer-1"], undefined,
    "but the key is free again: the same peer's next stroke needs it");
  assert.strictEqual(l.gone(), 1, "it is waiting to be replaced");

  // The edit arrives and the ghost steps aside. (What calls this on a real
  // layer — `_renderAnnotation`, building the shape — is pinned in the
  // Elixir wrapper beside this file.)
  l._handOverGhost({ kind: "marker", geometry: { points: [[0, 0], [9, 9]] } });
  assert.strictEqual(g.removed, true, "replaced, not merely forgotten");
  assert.strictEqual(l.gone(), 0);
  assert.ok(timers[0].cancelled, "and the backstop is called off");
}

{
  // Rounding on the way through the server: the same drawing, a thousandth
  // off. A miss here leaves two copies of the line on the board.
  timers = [];
  const l = handoverLayer();
  l._applyGhostDraw("peer-1", { kind: "marker", geometry: { points: [[1.0001, 2.0002]] } });
  const g = ghostEl(l, "peer-1");
  l._retireGhostDraw("peer-1");
  l._handOverGhost({ kind: "marker", geometry: { points: [[1, 2]] } });

  assert.strictEqual(g.removed, true);
}

{
  // A shape of another kind is not this ghost's replacement.
  timers = [];
  const l = handoverLayer();
  l._applyGhostDraw("peer-1", { kind: "marker", geometry: { points: [[0, 0]] } });
  const g = ghostEl(l, "peer-1");
  l._retireGhostDraw("peer-1");
  l._handOverGhost({ kind: "rectangle", geometry: { x: 0, y: 0, w: 1, h: 1 } });

  assert.strictEqual(g.removed, undefined, "somebody else's shape landing is not the handover");
  assert.strictEqual(l.gone(), 1);
}

{
  // Two people let go at once, and each edit retires its own author's ghost.
  timers = [];
  const l = handoverLayer();
  l._applyGhostDraw("peer-1", { kind: "marker", geometry: { points: [[0, 0]] } });
  const g1 = ghostEl(l, "peer-1");
  l._applyGhostDraw("peer-2", { kind: "marker", geometry: { points: [[50, 50]] } });
  const g2 = ghostEl(l, "peer-2");
  l._retireGhostDraw("peer-1");
  l._retireGhostDraw("peer-2");

  l._handOverGhost({ kind: "marker", geometry: { points: [[50, 50]] } });
  assert.strictEqual(g2.removed, true, "the one that matches");
  assert.strictEqual(g1.removed, undefined, "and not the other person's");
  assert.strictEqual(l.gone(), 1);
}

{
  // The shape was moved between letting go and the edit arriving, so the
  // geometry no longer matches. With one stroke of that kind waiting, it is
  // still unambiguous — and a ghost left behind by a miss would sit there as
  // a second copy of the line until it timed out.
  timers = [];
  const l = handoverLayer();
  l._applyGhostDraw("peer-1", { kind: "marker", geometry: { points: [[0, 0], [9, 9]] } });
  const g = ghostEl(l, "peer-1");
  l._retireGhostDraw("peer-1");
  l._handOverGhost({ kind: "marker", geometry: { points: [[400, 400], [409, 409]] } });

  assert.strictEqual(g.removed, true);
}

{
  // …but with two of the same kind waiting, a guess could take the wrong
  // one off screen. They keep their backstops instead.
  timers = [];
  const l = handoverLayer();
  l._applyGhostDraw("peer-1", { kind: "marker", geometry: { points: [[0, 0]] } });
  const g1 = ghostEl(l, "peer-1");
  l._applyGhostDraw("peer-2", { kind: "marker", geometry: { points: [[50, 50]] } });
  const g2 = ghostEl(l, "peer-2");
  l._retireGhostDraw("peer-1");
  l._retireGhostDraw("peer-2");
  l._handOverGhost({ kind: "marker", geometry: { points: [[999, 999]] } });

  assert.strictEqual(g1.removed, undefined);
  assert.strictEqual(g2.removed, undefined);
  assert.strictEqual(l.gone(), 2);
}

{
  // The edit that never lands: an undo on the way, a save that failed, a
  // dropped socket. The backstop takes it away rather than leaving a stroke
  // nobody can select or move lying on the board.
  timers = [];
  const l = handoverLayer();
  l._applyGhostDraw("peer-1", { kind: "marker", geometry: { points: [[0, 0]] } });
  const g = ghostEl(l, "peer-1");
  l._retireGhostDraw("peer-1");

  assert.strictEqual(timers[0].ms, GHOST_HANDOVER_MS);
  timers[0].fn();
  assert.strictEqual(g.removed, true);
  assert.strictEqual(l.gone(), 0);
}

{
  // The same peer starts drawing again before their last edit arrives. The
  // new stroke is its own ghost; the old one is still waiting to be replaced.
  timers = [];
  const l = handoverLayer();
  l._applyGhostDraw("peer-1", { kind: "marker", geometry: { points: [[0, 0]] } });
  const first = ghostEl(l, "peer-1");
  l._retireGhostDraw("peer-1");
  l._applyGhostDraw("peer-1", { kind: "marker", geometry: { points: [[70, 70]] } });

  assert.ok(l._ghostDraws["peer-1"], "the second stroke has the key");
  assert.notStrictEqual(l._ghostDraws["peer-1"], first, "and is not the retiring one");
  assert.strictEqual(first.removed, undefined, "which is still on screen, still waiting");
  assert.strictEqual(l.gone(), 1);
}

{
  // Retiring what was never there, and handing over with nothing waiting.
  timers = [];
  const l = handoverLayer();
  assert.doesNotThrow(() => l._retireGhostDraw("never-drew"));
  assert.doesNotThrow(() => l._handOverGhost({ kind: "marker", geometry: { points: [] } }));
  assert.doesNotThrow(() => l._handOverGhost(null));
  assert.doesNotThrow(() => l._dropRetiredGhost(null));
}

{
  // Geometry comparison in its own right: every shape's geometry is a
  // different shape of object, so this is structural rather than per-kind.
  const l = handoverLayer();
  assert.strictEqual(l._sameGeometry({ x: 1, y: 2, w: 3, h: 4 }, { x: 1, y: 2, w: 3, h: 4 }), true);
  assert.strictEqual(l._sameGeometry({ x: 1 }, { x: 1, y: 2 }), false, "a missing field is a difference");
  assert.strictEqual(l._sameGeometry({ points: [[1, 2]] }, { points: [[1, 2], [3, 4]] }), false,
    "a longer stroke is a different stroke");
  assert.strictEqual(l._sameGeometry({ x: 1 }, { y: 1 }), false, "…and so is a renamed one");
  assert.strictEqual(l._sameGeometry({ x: 5 }, { x: 5.4 }), true, "rounding is not");
  assert.strictEqual(l._sameGeometry({ x: 5 }, { x: 7 }), false, "two units is not rounding");
  assert.strictEqual(l._sameGeometry({ t: "hi" }, { t: "hi" }), true, "labels compare as themselves");
  assert.strictEqual(l._sameGeometry({ t: "hi" }, { t: "ho" }), false);
}

console.log("live drawing: all checks passed");
