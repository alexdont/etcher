// Pins what dragging a callout moves.
//
// A callout is two things: an anchor marking WHAT it points at, and a
// label saying something about it. Dragging the label used to translate
// both — repositioning the text dragged the pointer off its target, which
// defeats the shape. Now a grab that lands on the text box moves only the
// box (the anchor stays pinned, the leader stretches); a grab on the
// leader line or anchor dot still moves the whole callout.
//
//   node test/js/callout_label_drag_test.js

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

const startShapeMove = extract("_startShapeMove");
const translateGeometry = extract("_translateGeometry");

// Drive the real drag machinery: pointerdown at `grab`, one big move by
// `(dx, dy)`, release. Returns the geometry the drag left behind.
function drag(geometry, grab, dx, dy) {
  const noop = () => {};
  const listeners = {};
  const el = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: noop,
    setPointerCapture: noop,
    releasePointerCapture: noop,
    classList: { add: noop, remove: noop }
  };
  const shape = { kind: "callout", uuid: "u1", el, geometry, metadata: null };
  const points = [grab, { x: grab.x + dx, y: grab.y + dy }];
  let call = 0;
  const ctx = {
    _cycleTapTarget: (s) => s,
    _activateOverlayForShape: noop,
    _toImage: () => points[Math.min(call++, points.length - 1)],
    _imageToContainer: (p) => p, // 1:1 — image px are screen px here
    _snapshotShape: () => ({}),
    _onShapeTap: noop,
    _calloutTextBoxImage: (g) => g.text_box,
    _translateGeometry: translateGeometry,
    _hideTooltip: noop,
    _showTooltipFor: noop,
    _suspendMidpointHighlight: noop,
    _resumeMidpointHighlight: noop,
    _renderShape: noop,
    _positionAllHandles: noop,
    _emitChanged: noop,
    _pushUndo: noop,
    editingTitleShape: null
  };
  startShapeMove.call(ctx, shape, { pointerId: 1 });
  listeners.pointermove({ pointerId: 1 });
  listeners.pointerup({ pointerId: 1 });
  return shape.geometry;
}

const GEOM = () => ({
  anchor: [100, 200],
  text_box: { x: 160, y: 120, w: 96, h: 22 }
});

// ── a grab on the label moves only the label ────────────────────────────────

{
  const g = drag(GEOM(), { x: 200, y: 130 }, 50, 40); // inside the box
  assert.deepStrictEqual(g.anchor, [100, 200],
    "dragging the label moved the anchor — the callout no longer points at its target");
  assert.deepStrictEqual(g.text_box, { x: 210, y: 160, w: 96, h: 22 },
    "the label box should travel with the drag");
}

// ── a grab on the leader still moves the whole callout ──────────────────────

{
  const g = drag(GEOM(), { x: 120, y: 180 }, 50, 40); // on the leader, outside the box
  assert.deepStrictEqual(g.anchor, [150, 240],
    "a leader/dot grab should move the whole callout, anchor included");
  assert.deepStrictEqual(g.text_box, { x: 210, y: 160, w: 96, h: 22 },
    "a leader/dot grab should move the box along with the anchor");
}

// ── the grab region matches what is DRAWN ───────────────────────────────────

// The rendered box shrinks to the text; the storage envelope is often
// wider. Hit-testing the storage box would create an invisible "label"
// strip that pins the anchor for no visible reason.
{
  const noop = () => {};
  const listeners = {};
  const el = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: noop, setPointerCapture: noop,
    releasePointerCapture: noop, classList: { add: noop, remove: noop }
  };
  const shape = {
    kind: "callout", uuid: "u1", el,
    geometry: GEOM(), metadata: null,
    _renderedBox: { x: 160, y: 120, w: 30, h: 22 } // text is short
  };
  const points = [{ x: 220, y: 130 }, { x: 270, y: 130 }]; // inside storage, OUTSIDE rendered
  let call = 0;
  const ctx = {
    _cycleTapTarget: (s) => s, _activateOverlayForShape: noop,
    _toImage: () => points[Math.min(call++, points.length - 1)],
    _imageToContainer: (p) => p,
    _snapshotShape: () => ({}), _onShapeTap: noop,
    _calloutTextBoxImage: (g) => g.text_box,
    _translateGeometry: translateGeometry,
    _hideTooltip: noop, _showTooltipFor: noop,
    _suspendMidpointHighlight: noop, _resumeMidpointHighlight: noop,
    _renderShape: noop, _positionAllHandles: noop,
    _emitChanged: noop, _pushUndo: noop, editingTitleShape: null
  };
  startShapeMove.call(ctx, shape, { pointerId: 1 });
  listeners.pointermove({ pointerId: 1 });
  listeners.pointerup({ pointerId: 1 });
  assert.deepStrictEqual(shape.geometry.anchor, [150, 200],
    "a grab outside the RENDERED box should be a whole-shape move — the invisible storage envelope must not pin the anchor");
}

console.log("callout label drag: all checks passed");
