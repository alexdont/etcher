// Pins the fresh-shape default mirroring.
//
// Draw a shape; it comes up selected. While that CREATION selection
// lasts, panel edits do double duty: they restyle the shape AND become
// the tool's defaults, so the next one comes out identical — draw,
// tune, keep drawing. The moment the user clicks off, freshness ends
// for good: re-selecting the same shape later is a one-time edit that
// leaves the defaults alone, exactly as selection edits always were.
//
//   node test/js/fresh_shape_defaults_test.js

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

const freshTargets = extract("_freshTargets");
const setLineParam = extract("_setLineParam");

// ── the freshness predicate itself ────────────────────────────────────────

{
  const shape = { uuid: "s" };
  const other = { uuid: "o" };
  const base = { _freshShape: shape, editingShape: shape, selectedShapes: [] };
  assert.strictEqual(freshTargets.call(base, [shape]), true,
    "the just-drawn shape, still in its creation edit mode");
  assert.strictEqual(freshTargets.call(
    { _freshShape: shape, editingShape: null,
      selectedShapes: [shape] }, [shape]), true,
    "…or its creation selection");
  assert.strictEqual(freshTargets.call(
    { _freshShape: null, editingShape: shape, selectedShapes: [] }, [shape]),
    false, "no fresh shape — a re-selected shape is a one-time edit");
  assert.strictEqual(freshTargets.call(base, [other]), false,
    "a different target is never fresh");
  assert.strictEqual(freshTargets.call(base, [shape, other]), false,
    "a multi-selection is a batch edit, not a tuning session");
}

// ── a fresh shape's thickness becomes the tool's thickness ────────────────

{
  const shape = { uuid: "s", kind: "line", style: {} };
  function board(fresh) {
    const emits = { lineParams: 0, changed: 0 };
    return {
      emits,
      _freshShape: fresh ? shape : null,
      editingShape: shape,
      selectedShapes: [],
      lineParams: { width: 2 },
      _paramsTargetShapes: () => [shape],
      _freshTargets: freshTargets,
      _isStrokeShape: () => false,
      _isShaftKind: (k) => k === "line",
      _inkScale: () => 1,
      _markerScale: () => 1,
      _renderShape() {},
      _applyLineParams() {},
      _restyleDrafts() {},
      _snapshotShape: () => ({}),
      _pushUndo() {},
      shapes: [shape],
      _emitChanged() { emits.changed++; },
      _emitLineParamsChanged() { emits.lineParams++; },
    };
  }

  const fresh = board(true);
  setLineParam.call(fresh, "width", 7, true);
  assert.strictEqual(shape.style.width, 7, "the shape takes the value");
  assert.strictEqual(fresh.lineParams.width, 7,
    "…and so does the tool — the next line comes out at 7");
  assert.strictEqual(fresh.emits.lineParams, 1,
    "the default change persists like a nothing-selected edit would");

  shape.style = {};
  const stale = board(false);
  setLineParam.call(stale, "width", 9, true);
  assert.strictEqual(shape.style.width, 9, "a re-selected shape still edits");
  assert.strictEqual(stale.lineParams.width, 2,
    "…but one-time: the tool's defaults are left alone");
  assert.strictEqual(stale.emits.lineParams, 0,
    "and nothing pretends the defaults changed");
}

// ── the wiring the fakes cannot reach ─────────────────────────────────────

{
  assert.ok(src.includes("this._freshShape = shape;"),
    "_finalizeShape marks the just-drawn shape fresh (after its own " +
    "enter-edit teardown, or the flag would clear itself)");
  const exitAt = src.indexOf("_exitEditMode: function()");
  assert.ok(src.slice(exitAt, exitAt + 300).includes("this._freshShape = null;"),
    "leaving edit mode ends freshness for good");
  const clearAt = src.indexOf("_clearSelection: function()");
  assert.ok(src.slice(clearAt, clearAt + 200).includes("this._freshShape = null;"),
    "so does clearing the selection");
  for (const [site, what] of [
    ["if (this._freshTargets(colorTargets)) this._selectColor(color);", "colour"],
    ['if (this._freshTargets(shapes)) this._setPref("label_color", color);', "label ink"],
    ["if (color) this._setPref(\"label_bg_last\", color);", "label plate"],
    ["this._fontFreshMirror = true;", "label size"],
  ]) {
    assert.ok(src.includes(site), `fresh mirror missing for ${what}`);
  }
}

console.log("fresh shape defaults: all checks passed");
