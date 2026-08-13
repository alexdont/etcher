// Pins how the dimension and callout tools complete a gesture.
//
// Both used a two-click flow: release armed the draft, and only the NEXT
// click placed the far end. A mode with no visible affordance — testers
// read the first click as the tool having done nothing. Now pointerup ends
// the gesture like every other tool: a bare click places a default-sized
// placeholder centered on (dimension) or anchored at (callout) the point,
// and a press-drag-release places exactly what was dragged. Both kinds
// then drop straight into label editing — selected, inline input open,
// waiting for text — because a dimension or callout without a label is a
// shape the user still has to come back for. Lines share the machinery
// but stay label-silent: consumers collect line titles via their own
// composer on `etcher:shape-drawn`, and stacking two inputs confuses
// where to type.
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
    _isClickGesture: isClickGesture,
    _clickPlaceSizeImagePx: clickPlaceSize,
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

// ── dimension: click → centered placeholder, label editor open ──────────────

{
  const c = ctx({ state: { kind: "dimension", anchor: { x: 200, y: 100 } } });
  commitDimension.call(c, { x: 201, y: 100 }); // 1px of jitter
  const f = c.out.finalized;
  assert.ok(f, "a click should place a dimension, not arm a hidden mode");
  assert.deepStrictEqual(f.geom, { a: [200 - SIZE / 2, 100], b: [200 + SIZE / 2, 100] },
    `the placeholder must span the default length centered on the click, got ${JSON.stringify(f.geom)}`);
  assert.deepStrictEqual(c.out.edit, [["edit", "u1"], ["label", "u1"]],
    "a placed dimension must be selected and drop into label editing — edit mode first, editor on top");
  assert.ok(c._suppressEditDismissUntil > Date.now(),
    "the dismiss guard is not armed — the gesture's own click will tear the selection down");
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
  assert.ok(c.out.finalized, "a click should place a line placeholder");
  assert.deepStrictEqual(c.out.edit, [],
    "a line must NOT auto-open the label editor — consumers collect line titles via their composer");
}
{
  const c = ctx({ state: { kind: "line", anchor: { x: 0, y: 0 } } });
  commitDimension.call(c, { x: 100, y: 0 });
  assert.deepStrictEqual(c.out.finalized.geom, { a: [0, 0], b: [100, 0] });
  assert.deepStrictEqual(c.out.edit, [], "a dragged line stays label-silent too");
}

// ── callout: click → placeholder as previewed, label editor open ────────────

{
  const box = { x: 210, y: 90, w: 96, h: 22 };
  const c = ctx({ callout: { kind: "callout", geometry: { anchor: [200, 100], text_box: box } } });
  commitCallout.call(c, { x: 200, y: 101 });
  const f = c.out.finalized;
  assert.ok(f, "a click should commit the callout placeholder");
  assert.deepStrictEqual(f.geom.text_box, box,
    "a bare click keeps the default-offset box the draft was previewing");
  assert.deepStrictEqual(c.out.edit, [["edit", "u1"], ["label", "u1"]],
    "a placed callout must drop into label editing — a callout IS a label");
  assert.strictEqual(c.draftCallout, null, "the draft must be cleared on commit");
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

// ── the two-click mode is gone, entirely ────────────────────────────────────

// Half-removed would be worse than either state: a pointerdown gate still
// checking a flag nothing sets strands the draft forever.
assert.ok(!src.includes("pendingClickEnd"),
  "pendingClickEnd is back — the hidden two-click mode these gestures replaced");

console.log("labeled placeholder: all checks passed");
