// Pins the round trip between a dimension's label and the style panel.
//
// Place a dimension's two points and the label editor opens, waiting for
// the words. Reaching for the thickness or the label size is the most
// natural next move, and coming back from it used to cost the label: the
// click back onto the canvas dismissed the editor ("you can't type"), and
// clicking the label itself put the caret in AND started a second
// dimension from the middle of the label — one click doing two unrelated
// things, the second one unasked for.
//
// The rules pinned here:
//   * a press on the editor belongs to the words — no tool ever sees it
//   * a press on the chrome remembers the detour
//   * the first canvas press after a detour puts the caret back
//   * the next one dismisses, which is how a label is abandoned
//
//   node test/js/dimension_label_return_test.js

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

const pointerDown = extract("_onPointerDown");

// `_selectTool` reaches for the ink tools' built-in palettes when one is
// armed; the values do not matter here, only that they exist.
for (const name of ["MARKER_DEFAULT_SLOTS", "HIGHLIGHT_DEFAULT_SLOTS"]) global[name] = ["#000"];
for (const name of ["MARKER_DEFAULT_COLOR", "HIGHLIGHT_DEFAULT_COLOR"]) global[name] = "#000";
for (const name of ["MARKER_DEFAULT_WIDTH", "HIGHLIGHT_DEFAULT_WIDTH"]) global[name] = 4;

function board(over) {
  return Object.assign({
    annotationMode: true,
    activeTool: "dimension",
    _pendingDraw: null,
    _drawSuppressedUntilDrag: false,
    _pressInsideTextEditor: false,
    placed: 0,
    dispatched: 0,
    _toImage: function() { return { x: 10, y: 20 }; },
    _placeArmedDraft: function() { this.placed++; return false; },
    _dispatchToolDown: function() { this.dispatched++; }
  }, over || {});
}

const press = { button: 0, shiftKey: false };

// ── a press on the label draws nothing at all ─────────────────────────────

{
  // The bug as reported: click the waiting label to type, get a caret
  // AND a brand-new dimension starting where you clicked.
  const b = board({ _pressInsideTextEditor: true });
  pointerDown.call(b, press);
  assert.strictEqual(b.dispatched, 0,
    "a press on the open label editor is about the words — the armed " +
    "tool never sees it");
  assert.strictEqual(b.placed, 0,
    "and it cannot finish a draft waiting for its second click either");
  assert.strictEqual(b._pendingDraw, null,
    "not even held for a drag: dragging to select the label's own text " +
    "would otherwise start a shape from inside the box");
  assert.strictEqual(b._pressInsideTextEditor, false,
    "the flag belongs to THIS press and is spent by it");
}

// ── and the flag never survives a press, whatever that press does ─────────

{
  // Read before every early return, like `_drawSuppressedUntilDrag` —
  // a flag left lying around eats the NEXT press instead.
  const off = board({ _pressInsideTextEditor: true, annotationMode: false });
  pointerDown.call(off, press);
  assert.strictEqual(off._pressInsideTextEditor, false,
    "cleared even when the press returns early for another reason");

  const right = board({ _pressInsideTextEditor: true });
  pointerDown.call(right, { button: 2, shiftKey: false });
  assert.strictEqual(right._pressInsideTextEditor, false,
    "cleared on a right-click too");
}

// ── an ordinary press still draws ─────────────────────────────────────────

{
  const b = board();
  pointerDown.call(b, press);
  assert.strictEqual(b.dispatched, 1,
    "nothing changes for a press that did not land on an editor");
}

// ── the handler's three branches ──────────────────────────────────────────

const down = src.slice(src.indexOf("self._textEditOutsideDown = function"),
                       src.indexOf("document.addEventListener(\"pointerdown\", self._textEditOutsideDown"));

