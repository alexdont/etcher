// Pins the text tool's drag-to-size.
//
// A drawn box is a size request: small box, small text; big box, big
// text — the way every drawing program's text tool works. The drawn
// height pins the font (the box-drives-font 0.65, in image units), and
// that pin beats the remembered label-size default, which otherwise made
// every new text the same size no matter what was dragged. A plain click
// keeps the default: nothing was asked.
//
//   node test/js/text_drag_size_test.js

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

for (const [g, v] of [["FONT_SIZE_MIN", /var FONT_SIZE_MIN = (\d+)/],
                      ["FONT_SIZE_MAX", /var FONT_SIZE_MAX = (\d+)/]]) {
  const m = src.match(v);
  assert.ok(m, `could not find ${g}`);
  global[g] = Number(m[1]);
}

const commitText = extract("_commitText");

function commit(anchor, pt, over) {
  const finalized = [];
  const self = Object.assign({
    draftState: { anchor, el: { classList: { remove() {} } } },
    _textDefaultBoxImagePx: () => 20,
    _textDefaultBoxInkPx: () => 20,
    _markerScale: () => 1,
    _renderShape() {},
    _startTextEdit() {},
    _finalizeShape(kind, geom, el, cb) {
      const shape = { kind, geometry: geom, style: {} };
      finalized.push(shape);
      cb(shape);
    },
  }, over || {});
  commitText.call(self, pt);
  return finalized[0];
}

// ── a drawn box pins the font from its height ─────────────────────────────

{
  const big = commit({ x: 0, y: 0 }, { x: 300, y: 100 });
  assert.ok(Math.abs(big.style.font_size - 65) < 0.001,
    "a 100px-tall box asks for 65px text — the box-drives-font 0.65");

  const small = commit({ x: 0, y: 0 }, { x: 120, y: 30 });
  assert.ok(Math.abs(small.style.font_size - 19.5) < 0.001,
    "a smaller box asks for smaller text");

  assert.ok(big.style.font_size > small.style.font_size,
    "big box, bigger text; small box, smaller text");
}

// ── a plain click asks for nothing ────────────────────────────────────────

{
  const clicked = commit({ x: 50, y: 50 }, { x: 52, y: 51 });
  assert.strictEqual(clicked.style.font_size, undefined,
    "no box was drawn, so the remembered default (or the box rule) stands");
  assert.ok(clicked.geometry.w > 2 && clicked.geometry.h > 2,
    "…and the click still gets the usable minimum box, as before");
}

// ── the pin respects the same clamps as the panel's input ─────────────────

{
  const huge = commit({ x: 0, y: 0 }, { x: 900, y: 600 });
  assert.strictEqual(huge.style.font_size, global.FONT_SIZE_MAX,
    "a wall-sized box clamps to the same max the Label size input has");
}

console.log("text drag size: all checks passed");
