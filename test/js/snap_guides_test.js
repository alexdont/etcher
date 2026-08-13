// Pins the snap & alignment guides: while a shape's body is dragged, its
// edges and centers magnetize to every other shape's within a screen-px
// threshold, cyan guide lines show what aligned with what, ⌘/Ctrl
// bypasses, and a shift-locked axis is never nudged off its lock.
//
//   node test/js/snap_guides_test.js

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

const THRESHOLD = Number((src.match(/var SNAP_THRESHOLD_PX = (\d+);/) || [])[1]);
assert.ok(THRESHOLD > 0, "could not find SNAP_THRESHOLD_PX");
global.SNAP_THRESHOLD_PX = THRESHOLD;

const computeSnap = extract("_computeSnap");
const snapGuidesFor = extract("_snapGuidesFor");
const snapCandidatesFor = extract("_snapCandidatesFor");
const startShapeMove = extract("_startShapeMove");
const translateGeometry = extract("_translateGeometry");
const shapeBBoxImagePx = extract("_shapeBBoxImagePx");

// ── the snap math ───────────────────────────────────────────────────────────

const OTHER = { x: 200, y: 200, w: 100, h: 60 }; // edges x: 200/250/300, y: 200/230/260

{
  // Left edge 4px from the other's left edge → pulls flush.
  const sn = computeSnap({ x: 204, y: 400, w: 50, h: 50 }, [OTHER], 6);
  assert.ok(sn.x && sn.x.delta === -4 && sn.x.coord === 200,
    `a 4px-off left edge must snap flush, got ${JSON.stringify(sn.x)}`);
  assert.strictEqual(sn.y, null,
    "nothing within threshold on y — snapping anyway would yank the shape sideways");
}
{
  // Center-to-center: dragged center at 247 → snaps to the other's 250.
  const sn = computeSnap({ x: 222, y: 400, w: 50, h: 50 }, [OTHER], 6);
  assert.ok(sn.x && sn.x.coord === 250 && sn.x.delta === 3,
    `centers must snap to centers, got ${JSON.stringify(sn.x)}`);
}
{
  // Beyond threshold: nothing happens.
  const sn = computeSnap({ x: 210, y: 400, w: 50, h: 50 }, [OTHER], 6);
  assert.strictEqual(sn.x, null, "10px off is beyond the pull — no snap");
}
{
  // Two candidates: the SMALLER correction wins.
  const near = { x: 302, y: 400, w: 10, h: 10 };
  const sn = computeSnap({ x: 304, y: 400, w: 50, h: 50 }, [OTHER, near], 6);
  assert.ok(sn.x && sn.x.coord === 302 && sn.x.delta === -2,
    `the nearest candidate must win, got ${JSON.stringify(sn.x)}`);
}
{
  // A masked axis is never snapped — the shift lock owns it.
  const sn = computeSnap({ x: 204, y: 202, w: 50, h: 50 }, [OTHER], 6, { x: false, y: true });
  assert.strictEqual(sn.x, null,
    "a shift-locked x axis must not be nudged off its lock by the snap");
  assert.ok(sn.y, "the free axis still snaps");
}

// ── the guides ──────────────────────────────────────────────────────────────

{
  // Snapped flush left with OTHER, above it: one vertical guide at x=200
  // spanning from the dragged box's top to the candidate's bottom.
  const guides = snapGuidesFor({ x: 200, y: 80, w: 44, h: 50 }, [OTHER]);
  const v = guides.filter((g) => g.axis === "v");
  assert.strictEqual(v.length, 1, `expected one vertical guide, got ${JSON.stringify(guides)}`);
  assert.deepStrictEqual(v[0], { axis: "v", at: 200, from: 80, to: 260 },
    "the guide must span from the dragged shape to the shape it aligned with");
}
{
  // Aligned with TWO candidates on the same coordinate: the guide spans to
  // the farthest, connecting everything that lines up.
  const far = { x: 200, y: 600, w: 40, h: 40 };
  const guides = snapGuidesFor({ x: 200, y: 80, w: 44, h: 50 }, [OTHER, far]);
  const v = guides.filter((g) => g.axis === "v" && g.at === 200);
  assert.strictEqual(v[0].to, 640,
    "a guide shared by several shapes must span to the farthest one");
}
{
  // No coordinate matches → no guides.
  assert.deepStrictEqual(snapGuidesFor({ x: 130, y: 80, w: 51, h: 50 }, [OTHER]), [],
    "an unaligned box must draw no guides");
}

