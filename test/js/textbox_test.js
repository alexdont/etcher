// The text box tool: a box the user draws ONCE, that stays the size they
// drew it. The text wraps and sizes inside it (Label size in the panel);
// typing more or picking a bigger font never moves the walls, and
// dragging the corners resizes the box without touching the font. The
// plate and colour controls are the label's own — on the wire it IS a
// `text` shape, just with `style.box: "fixed"`, so every consumer stores
// and bakes it with no schema change.
//
//   node test/js/textbox_test.js

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
  assert.notStrictEqual(end, -1, `could not find the end of ${name}`);
  return eval(
    "(" +
      src.slice(start, end + "\n    }".length).replace(`${name}: function`, "function") +
      ")"
  );
}

// ── the tool exists, draws through the text machinery, and flags itself ──

{
  assert.ok(/textbox:\s*\{ icon: ICONS\.textbox,/.test(src),
    "textbox is a tool of its own in TOOL_DEFS");
  assert.ok(src.includes('case "textbox":   this._startText(pt, e, true); break;'),
    "the tool draws through the text draft, flagged fixed");
  assert.ok(src.includes("var fixedBox = !!this.draftState.fixedBox;"),
    "the commit reads the flag off the DRAFT — the commit switch keys on the " +
    "draft kind, which is \"text\" for both tools, so a parameter never arrives");
  assert.ok(/box: "fixed",\s*font_size: self\._defaultLabelFontSize\(\) \/ self\._inkScale\(\)/.test(src),
    "a committed text box pins the default label size and carries the flag in style " +
    "— plain style data, so the wire format and every consumer are untouched");
}

// ── _textboxFixed: the one question everything else asks ─────────────────

const textboxFixed = lift("_textboxFixed", "shape");

{
  assert.ok(textboxFixed({ style: { box: "fixed" } }), "committed flag rides style");
  assert.ok(textboxFixed({ fixedBox: true }), "a draft has no style yet — its own flag");
  assert.ok(!textboxFixed({ style: {} }), "a plain text shape is not a box");
  assert.ok(!textboxFixed(null));
}

// ── the box is the user's: render keeps the walls ────────────────────────

{
  const render = src.slice(src.indexOf('        case "text": {'),
                           src.indexOf('        case "dimension": {'));
  assert.ok(render.includes("if (self._textboxFixed(shape)) {"),
    "the text render branches on the flag");
  const fixed = render.slice(render.indexOf("if (self._textboxFixed(shape)) {"),
                             render.indexOf("} else {", render.indexOf("if (self._textboxFixed(shape)) {")));
  assert.ok(fixed.includes("shape._renderedBox = null;"),
    "a fixed box exposes its storage geometry — handles, editor and hit-tests all work the drawn box");
  assert.ok(!fixed.includes("actualW"),
    "…and never shrink-wraps to the measured text");
  assert.ok(fixed.includes("self._applyLabelBg(trect, shape);"),
    "the plate (background on/off + colour) still applies — transparency is the label's own control");
}

// ── the corners always show, and resize the box without touching the font ─

const handlePositions = lift("_handlePositions", "shape");

{
  const fixedShape = {
    kind: "text", style: { box: "fixed" },
    geometry: { x: 10, y: 20, w: 200, h: 100 }
  };
  const ctx = { _titleHandlesOn: () => false, _textboxFixed: textboxFixed };
  const dots = handlePositions.call(ctx, fixedShape);
  assert.strictEqual(dots.length, 4,
    "a text box's corners are the only way to resize it — they show without the ⋯ opt-in");
  assert.deepStrictEqual(dots[2], { x: 210, y: 120 });

  const plain = { kind: "text", style: {}, geometry: { x: 0, y: 0, w: 50, h: 20 } };
  assert.strictEqual(handlePositions.call(ctx, plain).length, 0,
    "a plain text label keeps its corners behind the opt-in, as before");
}

{
  assert.ok(/if \(shape\.kind === "text" && !this\._textboxFixed\(shape\)\) \{\s*this\._unpinFontSize\(shape\);/.test(src),
    "a corner drag re-derives a plain text's font but leaves a text box's alone — " +
    "the box and the font never derive from each other");
}

// ── the editor is the box: WYSIWYG while typing ──────────────────────────
//
// Reported from the field: the committed render wrapped beautifully, but
// TYPING showed one endless unwrapped line — the single-line editor every
// label uses. A text box's editor wraps inside the walls instead, and the
// walls never move with the text.

{
  const ed = src.slice(src.indexOf("    _startTextEdit: function"),
                       src.indexOf("    _repositionTextEditor: function"));
  assert.ok(/var fixedEd = this\._textboxFixed\(shape\);\s*if \(fixedEd\) \{\s*input\.wrap = "soft";\s*input\.style\.whiteSpace = "pre-wrap";/.test(ed),
    "the box's editor wraps while typing — soft wrap, pre-wrap — like the committed render");
  assert.ok(/if \(fixedEd\) \{\s*var gF = selfEd\._textEditBoxImage\(shape\);[\s\S]{0,500}?return;\s*\}\s*var linesEd/.test(ed),
    "and its fit pins the editor to the shape's own box (recomputed per fit, " +
    "so pan/zoom mid-edit tracks) instead of growing it around the text");
}

// ── same-tool editing covers the family ──────────────────────────────────

{
  const armedToolEdits = lift("_armedToolEdits", "shape");
  const box = { kind: "text", uuid: "b1", style: { box: "fixed" } };
  assert.ok(armedToolEdits.call({ activeTool: "textbox", _armedToolEdits: armedToolEdits }, box),
    "the textbox tool grabs text shapes");
  assert.ok(armedToolEdits.call({ activeTool: "text", _armedToolEdits: armedToolEdits }, box),
    "and so does the text tool — one family");
  assert.ok(!armedToolEdits.call({ activeTool: "rectangle", _armedToolEdits: armedToolEdits }, box));
}

console.log("textbox: all checks passed");
