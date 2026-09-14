// Pins what a COMPLETED dimension / callout gesture produces.
//
// A press-drag-release places exactly what was dragged, and both kinds then
// drop straight into label editing — selected, inline input open, waiting
// for text — because a dimension or callout without a label is a shape the
// user still has to come back for. Lines share the machinery but stay
// label-silent: consumers collect line titles via their own composer on
// `etcher:shape-drawn`, and stacking two inputs confuses where to type.
//
// What a CLICK does is two_click_place_test.js's subject: it arms the draft
// for a second click rather than committing anything, so there is no
// placeholder to assert here any more. (A click used to commit a
// default-sized stub. Two-click before that had no live preview, which is
// why it was removed and why it works now.)
//
//   node test/js/labeled_placeholder_test.js

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

const THRESHOLD = Number((src.match(/var CLICK_PLACE_THRESHOLD_PX = (\d+);/) || [])[1]);
const SIZE = Number((src.match(/var CLICK_PLACE_SIZE_PX = (\d+);/) || [])[1]);
global.CLICK_PLACE_THRESHOLD_PX = THRESHOLD;
global.CLICK_PLACE_SIZE_PX = SIZE;

const isClickGesture = extract("_isClickGesture");
const clickPlaceSize = extract("_clickPlaceSizeImagePx");
const commitDimension = extract("_commitDimension");
const commitShaftDraft = extract("_commitShaftDraft");
const finalizeLabeled = extract("_finalizeLabeled");
const commitCallout = extract("_commitCallout");
const calloutDefaultBox = extract("_calloutDefaultBox");

// A context that behaves like the hook for exactly these paths: real
// gesture judgment, recorded finalize/edit calls, and a `_finalizeShape`
// that hands the shape back through afterCreate like the real one does.
function ctx(draft) {
  const out = { finalized: null, edit: [], guardAt: 0 };
  const c = {
    draftState: draft && draft.state
      ? Object.assign({ el: { classList: { remove: () => {} } } }, draft.state)
      : null,
    draftCallout: draft && draft.callout
      ? Object.assign({ el: { classList: { remove: () => {} } } }, draft.callout)
      : null,
    _markerScale: () => 1,
    _textDefaultBoxImagePx: () => 16,
    _isClickGesture: isClickGesture,
    _clickPlaceSizeImagePx: clickPlaceSize,
    _calloutDefaultBox: calloutDefaultBox,
    // A shaft draft commits the geometry it was carrying, so an arrow keeps
    // its route — see arrow_tool_test.js.
    _shaftGeometry: extract("_shaftGeometry"),
    _commitShaftDraft: commitShaftDraft,
    _finalizeLabeled: finalizeLabeled,
    _finalizeShape(kind, geom, el, afterCreate) {
      out.finalized = { kind, geom };
      if (typeof afterCreate === "function") afterCreate({ uuid: "u1", kind });
    },
    _enterEditMode: (s) => out.edit.push(["edit", s.uuid]),
    _startTextEdit: (s) => out.edit.push(["label", s.uuid])
  };
  Object.defineProperty(c, "out", { value: out });
  return c;
}

// ── dimension: click → armed, nothing placed yet ────────────────────────────

{
  const c = ctx({ state: { kind: "dimension", anchor: { x: 200, y: 100 } } });
  commitDimension.call(c, { x: 201, y: 100 }); // 1px of jitter
  assert.ok(!c.out.finalized,
    "a click places nothing — it arms the draft for the click that sets the far end");
  assert.strictEqual(c.draftState.armed, true);
  assert.deepStrictEqual(c.out.edit, [], "and opens no label editor for a shape that isn't there");
}

// ── dimension: drag → exactly the dragged span, label editor open ───────────

{
  const c = ctx({ state: { kind: "dimension", anchor: { x: 10, y: 10 } } });
  commitDimension.call(c, { x: 90, y: 60 });
  assert.deepStrictEqual(c.out.finalized.geom, { a: [10, 10], b: [90, 60] },
    "a dragged dimension keeps its dragged endpoints");
  assert.deepStrictEqual(c.out.edit, [["edit", "u1"], ["label", "u1"]],
    "a dragged dimension must also land in label editing — that is the point of drawing one");
}

// ── line: same gestures, no label editor ────────────────────────────────────

