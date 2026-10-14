// Pins the text box's corners: four shapes (rounded, straight cut, concave,
// notched), a reach stored in canvas units so resizing the box never grows
// them, and padding that keeps the words inside however deep they bite.
//
//   node test/js/textbox_corners_test.js

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
const TEXTBOX_CORNERS = JSON.parse(src.match(/var TEXTBOX_CORNERS = (\[[^\]]+\]);/)[1]);
const TEXTBOX_CORNER_INSET = { round: 1 - Math.SQRT1_2, chamfer: 0.5, concave: Math.SQRT1_2, notch: 1 };
assert.ok(src.includes("var TEXTBOX_CORNER_INSET = { round: 1 - Math.SQRT1_2, chamfer: 0.5, concave: Math.SQRT1_2, notch: 1 };"));
const make = (n) => new Function("TEXTBOX_CORNERS", "TEXTBOX_CORNER_INSET", "return " + body(n))(TEXTBOX_CORNERS, TEXTBOX_CORNER_INSET);
const corner = make("_textboxCorner");
const padPx = make("_textboxPadPx");
const cornerPath = make("_cornerPath");

assert.deepStrictEqual(TEXTBOX_CORNERS, ["round", "chamfer", "concave", "notch"]);

// At 2 container px per canvas unit.
const ctx = { _markerScale: () => 2, _textboxCorner: corner };
const box = (style) => ({ kind: "text", style: Object.assign({ box: "fixed" }, style) });

assert.deepStrictEqual(corner.call(ctx, box({}), 200, 100), { type: "round", r: 0 }, "sharp by default");
assert.deepStrictEqual(corner.call(ctx, box({ corner: "notch", corner_size: 10 }), 200, 100), { type: "notch", r: 20 },
  "canvas units times the zoom");
assert.strictEqual(corner.call(ctx, box({ corner_size: 10 }), 400, 300).r, 20,
  "a bigger box keeps the same corners — they never grow with it");
assert.strictEqual(corner.call(ctx, box({ corner_size: 100 }), 200, 60).r, 30, "never past half the shorter side");
assert.strictEqual(corner.call(ctx, box({ corner: "bogus", corner_size: 5 }), 200, 100).type, "round");

// Padding: the usual pad until the corners would cut into the words.
assert.strictEqual(padPx.call(ctx, box({}), 8, 200, 100), 8, "sharp: just the pad");
assert.strictEqual(padPx.call(ctx, box({ corner: "round", corner_size: 2 }), 8, 200, 100), 8,
  "a slight rounding needs nothing more");
const deep = (type) => padPx.call(ctx, box({ corner: type, corner_size: 20 }), 8, 200, 100); // r = 40
assert.ok(Math.abs(deep("round") - (40 * (1 - Math.SQRT1_2) + 4)) < 1e-9);
assert.strictEqual(deep("chamfer"), 24);
assert.ok(Math.abs(deep("concave") - (40 * Math.SQRT1_2 + 4)) < 1e-9);
assert.strictEqual(deep("notch"), 44);
// The inset puts the text box's corner inside every cut.
for (const type of TEXTBOX_CORNERS) {
  const r = 40, d = deep(type);
  const inside = {
    round: Math.hypot(r - d, r - d) <= r,
    chamfer: d + d >= r,
    concave: Math.hypot(d, d) >= r,
    notch: d >= r
  }[type];
  assert.ok(inside, `${type}: the words' corner clears the cut`);
}

// The outline.
assert.strictEqual(cornerPath(0, 0, 100, 50, "round", 0), "M0 0H100V50H0Z", "sharp is a plain box");
assert.ok(cornerPath(0, 0, 100, 50, "round", 10).includes("A10 10 0 0 1 100 10"), "rounded bulges out");
assert.ok(cornerPath(0, 0, 100, 50, "concave", 10).includes("A10 10 0 0 0 100 10"), "concave scoops in");
assert.strictEqual(cornerPath(0, 0, 100, 50, "chamfer", 10),
  "M10 0H90L100 10V40L90 50H10L0 40V10Z", "straight cuts across");
assert.strictEqual(cornerPath(0, 0, 100, 50, "notch", 10),
  "M10 0H90V10H100V40H90V50H10V40H0V10H10Z", "notched bites out a square");

// Wiring.
const render = src.slice(src.indexOf('        case "text": {'), src.indexOf('        case "dimension": {'));
assert.ok(render.includes("if (self._textboxFixed(shape)) pad = self._textboxPadPx(shape, pad, tw, th);"),
  "the render pads by the corners");
assert.ok(body("_startTextEdit").includes("if (fixedEd) edPad = this._textboxPadPx(shape, edPad, w, h);"),
  "and so does the editor, so typing wraps where the result will");
assert.ok(src.includes("corner: cornerDef.corner,") && body("_textboxCornerDefaults").includes(': 0'),
  "new boxes are sharp unless the user chose otherwise");
assert.ok(body("_syncParamsPopup").includes("this._syncCornerRows();"), "the panel shows the corner controls");

assert.ok(/if \(!\(shape\.style && shape\.style\.corner_size > 0\)\) \{\s*patch\.corner_size = TEXTBOX_CORNER_PICK \/ self\._inkScale\(\);/.test(body("_setTextboxCorner")),
  "picking a type on a sharp box gives it corners you can see");

assert.ok(src.includes('["sharp"].concat(TEXTBOX_CORNERS).map(function(type) {'), "Sharp is a button of its own, first");
assert.ok(body("_syncCornerRows").includes('var shown = px > 0 ? type : "sharp";'), "and lights whenever there are no corners");

console.log("text box corners: all checks passed");
