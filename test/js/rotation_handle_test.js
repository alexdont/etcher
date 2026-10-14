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

console.log("rotation + scale dot: all checks passed");
