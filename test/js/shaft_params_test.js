// Pins that the shaft kinds — line, arrow, dimension — carry real stroke
// params (thickness / opacity / line type), not just a color.
//
// Before this, `_paramsTargetShapes` excluded them, so selecting a line and
// opening the params popup silently edited the GLOBAL default while the
// line stayed 2px solid — the popup looked broken. Their widths were also
// re-derived every render frame from the board line scale, so nothing a
// style said about width could have survived a pan anyway.
//
// Now the render cases read the shape's style: a styled width (canvas
// units, like every other stroke) wins, arrowheads are sized off the shaft
// so a fat line gets a proportionate V, dash lands on the shaft only, and
// without a styled width each kind falls back to exactly what it rendered
// before — untouched boards don't change.
//
//   node test/js/shaft_params_test.js

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

global.DOT_GAP_RATIO = 2.4;

const isShaftKind = extract("_isShaftKind");
const shaftStrokePx = extract("_shaftStrokePx");
const applyShaftStroke = extract("_applyShaftStroke");
const applyStrokeDash = extract("_applyStrokeDash");
const paramsTargets = extract("_paramsTargetShapes");

// ── which kinds are shafts ──────────────────────────────────────────────────

for (const k of ["line", "arrow", "dimension"]) {
  assert.ok(isShaftKind(k), `${k} is a shaft kind`);
}
for (const k of ["rectangle", "freehand", "marker", "callout", "text", "image"]) {
  assert.ok(!isShaftKind(k), `${k} is not a shaft kind`);
}

// ── stroke width resolution ─────────────────────────────────────────────────

const AT_ZOOM_2 = { _markerScale: () => 2 };

// A styled width in canvas units scales with zoom, like every other stroke.
assert.strictEqual(
  shaftStrokePx.call(AT_ZOOM_2, { style: { width: 3, width_units: "canvas" } }, 99),
  6, "canvas-unit width should scale by the zoom");

// Floored so extreme zoom-out can't thin a shaft into invisibility.
assert.strictEqual(
  shaftStrokePx.call({ _markerScale: () => 0.01 },
    { style: { width: 3, width_units: "canvas" } }, 99),
  0.4, "sub-pixel widths must floor at 0.4");

// No styled width → the kind's own fallback, untouched. This is what keeps
// pre-params boards rendering byte-for-byte as before.
assert.strictEqual(shaftStrokePx.call(AT_ZOOM_2, { style: { color: "#f00" } }, 7.5), 7.5);
assert.strictEqual(shaftStrokePx.call(AT_ZOOM_2, { style: null }, 2), 2);
assert.strictEqual(shaftStrokePx.call(AT_ZOOM_2, {}, 2), 2);

// ── shaft vs head: who gets the dash ────────────────────────────────────────

function fakeEl() {
  return {
    style: {},
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = v; },
    removeAttribute(k) { delete this.attrs[k]; }
  };
}

{
  const ctx = { _applyStrokeDash: applyStrokeDash };
  const shape = { style: { dash: "dashed", opacity: 0.5 } };

  const shaft = fakeEl();
  applyShaftStroke.call(ctx, shaft, shape, 4, true);
  assert.strictEqual(shaft.style.strokeWidth, "4px");
  assert.strictEqual(shaft.style.strokeOpacity, "0.5");
  assert.strictEqual(shaft.attrs["stroke-dasharray"], "8.8 6.4",
    "the shaft takes the dash pattern, sized off its width");

  const head = fakeEl();
  applyShaftStroke.call(ctx, head, shape, 4, false);
  assert.strictEqual(head.style.strokeWidth, "4px");
  assert.strictEqual(head.style.strokeOpacity, "0.5");
  assert.ok(!("stroke-dasharray" in head.attrs),
    "arrowheads stay solid — a dashed V reads as broken");

  // The hardcoded builder attr must lose to the applied width, or hydrated
  // shafts would ignore their persisted thickness.
  const legacy = fakeEl();
  legacy.attrs["stroke-width"] = "2";
  applyShaftStroke.call(ctx, legacy, shape, 6, false);
  assert.ok(!("stroke-width" in legacy.attrs),
    "the builder's stroke-width attribute must be removed, not just overridden");
}

