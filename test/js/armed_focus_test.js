// While a tool is armed, the shape being worked on holds the focus: other
// shapes neither hover nor grab nor get selected by a tap until a click
// away lets go. Shift gets past it and gathers a selection.
//
//   node test/js/armed_focus_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher.js"), "utf8");

function lift(name) {
  const start = src.indexOf(`    ${name}: function(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf("\n    },", start);
  return eval("(function" + src.slice(src.indexOf("(", start), end + "\n    }".length) + ")");
}

const liveFocus = lift("_liveFocus");
const bars = lift("_armedFocusBars");
const edits = lift("_armedToolEdits");

const typed = { kind: "text", uuid: "t1" };
const other = { kind: "text", uuid: "t2" };

function layer(over) {
  return Object.assign({
    annotationMode: true, activeTool: "text", editingShape: null, selectedShapes: [],
    _pressFocus: null, _focusLetGo: null,
    _liveFocus: liveFocus, _armedFocusBars: bars, _armedToolEdits: edits
  }, over);
}

{
  const l = layer({});
  assert.ok(l._armedToolEdits(other), "nothing focused: the text tool reaches any text");
}
{
  const l = layer({ editingShape: typed });
  assert.ok(l._armedToolEdits(typed), "the focused text stays grabbable");
  assert.ok(!l._armedToolEdits(other), "every other text is inert — no hover, no grab");
}
{
  const l = layer({ editingShape: typed, activeTool: null });
  assert.ok(l._armedFocusBars(other), "the cursor holds the focus the same way");
  assert.ok(!l._armedFocusBars(typed));
  l.annotationMode = false;
  assert.ok(!l._armedFocusBars(other), "browsing (annotation mode off) is not affected");
}
{
  const l = layer({ activeTool: null, editingTitleShape: typed });
  assert.ok(l._armedFocusBars(other), "a picked label holds the focus for its shape");
}
{
  const l = layer({ selectedShapes: [typed, other] });
  assert.ok(l._armedToolEdits(other), "a gathered selection is all focus");
}
{
  const l = layer({ editingShape: null, _pressFocus: { focus: [typed], shift: false } });
  assert.ok(!l._armedToolEdits(other),
    "a press is judged by the focus it started with, even once the editor's commit cleared it");
  l._pressFocus = { focus: [typed], shift: true };
  assert.ok(l._armedToolEdits(other), "shift gets past the focus");
}
{
  const l = layer({ editingShape: typed, _focusLetGo: typed });
  assert.ok(l._armedToolEdits(other), "committed by a click away: the focus is let go");
}

// wiring — cursor mode
assert.ok(/if \(hit && self\._armedFocusBars\(hit\) && self\.activeTool == null\) \{/.test(src),
  "a cursor press on another shape only lets go");
assert.ok(/if \(next && \(!this\._hoverAllowed\(\) \|\| this\._armedFocusBars\(next\)\)\)/.test(src),
  "no hover on other shapes while one holds the focus");
assert.ok(src.includes("if (!dragged && tapCycle) self._onShapeTap(tapCycle);"),
  "tapping a focused shape again still reaches underneath — but only on a tap, never a drag");

// wiring
assert.ok(src.includes('window.addEventListener("pointerdown", self._focusPressDown, true);'),
  "the press focus is taken on the window, capture phase, ahead of the editor's commit");
assert.ok(/if \(self\._armedFocusBars\(hit\)\) return;/.test(src),
  "the doc tap tracker never selects a shape the focus bars");
assert.ok(/var add = this\._sameToolGrabTarget\(pt\);/.test(src) && src.includes("this._armedShiftAdd(add, e);"),
  "shift-press on a shape gathers it into the selection");
assert.ok(/if \(this\._pressFocus\) this\._focusLetGo = shape;/.test(src),
  "a click-away commit lets go of the focus; Enter keeps it");

console.log("armed focus: all checks passed");
assert.ok(/if \(!onShape\) this\._pendingDraw/.test(src) &&
  /if \(!this\._pressLetsGoOnShape\(pt\)\) this\._pendingDraw/.test(src),
  "a press that lets go by landing on another shape never draws on top of it");
