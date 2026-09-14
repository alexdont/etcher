// Pins that a draft looks like the shape it is about to become.
//
// While you dragged one out, the preview was drawn in its own look —
// orange, `stroke-dasharray: 5 4`, orange body — and only on release did
// the shape snap to the thickness / dash / opacity / fill you had actually
// set in the style panel. So a solid 8px line previewed as a thin dashed
// one, and a marker stroke previewed dotted no matter what.
//
// Two halves to the fix, both pinned here:
//
//   1. `_styleForNewShape(kind)` is the ONE answer to "what does a new
//      shape of this kind look like" — the draft is drawn with it and
//      `_finalizeShape` commits it, so they cannot drift.
//   2. `.etcher-shape.is-draft` stops repainting. Its stroke and fill were
//      already dead on any coloured shape (inline styles beat class rules),
//      but its dasharray LANDED, because `_applyLineParams` writes dash as
//      a presentation attribute and any class rule outranks one.
//
//   node test/js/draft_style_test.js

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

// `_applyStrokeDash` closes over the module-level dot-gap constant; lift
// the real value rather than a guess so the assertions below stay honest.
{
  const m = src.match(/var DOT_GAP_RATIO = ([\d.]+);/);
  assert.ok(m, "could not find DOT_GAP_RATIO");
  global.DOT_GAP_RATIO = Number(m[1]);
}

const styleForNewShape = extract("_styleForNewShape");
const isStrokeShape = extract("_isStrokeShape");
const isShaftKind = extract("_isShaftKind");
const applyStrokeDash = extract("_applyStrokeDash");

// A board with a deliberately non-default style set in the panel: fat,
// dotted, half-opaque. Nothing about a draft should look like the defaults.
function board() {
  return {
    activeColor: "#93c5fd",
    lineParams: { width: 8, opacity: 0.5, dash: "dotted", fill: "solid" },
    _isStrokeShape: isStrokeShape,
    _isShaftKind: isShaftKind,
    _styleForNewShape: styleForNewShape,
    _markerScale: () => 2,
    _getPref: () => null,
    _currentLineParams() {
      const lp = this.lineParams;
      return {
        color: this.activeColor,
        width: lp.width,
        opacity: lp.opacity,
        dash: lp.dash,
        fill: lp.fill,
      };
    },
    _lineParamsForNewShape() {
      const lp = this._currentLineParams();
      return Object.assign({}, lp, {
        width: lp.width / this._markerScale(),
        width_units: "canvas",
      });
    },
    _currentMarkerStyle() {
      const lp = this.lineParams;
      return {
        color: this.activeColor,
        width: lp.width / this._markerScale(),
        opacity: lp.opacity,
        dash: lp.dash,
      };
    },
  };
}

// ── every kind's style carries the panel's settings ────────────────────────

for (const kind of ["rectangle", "circle", "polygon", "freehand"]) {
  const s = styleForNewShape.call(board(), kind);
  assert.strictEqual(s.dash, "dotted", `${kind} takes the chosen line type`);
  assert.strictEqual(s.opacity, 0.5, `${kind} takes the chosen opacity`);
  assert.strictEqual(s.fill, "solid", `${kind} takes the chosen fill`);
  assert.strictEqual(s.width, 4, `${kind} width converts to canvas units`);
  assert.strictEqual(s.width_units, "canvas");
}

for (const kind of ["line", "arrow", "dimension"]) {
  const s = styleForNewShape.call(board(), kind);
  assert.strictEqual(s.dash, "dotted", `${kind} takes the chosen line type`);
  assert.strictEqual(s.opacity, 0.5, `${kind} takes the chosen opacity`);
  assert.ok(!("fill" in s), `${kind} is an open shaft — no fill key rides along`);
}

{
  const s = styleForNewShape.call(board(), "marker");
  assert.strictEqual(s.dash, "dotted", "marker takes the chosen line type");
  assert.strictEqual(s.opacity, 0.5, "marker takes the chosen opacity");
  assert.strictEqual(s.width, 4, "marker width is image px at this zoom");
}

{
  // A text shape is a label: it starts in the remembered label colour, and
  // falls back to the stroke colour when none is remembered.
  const remembered = board();
  remembered._getPref = (k) => (k === "label_color" ? "#fde68a" : null);
  assert.deepStrictEqual(styleForNewShape.call(remembered, "text"),
    { color: "#fde68a" });
  assert.deepStrictEqual(styleForNewShape.call(board(), "text"),
    { color: "#93c5fd" });
  // Anything else just carries the colour.
  assert.deepStrictEqual(styleForNewShape.call(board(), "callout"),
    { color: "#93c5fd" });
}

