// Pins what the toolbar says when it opens.
//
// A board has always started in cursor mode — `activeTool == null`, drag
// does box-select, the arrow is the pointer — but it got there by setting
// the field, not by selecting the tool. So the toolbar opened with no
// button lit, and the one behaviour the user gets for free was the one
// the toolbar never mentioned. Entering the mode now arms the cursor tool
// through the same door a click on it uses.
//
//   node test/js/mode_default_tool_test.js

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

const setMode = extract("_setAnnotationMode");

function board(over) {
  const calls = [];
  const note = (name) => function() { calls.push(name); };
  return Object.assign({
    calls,
    annotationMode: false,
    activeTool: null,
    handleKind: "canvas",
    handle: { container: { style: {} } },
    toolbar: { classList: { toggle: (c, on) => calls.push(`toolbar:${c}=${on}`) } },
    selected: [],
    _selectTool: function(t) { this.selected.push(t); this.activeTool = t; },
    _syncNavPencil: note("navPencil"),
    _syncActionBar: note("actionBar"),
    _syncStylePanel: note("stylePanel"),
    _closeActionMenu: note("closeMenu"),
    _positionActionBar: note("positionBar"),
    _layoutToolbar: note("layout"),
    _cancelDraft: note("cancelDraft"),
    _exitEditMode: note("exitEdit"),
    _clearSelection: note("clearSel"),
    _closePopup: note("closePopup"),
    _applyPanLock: note("panLock"),
    _dispatch: function(name, detail) { calls.push(`dispatch:${name}:${detail.annotationMode}`); }
  }, over || {});
}

// ── switching on arms the cursor tool ─────────────────────────────────────

{
  const b = board();
  setMode.call(b, true);
  assert.deepStrictEqual(b.selected, [null],
    "the cursor tool is SELECTED on entry, not merely implied — that is " +
    "what lights its button, and the button is how a user learns what " +
    "the pointer already does");
  assert.strictEqual(b.activeTool, null, "which is still cursor mode");
  assert.ok(b.calls.indexOf("layout") < b.calls.indexOf("dispatch:etcher:mode-changed:true"),
    "and it happens while the mode is being set up, before the board is " +
    "told the mode changed");
}

// ── the arrow cursor is not overwritten on the way out ────────────────────

{
  // `_selectTool` puts the toolbar's own arrow on the container when the
  // cursor tool is armed in annotation mode. A later line in this
  // function used to write a plain `default` over it.
  const b = board({
    _selectTool: function(t) { this.selected.push(t); this.activeTool = t;
                               this.handle.container.style.cursor = "url(arrow)"; }
  });
  setMode.call(b, true);
  assert.strictEqual(b.handle.container.style.cursor, "url(arrow)",
    "what the tool put there is what stays there");
}

// ── switching off still puts everything down ──────────────────────────────

{
  const b = board({ annotationMode: true, activeTool: "rectangle" });
  setMode.call(b, false);
  assert.deepStrictEqual(b.selected, [null], "the armed tool is dropped");
  for (const expected of ["cancelDraft", "exitEdit", "clearSel", "closePopup", "closeMenu"])
    assert.ok(b.calls.includes(expected), `…along with ${expected}`);
  assert.ok(!b.calls.includes("positionBar"),
    "and nothing is laid out for a bar that just went away");
}

// ── a mode that did not change does nothing at all ────────────────────────

{
  const b = board({ annotationMode: true });
  setMode.call(b, true);
  assert.deepStrictEqual(b.selected, [],
    "re-asserting the current mode must not re-arm the cursor — it would " +
    "throw away the tool the user is holding");
  assert.deepStrictEqual(b.calls, []);
}

console.log("mode default tool: ok");
