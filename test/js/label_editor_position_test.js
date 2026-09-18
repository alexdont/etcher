// Pins where the label editor opens when a shape is double-clicked.
//
// A brand-new label lands CENTERED in its shape (`_commitTextEdit` stamps
// center/middle at creation), but the editor used to open at the
// float-above default — you typed above the rectangle and the text then
// jumped into the middle on commit. The editor now opens where the label
// will land. Only for label-less shapes: an existing label keeps its
// editor wherever the label actually is, and host-supplied labels keep
// their float-above default.
//
//   node test/js/label_editor_position_test.js

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

// The real module-level alignedBox, so the editor's centering and the
// committed label's centering can't disagree.
{
  const start = src.indexOf("  function alignedBox(bbox, size, align) {");
  assert.notStrictEqual(start, -1, "could not find alignedBox");
  const end = src.indexOf("\n  }", start);
  global.alignedBox = eval("(" + src.slice(start, end + "\n  }".length)
    .replace("function alignedBox", "function") + ")");
}

const startTextEdit = extract("_startTextEdit");
const ridesShaft = extract("_labelRidesShaft");

// Drive _startTextEdit far enough to capture the editor box: the
// foreignObject is created from `g` via _imageToContainer — record the
// corners it converts.
function editorBoxFor(shape, floatingBox) {
  const converted = [];
  const noop = () => {};
  global.svgEl = (tag, attrs) => ({
    tag, attrs: attrs || {}, style: {},
    classList: { add: noop },
    appendChild: noop, setAttribute: noop, remove: noop
  });
  global.document = {
    createElement: () => ({
      style: {}, addEventListener: noop, focus: noop, select: noop,
      setSelectionRange: noop
    })
  };
  const ctx = {
    // The real anchor-box computation, lifted: _startTextEdit delegates
    // to it so the open editor can be re-anchored per frame.
    _textEditBoxImage: extract("_textEditBoxImage"),
    _shaftPointAt: () => ({ x: 150, y: 120 }),
    _textDefaultBoxInkPx: () => 16,
    _labelRidesShaft: ridesShaft,
    _isTextKind: (k) => k === "text" || k === "callout",
    _hasPinnedFontSize: (s) => !!(s && s.style && s.style.font_size > 0),
    _defaultLabelFontSize: () => 16,
    _inkScale: () => 1,
    _endTextEdit: noop,
    _calloutTextBoxImage: (g) => g.text_box,
    _textDefaultBoxImagePx: () => 16,
    _shapeTitleBoxImage: () => Object.assign({}, floatingBox),
    _lastBboxTopImageFor: () => ({ x: 150, y: 100 }),
    _shapeBBoxImagePx: () => ({ x: 100, y: 100, w: 100, h: 80 }),
    _imageToContainer: (p) => { converted.push(p); return p; },
    _textEditHost: () => null,
    svg: { appendChild: noop }
  };
  try { startTextEdit.call(ctx, shape); } catch (_) {
    // The tail of _startTextEdit touches editor plumbing this stub does
    // not model; the corners are converted before it gets there.
  }
  delete global.document;
  delete global.svgEl;
  assert.ok(converted.length >= 2,
    "the editor box was never positioned — _startTextEdit bailed before converting corners");
  return { tl: converted[0], br: converted[1] };
}

const FLOATING = { x: 102, y: 60, w: 96, h: 22 }; // the float-above default

// ── no label yet → the editor opens centered in the shape ───────────────────

{
  const { tl, br } = editorBoxFor({ kind: "rectangle", metadata: null }, FLOATING);
  // Shape bbox center is (150, 140); the 96×22 editor centered there spans
  // x 102..198, y 129..151.
  assert.deepStrictEqual(tl, { x: 102, y: 129 },
    "a label-less shape's editor should open centered in the shape, not floating above it");
  assert.strictEqual(br.y, 151, "editor bottom edge should sit below the shape's vertical center");
}

// ── an existing label keeps its editor where the label is ───────────────────

{
  const { tl } = editorBoxFor(
    { kind: "rectangle", metadata: { title: "existing" } }, FLOATING);
  assert.deepStrictEqual(tl, { x: 102, y: 60 },
    "an existing label's editor must open where the label actually is — not get re-centered");
}

// ── whitespace-only titles count as no label ────────────────────────────────

{
  const { tl } = editorBoxFor({ kind: "rectangle", metadata: { title: "  " } }, FLOATING);
  assert.strictEqual(tl.y, 129,
    "a whitespace-only title is not a label — the editor should still center");
}

console.log("label editor position: all checks passed");


