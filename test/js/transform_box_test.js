// The selection frame: a group, or one hand-drawn stroke, scaled from a
// corner and turned from the knob above, all from a snapshot taken at the
// press.
//
//   node test/js/transform_box_test.js

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
  return eval("(" + src.slice(start, end + "\n    }".length).replace(`${name}: function`, "function") + ")");
}

const scaleShape = lift("_xfScaleShape", "sn, P, sx, sy");
const rotateShape = lift("_xfRotateShape", "sn, C, deg");
const rotatePoint = lift("_rotatePoint", "pt, cx, cy, deg");
const rotateGeometry = lift("_rotateGeometry", "kind, g, c, deg");
const norm = lift("_xfNorm", "a");
const ctx = {
  _rotatePoint: rotatePoint, _rotateGeometry: rotateGeometry, _xfNorm: norm,
  _isPointText: () => false, _labelRidesShaft: () => false,
  _isBoxRotatable: (s) => s.kind === "rectangle" || s.kind === "text" || s.kind === "image",
  _calloutTextBoxImage: (g) => g.text_box,
  _renderShape: () => {}
};
const snap = (shape, extra) => Object.assign({
  shape, g: JSON.parse(JSON.stringify(shape.geometry)), style: Object.assign({}, shape.style || {}),
  meta: null, rot: (shape.style && shape.style.rotation) || 0, turn: 0
}, extra || {});
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

// ── a corner scales about the opposite corner ──────────────────────────────

{
  const stroke = { kind: "marker", geometry: { points: [[10, 10], [30, 20]] }, style: { width: 4 } };
  scaleShape.call(ctx, snap(stroke), { x: 10, y: 10 }, 2, 2);
  assert.deepStrictEqual(stroke.geometry.points, [[10, 10], [50, 30]], "points scale about the pivot");
  near(stroke.style.width, 8, "and the ink thickens with it");

  const rect = { kind: "rectangle", geometry: { x: 20, y: 20, w: 10, h: 10 }, style: { width: 2 } };
  scaleShape.call(ctx, snap(rect), { x: 0, y: 0 }, 2, 1);
  assert.deepStrictEqual(rect.geometry, { x: 40, y: 20, w: 20, h: 10 }, "a box scales along the frame's axes");

  const turned = { kind: "rectangle", geometry: { x: 0, y: 0, w: 10, h: 20 }, style: { rotation: 90 } };
  scaleShape.call(ctx, snap(turned), { x: 0, y: 0 }, 2, 1);
  near(turned.geometry.w, 10, "a quarter-turned box swaps which side the stretch reaches (w)");
  near(turned.geometry.h, 40, "…(h)");

  const nodes = { kind: "freehand", geometry: { nodes: [{ p: [10, 0], hIn: [1, 1], hOut: [-1, 2] }] }, style: {} };
  scaleShape.call(ctx, snap(nodes), { x: 0, y: 0 }, 3, 2);
  assert.deepStrictEqual(nodes.geometry.nodes[0], { p: [30, 0], hIn: [3, 2], hOut: [-3, 4] }, "curve handles scale too");

  const text = { kind: "text", geometry: { x: 0, y: 0, w: 10, h: 10 }, style: { font_size: 12 } };
  scaleShape.call(ctx, snap(text), { x: 0, y: 0 }, 2, 2);
  near(text.style.font_size, 24, "text grows with its box");
}

// ── the knob turns everything about the frame's middle ────────────────────

{
  const C = { x: 0, y: 0 };
  const rect = { kind: "rectangle", geometry: { x: 9, y: -1, w: 2, h: 2 }, style: {} };
  rotateShape.call(ctx, snap(rect), C, 90);
  near(rect.geometry.x + rect.geometry.w / 2, 0, "a box's middle swings round the frame's (x)");
  near(rect.geometry.y + rect.geometry.h / 2, 10, "…(y)");
  near(rect.style.rotation, 90, "and the box turns on it");

  const line = { kind: "line", geometry: { a: [10, 0], b: [20, 0] }, style: {} };
  rotateShape.call(ctx, snap(line), C, 90);
  near(line.geometry.a[0], 0, "a point shape's points turn"); near(line.geometry.a[1], 10, "…");
  near(line.style.turn, 90, "and its turn is counted, as the shape's own knob keeps it");

  const circle = { kind: "circle", geometry: { cx: 5, cy: 0, r: 3 }, style: {} };
  rotateShape.call(ctx, snap(circle), C, 180);
  near(circle.geometry.cx, -5, "a circle's centre swings round"); near(circle.geometry.r, 3, "its size untouched");
}

// ── wiring ────────────────────────────────────────────────────────────────

{
  assert.ok(/if \(this\._canRotate\(shape\) && !this\._xfOwnsSingle\(shape\)\) \{/.test(src),
    "a hand-drawn stroke has one knob, the frame's");
  assert.ok(src.includes("self._xfNoteRender(shape);"), "the frame follows every render of its shapes");
  assert.ok(src.includes("this._positionTransformBox();"), "and every pan and zoom");
  assert.ok(src.includes("if (self._xfContains(inPt)) {"), "a press inside it takes the whole selection");
}

console.log("transform box: all checks passed");
