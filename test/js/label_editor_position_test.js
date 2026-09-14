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
