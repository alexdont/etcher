// Pins per-tool style memory: each shape tool keeps its OWN colour and line
// params (width, opacity, dash, fill, font size), so a thin red arrow and a
// thick blue rectangle stay that way when the user goes back and forth
// between them. A tool armed for the first time starts from the board's base
// style — never from whatever the previous tool was left in, which is the
// complaint this exists for (head dev, 2026-11-11).
//
//   node test/js/tool_style_memory_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

function constant(name) {
  const m = src.match(new RegExp(`var ${name} = ([\\s\\S]*?);\\n`));
  assert.ok(m, `could not find ${name}`);
  return eval("(" + m[1] + ")");
}
const STYLE_MEMORY_TOOLS = constant("STYLE_MEMORY_TOOLS");
const STYLE_MEMORY_PARAMS = constant("STYLE_MEMORY_PARAMS");
const DASH_MODES = constant("DASH_MODES");
const FILL_MODES = constant("FILL_MODES");
const FONT_SIZE_MIN = constant("FONT_SIZE_MIN");
const FONT_SIZE_MAX = constant("FONT_SIZE_MAX");

function extract(name) {
  const needle = `    ${name}: function`;
  const start = src.indexOf(needle);
  assert.notStrictEqual(start, -1, `could not find ${name}`);
  const end = src.indexOf("\n    },", start);
  return eval("(" + src.slice(start, end + "\n    }".length)
    .replace(`${name}: function`, "function") + ")");
}

function board() {
  const prefs = {};
  return {
    prefs,
    activeTool: null,
    activeColor: "#111111",
    _activeSlot: 0,
    _colorSlots: ["#111111", "#ff0000", "#0000ff", "#00aa00", "#ffaa00"],
    lineParams: { width: 2 },
    paramsPopup: null,
    _getPref(k) { return prefs[k]; },
    _setPref(k, v) { prefs[k] = v; },
    _refreshToolbarSwatches() {},
    _restyleDrafts() {},
    // The real _selectColor records too; here the pick is what matters.
    _selectColor(c) { this.activeColor = c; this._rememberToolStyle(); },
    _styleMemoryTool: extract("_styleMemoryTool"),
    _currentToolStyle: extract("_currentToolStyle"),
    _rememberToolStyle: extract("_rememberToolStyle"),
    _applyToolStyle: extract("_applyToolStyle"),
    _setLineParamsDirect: extract("_setLineParamsDirect"),
    arm(tool) { this.activeTool = tool; this._applyToolStyle(tool); },
    // What the controls do: change, then remember.
    setWidth(w) { this.lineParams.width = w; this._rememberToolStyle(); },
    pick(c) { this._activeSlot = this._colorSlots.indexOf(c); this._selectColor(c); },
  };
}

// ── each tool comes back the way it was left ──────────────────────────────
{
  const b = board();
  b.arm("rectangle");
  b.setWidth(8);
  b.pick("#0000ff");

  b.arm("arrow");
  assert.strictEqual(b.lineParams.width, 2, "a first-time arrow is not the rectangle's 8");
  assert.strictEqual(b.activeColor, "#111111", "nor its blue");
  b.setWidth(3);
  b.pick("#ff0000");

  b.arm("rectangle");
  assert.strictEqual(b.lineParams.width, 8);
  assert.strictEqual(b.activeColor, "#0000ff");
  assert.strictEqual(b._activeSlot, 2, "its swatch is the selected one");

  b.arm("arrow");
  assert.strictEqual(b.lineParams.width, 3);
  assert.strictEqual(b.activeColor, "#ff0000");

  assert.deepStrictEqual(Object.keys(b.prefs.tool_styles).sort(), ["arrow", "rectangle"],
    "saved in one preference, so it follows the user across boards");
}

// ── every param, not only the width ───────────────────────────────────────
{
  const b = board();
  b.arm("line");
  b.lineParams.dash = DASH_MODES[1];
  b.lineParams.opacity = 0.4;
  b._rememberToolStyle();
  b.arm("circle");
  assert.strictEqual(b.lineParams.dash, undefined, "the circle has no dash of the line's");
  assert.strictEqual(b.lineParams.opacity, undefined);
  b.arm("line");
  assert.strictEqual(b.lineParams.dash, DASH_MODES[1]);
  assert.strictEqual(b.lineParams.opacity, 0.4);
}

// ── a colour from the wheel (off the palette) stands with no swatch ───────
{
  const b = board();
  b.arm("text");
  b._activeSlot = -1;
  b._selectColor("#123456");
  b.arm("arrow");
  b.arm("text");
  assert.strictEqual(b.activeColor, "#123456");
  assert.strictEqual(b._activeSlot, -1);
}

// ── tools without a styled stroke remember nothing ────────────────────────
{
  const b = board();
  for (const tool of ["grabber", "eraser", "pointer", "image", "marker", "highlighter", null]) {
    b.activeTool = tool;
    b.setWidth(30);
  }
  assert.strictEqual(b.prefs.tool_styles, undefined,
    "the ink tools keep their own `<tool>_width` memory; the others draw no stroke");
  for (const t of STYLE_MEMORY_TOOLS) {
    assert.ok(["marker", "highlighter"].indexOf(t) === -1, `${t} is not an ink tool`);
  }
}

// ── putting a memory on screen is not a choice ────────────────────────────
{
  const b = board();
  b.arm("rectangle");
  b.setWidth(9);
  let writes = 0;
  const set = b._setPref.bind(b);
  b._setPref = (k, v) => { writes++; set(k, v); };
  b.arm("arrow");
  b.arm("rectangle");
  assert.strictEqual(writes, 0, "arming a tool reads its memory and writes nothing");
}

// ── wired into the real paths ─────────────────────────────────────────────
{
  const body = (name) => {
    const s = src.indexOf(`    ${name}: function`);
    return src.slice(s, src.indexOf("\n    },", s));
  };
  assert.ok(body("_selectTool").indexOf("self._applyToolStyle(toolKey)") !== -1,
    "arming a shape tool loads its style");
  assert.ok(body("_selectColor").indexOf("this._rememberToolStyle()") !== -1,
    "a colour pick is remembered");
  assert.ok(body("_setLineParam").indexOf("this._rememberToolStyle()") !== -1,
    "a thickness / opacity / dash / fill change is remembered");
  assert.ok(body("_setFontSize").indexOf("this._rememberToolStyle()") !== -1,
    "a font size change is remembered");
}

console.log("Tool style memory: all checks passed");
