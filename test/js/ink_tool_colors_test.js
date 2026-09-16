// Pins per-tool ink colours: the marker and the highlighter each keep
// their OWN colour, apart from the palette colour the shapes share.
//
// Arming an ink tool banks the shared selection and loads the tool's
// remembered colour (a first-time highlighter starts yellow, so the two
// ink tools never match out of the box); a pick while armed is stored
// under the tool; disarming restores the banked shared selection — so a
// yellow highlighting session never leaks into the next rectangle.
//
// The palettes are separate too: the shapes, the marker and the
// highlighter each own a full five-slot set ("colors" / "marker_colors"
// / "highlighter_colors"), swapped in and out with the tool. The wheel
// edits the slot it was opened from whatever tool is up, and the edit
// persists under the palette the user was actually looking at.
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

// ── the wheel edits the slot it was opened from, armed or not ─────────────

{
  function pickerBoard() {
    return {
      _labelBgPickTarget: null,
      _labelPickTarget: null,
      _inspectedShape: () => null,
      _activeSlot: 1,
      slotWrites: [],
      picks: [],
      _setSlotColor(i, hex) { this.slotWrites.push([i, hex]); },
      _selectColor(hex) { this.picks.push(hex); },
    };
  }
  // Ink armed: the swatch being edited MUST repaint — five swatches that
  // silently stop taking edits while the marker is up read as broken.
  // (_selectColor is what stores the pick as the tool's colour.)
  const armed = pickerBoard();
  applyPickedColor.call(armed, "#123456");
  assert.deepStrictEqual(armed.slotWrites, [[1, "#123456"]],
    "the wheel edits the slot whatever tool is up");
  assert.deepStrictEqual(armed.picks, ["#123456"]);

  // A tool colour outside the palette leaves no slot active; the pick is
  // then a pure tool recolour, guarded by _setSlotColor's own bounds
  // check rather than a branch here.
  const setSlotColor = extract("_setSlotColor");
  const off = {
    _colorSlots: ["#aaaaaa"],
    swatchEls: [],
    _activeSlot: -1,
    activeColor: "#ff0000",
    _setPref() { this.persisted = true; },
  };
  setSlotColor.call(off, -1, "#123456");
  assert.deepStrictEqual(off._colorSlots, ["#aaaaaa"],
    "no active slot: the palette survives the pick");
  assert.ok(!off.persisted, "…and nothing is persisted for it");
}

// ── arming banks the shared colour; disarming restores it ─────────────────

// Lift _selectTool's swap block and drive it through a whole session.
const blockStart = src.indexOf("      var wasInk = prevTool ===");
assert.notStrictEqual(blockStart, -1, "could not find the ink-colour swap");
const blockEnd = src.indexOf(
  "? bank.slots[bank.slot] : bank.color);\n      }\n", blockStart);
assert.notStrictEqual(blockEnd, -1, "could not find the end of the swap block");
const sm = src.match(
  /var HIGHLIGHT_DEFAULT_SLOTS =\n\s+(\[[^\]]+\]);/);
assert.ok(sm, "the highlighter needs a starting palette of its own");
const HIGHLIGHT_DEFAULT_SLOTS = eval(sm[1]);
assert.strictEqual(HIGHLIGHT_DEFAULT_SLOTS[0], HIGHLIGHT_DEFAULT_COLOR,
  "the default colour leads its own palette");
const swap = new Function("self", "prevTool", "toolKey",
  "HIGHLIGHT_DEFAULT_COLOR", "HIGHLIGHT_DEFAULT_SLOTS",
  src.slice(blockStart, src.indexOf("\n", blockEnd + 44)));

