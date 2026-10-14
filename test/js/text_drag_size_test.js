// Pins the text tool's drag-to-size.
//
// A drawn box is a size request: small box, small text; big box, big
// text — the way every drawing program's text tool works. The drawn
// height pins the font (the box-drives-font 0.65, in image units), and
// that pin beats the remembered label-size default, which otherwise made
// every new text the same size no matter what was dragged. A plain click
// starts text at the default label size, centred on the click. Either way
// the result is point text, selected and being typed into.
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
global.NEW_TEXT_MIN_SCREEN_PX = Number(src.match(/var NEW_TEXT_MIN_SCREEN_PX = (\d+);/)[1]);
const newTextBoxPx = extract("_newTextBoxPx");

function commit(anchor, pt, over) {
  const finalized = [];
  const self = Object.assign({
    draftState: { anchor, el: { classList: { remove() {} } } },
    _textDefaultBoxImagePx: () => 20,
    _textDefaultBoxInkPx: () => 20,
    // The real one: ink-sized, floored at what can be read on the glass.
    // At 1:1 (this stub's zoom) the floor does not bite and it is the ink
    // size, which is what every case below assumes.
    _newTextBoxPx: newTextBoxPx,
    _markerScale: () => 1,
    _defaultLabelFontSize: () => 16,
    _textboxCornerDefaults: () => ({ corner: "round", size: 0 }),
    _inkScale: () => 1,
    _renderShape() {},
    _enterEditMode(shape) { shape._selected = true; shape._guarded = this._suppressEditDismissUntil > Date.now(); },
    _startTextEdit(shape) { shape._typing = true; },
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

// ── a plain click starts default-size text where it landed ───────────────

{
  const clicked = commit({ x: 50, y: 50 }, { x: 50, y: 50 });
  assert.strictEqual(clicked.style.font_size, 16,
    "no box was drawn: the default label size");
  assert.strictEqual(clicked.style.point, true, "point text");
  // Zoomed far out, the default would be a few pixels on the glass: it
  // is floored at 12 screen px (3/4 of NEW_TEXT_MIN_SCREEN_PX).
  const far = commit({ x: 50, y: 50 }, { x: 50, y: 50 }, { _markerScale: () => 0.25 });
  assert.strictEqual(far.style.font_size, 48, "12 px on screen at a quarter zoom");
  // The middle of the first line (pad 0.2em, line box 1.4em) on the click.
  assert.ok(Math.abs(clicked.geometry.x - (50 - 16 * 0.2)) < 1e-9);
  assert.ok(Math.abs(clicked.geometry.y - (50 - 16 * 0.7)) < 1e-9);
}

// ── either way it is point text, selected AND being typed into ───────────

{
  const drawn = commit({ x: 0, y: 0 }, { x: 300, y: 100 });
  assert.strictEqual(drawn.style.point, true);
  assert.ok(drawn._selected, "its eight handles are up while typing");
  // The click a drag ends with lands at its far corner, off the new text;
  // without the guard it read as "clicked away" and dropped the selection.
  assert.ok(drawn._guarded, "selected under the dismiss guard, so the drag's own click does not unselect it");
  assert.ok(drawn._typing, "and the caret is in it");
  assert.deepStrictEqual([drawn.geometry.x, drawn.geometry.y], [0, 0],
    "a drawn text starts at the drag's top-left");
}

// ── the pin respects the same clamps as the panel's input ─────────────────

{
  const huge = commit({ x: 0, y: 0 }, { x: 900, y: 600 });
  assert.strictEqual(huge.style.font_size, global.FONT_SIZE_MAX,
    "a wall-sized box clamps to the same max the Label size input has");
}

console.log("text drag size: all checks passed");