// Dotted needs the round linecap or it renders as nothing.
{
  const el = fakeEl();
  applyStrokeDash.call({}, el, "dotted", 5);
  assert.strictEqual(el.attrs["stroke-dasharray"], "0.01 " + 5 * 2.4);
  assert.strictEqual(el.style.strokeLinecap, "round");
}

// ── the params popup targets shafts now ─────────────────────────────────────

{
  const ctx = {
    _isStrokeShape: (k) =>
      ["rectangle", "circle", "polygon", "freehand"].indexOf(k) !== -1,
    _isShaftKind: isShaftKind,
    selectedShapes: null,
    editingShape: null
  };

  for (const kind of ["line", "arrow", "dimension"]) {
    ctx.editingShape = { kind };
    assert.strictEqual(paramsTargets.call(ctx).length, 1,
      `a selected ${kind} should be a params target — otherwise the popup silently edits the global default`);
  }
  ctx.editingShape = { kind: "text" };
  assert.strictEqual(paramsTargets.call(ctx).length, 0,
    "text still has no stroke params");
}

// ── the render cases actually consult the style ─────────────────────────────

// The width used to be recomputed from the board scale every frame, which
// is precisely why styling a shaft was impossible. Each case must now route
// through the two helpers; a case that stops is a case whose params are
// silently dead again.
{
  const renderStart = src.indexOf("        case \"dimension\": {");
  const renderEnd = src.indexOf("      // Inline title sibling", renderStart);
  assert.ok(renderStart !== -1 && renderEnd > renderStart,
    "could not isolate the shaft render cases");
  const cases = src.slice(renderStart, renderEnd);

  for (const kind of ["dimension", "line", "arrow"]) {
    const caseStart = cases.indexOf(`case "${kind}": {`);
    const caseEnd = cases.indexOf("break;", caseStart);
    assert.ok(caseStart !== -1 && caseEnd > caseStart, `could not isolate case ${kind}`);
    const body = cases.slice(caseStart, caseEnd);
    assert.ok(body.includes("_shaftStrokePx("),
      `the ${kind} render case no longer resolves its width from the shape's style`);
    assert.ok(body.includes("_applyShaftStroke("),
      `the ${kind} render case no longer applies stroke params`);
  }

  // Heads scale off the shaft, not off the default weight — the divisions
  // are what turn a styled width into a proportionate arrowhead. Matched as
  // assignments (`= …`): the explanatory comments quote the same expressions,
  // and matching those would pass with the code gone.
  assert.ok(cases.includes("= dimStroke / LINE_WEIGHT_PX"),
    "dimension heads are no longer sized off the shaft weight");
  assert.ok(cases.includes("= arW / LINE_WEIGHT_PX"),
    "arrow heads are no longer sized off the shaft weight");
}

// ── new shafts adopt the global params ──────────────────────────────────────

// Draw a line after setting thickness 8 → an 8px line, like every other
// stroke tool. And no `fill` key rides along: nothing to fill on a shaft.
// (The rules live in `_styleForNewShape`, which both `_finalizeShape` and
// every draft creator take their answer from — so what a shaft previews as
// and what it commits as cannot drift. See draft_style_test.js.)
{
  const start = src.indexOf("    _styleForNewShape: function(kind) {");
  assert.notStrictEqual(start, -1, "could not find _styleForNewShape");
  const branch = src.slice(start, src.indexOf("\n    },", start));
  assert.ok(branch.includes("_isShaftKind(kind)"),
    "new shafts no longer adopt the global stroke params at creation");
  assert.ok(branch.includes("delete shaft.fill"),
    "the dead fill key rides along on every shaft payload again");
}

console.log("shaft params: all checks passed");
