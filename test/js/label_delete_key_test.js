// Pins the Delete key against a focused label.
//
// Delete removed the selected shape, the edit-mode shape, even a scoped
// polygon vertex — but a focused LABEL fell through every one of those
// checks and the key did nothing. Clicking a label clears the shape
// selection on its way into title-edit mode, so the states are mutually
// exclusive and the label needs its own branch.
//
//   node test/js/label_delete_key_test.js

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

const wire = extract("_wireUndoKeyboard");

// Wire the handler against a stub board and return a Delete-key driver.
function board(over) {
  const self = Object.assign({
    annotationMode: true,
    editingTitleShape: null,
    editingShape: null,
    selectedShapes: [],
    selectedVertexIndices: null,
    deleted: [],
    undos: [],
    exited: 0,
    rendered: [],
    _isTextKind: (k) => k === "text" || k === "callout" || k === "dimension",
    _exitTitleEditMode() { this.exited++; this.editingTitleShape = null; },
    _deleteShape(s) { this.deleted.push(s); },
    _deleteSelectedShapes() { this.deleted.push(...this.selectedShapes); },
    _deleteSelectedVertex: () => false,
    _snapshotShape: (s) => JSON.parse(JSON.stringify(s || {})),
    _renderShape(s) { this.rendered.push(s); },
    _pushUndo(uuid, b, a) { this.undos.push({ uuid, b, a }); },
    _emitChanged() { this.emitted = (this.emitted || 0) + 1; },
  }, over || {});
  global.document = { addEventListener: () => {} };
  global.window = { addEventListener: () => {} };
  wire.call(self);
  delete global.document;
  delete global.window;
  const key = (k, target) => {
    const e = { key: k, target: target || null, prevented: 0,
      preventDefault() { this.prevented++; } };
    self._undoKeyHandler(e);
    return e;
  };
  return { self, key };
}

// ── Delete on a focused label clears the label, keeps the shape ───────────

{
  const arrow = { uuid: "a", kind: "arrow", metadata: {
    title: "hello", title_offset: 0.3, title_color: "#ff0000",
    title_box: { x: 1, y: 2, w: 3, h: 4 } } };
  const { self, key } = board({ editingTitleShape: arrow });

  const e = key("Delete");
  assert.strictEqual(e.prevented, 1, "the key is consumed, not left to the page");
  assert.strictEqual(arrow.metadata.title, "", "the label text is gone");
  for (const k of ["title_box", "title_align", "title_offset", "title_color"]) {
    assert.ok(!arrow.metadata[k], `${k} goes with it — a deleted label must not haunt the next one`);
  }
  assert.deepStrictEqual(self.deleted, [], "the arrow itself survives");
  assert.strictEqual(self.exited, 1, "title-edit mode ends — its handles have nothing to hold");
  assert.strictEqual(self.undos.length, 1, "one undo entry for the lot");
  assert.strictEqual(self.undos[0].b.metadata.title, "hello", "…that can bring the label back");
  assert.strictEqual(self.emitted, 1, "and the change persists");
  assert.ok(self.rendered.includes(arrow), "re-rendered so the label disappears now");
}

// ── on a text-kind, the text IS the shape ─────────────────────────────────

{
  const dim = { uuid: "d", kind: "dimension", metadata: { title: "42cm" } };
  const { self, key } = board({ editingTitleShape: dim });
  key("Backspace");
  assert.deepStrictEqual(self.deleted, [dim],
    "deleting a dimension's label deletes the dimension — its text is the shape");
}

// ── the existing paths are untouched ──────────────────────────────────────

{
  // Shape selection still deletes, when no label is focused.
  const rect = { uuid: "r", kind: "rectangle" };
  const { self, key } = board({ selectedShapes: [rect] });
  key("Delete");
  assert.deepStrictEqual(self.deleted, [rect]);
}

{
  // Typing in an input never triggers any of it.
  const arrow = { uuid: "a", kind: "arrow", metadata: { title: "hi" } };
  const { self, key } = board({ editingTitleShape: arrow });
  key("Delete", { tagName: "INPUT" });
  assert.strictEqual(arrow.metadata.title, "hi",
    "Delete while typing edits text, it does not delete the label");
  assert.strictEqual(self.exited, 0);
}

console.log("label delete key: all checks passed");
