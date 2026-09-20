// Pins that the five swatches belong to whatever the panel is describing.
//
// The marker and the highlighter each own a full five-slot palette, swapped
// in while that tool is armed. Selecting a STROKE drawn with one did not
// swap anything: click a highlight and the panel offered the shapes' set —
// so recolouring it meant picking from colours it was never drawn from, and
// an edit there wrote the shapes' palette.
//
// The selected shape outranks the armed tool, because the panel is
// describing that shape. Deselecting puts back whatever the tool context
// asks for.
//
//   node test/js/ink_shape_palette_test.js

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

function constant(name) {
  const m = src.match(new RegExp(`var ${name} =\\s*([\\s\\S]*?);\\n`));
  assert.ok(m, `could not read ${name}`);
  return eval("(" + m[1] + ")");
}

const HIGHLIGHT_OPACITY = constant("HIGHLIGHT_OPACITY");
const HIGHLIGHT_DEFAULT_SLOTS = constant("HIGHLIGHT_DEFAULT_SLOTS");
const MARKER_DEFAULT_SLOTS = constant("MARKER_DEFAULT_SLOTS");
global.HIGHLIGHT_OPACITY = HIGHLIGHT_OPACITY;
global.HIGHLIGHT_DEFAULT_SLOTS = HIGHLIGHT_DEFAULT_SLOTS;
global.MARKER_DEFAULT_SLOTS = MARKER_DEFAULT_SLOTS;

const inkToolFor = extract("_inkToolFor");
const paletteKey = extract("_paletteKey");
const syncPalette = extract("_syncPaletteForContext");
const bankPalette = extract("_bankPalette");
const defaultSlotsFor = extract("_defaultSlotsFor");

// ── which tool drew a stroke ──────────────────────────────────────────────

{
  const ink = (shape) => inkToolFor.call({}, shape);

  assert.strictEqual(ink({ kind: "marker", style: { ink: "highlighter" } }), "highlighter");
  assert.strictEqual(ink({ kind: "marker", style: { ink: "marker" } }), "marker");

  // Before the stamp existed the only difference between the two WAS the
  // opacity — the highlighter is the marker at a fixed half — so that is
  // what old strokes are read by.
  assert.strictEqual(ink({ kind: "marker", style: { opacity: HIGHLIGHT_OPACITY } }), "highlighter",
    "a legacy half-opacity stroke is a highlight");
  assert.strictEqual(ink({ kind: "marker", style: { opacity: 1 } }), "marker");
  assert.strictEqual(ink({ kind: "marker", style: {} }), "marker",
    "no opacity recorded at all: a marker, which is the one that leaves it alone");

  // The stamp wins over the opacity, so a highlight someone turned opaque
  // still edits the highlighter's colours.
  assert.strictEqual(
    ink({ kind: "marker", style: { ink: "highlighter", opacity: 1 } }), "highlighter");

  assert.strictEqual(ink({ kind: "rectangle", style: { opacity: 0.4 } }), null,
    "only marker-kind shapes come off an ink tool");
  assert.strictEqual(ink(null), null);
}

// ── and it is stamped at creation ─────────────────────────────────────────

{
  const styleForNew = extract("_styleForNewShape");
  const base = { color: "#111111", width: 6, dash: "solid", opacity: 1 };
  const make = (activeTool) => styleForNew.call({
    activeTool,
    _currentMarkerStyle: () => Object.assign({}, base),
    _isStrokeShape: () => false,
    _isShaftKind: () => false,
    _isTextKind: () => false,
    _getPref: () => undefined,
    _defaultLabelFontSize: () => 16,
    _lineParamsForNewShape: () => ({}),
  }, "marker");

  assert.strictEqual(make("highlighter").ink, "highlighter");
  assert.strictEqual(make("highlighter").opacity, HIGHLIGHT_OPACITY,
    "still the half opacity that makes it a highlight on screen");
  assert.strictEqual(make("marker").ink, "marker");
  assert.strictEqual(make("marker").opacity, 1);

  // The stamp must not disturb what a stroke already carried.
  assert.strictEqual(make("marker").width, 6);
  assert.strictEqual(make("marker").color, "#111111");
}

// ── the palette key follows the selection, then the tool ──────────────────

{
  const key = (state) => paletteKey.call(Object.assign({
    _inkToolFor: inkToolFor,
    _inspectedShape: () => null,
    _armedInkTool: function() {
      return !!this.annotationMode &&
        (this.activeTool === "marker" || this.activeTool === "highlighter");
    },
    annotationMode: true,
    activeTool: null,
  }, state));

  const hl = { kind: "marker", style: { ink: "highlighter" } };
  const mk = { kind: "marker", style: { ink: "marker" } };
  const rect = { kind: "rectangle", style: {} };

  assert.strictEqual(key({}), "colors", "nothing selected, nothing armed: the shapes' set");
  assert.strictEqual(key({ _inspectedShape: () => hl }), "highlighter_colors");
  assert.strictEqual(key({ _inspectedShape: () => mk }), "marker_colors");
  assert.strictEqual(key({ _inspectedShape: () => rect }), "colors",
    "a rectangle is drawn from the shared palette, and shows it");
  assert.strictEqual(key({ activeTool: "highlighter" }), "highlighter_colors",
    "arming still swaps, exactly as before");

  // The panel describes the SELECTION, so it wins.
  assert.strictEqual(key({ _inspectedShape: () => hl, activeTool: "marker" }),
    "highlighter_colors",
    "with a highlight selected the swatches are the highlighter's, whatever is armed");
}

