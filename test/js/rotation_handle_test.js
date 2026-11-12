// Pins shape rotation by the knob above a shape, and the text box's
// scale-as-one dot.
//
//   node test/js/rotation_handle_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher.js"), "utf8");
function body(name) {
  const start = src.indexOf(`    ${name}: function(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf("\n    },", start);
  return "(function" + src.slice(src.indexOf("(", start), end + "\n    }".length) + ")";
}
const fn = (n) => eval(body(n));
const ctx = {
  _isBoxRotatable: fn("_isBoxRotatable"), _canRotate: fn("_canRotate"), _shapeRot: fn("_shapeRot"),
  _rotBox: fn("_rotBox"), _rotCenter: fn("_rotCenter"), _rotPts: fn("_rotPts"),
  _rotatePoint: fn("_rotatePoint"), _rotateGeometry: fn("_rotateGeometry"), _recenterRotated: fn("_recenterRotated")
};
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

// Which shapes turn, and how.
assert.ok(ctx._canRotate({ kind: "rectangle" }) && ctx._canRotate({ kind: "text" }) && ctx._canRotate({ kind: "arrow" }));
assert.ok(!ctx._canRotate({ kind: "circle" }), "a circle looks the same turned");
assert.ok(!ctx._canRotate({ kind: "callout" }), "a callout stays upright to be read");
assert.ok(!ctx._canRotate({ kind: "rectangle", readonly: true }));
assert.strictEqual(ctx._shapeRot({ kind: "rectangle", style: { rotation: 30 } }), 30);
assert.strictEqual(ctx._shapeRot({ kind: "polygon", style: { rotation: 30 } }), 0, "point shapes bake the turn into their points");

// A turned box's corners.
const rect = { kind: "rectangle", geometry: { x: 0, y: 0, w: 100, h: 50 }, style: { rotation: 90 } };
const [tl] = ctx._rotPts.call(ctx, rect, [{ x: 0, y: 0 }]);
near(tl.x, 75, "TL turned 90° about the centre lands at x"); near(tl.y, -25, "and y");

// Resizing in the turned frame keeps the held corner where it was.
{
  const s = { kind: "rectangle", geometry: { x: 0, y: 0, w: 100, h: 50 }, style: { rotation: 40 } };
  const c0 = ctx._rotCenter.call(ctx, s);
  const heldBefore = ctx._rotatePoint({ x: 0, y: 0 }, c0.x, c0.y, 40);
  s.geometry = { x: 0, y: 0, w: 160, h: 90 };       // the local resize, TL held
  ctx._recenterRotated.call(ctx, s, c0, 40);
  const cn = ctx._rotCenter.call(ctx, s);
  const heldAfter = ctx._rotatePoint({ x: s.geometry.x, y: s.geometry.y }, cn.x, cn.y, 40);
  near(heldAfter.x, heldBefore.x, "held corner x"); near(heldAfter.y, heldBefore.y, "held corner y");
}

// Point geometry turns point by point; bezier handles turn as vectors.
{
  const g = ctx._rotateGeometry.call(ctx, "freehand", { nodes: [{ p: [10, 0], hIn: null, hOut: [5, 0] }] }, { x: 0, y: 0 }, 90);
  near(g.nodes[0].p[0], 0, "p x"); near(g.nodes[0].p[1], 10, "p y");
  near(g.nodes[0].hOut[0], 0, "hOut x"); near(g.nodes[0].hOut[1], 5, "hOut y");
  const a = ctx._rotateGeometry.call(ctx, "arrow", { a: [1, 0], b: [2, 0], points: [[3, 0]], from: null, to: null }, { x: 0, y: 0 }, 180);
  near(a.b[0], -2, "arrow end"); near(a.points[0][0], -3, "and its bends");
}

// Wiring: rendered, hit-tested, handled and resized turned.
assert.ok(src.includes('el.setAttribute("transform", "rotate(" + rRot + " "'), "a rectangle draws turned");
assert.ok(src.includes("tbox.deg = (tbox.deg || 0) + self._shapeRot(shape);"), "text draws turned");
assert.ok(body("_shapeContainsPoint").includes("var lp = this._rotatePoint(pt, hc.x, hc.y, -hitRot);"), "clicks test the turned shape");
assert.ok(body("_handlePositions").includes("return this._rotPts(shape, local);"), "corner dots sit on turned corners");
assert.ok(body("_startHandleDrag").includes("if (dragRot) self._recenterRotated(shape, dragC0, dragRot);"), "resizes hold their corner");
assert.ok(body("_renderExtraHandles").includes('knob.classList.add("etcher-handle", "etcher-rotate-handle");'), "the knob");
assert.ok(body("_startRotateDrag").includes("if (ev.shiftKey) next = Math.round(next / 15) * 15;"), "Shift steps 15°");

// The text box's scale dot: box, text and corners together.
const scale = body("_startTextboxScaleDrag");
assert.ok(scale.includes("shape.geometry = Object.assign({}, g0, { w: g0.w * k, h: g0.h * k });") &&
  scale.includes("patch.font_size = st0.font_size * k;") && scale.includes("patch.corner_size = st0.corner_size * k;"));
assert.ok(body("_renderExtraHandles").includes('if (shape.kind === "text" && this._textboxFixed(shape)) {'), "only on text boxes");

// The label turns with its shape.
{
  const labelRot = eval(body("_labelRot"));
  const lctx = Object.assign({}, ctx, { _labelRidesShaft: (k) => k === "arrow" || k === "dimension",
    _isTextKind: (k) => k === "text" || k === "callout" });
  assert.strictEqual(labelRot.call(lctx, { kind: "rectangle", style: { rotation: 30 } }), 30, "a turned box's label turns as far");
  assert.strictEqual(labelRot.call(lctx, { kind: "polygon", style: { title_rotation: 50 } }), 50, "a point shape's label keeps the knob's turns");
  assert.strictEqual(labelRot.call(lctx, { kind: "arrow", style: { title_rotation: 50 } }), 0, "a label riding its line stays upright");
  assert.ok(body("_renderPointLabel").includes("tbox.deg = (tbox.deg || 0) + lRot;"));
  assert.ok(body("_renderPointLabel").includes("var nc = this._rotatePoint(lc, sc.x, sc.y, lRot);"), "an aligned label travels round with its box");
  assert.ok(body("_startRotateDrag").includes("title_rotation:"), "the knob turns a point shape's label along");
}

// eslint-disable-next-line no-unused-vars
var ROTATE_KNOB_PX = Number(src.match(/var ROTATE_KNOB_PX = (\d+);/)[1]);

// A dimension is not turned by a knob; a line and an arrow are, by a knob
// set straight out from the middle of the line — not above the top of its
// bounding box, which on a diagonal is far off in the empty corner.
{
  assert.ok(!ctx._canRotate({ kind: "dimension" }), "a dimension has no knob");
  assert.ok(ctx._canRotate({ kind: "line" }) && ctx._canRotate({ kind: "arrow" }));

  const kctx = {
    _shaftPointAt: fn("_shaftPointAt"), _arrowRoute: fn("_arrowRoute"), _arrowPath: fn("_arrowPath"),
    _imageToContainer: (p) => ({ x: p.x, y: p.y })
  };
  const place = (a, b) => fn("_shaftKnobPlace").call(kctx, { kind: "line", geometry: { a, b } });
  const dist = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);

  const diag = place([100, 400], [400, 100]);
  near(diag.from.x, 250, "from the middle x"); near(diag.from.y, 250, "from the middle y");
  near(dist(diag.from, diag.knob), ROTATE_KNOB_PX, "the usual distance, not the box's height");
  near((diag.knob.x - 250) * 300 + (diag.knob.y - 250) * -300, 0, "square to the line");
  assert.ok(diag.knob.y < 250, "on the side facing up");

  const flat = place([100, 200], [500, 200]);
  near(flat.knob.x, 300, "a level line: over its middle"); near(flat.knob.y, 200 - ROTATE_KNOB_PX, "just above it");
  const reversed = place([500, 200], [100, 200]);
  near(reversed.knob.y, 200 - ROTATE_KNOB_PX, "drawn right to left, still above");
  const upright = place([300, 100], [300, 500]);
  assert.ok(upright.knob.x > 300 && Math.abs(upright.knob.y - 300) < 1e-9, "a vertical line: to the right");
  assert.strictEqual(place([10, 10], [10, 10]), null, "no length, no place");
}

console.log("rotation + scale dot: all checks passed");
