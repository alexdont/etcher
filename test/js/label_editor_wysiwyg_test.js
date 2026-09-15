// Pins the label editor's WYSIWYG dress.
//
// The editor used to be a white box with a dashed border and 14px black
// text — nothing like what commit would draw, so every edit was typed
// blind into a form control. The input now wears exactly what the
// rendered label wears: its font at its rendered size, its own ink, its
// plate (or nothing) behind it, centred where the committed text will
// centre, shrinking as you type past the box the way the render's
// width-fit cap does.
//
//   node test/js/label_editor_wysiwyg_test.js

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

const startTextEdit = extract("_startTextEdit");
const ridesShaft = extract("_labelRidesShaft");

{
  const m = src.match(/var LABEL_BG_RADIUS_RATIO = ([\d.]+);/);
  global.LABEL_BG_RADIUS_RATIO = Number(m[1]);
}
global.normalizeTitleAlign = (a) => (a && a.h ? a : null);
global.alignedBox = (bbox, size) => ({
  x: bbox.x + (bbox.w - size.w) / 2, y: bbox.y + (bbox.h - size.h) / 2,
  w: size.w, h: size.h,
});

// Drive _startTextEdit and capture the input it dresses.
function edit(shape, opts) {
  opts = opts || {};
  const noop = () => {};
  let input = null;
  let fo = null;
  global.svgEl = (tag) => {
    const el = {
      tag, style: {}, attrs: {}, classList: { add: noop },
      appendChild: noop, remove: noop,
      setAttribute(k, v) { this.attrs[k] = v; },
    };
    if (tag === "foreignObject") fo = el;
    return el;
  };
  global.document = {
    createElement: () => {
      input = {
        style: {}, listeners: {},
        addEventListener(n, fn) { this.listeners[n] = fn; },
        focus: noop, select: noop, setSelectionRange: noop,
      };
      return input;
    },
  };
  const renderedText = opts.renderedFontSize != null
    ? { getAttribute: (k) => (k === "font-size" ? String(opts.renderedFontSize) : null) }
    : null;
  const ctx = {
    _endTextEdit: noop,
    _labelRidesShaft: ridesShaft,
    _calloutTextBoxImage: (g) => g,
    _textDefaultBoxImagePx: () => 16,
    _shapeTitleBoxImage: () => ({ x: 100, y: 100, w: 200, h: 40 }),
    _shaftPointAt: () => ({ x: 150, y: 120 }),
    _lastBboxTopImageFor: () => ({ x: 150, y: 100 }),
    _shapeBBoxImagePx: () => ({ x: 100, y: 100, w: 200, h: 100 }),
    _imageToContainer: (p) => p,
    _textEditHost: () => ({ querySelector: () => renderedText }),
    _fontSizeFor: (s, base) => base,
    _titleColorFor: () => opts.color || "#fca5a5",
    _labelBgFor: () => opts.bg || null,
    _hasPinnedFontSize: () => !!opts.pinned,
    _zoomPx: (n) => n,
    // Width proportional to length: 10px per character at font 20.
    _measureTextWidth: (t, size) => t.length * size * 0.5,
    svg: { appendChild: noop },
  };
  try { startTextEdit.call(ctx, shape); } catch (_) {
    // editor plumbing past the styling is not modelled
  }
  delete global.document;
  delete global.svgEl;
  assert.ok(input, "no input was built");
  input.fo = fo;
  return input;
}

// ── the input wears the label's own dress ─────────────────────────────────

{
  const input = edit(
    { kind: "rectangle", metadata: { title: "hello" } },
    { renderedFontSize: 26, color: "#d8b4fe" }
  );
  assert.ok(input.style.font.startsWith("500 26px"),
    "the rendered label's exact font size, not a hardcoded 14px");
  assert.strictEqual(input.style.color, "#d8b4fe", "the label's own ink");
  assert.strictEqual(input.style.caretColor, "#d8b4fe", "caret included");
  assert.strictEqual(input.style.background, "transparent",
    "no plate on the label, no white box on the editor");
  assert.strictEqual(input.style.border, "none", "no dashed chrome");
}

