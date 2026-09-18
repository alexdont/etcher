// Pins which style rows appear when the focus carries no stroke.
//
// "No targets" is two different situations. Nothing focused at all → the
// panel edits the global authoring defaults and every stroke row belongs.
// But a focus that simply has no stroke — a text shape, a focused label —
// used to fall into the same branch, so clicking a label box made the
// infill buttons (and the sliders) appear for a thing that has neither
// fill nor stroke, silently wired to the authoring defaults underneath.
//
//   node test/js/label_focus_params_test.js

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

const syncParams = extract("_syncParamsPopup");
const paramsTargets = extract("_paramsTargetShapes");
const isStrokeShape = extract("_isStrokeShape");
const isShaftKind = extract("_isShaftKind");

function row() { return { style: {} }; }

function panel(over) {
  return Object.assign({
    selectedShapes: [],
    editingShape: null,
    editingTitleShape: null,
    lineParams: { width: 2, opacity: 1, dash: "solid", fill: "semi" },
    _paramsTargetShapes: paramsTargets,
    _isStrokeShape: isStrokeShape,
    _isShaftKind: isShaftKind,
    _markerScale: () => 1,
    _sliderFromWeight: () => 0,
    _armedInkTool: () => false,
    _refreshLabelSwatch() {},
    _inkScale: () => 1,
    _syncFontRow() {},
    _syncLabelBgRow() {},
    _syncLabelSection() {},
    _paramsWeightRow: row(),
    _paramsOpacityRow: row(),
    _paramsDashRow: row(),
    _paramsFillRow: row(),
    _paramsWeightInput: { value: 0 },
    _paramsWeightVal: { textContent: "" },
    _paramsOpacityInput: { value: 0 },
    _paramsOpacityVal: { textContent: "" },
    _paramsDashBtns: [],
    _paramsFillBtns: [],
  }, over || {});
}

function visible(p) {
  return {
    weight: p._paramsWeightRow.style.display !== "none",
    opacity: p._paramsOpacityRow.style.display !== "none",
    dash: p._paramsDashRow.style.display !== "none",
    fill: p._paramsFillRow.style.display !== "none",
  };
}

// ── nothing focused: the authoring defaults, all rows ─────────────────────

{
  const p = panel();
  syncParams.call(p);
  assert.deepStrictEqual(visible(p),
    { weight: true, opacity: true, dash: true, fill: true },
    "with nothing focused the panel edits the defaults, which have all of these");
}

// ── a label box has neither stroke nor fill ───────────────────────────────

{
  // A text shape IS a label box — the report was literally "when I click
  // on a label box, the infill settings appear".
  const p = panel({ selectedShapes: [{ uuid: "t", kind: "text", style: {} }] });
  syncParams.call(p);
  assert.deepStrictEqual(visible(p),
    { weight: false, opacity: false, dash: false, fill: false },
    "a selected text shape must not surface stroke or fill controls");
}

{
  // A focused label on any shape: the label is the focus, not the shape.
  const p = panel({ editingTitleShape: { uuid: "r", kind: "rectangle", metadata: { title: "x" } } });
  syncParams.call(p);
  assert.deepStrictEqual(visible(p),
    { weight: false, opacity: false, dash: false, fill: false },
    "a focused label offers label controls, not its shape's stroke rows");
}

// ── shapes with strokes keep exactly what they had ────────────────────────

{
  const p = panel({ selectedShapes: [{ uuid: "r", kind: "rectangle", style: { width: 3 } }] });
  syncParams.call(p);
  assert.deepStrictEqual(visible(p),
    { weight: true, opacity: true, dash: true, fill: true },
    "a stroke shape shows the full set");
}

{
  // The pre-existing rule survives: a marker has a stroke but no fill.
  const p = panel({ selectedShapes: [{ uuid: "m", kind: "marker", style: { width: 3 } }] });
  syncParams.call(p);
  const v = visible(p);
  assert.strictEqual(v.weight, true, "a marker has thickness");
  assert.strictEqual(v.fill, false, "…but nothing to fill");
}

console.log("label focus params: all checks passed");
