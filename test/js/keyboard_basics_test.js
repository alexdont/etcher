// Pins the keyboard/gesture basics every comparable canvas tool honors:
// the Escape ladder, arrow-key nudge, ⌘D duplicate, ⌘A select-all,
// shift-constrained drawing (square / 45°), and shift axis-lock on moves.
//
//   node test/js/keyboard_basics_test.js

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

const escapeLadder = extract("_escapeLadder");
const selectAll = extract("_selectAll");
const nudgeSelection = extract("_nudgeSelection");
const flushNudge = extract("_flushNudge");
const constrainRect = extract("_constrainRectPoint");
const constrainShaft = extract("_constrainShaftPoint");
const translateGeometry = extract("_translateGeometry");
const startShapeMove = extract("_startShapeMove");

// ── the Escape ladder: draft, then tool, then selection ─────────────────────

function ladderCtx(state) {
  const calls = [];
  return {
    ctx: Object.assign({
      draftState: null, draftPolygon: null, draftCallout: null,
      activeTool: null, selectedShapes: null,
      editingShape: null, editingTitleShape: null,
      _cancelDraft: () => calls.push("cancelDraft"),
      _selectTool: (k) => calls.push(["selectTool", k]),
      _exitEditMode: () => calls.push("exitEdit"),
      _exitTitleEditMode: () => calls.push("exitTitleEdit"),
      _clearSelection: () => calls.push("clearSelection"),
      _syncActionBar: () => {}
    }, state),
    calls
  };
}

{
  // Mid-draw with a tool armed AND a selection: the draft dies, nothing else.
  const { ctx, calls } = ladderCtx({
    draftState: {}, activeTool: "rectangle", selectedShapes: [{}]
  });
  assert.strictEqual(escapeLadder.call(ctx), true);
  assert.deepStrictEqual(calls, ["cancelDraft"],
    "the first Escape must cancel ONLY the draft — one rung per press");
}
{
  // Armed tool, no draft: back to the cursor.
  const { ctx, calls } = ladderCtx({ activeTool: "rectangle" });
  assert.strictEqual(escapeLadder.call(ctx), true);
  assert.deepStrictEqual(calls, [["selectTool", null]],
    "with no draft, Escape should drop the armed tool to the cursor");
}
{
  // Cursor with a selection: everything lets go.
  const { ctx, calls } = ladderCtx({ selectedShapes: [{}] });
  assert.strictEqual(escapeLadder.call(ctx), true);
  assert.ok(calls.indexOf("clearSelection") !== -1 && calls.indexOf("exitEdit") !== -1,
    "with a selection, Escape should deselect");
}
{
  // Nothing to do: fall through so the host page keeps the key.
  const { ctx, calls } = ladderCtx({});
  assert.strictEqual(escapeLadder.call(ctx), false,
    "an idle Escape must not be consumed — the host page owns it");
  assert.deepStrictEqual(calls, []);
}

// ── select all: every editable shape, cursor mode only ──────────────────────

{
  const selected = [];
  const shapes = [
    { uuid: "a", el: {} },
    { uuid: "b", el: {}, readonly: true },
    { uuid: "c", el: {} },
    { uuid: "d" } // no el — never rendered
  ];
  const ctx = {
    activeTool: null, shapes,
    _exitEditMode: () => {}, _exitTitleEditMode: () => {},
    _clearSelection: () => {}, _syncActionBar: () => {},
    _addToSelection: (s) => selected.push(s.uuid)
  };
  assert.strictEqual(selectAll.call(ctx), true);
  assert.deepStrictEqual(selected, ["a", "c"],
    "select-all must take every editable shape and skip locked / unrendered ones");

  assert.strictEqual(selectAll.call(Object.assign({}, ctx, { activeTool: "rectangle" })), false,
    "select-all mid-draw must fall through to the host");
}

// ── nudge: screen-px steps, one undo + one emit per burst ───────────────────

{
  const emits = [];
  const undos = [];
  let flush = null;
  global.setTimeout = (fn) => { flush = fn; return 1; };
  global.clearTimeout = () => {};

  const shape = {
    uuid: "s1", kind: "rectangle",
    geometry: { x: 10, y: 10, w: 40, h: 20 }, metadata: null
  };
  const ctx = {
    selectedShapes: null,
    editingShape: shape,
    shapes: [shape],
    freehandEditor: null,
    _markerScale: () => 2, // zoomed 2×: 1 screen px = 0.5 image px
    _translateGeometry: translateGeometry,
    _snapshotShape: (s) => JSON.parse(JSON.stringify(s.geometry)),
    _renderShape: () => {},
    _positionAllHandles: () => {},
    _emitChanged: () => emits.push(1),
    _pushUndo: (uuid, before, after) => undos.push({ uuid, before, after }),
    _flushNudge: flushNudge,
    _nudgeSelection: nudgeSelection
  };

  // Three rapid presses: right, right, down (shift).
  assert.strictEqual(nudgeSelection.call(ctx, 1, 0), true);
  assert.strictEqual(nudgeSelection.call(ctx, 1, 0), true);
  assert.strictEqual(nudgeSelection.call(ctx, 0, 10), true);

  assert.strictEqual(shape.geometry.x, 11,
    "two 1-screen-px nudges at 2× zoom should move 1 image px total");
  assert.strictEqual(shape.geometry.y, 15,
    "a shift-nudge should step 10 screen px (5 image px at 2×)");
  assert.strictEqual(emits.length, 0,
    "nothing may emit mid-burst — intermediate positions would spray the server");
  assert.strictEqual(undos.length, 0, "no undo entries mid-burst");

  flush.call(ctx); // the settle timer fires
  assert.strictEqual(emits.length, 1, "one emit per burst");
  assert.strictEqual(undos.length, 1, "one undo entry per burst");
  assert.deepStrictEqual(undos[0].before, { x: 10, y: 10, w: 40, h: 20 },
    "the undo must restore the pre-burst position, not the second-to-last nudge");

  delete global.setTimeout;
  delete global.clearTimeout;
}

