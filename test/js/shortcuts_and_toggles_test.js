// Pins the Tier-2 conveniences: single-key tool shortcuts, alt-drag
// duplicate, and the snap toggle (off by default, user pref wins, saved
// like the connector toggle).
//
//   node test/js/shortcuts_and_toggles_test.js

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

// The shortcut map, as the bundle defines it.
const mapSrc = src.match(/var TOOL_SHORTCUTS = \{[\s\S]*?\};/);
assert.ok(mapSrc, "could not find TOOL_SHORTCUTS");
const TOOL_SHORTCUTS = eval("(" + mapSrc[0].replace("var TOOL_SHORTCUTS = ", "").replace(/;$/, "") + ")");
global.TOOL_SHORTCUTS = TOOL_SHORTCUTS;
global.SNAP_THRESHOLD_PX = Number((src.match(/var SNAP_THRESHOLD_PX = (\d+);/) || [])[1]);
global.TOOL_DEFS = {
  rectangle: {}, circle: {}, polygon: {}, freehand: {}, marker: {},
  grabber: {}, callout: {}, text: {}, dimension: {}, line: {},
  eraser: {}, pointer: {}, image: { momentary: true }
};

const selectToolByShortcut = extract("_selectToolByShortcut");
const snapOn = extract("_snapOn");
const cloneShapeInPlace = extract("_cloneShapeInPlace");
const startShapeMove = extract("_startShapeMove");
const translateGeometry = extract("_translateGeometry");

// ── the shortcut map covers the dialect ─────────────────────────────────────

assert.strictEqual(TOOL_SHORTCUTS.v, null, "V must be the cursor");
assert.strictEqual(TOOL_SHORTCUTS.r, "rectangle");
assert.strictEqual(TOOL_SHORTCUTS.o, "circle");
assert.strictEqual(TOOL_SHORTCUTS.d, "freehand");
assert.strictEqual(TOOL_SHORTCUTS.e, "eraser");
assert.strictEqual(TOOL_SHORTCUTS.t, "text");
assert.ok(!Object.values(TOOL_SHORTCUTS).includes("image"),
  "the image tool must have no shortcut — a keystroke opening the OS file picker is startling");

// ── arming respects the board's tool allowlist ──────────────────────────────

{
  const armed = [];
  const ctx = {
    tools: ["rectangle", "eraser"],
    _selectTool: (k) => armed.push(k)
  };
  assert.strictEqual(selectToolByShortcut.call(ctx, null), true, "the cursor is always reachable");
  assert.strictEqual(selectToolByShortcut.call(ctx, "rectangle"), true);
  assert.strictEqual(selectToolByShortcut.call(ctx, "circle"), false,
    "a key must not arm a tool the toolbar does not offer — an invisible mode strands the user");
  assert.deepStrictEqual(armed, [null, "rectangle"]);
}

// ── the handler gates on modifiers and routes bare keys ─────────────────────

{
  const handler = src.slice(src.indexOf("self._undoKeyHandler = function"),
    src.indexOf('document.addEventListener("keydown", self._undoKeyHandler)'));
  const shortcutBlock = handler.slice(handler.indexOf("TOOL_SHORTCUTS"));
  const gateAt = handler.indexOf("!e.metaKey && !e.ctrlKey && !e.altKey");
  assert.ok(gateAt !== -1 && gateAt < handler.indexOf("TOOL_SHORTCUTS"),
    "the shortcut lookup must be gated on bare keys — ⌘R is the browser's reload, alt-drag is duplicate " +
    "(the gate must EXIST; -1 compares smaller than everything and must not count)");
  assert.ok(shortcutBlock.includes("_selectToolByShortcut"),
    "the shortcut keys are not routed through the allowlist check");
}

// ── the snap toggle: pref > host default > off ──────────────────────────────

function snapCtx(pref, hostAttr) {
  return {
    _getPref: (name) => (name === "snap" ? pref : undefined),
    el: { dataset: hostAttr === undefined ? {} : { snap: hostAttr } }
  };
}
assert.strictEqual(snapOn.call(snapCtx(undefined, undefined)), false,
  "snapping must be OFF by default — the pull is an acquired taste");
assert.strictEqual(snapOn.call(snapCtx(undefined, "true")), true,
  "the host's snap={true} default is ignored");
assert.strictEqual(snapOn.call(snapCtx(true, undefined)), true,
  "the user's saved 'on' is ignored");
assert.strictEqual(snapOn.call(snapCtx(false, "true")), false,
  "the user turned snapping OFF but the host default overrode it");