// ── click-away commits the label ────────────────────────────────────────────
//
// Enter and click-away are equal commits. The blur listener alone never
// covered click-away: canvas pointer handlers preventDefault, which
// suppresses the focus change, so a click on the board left the typed
// label uncommitted. A capture-phase document pointerdown commits first;
// the click then goes on to deselect / draw / select as usual.

assert.ok(
  src.includes('document.addEventListener("pointerdown", self._textEditOutsideDown, true);'),
  "opening the editor wires a capture-phase outside-pointerdown"
);
assert.ok(
  src.includes('document.removeEventListener("pointerdown", this._textEditOutsideDown, true);'),
  "ending the edit unwires it (commit, cancel and restart all funnel through _endTextEdit)"
);
{
  const handler = src.slice(
    src.indexOf("self._textEditOutsideDown = function(e) {"),
    src.indexOf('document.addEventListener("pointerdown", self._textEditOutsideDown, true);')
  );
  assert.ok(
    handler.includes("self._commitTextEdit();") &&
      handler.includes("e.target === input") &&
      handler.includes("fo.contains(e.target)"),
    "a pointerdown outside the input commits; inside the editor it does nothing"
  );
}
{
  // The teardown site is _endTextEdit itself, so no editor exit path can
  // leave the document listener behind — including hook destroy.
  const end = src.slice(
    src.indexOf("_endTextEdit: function() {"),
    src.indexOf("_textEditHost: function(shape)")
  );
  assert.ok(
    end.includes("this._textEditOutsideDown = null;"),
    "_endTextEdit clears the outside-pointerdown listener"
  );
  const destroyed = src.slice(
    src.indexOf("destroyed: function() {"),
    src.indexOf("_unwireImagePaste();", src.indexOf("destroyed: function() {"))
  );
  assert.ok(
    destroyed.includes("this._endTextEdit();"),
    "hook destroy ends an open edit so the listener can't leak"
  );
}

// ── the open editor follows the board ─────────────────────────────────────

{
  // The editor's box is positioned in CONTAINER px, and the board moves
  // underneath it on every pan/zoom frame. Without re-anchoring, the text
  // being typed slid off its line — measured at 269px off after one zoom
  // step, 385 after two — and only snapped into place on commit.
  const reposition = extract("_repositionTextEditor");

  let scale = 1;
  const anchors = [];
  const fits = [];
  const ed = {
    shape: { kind: "dimension", geometry: { a: [0, 0], b: [200, 0] }, style: {}, metadata: {} },
    fo: {},
    input: { style: { fontSize: "16px", padding: "2px" } },
    setAnchor: (cx, cy, left) => anchors.push([cx, cy, left]),
    setFontSize: (s) => fits.push(["size", s]),
    setPad: (p) => fits.push(["pad", +p.toFixed(2)]),
    fit: () => fits.push(["fit"]),
  };
  const ctx = {
    _textEditor: ed,
    _textEditBoxImage: () => ({ x: 80, y: 40, w: 40, h: 20 }),
    // A zoom is a different image→container mapping, nothing else.
    _imageToContainer: (p) => ({ x: p.x * scale, y: p.y * scale }),
    _textEditHost: () => null,
    _hasPinnedFontSize: () => true,
    _fontSizeFor: (_s, fallback) => 16 * scale,
  };

  reposition.call(ctx);
  assert.deepStrictEqual(anchors[0], [100, 50, 80],
    "the editor anchors on the label's box, centre and left edge");

  scale = 2;
  reposition.call(ctx);
  assert.deepStrictEqual(anchors[1], [200, 100, 160],
    "…and follows the board when the zoom changes");

  assert.ok(fits.some((f) => f[0] === "size" && f[1] === 32),
    "the typed text tracks the label's own size through the zoom");
  assert.ok(fits.some((f) => f[0] === "pad" && f[1] === 6.4),
    "…and its padding, so the editor keeps the label's proportions");
  assert.strictEqual(fits[fits.length - 1][0], "fit",
    "the re-fit runs last, measuring at the metrics just set");

  // Nothing open, nothing to move — and no throw.
  reposition.call({ _textEditor: null });
  reposition.call({ _textEditor: { shape: null } });
}

// ── and the per-frame render is what drives it ────────────────────────────

{
  const renderAll = src.slice(src.indexOf("    _renderAll: function() {"),
                              src.indexOf("\n    },", src.indexOf("    _renderAll: function() {")));
  assert.ok(renderAll.includes("if (this._textEditor) this._repositionTextEditor();"),
    "_renderAll must re-anchor the editor like it re-glues handles and dots");
}