// ── shift constraints: square and 45° ───────────────────────────────────────

{
  const a = { x: 100, y: 100 };
  assert.deepStrictEqual(constrainRect(a, { x: 180, y: 130 }), { x: 180, y: 180 },
    "shift-rect: the longer axis wins and the drag stays in its quadrant");
  assert.deepStrictEqual(constrainRect(a, { x: 60, y: 30 }), { x: 30, y: 30 },
    "shift-rect: up-left drags square up-left");

  const p = constrainShaft(a, { x: 200, y: 108 });
  assert.deepStrictEqual({ x: Math.round(p.x), y: Math.round(p.y) }, { x: 200, y: 100 },
    "a near-horizontal shift-shaft must snap exactly horizontal, length preserved");
  const d = constrainShaft(a, { x: 195, y: 205 });
  assert.strictEqual(Math.round(d.x - a.x), Math.round(d.y - a.y),
    "a near-diagonal shift-shaft must snap to 45°");
}

// The draft plumbing that feeds them: both pointer handlers stamp the key,
// and the rect/shaft update+commit paths consult it.
{
  assert.strictEqual((src.match(/this\.draftState\.shift = !!e\.shiftKey;/g) || []).length, 2,
    "draftState.shift must be stamped in BOTH _onPointerMove and _onPointerUp — " +
    "missing the up-stamp means the commit ignores a shift pressed mid-drag");
  for (const fn of ["_updateRectangle", "_commitRectangle"]) {
    const body = src.slice(src.indexOf(`    ${fn}: function`), src.indexOf("\n    },", src.indexOf(`    ${fn}: function`)));
    assert.ok(body.includes("_constrainRectPoint"), `${fn} no longer applies the square constraint`);
  }
  for (const fn of ["_updateDimension", "_commitDimension"]) {
    const body = src.slice(src.indexOf(`    ${fn}: function`), src.indexOf("\n    },", src.indexOf(`    ${fn}: function`)));
    assert.ok(body.includes("_constrainShaftPoint"), `${fn} no longer applies the 45° constraint`);
  }
}

// ── shift axis-lock while moving a shape ────────────────────────────────────

{
  const noop = () => {};
  const listeners = {};
  const el = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: noop, setPointerCapture: noop,
    releasePointerCapture: noop, classList: { add: noop, remove: noop }
  };
  const shape = {
    kind: "rectangle", uuid: "u1", el,
    geometry: { x: 0, y: 0, w: 40, h: 40 }, metadata: null
  };
  const points = [{ x: 20, y: 20 }, { x: 80, y: 35 }]; // mostly horizontal
  let call = 0;
  const ctx = {
    _cycleTapTarget: (s) => s, _activateOverlayForShape: noop,
    _toImage: () => points[Math.min(call++, points.length - 1)],
    _imageToContainer: (p) => p,
    _snapshotShape: () => ({}), _onShapeTap: noop,
    _translateGeometry: translateGeometry,
    _shapeBBoxImagePx: () => null,
    _snapCandidatesFor: () => [],
    _snapOn: () => false,
    _clearSnapGuides: noop,
    _hideTooltip: noop, _showTooltipFor: noop,
    _suspendMidpointHighlight: noop, _resumeMidpointHighlight: noop,
    _renderShape: noop, _positionAllHandles: noop,
    _emitChanged: noop, _pushUndo: noop, editingTitleShape: null
  };
  startShapeMove.call(ctx, shape, { pointerId: 1 });
  listeners.pointermove({ pointerId: 1, shiftKey: true });
  listeners.pointerup({ pointerId: 1 });
  assert.deepStrictEqual(shape.geometry, { x: 60, y: 0, w: 40, h: 40 },
    "a shift-move that travels mostly horizontally must lock to the x axis");
}

// ── the keys are actually bound ─────────────────────────────────────────────

{
  const handler = src.slice(src.indexOf("self._undoKeyHandler = function"),
    src.indexOf('document.addEventListener("keydown", self._undoKeyHandler)'));
  assert.ok(handler.includes("self._escapeLadder()"), "Escape is not routed to the ladder");
  assert.ok(handler.includes("self._nudgeSelection(ndx, ndy)"), "arrow keys are not routed to the nudge");
  assert.ok(handler.includes("self._duplicateSelection()"), "⌘D is not bound — the tooltip has promised it since the button shipped");
  assert.ok(handler.includes("self._selectAll()"), "⌘A is not bound");
  // Consumed-only-on-success: stealing the browser's bookmark key for a
  // no-op is how "the shortcuts are broken" bugs get filed.
  assert.ok(/if \(self\._duplicateSelection\(\)\) e\.preventDefault\(\)/.test(handler),
    "⌘D must consume the key only when something was duplicated");
}

console.log("keyboard basics: all checks passed");