// The toggle button flips the RESOLVED state and lives next to the grid /
// connector toggles.
assert.ok(src.includes('self._setPref("snap", !self._snapOn());'),
  "the snap toggle no longer writes the inverse of the resolved state");
{
  const conAt = src.indexOf("self.connectorsBtn = self._makePopupAction");
  const snapAt = src.indexOf("self.snapBtn = self._makePopupAction");
  // The view-toggle group has grown (label dots, ink-zoom anchoring sit
  // between them now) — what matters is that snap stays in the same group
  // after connectors, not a byte distance.
  assert.ok(conAt !== -1 && snapAt !== -1 && snapAt > conAt && snapAt - conAt < 2000,
    "the snap toggle must sit in the connector toggle's group in the customise menu");
}

// ── the drag respects the toggle ────────────────────────────────────────────

function dragHarness(opts) {
  const noop = () => {};
  const listeners = {};
  const el = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: noop, setPointerCapture: noop,
    releasePointerCapture: noop, classList: { add: noop, remove: noop }
  };
  const shape = {
    kind: "rectangle", uuid: "u1", el,
    geometry: { x: 0, y: 0, w: 50, h: 50 }, metadata: null
  };
  const other = {
    kind: "rectangle", uuid: "u2", el: {},
    geometry: { x: 200, y: 200, w: 100, h: 60 }
  };
  const shapes = [shape, other];
  const points = [{ x: 25, y: 25 }, opts.endPt];
  let call = 0;
  let nextId = 100;
  const created = [];
  const ctx = Object.assign({
    shapes,
    _cycleTapTarget: (s) => s, _activateOverlayForShape: noop,
    _toImage: () => points[Math.min(call++, points.length - 1)],
    _imageToContainer: (p) => p,
    _markerScale: () => 1,
    _snapshotShape: () => ({}), _onShapeTap: noop,
    _translateGeometry: translateGeometry,
    _shapeBBoxImagePx: extract("_shapeBBoxImagePx"),
    _snapCandidatesFor: extract("_snapCandidatesFor"),
    _computeSnap: extract("_computeSnap"),
    _snapGuidesFor: extract("_snapGuidesFor"),
    _snapOn: () => !!opts.snapOn,
    _renderSnapGuides: noop, _clearSnapGuides: noop,
    _cloneShapeInPlace: cloneShapeInPlace,
    _addShape: (payload) => {
      const uuid = "clone-" + nextId++;
      // The clone gets a listener-capable el: after an alt-grab the drag
      // machinery re-targets onto it.
      shapes.push(Object.assign({ uuid, el }, JSON.parse(JSON.stringify(payload))));
      return uuid;
    },
    _pushUndoCreate: (s) => created.push(s.uuid),
    _hideTooltip: noop, _showTooltipFor: noop,
    _suspendMidpointHighlight: noop, _resumeMidpointHighlight: noop,
    _renderShape: noop, _positionAllHandles: noop,
    _emitChanged: noop, _pushUndo: noop, editingTitleShape: null
  }, opts.ctx || {});
  startShapeMove.call(ctx, shape, Object.assign({ pointerId: 1 }, opts.downEv || {}));
  listeners.pointermove({ pointerId: 1 });
  listeners.pointerup({ pointerId: 1 });
  return { shape, shapes, created };
}

{
  // Snapping OFF (the default): a drag to 4px shy stays 4px shy.
  const { shape } = dragHarness({ snapOn: false, endPt: { x: 229, y: 125 } });
  assert.strictEqual(shape.geometry.x, 204,
    "with the toggle off, the drag must land exactly where the hand put it");
}
{
  // Snapping ON: same drag magnetizes flush.
  const { shape } = dragHarness({ snapOn: true, endPt: { x: 229, y: 125 } });
  assert.strictEqual(shape.geometry.x, 200,
    "with the toggle on, the drag must snap flush");
}

// ── alt-drag duplicates: the copy moves, the original stays ─────────────────

{
  const { shape, shapes, created } = dragHarness({
    snapOn: false, endPt: { x: 125, y: 125 }, downEv: { altKey: true }
  });
  assert.deepStrictEqual(shape.geometry, { x: 0, y: 0, w: 50, h: 50 },
    "alt-drag must leave the ORIGINAL exactly where it was");
  const clone = shapes.find((s) => String(s.uuid).indexOf("clone-") === 0);
  assert.ok(clone, "alt-drag created no copy");
  assert.deepStrictEqual(clone.geometry, { x: 100, y: 100, w: 50, h: 50 },
    "the copy is what the drag moves");
  assert.deepStrictEqual(created, [clone.uuid],
    "the copy must get a create-undo entry, same as the ⌘D path");
}
{
  // Without alt, no clone appears.
  const { shapes } = dragHarness({ snapOn: false, endPt: { x: 125, y: 125 } });
  assert.strictEqual(shapes.length, 2, "a plain drag must not duplicate");
}

console.log("shortcuts and toggles: all checks passed");