// ── candidate collection ────────────────────────────────────────────────────

{
  const dragged = { uuid: "d", el: {}, kind: "rectangle", geometry: { x: 0, y: 0, w: 10, h: 10 } };
  const same = { uuid: "a", el: {}, kind: "rectangle", geometry: { x: 50, y: 0, w: 10, h: 10 } };
  const otherPage = Object.assign({}, same, { uuid: "b", image_idx: 2 });
  const ctx = {
    shapes: [dragged, same, otherPage],
    _shapeBBoxImagePx: shapeBBoxImagePx
  };
  const boxes = snapCandidatesFor.call(ctx, dragged);
  assert.strictEqual(boxes.length, 1,
    "candidates must exclude the dragged shape itself and shapes on other strip pages");
  assert.deepStrictEqual(boxes[0], { x: 50, y: 0, w: 10, h: 10 });
}

// ── through the real drag machinery ─────────────────────────────────────────

function dragWith(evProps, endPt) {
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
  const points = [{ x: 25, y: 25 }, endPt];
  let call = 0;
  const rendered = [];
  let cleared = 0;
  const ctx = {
    shapes: [shape, other],
    _cycleTapTarget: (s) => s, _activateOverlayForShape: noop,
    _toImage: () => points[Math.min(call++, points.length - 1)],
    _imageToContainer: (p) => p,
    _markerScale: () => 1,
    _snapshotShape: () => ({}), _onShapeTap: noop,
    _translateGeometry: translateGeometry,
    _shapeBBoxImagePx: shapeBBoxImagePx,
    _snapCandidatesFor: snapCandidatesFor,
    _snapOn: () => true,
    _computeSnap: computeSnap,
    _snapGuidesFor: snapGuidesFor,
    _renderSnapGuides: (g) => rendered.push(g),
    _clearSnapGuides: () => { cleared++; },
    _hideTooltip: noop, _showTooltipFor: noop,
    _suspendMidpointHighlight: noop, _resumeMidpointHighlight: noop,
    _renderShape: noop, _positionAllHandles: noop,
    _emitChanged: noop, _pushUndo: noop, editingTitleShape: null
  };
  startShapeMove.call(ctx, shape, { pointerId: 1 });
  listeners.pointermove(Object.assign({ pointerId: 1 }, evProps));
  listeners.pointerup({ pointerId: 1 });
  return { shape, rendered, cleared };
}

{
  // Drag to 4px shy of flush-left with the other shape: snap closes the gap.
  const { shape, rendered, cleared } = dragWith({}, { x: 229, y: 125 });
  assert.strictEqual(shape.geometry.x, 200,
    "the dragged shape must land flush with the neighbour it snapped to");
  assert.ok(rendered.length > 0 && rendered[rendered.length - 1].some((g) => g.at === 200),
    "a guide must be shown at the snapped coordinate");
  assert.ok(cleared > 0, "the guides must be cleared when the drag ends");
}
{
  // Same drag with ⌘ held: no snap, no guides.
  const { shape, rendered } = dragWith({ metaKey: true }, { x: 229, y: 125 });
  assert.strictEqual(shape.geometry.x, 204,
    "⌘ must bypass the snap — the user said 'exactly here'");
  assert.deepStrictEqual(rendered, [], "no guides while snapping is bypassed");
}

// ── the chrome ──────────────────────────────────────────────────────────────

assert.ok(src.includes('".etcher-snap-guide {"'),
  "the guide CSS is gone — snapped drags would render invisible guides");

console.log("snap guides: all checks passed");
