// Pins the right-click menu: on a shape it offers what the action bar does
// to a selection (duplicate, delete, the four layer moves, disabled when
// nothing can move); on empty board paste, select all, undo and redo. Every
// item calls the same method as its button or shortcut (head dev,
// 2026-11-11).
//
//   node test/js/context_menu_test.js

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
  return eval("(" + src.slice(start, end + "\n    }".length)
    .replace(`${name}: function`, "function") + ")");
}

global.navigator = { platform: "Linux" };
const items = extract("_contextMenuItems");

function board(over) {
  const calls = [];
  return Object.assign({
    calls,
    shapes: [{ el: {}, readonly: false }],
    activeTool: null,
    _undoStack: [1],
    _redoStack: [],
    _canArrange: () => true,
    _duplicateSelection: () => calls.push("duplicate"),
    _deleteSelection: () => calls.push("delete"),
    _arrange: (w) => calls.push("arrange:" + w),
    _pasteFromClipboard: () => calls.push("paste"),
    _selectAll: () => calls.push("selectAll"),
    _selectTool: (t) => calls.push("tool:" + t),
    _undo: () => calls.push("undo"),
    _redo: () => calls.push("redo"),
  }, over || {});
}
const labels = (list) => list.map((i) => (i === "-" ? "-" : i.label));
const find = (list, l) => list.find((i) => i !== "-" && i.label === l);

// ── on a shape ────────────────────────────────────────────────────────────
{
  const b = board();
  const list = items.call(b, { uuid: "s1" });
  assert.deepStrictEqual(labels(list), ["Duplicate", "Delete", "-", "Bring to front",
    "Bring forward", "Send backward", "Send to back"]);
  list.filter((i) => i !== "-").forEach((i) => i.run());
  assert.deepStrictEqual(b.calls, ["duplicate", "delete", "arrange:front", "arrange:forward",
    "arrange:backward", "arrange:back"], "each item is the action bar's own method");
  assert.ok(find(list, "Delete").danger, "delete reads as destructive");
  assert.strictEqual(find(list, "Bring forward").key, "]", "the hint is the real shortcut");
  assert.strictEqual(find(list, "Send to back").key, "Ctrl+[");

  const stuck = items.call(board({ _canArrange: () => false }), { uuid: "s1" });
  assert.ok(find(stuck, "Bring to front").disabled, "no layer move when nothing can move");
  assert.ok(!find(stuck, "Delete").disabled);
}

// ── on empty board ────────────────────────────────────────────────────────
{
  const b = board({ activeTool: "rectangle" });
  const list = items.call(b, null);
  assert.deepStrictEqual(labels(list), ["Paste", "Select all", "-", "Undo", "Redo"]);
  find(list, "Select all").run();
  assert.deepStrictEqual(b.calls, ["tool:null", "selectAll"],
    "select all puts the drawing tool down first, as ⌘A needs the cursor");
  assert.ok(!find(list, "Undo").disabled);
  assert.ok(find(list, "Redo").disabled, "nothing to redo");

  const empty = items.call(board({ shapes: [{ el: {}, readonly: true }] }), null);
  assert.ok(find(empty, "Select all").disabled, "nothing selectable, nothing to select");
}

// ── wired: annotating only, never over a text field or Etcher's chrome ────
{
  const wire = src.slice(src.indexOf("    _wireContextMenu: function"),
                         src.indexOf("\n    },", src.indexOf("    _wireContextMenu: function")));
  assert.ok(wire.indexOf("if (!self.annotationMode) return;") !== -1,
    "outside annotation mode the browser keeps its menu");
  assert.ok(wire.indexOf('closest("input, textarea') !== -1, "text fields keep theirs");
  assert.ok(wire.indexOf("closest(CHROME_SELECTOR)") !== -1, "so do the controls");
  assert.ok((src.match(/self\._wireContextMenu\(\);/g) || []).length === 2,
    "wired wherever the bars are built");
}

console.log("Context menu: all checks passed");
