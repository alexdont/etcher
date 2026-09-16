// Pins which panel rows show while a pure-ink tool is armed.
//
// With the marker or highlighter armed, the panel used to offer the
// label rows (size, plate, the Text/Behind chips) and the fill buttons
// — settings about things the next stroke cannot produce: an ink
// stroke is not labelled at creation and cannot hold a fill. They hide
// while the tool is armed; selecting a labelled shape brings every
// applicable row back regardless.
//
//   node test/js/armed_ink_panel_test.js

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

const armedInk = extract("_armedInkTool");
const syncFontRow = extract("_syncFontRow");

// ── the predicate ─────────────────────────────────────────────────────────

{
  assert.strictEqual(armedInk.call({ annotationMode: true, activeTool: "marker" }), true);
  assert.strictEqual(armedInk.call({ annotationMode: true, activeTool: "highlighter" }), true);
  assert.strictEqual(armedInk.call({ annotationMode: true, activeTool: "rectangle" }), false,
    "shapes that can be labelled keep the defaults view");
  assert.strictEqual(armedInk.call({ annotationMode: true, activeTool: null }), false,
    "no tool armed = the ordinary defaults-editing state");
  assert.strictEqual(armedInk.call({ annotationMode: false, activeTool: "marker" }), false);
}

// ── the font row hides while ink is armed, returns on selection ───────────

{
  function rowSelf(armed, fontTargets) {
    const row = { style: {} }, num = { value: "x" };
    return {
      row, num,
      _paramsFontRow: row,
      _paramsFontNum: num,
      _fontTargetShapes: () => fontTargets || [],
      _paramsTargetShapes: () => [],
      _armedInkTool: () => armed,
      _hasPinnedFontSize: () => false,
      _textEditHost: () => null,
      _textEditor: null,
      _markerScale: () => 1,
      _inkScale: () => 1,
      lineParams: { font_size: 18 },
    };
  }
  const armed = rowSelf(true);
  syncFontRow.call(armed);
  assert.strictEqual(armed.row.style.display, "none",
    "a marker stroke takes no label at creation — the size row is noise");

  const idle = rowSelf(false);
  syncFontRow.call(idle);
  assert.strictEqual(idle.row.style.display, "",
    "no tool armed: the row edits the default, as ever");

  const selected = rowSelf(true, [{ kind: "text", style: {} }]);
  syncFontRow.call(selected);
  assert.strictEqual(selected.row.style.display, "",
    "selection always wins — a labelled shape shows its rows whatever is armed");
}

// ── the sibling gates ride the same predicate ─────────────────────────────

{
  for (const [needle, what] of [
    ["var global = !targets.length && !this._paramsTargetShapes().length &&\n        !this._armedInkTool();", "size and plate rows"],
    ["!this._armedInkTool()) ||\n          targets.some(function(s) { return self._isStrokeShape(s.kind); });", "the fill buttons"],
    ["onLabel || !this._armedInkTool() ? \"\" : \"none\";", "the Text/Behind chips"],
  ]) {
    assert.ok(src.includes(needle), `gate missing on ${what}`);
  }
  const count = (src.match(/var global = !targets\.length && !this\._paramsTargetShapes\(\)\.length &&\s*\n\s*!this\._armedInkTool\(\);/g) || []).length;
  assert.strictEqual(count, 2, "both the size row and the plate row carry the gate");
}

console.log("armed ink panel: all checks passed");
