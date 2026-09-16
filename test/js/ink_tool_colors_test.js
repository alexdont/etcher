// Pins per-tool ink colours: the marker and the highlighter each keep
// their OWN colour, apart from the palette colour the shapes share.
//
// Arming an ink tool banks the shared selection and loads the tool's
// remembered colour (a first-time highlighter starts yellow, so the two
// ink tools never match out of the box); a pick while armed is stored
// under the tool and leaves the palette slots alone; disarming restores
// the banked shared colour — so a yellow highlighting session never
// leaks into the next rectangle.
//
//   node test/js/ink_tool_colors_test.js

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

const m = src.match(/var HIGHLIGHT_DEFAULT_COLOR = "(#[0-9a-f]{6})";/);
assert.ok(m, "the highlighter needs a distinct default colour");
const HIGHLIGHT_DEFAULT_COLOR = m[1];

const selectColor = extract("_selectColor");
const applyPickedColor = extract("_applyPickedColor");

// ── a pick while armed is remembered under the tool ───────────────────────

function colorBoard(armedTool) {
  return {
    activeTool: armedTool || "cursor",
    prefs: [],
    _armedInkTool() { return armedTool != null; },
    _setPref(k, v) { this.prefs.push([k, v]); },
    _dispatch() {},
    _activeSlot: 0,
    swatchEls: null,
    colorsPopupBtns: null,
    _pickerPreview: null,
    _layoutToolbar() {},
    _restyleDrafts() {},
    _applyColorToTargets() {},
  };
}

{
  const board = colorBoard("marker");
  selectColor.call(board, "#ff0000");
  assert.deepStrictEqual(board.prefs, [["marker_color", "#ff0000"]],
    "the pick is stored under the armed tool, on the prefs channel");

  const hi = colorBoard("highlighter");
  selectColor.call(hi, "#00ff00");
  assert.deepStrictEqual(hi.prefs, [["highlighter_color", "#00ff00"]]);

  const idle = colorBoard(null);
  selectColor.call(idle, "#ff0000");
  assert.deepStrictEqual(idle.prefs, [],
    "no tool armed: the pick is the shared palette selection, not a pref");
}

// ── the picker leaves the palette slot alone while ink is armed ───────────

{
  function pickerBoard(armed) {
    return {
      _labelBgPickTarget: null,
      _labelPickTarget: null,
      _inspectedShape: () => null,
      _armedInkTool: () => armed,
      _activeSlot: 1,
      slotWrites: [],
      picks: [],
      _setSlotColor(i, hex) { this.slotWrites.push([i, hex]); },
      _selectColor(hex) { this.picks.push(hex); },
    };
  }
  const armed = pickerBoard(true);
  applyPickedColor.call(armed, "#123456");
  assert.deepStrictEqual(armed.slotWrites, [],
    "the slot keeps the shared colour the board returns to on disarm");
  assert.deepStrictEqual(armed.picks, ["#123456"], "the tool still gets the pick");

  const idle = pickerBoard(false);
  applyPickedColor.call(idle, "#123456");
  assert.deepStrictEqual(idle.slotWrites, [[1, "#123456"]],
    "no ink armed: the picker edits the active slot, as ever");
}

// ── arming banks the shared colour; disarming restores it ─────────────────

// Lift _selectTool's swap block and drive it through a whole session.
const blockStart = src.indexOf("      var wasInk = prevTool ===");
assert.notStrictEqual(blockStart, -1, "could not find the ink-colour swap");
const blockEnd = src.indexOf("self._selectColor(bank.color);\n      }\n", blockStart);
assert.notStrictEqual(blockEnd, -1, "could not find the end of the swap block");
const swap = new Function("self", "prevTool", "toolKey", "HIGHLIGHT_DEFAULT_COLOR",
  src.slice(blockStart, src.indexOf("\n", blockEnd + 40)));

{
  const prefs = {};
  const board = {
    _activeSlot: 2,
    activeColor: "#111111",
    _colorSlots: ["#aaaaaa", "#bbbbbb", "#111111"],
    _getPref: (k) => prefs[k],
    _selectColor(c) {
      this.activeColor = c;
      // What the real one does while ink is armed (pinned above).
      if (this._armed) prefs[this._armed + "_color"] = c;
    },
  };
  const arm = (prev, next) => {
    board._armed = next === "marker" || next === "highlighter" ? next : null;
    swap(board, prev, next, HIGHLIGHT_DEFAULT_COLOR);
  };

  // First marker arm: no memory yet — it inherits the shared colour, and
  // the shared selection is banked.
  arm(null, "marker");
  assert.strictEqual(board.activeColor, "#111111");
  assert.deepStrictEqual(board._bankedSharedColor, { slot: 2, color: "#111111" });

  // The user picks red for the marker (the pref write pinned above).
  board._selectColor("#ff0000");

  // Marker → highlighter keeps the ORIGINAL bank, and a first-time
  // highlighter starts in its own yellow, not the marker's red.
  arm("marker", "highlighter");
  assert.strictEqual(board.activeColor, HIGHLIGHT_DEFAULT_COLOR,
    "out of the box the two ink tools must not match");
  assert.deepStrictEqual(board._bankedSharedColor, { slot: 2, color: "#111111" },
    "only the first ink arm is a shared colour worth returning to");

  // Disarm: the shared selection comes back, slot and all.
  arm("highlighter", null);
  assert.strictEqual(board.activeColor, "#111111",
    "a highlighting session must not leak into the next rectangle");
  assert.strictEqual(board._activeSlot, 2);
  assert.strictEqual(board._bankedSharedColor, null);

  // Re-arm the marker: it comes up in ITS colour — the point of it all.
  arm(null, "marker");
  assert.strictEqual(board.activeColor, "#ff0000",
    "the marker remembers the colour the user used for it");
  assert.strictEqual(board._activeSlot, -1,
    "a colour outside the palette lights no swatch");

  // …and the highlighter in its.
  arm("marker", "highlighter");
  assert.strictEqual(board.activeColor, HIGHLIGHT_DEFAULT_COLOR);
}

// ── the swap sits after the selection teardown ────────────────────────────

{
  // _selectColor applies the colour to selected targets; if the swap ran
  // before _clearSelection, pressing M with a shape selected would recolour
  // that shape to the marker's remembered colour.
  const toolStart = src.indexOf("    _selectTool: function(toolKey) {");
  const teardown = src.indexOf("self._clearSelection();", toolStart);
  assert.ok(teardown !== -1 && teardown < blockStart,
    "the ink swap must run after _exitEditMode/_clearSelection");
}

console.log("ink tool colors: all checks passed");
