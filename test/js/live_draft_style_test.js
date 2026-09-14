// Pins that a shape being drawn follows the style panel live.
//
// A draft takes its style once, when it is created. That was fine while a
// draft only lived for the length of a drag — but a click now ARMS one,
// and it sits there following the cursor until the second click. During
// that time the obvious thing to do is set the thickness or line type you
// want before committing. Nothing happened until the placing click, at
// which point the shape appeared in the style chosen a moment earlier:
// the right answer, arriving too late to judge it by.
//
// `_styleForNewShape` is the same function the commit uses, so what you
// see while sliding the slider is exactly what you get.
//
//   node test/js/live_draft_style_test.js

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

const restyleDrafts = extract("_restyleDrafts");
const setLineParam = extract("_setLineParam");
const setFontSize = extract("_setFontSize");
const styleForNewShape = extract("_styleForNewShape");
const isShaftKind = extract("_isShaftKind");
const isStrokeShape = extract("_isStrokeShape");

function board(over) {
  const self = Object.assign({
    rendered: [],
    coloured: [],
    activeColor: "#93c5fd",
    lineParams: { width: 4, opacity: 1, dash: "solid", fill: "semi" },
    _restyleDrafts: restyleDrafts,
    _styleForNewShape: styleForNewShape,
    _isShaftKind: isShaftKind,
    _isStrokeShape: isStrokeShape,
    _markerScale: () => 1,
    _getPref: () => null,
    _currentMarkerStyle() {
      const lp = this.lineParams;
      return { color: this.activeColor, width: lp.width, opacity: lp.opacity, dash: lp.dash };
    },
    _currentLineParams() {
      const lp = this.lineParams;
      const out = { color: this.activeColor, width: lp.width, opacity: lp.opacity,
                    dash: lp.dash, fill: lp.fill };
      if (lp.font_size) out.font_size = lp.font_size;
      return out;
    },
    _lineParamsForNewShape() {
      const lp = this._currentLineParams();
      const out = Object.assign({}, lp, { width: lp.width, width_units: "canvas" });
      return out;
    },
    _applyShapeColor(el, color, style) { this.coloured.push([el, color, style]); },
    _applyLineParams(el, style) { this.linedEl = [el, style]; },
    _renderShape(s) { this.rendered.push(s); },
    _renderPolygonPreview(h) { this.polyPreview = (this.polyPreview || 0) + 1; },
    _paramsTargetShapes: () => [],
    _fontTargetShapes: () => [],
    _snapshotShape: () => ({}),
    _pushUndo() {},
    _emitChanged() {},
    _emitLineParamsChanged() {},
    _syncParamsPopup() {},
    shapes: [],
  }, over || {});
  return self;
}

function draft(kind) {
  return { kind, el: { tag: kind }, style: { width: 4, dash: "solid" }, geometry: {} };
}

// ── the slider reaches the draft ──────────────────────────────────────────

{
  const d = draft("dimension");
  const self = board({ draftState: d });

  setLineParam.call(self, "width", 20, false);
  assert.strictEqual(self.lineParams.width, 20, "the default is what a click edits");
  assert.strictEqual(d.style.width, 20,
    "…and the shape being drawn changes under the slider, not on release");
  assert.deepStrictEqual(self.rendered, [d], "it repaints straight away");

  setLineParam.call(self, "dash", "dashed", false);
  assert.strictEqual(d.style.dash, "dashed", "line type too");

  setLineParam.call(self, "opacity", 0.4, false);
  assert.strictEqual(d.style.opacity, 0.4, "and opacity");
}

// ── what you see is what commits ──────────────────────────────────────────

{
  // The restyle and the commit read the SAME function, so the preview can't
  // promise something the committed shape won't honour.
  const d = draft("arrow");
  const self = board({ draftState: d });
  setLineParam.call(self, "width", 12, false);
  assert.deepStrictEqual(d.style, styleForNewShape.call(self, "arrow"),
    "the draft's style IS what a new shape of its kind would be given");
}

// ── every live draft, not just the one kind ───────────────────────────────

{
  // A callout draft was missed by the two special cases this replaced: the
  // colour path knew about `draftState` and `draftPolygon` only.
  const co = draft("callout");
  const self = board({ draftCallout: co });
  setLineParam.call(self, "width", 9, false);
  assert.strictEqual(co.style.width, 9, "a callout draft follows too");
  assert.deepStrictEqual(self.rendered, [co]);
}

{
  // The polygon preview is drawn by its own path, so it takes the params
  // directly — the way it does at creation.
  const poly = { el: { tag: "poly" } };
  const self = board({ draftPolygon: poly });
  setLineParam.call(self, "width", 7, false);
  assert.ok(self.linedEl && self.linedEl[0] === poly.el,
    "the polygon preview is repainted through _applyLineParams");
  assert.strictEqual(self.linedEl[1].width, 7);
  assert.strictEqual(self.polyPreview, 1, "and redrawn");
}

// ── colour and label size ride the same path ──────────────────────────────

{
  const d = draft("line");
  const self = board({ draftState: d });
  self.activeColor = "#ff0000";
  restyleDrafts.call(self);
  assert.strictEqual(d.style.color, "#ff0000", "colour reaches the draft");
  assert.strictEqual(self.coloured[0][1], "#ff0000",
    "…and is painted on the element, not just stored");

  const t = draft("text");
  const withText = board({ draftState: t });
  setFontSize.call(withText, 30, false);
  assert.strictEqual(t.style.font_size, 30, "label size reaches a text draft");
}

// ── it stays quiet when there is nothing being drawn ──────────────────────

{
  const self = board();
  setLineParam.call(self, "width", 15, false);
  assert.deepStrictEqual(self.rendered, [], "nothing to repaint");
  assert.strictEqual(self.lineParams.width, 15, "the default still changes");

  // Half-built drafts must not throw — a draft exists for a frame before
  // its element does.
  assert.doesNotThrow(() => restyleDrafts.call(board({ draftState: { kind: "line" } })));
  assert.doesNotThrow(() => restyleDrafts.call(board({ draftCallout: null })));
  assert.doesNotThrow(() => restyleDrafts.call(board({ draftPolygon: {} })));
}

// ── and it does NOT hijack an edit of a selected shape ────────────────────

{
  // With something selected the panel edits THAT, and the global default is
  // left alone — so there is nothing for a draft to follow. (Drawing and
  // having a selection are mutually exclusive in practice; this pins that
  // the restyle hangs off the global branch rather than running always.)
  const setBody = src.slice(src.indexOf("    _setLineParam: function"),
                            src.indexOf("\n    },", src.indexOf("    _setLineParam: function")));
  const elseAt = setBody.indexOf("} else {");
  assert.ok(elseAt !== -1);
  assert.ok(setBody.indexOf("this._restyleDrafts();") > elseAt,
    "the draft restyle belongs to the global-default branch");
}

console.log("live draft style: all checks passed");