// ── the draft is drawn with that same style ────────────────────────────────

// Each draft creator must hand its draftState the style, or `_renderShape`
// skips the params (it is guarded on `shape.style`) and the preview falls
// back to the hardcoded 2px.
for (const [fn, kind] of [
  ["_startRectangle", "rectangle"],
  ["_startCircle", "circle"],
  ["_startLine", "line"],
  ["_startDimension", "dimension"],
]) {
  const body = src.slice(src.indexOf(`    ${fn}: function`),
                         src.indexOf("\n    },", src.indexOf(`    ${fn}: function`)));
  assert.ok(body.includes(`_styleForNewShape("${kind}")`),
    `${fn} draws its draft with the committed style`);
  assert.ok(/style:/.test(body), `${fn} puts the style on the draftState`);
}

{
  // Freehand and marker share one creator and derive the kind.
  const body = src.slice(src.indexOf("    _startStroke: function"),
                         src.indexOf("\n    },", src.indexOf("    _startStroke: function")));
  assert.ok(body.includes("this._styleForNewShape(kind)"),
    "the shared stroke creator uses the committed style for both kinds");
  assert.ok(body.includes("style: strokeStyle"),
    "and hands it to the draftState so every frame re-applies it at zoom");
  assert.ok(body.includes("this._markerScale()"),
    "the first paint is scaled too, not left at image px");
}

{
  // The polygon preview is drawn by its own path, so it takes the params
  // directly rather than through _renderShape.
  const body = src.slice(src.indexOf("    _polygonClick: function"),
                         src.indexOf("\n    },", src.indexOf("    _polygonClick: function")));
  assert.ok(body.includes('_styleForNewShape("polygon")') &&
              body.includes("_applyLineParams(poly,"),
    "the polygon preview paints the real params");
}

{
  const body = src.slice(src.indexOf("    _startArrowDrag: function"),
                         src.indexOf("\n    },", src.indexOf("    _startArrowDrag: function")));
  assert.ok(body.includes('_styleForNewShape("arrow")'),
    "an arrow dragged off a connector dot previews at its committed style");
}

// `_finalizeShape` must take the SAME answer, or release still changes the
// look — the whole point of the shared helper.
{
  const body = src.slice(src.indexOf("    _finalizeShape: function"),
                         src.indexOf("\n    },", src.indexOf("    _finalizeShape: function")));
  assert.ok(body.includes("var style = this._styleForNewShape(kind);"),
    "finalize commits the same style the draft was drawn with");
  assert.ok(!body.includes("_currentMarkerStyle()") &&
              !body.includes("_lineParamsForNewShape()"),
    "and does not keep its own private copy of the rules");
}

// ── the draft class no longer repaints the style ───────────────────────────

{
  const start = src.indexOf('".etcher-shape.is-draft {"');
  assert.notStrictEqual(start, -1, "the draft rule should still exist");
  const rule = src.slice(start, src.indexOf('"}"', start));
  assert.ok(rule.includes("pointer-events: none;"),
    "a draft still lets pointer events through to the tool");
  assert.ok(!rule.includes("stroke-dasharray"),
    "no forced dash — this is what made every preview look dashed");
  assert.ok(!rule.includes("#f59e0b") && !rule.includes("fill:"),
    "no forced orange stroke or body either");
}

// The text bbox keeps ITS dashed affordance: that marks out an invisible
// box, it is not a claim about the stroke style.
assert.ok(
  src.includes('".etcher-text.is-draft   .etcher-text-rect {"'),
  "the text draft's dashed bbox is untouched"
);

// ── and the dash the style asks for is the dash that gets drawn ────────────

{
  function dashOf(dash, w) {
    const el = {
      style: {},
      attrs: {},
      setAttribute(k, v) { this.attrs[k] = v; },
      removeAttribute(k) { delete this.attrs[k]; },
    };
    applyStrokeDash.call({}, el, dash, w);
    return el.attrs["stroke-dasharray"];
  }
  assert.strictEqual(dashOf("solid", 8), undefined, "solid draws no pattern");
  assert.ok(dashOf("dashed", 8), "dashed draws a pattern");
  assert.ok(dashOf("dotted", 8).startsWith("0.01 "), "dotted draws dots");
  // The forced 5 4 from the old draft rule matched none of these — which is
  // exactly why the preview never agreed with the committed shape.
  assert.notStrictEqual(dashOf("dashed", 8), "5 4");
}

console.log("draft style: all checks passed");