{
  const input = edit(
    { kind: "rectangle", metadata: { title: "hi" } },
    { renderedFontSize: 20, bg: "#86efac" }
  );
  assert.strictEqual(input.style.background, "#86efac",
    "a plated label edits on its plate");
  assert.ok(input.style.borderRadius, "…with the plate's rounded corners");
}

// ── typing grows from where the committed text will sit ───────────────────

{
  const fresh = edit({ kind: "rectangle", metadata: null }, {});
  assert.strictEqual(fresh.style.textAlign, "center",
    "a fresh label commits centred, so typing is centred");
  const rider = edit({ kind: "arrow", geometry: { a: [0, 0], b: [10, 10] },
    metadata: { title: "x", title_box: { x: 0, y: 0, w: 40, h: 20 } } }, { renderedFontSize: 18 });
  assert.strictEqual(rider.style.textAlign, "center",
    "a shaft-rider's label is centred on its line");
  const boxed = edit({ kind: "rectangle",
    metadata: { title: "x", title_box: { x: 0, y: 0, w: 40, h: 20 } } }, { renderedFontSize: 18 });
  assert.strictEqual(boxed.style.textAlign, "left",
    "a stored-box label renders left-anchored, so it edits left-anchored");
}

// ── the box hugs the text, live — no caps, no wrap ────────────────────────

{
  // Short text: the box shrink-wraps to text + the render's padding and
  // stays centred on its anchor — editing IS the label, not a field.
  const input = edit({ kind: "rectangle", metadata: null }, { renderedFontSize: 20 });
  assert.ok(input.listeners.input, "the editor re-fits as the user types");
  input.value = "hi";
  input.listeners.input();
  const hugW = parseFloat(input.fo.attrs.width);
  assert.ok(hugW < 200, "the box hugs short text instead of gaping around it");
  const x = parseFloat(input.fo.attrs.x);
  assert.ok(Math.abs((x + hugW / 2) - 200) < 1,
    "and resizes about its centre anchor (box centre stays put)");

  // Long text: the box GROWS and the font HOLDS. The old cap shrank the
  // font to fit the box — "more text, smaller text", which read as crazy.
  input.value = "a very long label that would once have shrunk the font";
  input.listeners.input();
  assert.strictEqual(parseFloat(input.style.fontSize) || 20, 20,
    "the chosen size is the size — more text never means smaller text");
  assert.ok(parseFloat(input.fo.attrs.width) > 200,
    "…the box grows to hold it instead");
}

{
  // Shift+Enter lines: each one adds exactly one line of height, and the
  // width follows the WIDEST line — multi-line is the author's lines,
  // never a wrap's.
  const input = edit({ kind: "rectangle", metadata: null }, { renderedFontSize: 20 });
  input.value = "first";
  input.listeners.input();
  const oneLineH = parseFloat(input.fo.attrs.height);
  input.value = "first\nsecond line is wider";
  input.listeners.input();
  const twoLineH = parseFloat(input.fo.attrs.height);
  assert.ok(Math.abs((twoLineH - oneLineH) - 20 * 1.1) < 0.001,
    "a second line adds exactly one 1.1em line, matching the render");
  const wWide = parseFloat(input.fo.attrs.width);
  input.value = "second line is wider";
  input.listeners.input();
  assert.strictEqual(parseFloat(input.fo.attrs.width), wWide,
    "the box width is the widest line's width");
}

// ── the source keeps the contracts the fakes can't reach ──────────────────

{
  assert.ok(src.includes('document.createElement("textarea")'),
    "the editor is a textarea — an input cannot hold the author's newline");
  assert.ok(/if \(e\.shiftKey\) return;/.test(src),
    "Shift+Enter falls through to insert the line; Enter alone commits");
  const titleRender = src.slice(src.indexOf("_renderTitleSibling: function"));
  assert.ok(titleRender.includes("textEl, trimmed, Infinity, fontSize"),
    "the title render never wraps — multi-line is the author's newlines");
  assert.ok(!src.includes("widthAtHeightFont > availWidth"),
    "and never caps the font to the box");
}

console.log("label editor wysiwyg: all checks passed");
