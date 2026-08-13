// Pins what selecting a shape looks like, and that a fresh shape is born
// selected.
//
// User feedback, verbatim in spirit: selecting a solid line appeared to
// CHANGE the line to a dashed one, and finishing a stroke required a second
// click on it before the thickness / dash / color controls would target it.
// The first was `.is-selected` / `.is-editing` forcing `stroke-dasharray`
// (the orange stroke/fill overrides in the same rules were already dead —
// inline styles from `_applyShapeColor` beat them — so the dash was the
// entire visible effect). The second was `_finalizeShape` dropping back to
// the cursor tool and stopping there.
//
// Now: selection paints a blue outline via stacked drop-shadow filters and
// never touches the shape's own stroke, and `_finalizeShape` enters edit
// mode on the shape it just created.
//
//   node test/js/selection_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

// ── the injected stylesheet, as the browser would receive it ────────────────

const cssStart = src.indexOf("var css = [");
assert.notStrictEqual(cssStart, -1, "could not find the style array");
const cssEnd = src.indexOf('].join("\\n");', cssStart);
assert.notStrictEqual(cssEnd, -1, "could not find the end of the style array");
// The array interpolates a few top-level constants (connector-dot colors);
// pull their declarations in rather than hardcoding stand-in values.
for (const name of ["CONNECTOR_DOT_CORE", "CONNECTOR_DOT_RING"]) {
  const m = src.match(new RegExp(`var ${name} = [^;]+;`));
  assert.ok(m, `could not find the ${name} constant the style array uses`);
  eval("global." + m[0].slice(4));
}
const css = eval(src.slice(cssStart + "var css = ".length, cssEnd + 1)).join("\n");

// One rule body per selector, tolerant of shared selector lists.
function ruleFor(selector) {
  const rules = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selectors = m[1].split(",").map((s) => s.trim());
    if (selectors.indexOf(selector) !== -1) rules.push(m[2]);
  }
  return rules.join(";");
}

// ── selection must not restyle the line itself ──────────────────────────────

for (const state of [".etcher-shape.is-selected", ".etcher-shape.is-editing",
                     ".etcher-shape.is-multi-selected", ".etcher-shape.is-hovered"]) {
  const body = ruleFor(state);
  assert.ok(body.length, `no rule found for ${state}`);
  assert.ok(!/stroke-dasharray/.test(body),
    `${state} forces a dash pattern — selecting a solid line will appear to change it to a dashed one`);
  // The orange recolor was dead code (inline styles win), but dead code that
  // LOOKS like the selection style is how the next edit resurrects it.
  assert.ok(!/stroke\s*:/.test(body) && !/fill\s*:/.test(body),
    `${state} overrides the shape's own paint (stroke/fill)`);
}

// ── ...it outlines the vector in blue instead ───────────────────────────────

for (const state of [".etcher-shape.is-selected", ".etcher-shape.is-editing",
                     ".etcher-shape.is-multi-selected"]) {
  const body = ruleFor(state);
  assert.ok(/drop-shadow\([^)]*#3b82f6\)/.test(body),
    `${state} has no blue outline — selection would be invisible on the shape body`);
}
assert.ok(/drop-shadow/.test(ruleFor(".etcher-shape.is-hovered")),
  "hover lost its glow — with the old fill/stroke overrides gone it needs the filter to show at all");

// ── the states that opt out of the filter still do ──────────────────────────

// Images: the drop-shadow lands outside the box where the corner clip-path
// removes it; they get a real ring element instead. Text: selection already
// shows on the bbox stroke, and outlining every glyph reads as bolding.
for (const prefix of ["image.etcher-shape", ".etcher-shape.etcher-text"]) {
  for (const state of ["is-selected", "is-editing", "is-multi-selected", "is-hovered"]) {
    assert.ok(/filter\s*:\s*none/.test(ruleFor(`${prefix}.${state}`)),
      `${prefix}.${state} no longer opts out of the outline filter`);
  }
}

// The image ring speaks the same selection language as everything else.
assert.ok(/#3b82f6/.test(ruleFor(".etcher-image-ring")),
  "the image selection ring is not blue while every other selected shape is");

// The text bbox shows selection in the same blue, not the old dash.
{
  const body = ruleFor(".etcher-text.is-selected .etcher-text-rect");
  assert.ok(/#3b82f6/.test(body) && !/stroke-dasharray/.test(body),
    "a selected text box should carry a solid blue border, not a dash");
}

// ── what selection must NOT have broken ─────────────────────────────────────

// Drafts keep the dashed in-progress look — that dash means "still being
// drawn", which is a different statement from "selected".
assert.ok(/stroke-dasharray/.test(ruleFor(".etcher-shape.is-draft")),
  "the draft (mid-draw) dash went missing");
// The edit-mode interaction plumbing rides the same class as the visuals.
assert.ok(/visiblePainted/.test(ruleFor(".etcher-shape.is-editing")),
  "edit mode lost pointer-events: visiblePainted — the shape body can no longer be dragged");
assert.ok(/cursor:\s*grab/.test(ruleFor(".etcher-shape.is-editing")),
  "edit mode lost its grab cursor");