// ── swapping the visible five ─────────────────────────────────────────────

function board(state) {
  return Object.assign({
    _paletteAppliedKey: "colors",
    _paletteBank: null,
    _colorSlots: ["#111111", "#222222", "#333333", "#444444", "#555555"],
    _activeSlot: 0,
    prefs: {},
    refreshes: 0,
    _getPref(k) { return this.prefs[k]; },
    _sanitizeColorSlots: (l) => (Array.isArray(l) ? l.slice() : ["#a", "#b"]),
    _refreshToolbarSwatches() { this.refreshes++; },
    _bankPalette: bankPalette,
    _defaultSlotsFor: defaultSlotsFor,
    _paletteKey: () => "colors",
  }, state);
}

{
  // Nothing to do when the answer has not changed — this runs on every
  // inspector sync, which is every selection change and every panel refresh.
  const b = board({ _paletteKey: () => "colors" });
  syncPalette.call(b);
  assert.strictEqual(b.refreshes, 0, "an unchanged palette must not rebuild the row");
}

{
  // Prefs first: every slot edit persists there.
  const stored = ["#f1f1f1", "#f2f2f2", "#f3f3f3", "#f4f4f4", "#f5f5f5"];
  const b = board({
    _paletteKey: () => "highlighter_colors",
    prefs: { highlighter_colors: stored },
  });
  syncPalette.call(b);
  assert.deepStrictEqual(b._colorSlots, stored);
  assert.strictEqual(b._paletteAppliedKey, "highlighter_colors");
  assert.strictEqual(b.refreshes, 1);
}

{
  // Never stored: the built-in five for that tool, not the shapes' presets.
  const b = board({ _paletteKey: () => "highlighter_colors" });
  syncPalette.call(b);
  assert.deepStrictEqual(b._colorSlots, HIGHLIGHT_DEFAULT_SLOTS,
    "a first-ever highlight selection shows the highlighter's own colours");

  const m = board({ _paletteKey: () => "marker_colors" });
  syncPalette.call(m);
  assert.deepStrictEqual(m._colorSlots, MARKER_DEFAULT_SLOTS);
}

{
  // The shared palette can come from the host's `colors` attr and never be
  // written to prefs at all. Leaving it has to remember it, or selecting a
  // highlight and deselecting would quietly replace the host's palette with
  // the presets.
  const seeded = ["#aa0000", "#bb0000", "#cc0000", "#dd0000", "#ee0000"];
  const b = board({ _colorSlots: seeded.slice(), _paletteKey: () => "highlighter_colors" });
  syncPalette.call(b);
  assert.deepStrictEqual(b._paletteBank.colors, seeded, "what was on screen is banked");

  b._paletteKey = () => "colors";
  syncPalette.call(b);
  assert.deepStrictEqual(b._colorSlots, seeded,
    "deselecting brings back the palette that was there, not the presets");
}

{
  // A slot index left over from a longer palette must not point off the end.
  const b = board({
    _activeSlot: 4, _paletteKey: () => "marker_colors",
    prefs: { marker_colors: ["#010101", "#020202"] },
  });
  syncPalette.call(b);
  assert.strictEqual(b._activeSlot, 0);
}

// ── the shared-only host channel stays shared-only ────────────────────────

{
  // `etcher:colors-changed` predates per-tool palettes: hosts wired to it
  // store whatever arrives as THE palette. It was silent while an ink tool
  // was armed; a selected ink stroke puts the same tool palette on screen,
  // so it has to be silent for that too — or clicking a highlight and
  // editing a slot would overwrite the host's shapes palette with the
  // highlighter's.
  const emit = extract("_emitColorsChanged");
  const run = (key) => {
    const log = [];
    emit.call({
      _paletteKey: () => key,
      // Present on purpose: the guard this replaced asked whether a TOOL
      // was armed, which is false in every case here. If the code goes
      // back to asking that, these calls must announce and fail loudly.
      _armedInkTool: () => false,
      _colorSlots: ["#111111"],
      _dispatch: (name, d) => log.push([name, d]),
      pushEventTo: null,
    });
    return log;
  };
  assert.strictEqual(run("colors").length, 1, "a shapes-palette edit is announced");
  assert.strictEqual(run("highlighter_colors").length, 0);
  assert.strictEqual(run("marker_colors").length, 0);
}

// ── and the inspector is what drives the swap ─────────────────────────────

{
  const inspector = src.slice(src.indexOf("    _syncStyleInspector: function() {"),
                              src.indexOf("\n    },", src.indexOf("    _syncStyleInspector: function() {")));
  assert.ok(inspector.includes("this._syncPaletteForContext();"),
    "the panel's own re-describe is where the palette question gets asked");
  assert.ok(inspector.indexOf("_syncPaletteForContext") < inspector.indexOf("swatchEls"),
    "…and it has to run BEFORE the swatches are read, or the highlight lands on the old row");
}

console.log("ink shape palette: all checks passed");