{
  const prefs = {};
  const SHARED = ["#aaaaaa", "#bbbbbb", "#111111"];
  const board = {
    _activeSlot: 2,
    activeColor: "#111111",
    _colorSlots: SHARED.slice(),
    refreshes: 0,
    _getPref: (k) => prefs[k],
    _sanitizeColorSlots: (a) => a.slice(),
    _refreshToolbarSwatches() { this.refreshes++; },
    _selectColor(c) {
      this.activeColor = c;
      // What the real one does while ink is armed (pinned above).
      if (this._armed) prefs[this._armed + "_color"] = c;
    },
  };
  const arm = (prev, next) => {
    board._armed = next === "marker" || next === "highlighter" ? next : null;
    swap(board, prev, next, HIGHLIGHT_DEFAULT_COLOR, HIGHLIGHT_DEFAULT_SLOTS);
  };

  // First marker arm: no memory yet — its palette seeds from the shared
  // one, it inherits the shared colour, and the shared selection is
  // banked whole (slots included).
  arm(null, "marker");
  assert.deepStrictEqual(board._colorSlots, SHARED);
  assert.strictEqual(board.activeColor, "#111111");
  assert.deepStrictEqual(board._bankedSharedColor,
    { slots: SHARED, slot: 2, color: "#111111" });
  assert.ok(board.refreshes > 0, "the swatch row repaints on the swap");

  // The user edits marker slot 0 through the wheel and picks it — what
  // _setSlotColor + _selectColor do while armed (pinned above).
  board._colorSlots[0] = "#ff0000";
  prefs.marker_colors = board._colorSlots.slice();
  board._selectColor("#ff0000");

  // Marker → highlighter: its OWN starting palette — the classic
  // highlight set, not the marker's, and not the shared one — with its
  // yellow selected. The original bank survives untouched.
  arm("marker", "highlighter");
  assert.deepStrictEqual(board._colorSlots, HIGHLIGHT_DEFAULT_SLOTS);
  assert.strictEqual(board.activeColor, HIGHLIGHT_DEFAULT_COLOR,
    "out of the box the two ink tools must not match");
  assert.strictEqual(board._activeSlot, 0, "…and yellow is a slot of its own set");
  assert.deepStrictEqual(board._bankedSharedColor,
    { slots: SHARED, slot: 2, color: "#111111" },
    "only the first ink arm is a shared state worth returning to");

  // Disarm: the shared palette AND selection come back — the marker's
  // red and the highlight set are nowhere on the shape palette.
  arm("highlighter", null);
  assert.deepStrictEqual(board._colorSlots, SHARED,
    "an ink session must not leak into the shapes' palette");
  assert.strictEqual(board.activeColor, "#111111");
  assert.strictEqual(board._activeSlot, 2);
  assert.strictEqual(board._bankedSharedColor, null);

  // Re-arm the marker: its edited palette and its colour — the point.
  arm(null, "marker");
  assert.deepStrictEqual(board._colorSlots, ["#ff0000", "#bbbbbb", "#111111"],
    "the marker's five slots are its own, edits included");
  assert.strictEqual(board.activeColor, "#ff0000");
  assert.strictEqual(board._activeSlot, 0);

  // Straight to the highlighter: seeded from the BANKED shared palette
  // is what it must NOT be — it keeps the highlight set.
  arm("marker", "highlighter");
  assert.deepStrictEqual(board._colorSlots, HIGHLIGHT_DEFAULT_SLOTS);
  assert.strictEqual(board.activeColor, HIGHLIGHT_DEFAULT_COLOR);

  // A shared colour from OUTSIDE the palette (host-seeded) banks as a
  // raw value — no slot to re-read — and comes back verbatim.
  arm("highlighter", null);
  board._activeSlot = -1;
  board.activeColor = "#0ff00f";
  arm(null, "marker");
  arm("marker", null);
  assert.strictEqual(board.activeColor, "#0ff00f",
    "an off-palette shared colour restores from the banked value");
}

// ── edits persist under the palette on screen ─────────────────────────────

{
  const setSlotColor = extract("_setSlotColor");
  const paletteKey = extract("_paletteKey");
  function slotBoard(armedTool) {
    return {
      activeTool: armedTool || "cursor",
      annotationMode: true,
      _armedInkTool() {
        return this.activeTool === "marker" || this.activeTool === "highlighter";
      },
      _paletteKey: paletteKey,
      _colorSlots: ["#aaaaaa", "#bbbbbb"],
      swatchEls: [],
      _activeSlot: 0,
      activeColor: "#aaaaaa",
      prefs: [],
      _setPref(k, v) { this.prefs.push([k, v]); },
    };
  }
  const marker = slotBoard("marker");
  setSlotColor.call(marker, 0, "#ff0000");
  assert.deepStrictEqual(marker.prefs, [["marker_colors", ["#ff0000", "#bbbbbb"]]],
    "a slot edited with the marker up is the marker's, not the shapes'");

  const shapes = slotBoard(null);
  setSlotColor.call(shapes, 0, "#ff0000");
  assert.deepStrictEqual(shapes.prefs, [["colors", ["#ff0000", "#bbbbbb"]]],
    "no ink armed: the shared palette, as ever");
}

// ── the legacy colours-only host channel stays shared-only ────────────────

{
  const emitColorsChanged = extract("_emitColorsChanged");
  function emitBoard(armed) {
    return {
      _armedInkTool: () => armed,
      _colorSlots: ["#facc15"],
      pushed: [],
      pushEventTo(_el, evt, payload) { this.pushed.push([evt, payload.colors]); },
      el: {},
      frescoId: null,
      _dispatch(evt, detail) { this.pushed.push([evt, detail.colors]); },
    };
  }
  const armed = emitBoard(true);
  emitColorsChanged.call(armed);
  assert.deepStrictEqual(armed.pushed, [],
    "hosts on the colours-only channel must never receive an ink palette " +
    "as the shared one");

  const idle = emitBoard(false);
  emitColorsChanged.call(idle);
  assert.ok(idle.pushed.length >= 1, "the shared palette still reaches the host");
}

// ── prefs apply to the palette on screen ──────────────────────────────────

{
  assert.ok(src.includes("this._applyColorsPref(prefs[this._paletteKey()]);"),
    "_applyPrefs must route the palette pref through _paletteKey — a hard " +
    "prefs.colors here would clobber an armed ink palette on every hydrate");
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