// ── a fresh shape is born selected ──────────────────────────────────────────

function extract(name) {
  const needle = `    ${name}: function`;
  const start = src.indexOf(needle);
  assert.notStrictEqual(start, -1, `could not find ${name}`);
  const end = src.indexOf("\n    },", start);
  assert.notStrictEqual(end, -1, `could not find the end of ${name}`);
  return eval("(" + src.slice(start, end + "\n    }".length)
    .replace(`${name}: function`, "function") + ")");
}

global.genUuidV7 = () => "uuid-test";
const finalize = extract("_finalizeShape");

function run(kind, afterCreate) {
  const calls = [];
  const ctx = {
    shapes: [],
    activeColor: "#ff0000",
    handleKind: "canvas",
    handle: {},
    _currentMarkerStyle: () => ({}),
    _isStrokeShape: (k) => ["rectangle", "circle", "polygon", "freehand"].indexOf(k) !== -1,
    _lineParamsForNewShape: () => ({ color: "#ff0000" }),
    _markerScale: () => 1,
    _resolveCanvasImageId: () => null,
    _renderShape: () => {},
    _applyLineParams: () => {},
    _attachShapeInteractions: () => {},
    _pushUndoCreate: () => {},
    _emitChanged: () => {},
    _syncDraftHandles: () => {},
    _selectTool: (k) => calls.push(["selectTool", k]),
    _enterEditMode: (s) => calls.push(["enterEditMode", s && s.uuid]),
    draftState: {}
  };
  const el = { setAttribute: () => {}, classList: { remove: () => {} } };
  finalize.call(ctx, kind, {}, el, afterCreate);
  return { calls, ctx };
}

// A drawn rectangle: cursor tool first, then edit mode on the new shape —
// in that order, since `_selectTool` with a real tool exits edit mode.
{
  const { calls, ctx } = run("rectangle");
  assert.deepStrictEqual(calls, [["selectTool", null], ["enterEditMode", "uuid-test"]],
    `rectangle create should select the cursor then the shape, got ${JSON.stringify(calls)}`);
  assert.ok(ctx._suppressEditDismissUntil > Date.now(),
    "the dismiss guard was not armed — the gesture's own synthesized click can tear the selection down");
}

// The marker stays armed for the next stroke: no tool flip, no selection.
{
  const { calls } = run("marker");
  assert.deepStrictEqual(calls, [],
    `marker create must leave the tool armed and select nothing, got ${JSON.stringify(calls)}`);
}

// An afterCreate hook owns what happens next (text → inline typing,
// media insert → its dialog); edit mode must not fight it.
{
  let after = 0;
  const { calls } = run("text", () => { after++; });
  assert.strictEqual(after, 1, "afterCreate did not run");
  assert.deepStrictEqual(calls, [["selectTool", null]],
    `with an afterCreate hook the shape must not also enter edit mode, got ${JSON.stringify(calls)}`);
}

// ── the guard actually guards ───────────────────────────────────────────────

// `_enterEditMode` registers an outside-click dismisser; the click the
// browser synthesizes from the draw gesture's own pointerup arrives right
// after and can land outside the shape. Drive the registered handler
// directly: inside the guard window it must NOT dismiss; after it, it must.
{
  const noop = () => {};
  // Globals the outside-click handler closes over.
  global.CHROME_SELECTOR = ".etcher-nothing-matches";
  global.isInputOwner = () => false;
  const enterEdit = extract("_enterEditMode");
  let captured = null;
  global.document = {
    addEventListener: (type, fn, capture) => {
      if (type === "click") captured = fn;
    },
    removeEventListener: noop
  };
  const exits = [];
  const ctx = {
    editingShape: null,
    svg: { querySelectorAll: () => [] },
    _exitEditMode: () => exits.push(1),
    _exitTitleEditMode: noop, _refreshImageRing: noop, _removeConnectorDots: noop,
    _syncArrangeButtons: noop, _showLinkMenuFor: noop, _hideTooltip: noop,
    _syncToolbarColorToShape: noop, _renderHandles: noop,
    _hasMidpointHandles: () => false, _wireMidpointTracker: noop,
    _toImage: () => { throw new Error("no viewer"); },
    overlayWrapper: null,
    _connectorDotShape: null
  };
  const shape = { uuid: "u1", el: { classList: { add: noop, remove: noop } } };
  ctx._suppressEditDismissUntil = Date.now() + 60000;
  enterEdit.call(ctx, shape);
  assert.ok(captured, "the outside-click dismisser was never registered");
  // `_enterEditMode` clears any previous edit on entry; only clicks from
  // here on are the dismissals under test.
  exits.length = 0;

  const outsideClick = { target: { closest: () => null } };
  captured(outsideClick);
  assert.strictEqual(exits.length, 0,
    "an outside click inside the guard window dismissed the fresh selection");

  ctx._suppressEditDismissUntil = Date.now() - 1;
  captured(outsideClick);
  assert.strictEqual(exits.length, 1,
    "an outside click after the guard window should dismiss edit mode");
}

console.log("selection: all checks passed");