{
  assert.ok(down.includes("self._pressInsideTextEditor = true;"),
    "a press inside the editor is marked for `_onPointerDown`");
  assert.ok(/fo\.contains\(e\.target\)\)\) \{[\s\S]*chromeSinceFocus = false;[\s\S]*return;/.test(down),
    "and clears the detour: back in the box, the next canvas press is a " +
    "plain click-away again");

  assert.ok(/closest\(CHROME_SELECTOR\)\) \{[\s\S]*chromeSinceFocus = true;[\s\S]*return;/.test(down),
    "a press on the panel remembers the detour instead of just surviving it");

  assert.ok(down.includes("ed.chromeSinceFocus && !(input.value || \"\").trim()"),
    "the return trip is keyed on the detour and scoped to an empty box — " +
    "text present still commits on click-away, as ever");
  assert.ok(/if \(!onShape \|\| onShape === ed\.shape\)/.test(down),
    "and to EMPTY canvas — a press on another shape is about that shape");
  assert.ok(down.indexOf("ed.chromeSinceFocus = false;") > down.indexOf("ed.chromeSinceFocus &&"),
    "the trip back is spent when it is taken, so the NEXT press away " +
    "dismisses the label — the only way to abandon one");
  assert.ok(down.includes("input.focus()"),
    "the click puts the cursor back in the box instead of deleting it");
}

{
  assert.ok(src.includes("ed.chromeSinceFocus = true;"),
    "a panel edit landing on the open editor counts as the same trip — " +
    "a control can be reached by keyboard, without a press on chrome");
  assert.ok(!src.includes("styledSinceOpen"),
    "the old flag is gone: it was never cleared, so a styled box could " +
    "not be dismissed by clicking away at all");
}

console.log("dimension_label_return_test: ok");

// ── reaching for a tool is walking away from the label ────────────────────

{
  // The toolbar is chrome, and a press on chrome is remembered as a trip
  // to the menus — so arming a tool used to leave the editor waiting, and
  // the first stroke drawn afterwards was spent putting the caret back in
  // a label the user had already abandoned. Found by drawing a dimension
  // and then a marker: the marker drew nothing at all.
  const selectTool = extract("_selectTool");
  const log = [];
  const pen = {
    activeTool: null,
    _textEditor: { input: {} },
    _commitTextEdit() { log.push("commit"); this._textEditor = null; },
    _exitEditMode() { log.push("exitEdit"); },
    _clearSelection() { log.push("clearSel"); },
    _cancelDraft() {}, _clearEraserHover() {}, _endPointer() {},
    _removeConnectorDots() {}, _rememberPinnedTool() {}, _layoutToolbar() {},
    _applyPanLock() {}, _wireGrabberCursor() {}, _syncStylePanel() {},
    _syncStyleInspector() {}, _hideTooltip() {}, _dispatch() {},
    _bankPalette() {}, _selectColor() {}, _refreshToolbarSwatches() {},
    _setInkWidth() {}, _getPref: () => null, _sanitizeColorSlots: (a) => a,
    toolbar: null, toolsPopup: null, overlayWrapper: null, handle: null,
    handleKind: "canvas", _bankedSharedColor: null
  };

  selectTool.call(pen, "marker");
  assert.ok(log.includes("commit"),
    "arming a drawing tool closes the label editor — whatever was typed is " +
    "kept, an empty box is dropped, and the stroke that follows is a stroke");
  assert.ok(log.indexOf("commit") < log.indexOf("exitEdit"),
    "…before the rest of the teardown, so the commit still has its shape");
}

{
  // Disarming is not walking away: the cursor tool is what you hold while
  // working ON a shape, and the panel round trip above happens under it.
  const selectTool = extract("_selectTool");
  let committed = 0;
  const cursor = {
    activeTool: "marker",
    _textEditor: { input: {} },
    _commitTextEdit() { committed++; },
    _cancelDraft() {}, _clearEraserHover() {}, _endPointer() {},
    _removeConnectorDots() {}, _exitEditMode() {}, _clearSelection() {},
    _rememberPinnedTool() {}, _layoutToolbar() {}, _applyPanLock() {},
    _wireGrabberCursor() {}, _syncStylePanel() {}, _syncStyleInspector() {},
    _hideTooltip() {}, _dispatch() {}, _bankPalette() {}, _selectColor() {},
    _refreshToolbarSwatches() {}, _setInkWidth() {}, _getPref: () => null,
    _sanitizeColorSlots: (a) => a, toolbar: null, toolsPopup: null,
    overlayWrapper: null, handle: null, handleKind: "canvas",
    _bankedSharedColor: null
  };

  selectTool.call(cursor, null);
  assert.strictEqual(committed, 0, "disarming leaves an open label alone");
}