{
  const c = ctx({ state: { kind: "line", anchor: { x: 50, y: 50 } } });
  commitDimension.call(c, { x: 50, y: 50 });
  assert.ok(!c.out.finalized, "a clicked line arms too — same gesture, same rule");
  assert.strictEqual(c.draftState.armed, true);
}
{
  const c = ctx({ state: { kind: "line", anchor: { x: 0, y: 0 } } });
  commitDimension.call(c, { x: 100, y: 0 });
  assert.deepStrictEqual(c.out.finalized.geom, { a: [0, 0], b: [100, 0] });
  assert.deepStrictEqual(c.out.edit, [], "a dragged line stays label-silent too");
}

// ── callout: click → armed, nothing placed yet ──────────────────────────────

// This block used to pin a subtle bug in the click branch: the draft's box
// could not be trusted at commit, because any pointermove between press and
// release — including the move browsers synthesize at the click point
// itself — runs `_calloutHover` and re-centers the box on the cursor, so a
// clicked callout committed with its box on the anchor and its leader
// collapsed to nothing. There is no click branch to get wrong now; a click
// arms, and the placing click is somewhere the user actually pointed.
{
  const clobbered = { x: 200, y: 89, w: 96, h: 22.4 };
  const c = ctx({ callout: { kind: "callout", geometry: { anchor: [200, 100], text_box: clobbered } } });
  commitCallout.call(c, { x: 200, y: 101 });
  assert.ok(!c.out.finalized, "a click places nothing");
  assert.strictEqual(c.draftCallout.armed, true, "it arms for the placing click");
  assert.deepStrictEqual(c.out.edit, []);
}

// ── callout: drag → box centered on the release point ───────────────────────

{
  const box = { x: 210, y: 90, w: 96, h: 22 };
  const c = ctx({ callout: { kind: "callout", geometry: { anchor: [200, 100], text_box: box } } });
  commitCallout.call(c, { x: 400, y: 300 });
  assert.deepStrictEqual(c.out.finalized.geom, {
    anchor: [200, 100],
    text_box: { x: 400, y: 300 - box.h / 2, w: box.w, h: box.h }
  }, "a dragged callout places its box centered on the release point, anchor where the press was");
  assert.deepStrictEqual(c.out.edit, [["edit", "u1"], ["label", "u1"]]);
}

// ── pointerup actually reaches the callout commit ───────────────────────────

// Callout drafts live in `draftCallout`, not `draftState`, and `_onPointerUp`
// guards on `draftState` — without its own gate the commit is unreachable
// and the tool silently reverts to never finishing.
{
  const onPointerUp = extract("_onPointerUp");
  let committed = null;
  const c = {
    activeTool: "callout",
    draftCallout: { geometry: {} },
    draftState: null,
    _erasingActive: false,
    _toImage: () => ({ x: 7, y: 9 }),
    _commitCallout: (pt) => { committed = pt; }
  };
  onPointerUp.call(c, {});
  assert.deepStrictEqual(committed, { x: 7, y: 9 },
    "_onPointerUp never routed the callout draft to _commitCallout");
}

// ── the callout placeholder's leader is a real diagonal ─────────────────────

// A callout IS "a line pointing at something". The default box used to sit
// a two-basePx hop from the anchor, drawing a leader too short to read as
// one. Driven through the real helper: with basePx = 16, the box must
// clear the anchor by a visible margin on both axes.
{
  const box = calloutDefaultBox.call({ _textDefaultBoxImagePx: () => 16 }, { x: 0, y: 0 });
  assert.ok(box.x >= 16 * 3,
    `the box starts only ${box.x / 16} basePx right of the anchor — the leader reads as a nudge, not a diagonal`);
  assert.ok(box.y + box.h <= -(16 * 2.5),
    `the box bottom sits only ${-(box.y + box.h) / 16} basePx above the anchor — the leader is nearly horizontal`);
}

// ── the two-click mode is gone, entirely ────────────────────────────────────

// Half-removed would be worse than either state: a pointerdown gate still
// checking a flag nothing sets strands the draft forever.
assert.ok(!src.includes("pendingClickEnd"),
  "pendingClickEnd is back — the hidden two-click mode these gestures replaced");

console.log("labeled placeholder: all checks passed");
