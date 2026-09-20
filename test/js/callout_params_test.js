// Pins that a callout is a line like any other line.
//
// Three things were wrong with it:
//
//   1. The thickness and line-type controls did nothing. A callout was not
//      in `_paramsTargetShapes`, so moving the sliders with one selected
//      silently edited the GLOBAL default for new shapes instead — the
//      controls looked broken and quietly changed something else.
//   2. Its render never read the params even when they were set.
//   3. The leader — the line joining the dot to the label — was not
//      clickable. The hit-test knew about the text box and the anchor dot
//      and nothing in between, so the part you naturally aim at did nothing.
//
//   node test/js/callout_params_test.js

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

const paramsTargets = extract("_paramsTargetShapes");
const styleForNewShape = extract("_styleForNewShape");
const containsPoint = extract("_shapeContainsPoint");
const setLineParam = extract("_setLineParam");
const nearSegment = extract("_nearSegment");
const nearestOnSegment = extract("_nearestOnSegment");
const shaftStrokePx = extract("_shaftStrokePx");

const isStrokeShape = (k) => ["rectangle", "circle", "polygon", "freehand"].indexOf(k) !== -1;
const isShaftKind = (k) => ["line", "arrow", "dimension"].indexOf(k) !== -1;

// ── the sliders apply to it ────────────────────────────────────────────────

{
  const self = { _isStrokeShape: isStrokeShape, _isShaftKind: isShaftKind };
  const callout = { kind: "callout" };

  self.selectedShapes = [callout];
  assert.deepStrictEqual(paramsTargets.call(self), [callout],
    "a selected callout is what the params popup edits");

  self.selectedShapes = [];
  self.editingShape = callout;
  assert.deepStrictEqual(paramsTargets.call(self), [callout],
    "…and so is one in edit mode");

  // It is NOT quietly promoted to a shaft kind: that flag drives arrowheads
  // and endpoint drags, which a callout has none of.
  assert.strictEqual(isShaftKind("callout"), false);
}

// ── a new one is born with the current params ──────────────────────────────

{
  const board = {
    activeColor: "#93c5fd",
    lineParams: { width: 8, opacity: 0.5, dash: "dotted", fill: "solid" },
    _isStrokeShape: isStrokeShape,
    _isShaftKind: isShaftKind,
    _markerScale: () => 2,
    _inkScale: () => 2,
    _getPref: () => null,
    _currentLineParams() {
      const lp = this.lineParams;
      return { color: this.activeColor, width: lp.width, opacity: lp.opacity,
               dash: lp.dash, fill: lp.fill };
    },
    _lineParamsForNewShape() {
      const lp = this._currentLineParams();
      return Object.assign({}, lp, {
        width: lp.width / this._markerScale(), width_units: "canvas",
      });
    },
    _currentMarkerStyle: () => ({}),
  };
  const s = styleForNewShape.call(board, "callout");
  assert.strictEqual(s.dash, "dotted", "takes the chosen line type");
  assert.strictEqual(s.width, 4, "and the chosen thickness, in canvas units");
  assert.strictEqual(s.opacity, 0.5);
  assert.strictEqual(s.color, "#93c5fd");
  assert.ok(!("fill" in s), "a leader is an open line — no fill key rides along");
}

// ── editing a param reaches the callout ────────────────────────────────────

{
  const rendered = [];
  const callout = { uuid: "c1", kind: "callout", style: {}, el: {} };
  const self = {
    selectedShapes: [callout],
    _isStrokeShape: isStrokeShape,
    _isShaftKind: isShaftKind,
    _paramsTargetShapes: paramsTargets,
    _freshTargets: () => false,
    _markerScale: () => 2,
    _inkScale: () => 2,
    _snapshotShape: () => ({}),
    _renderShape: (s) => rendered.push(s),
    _applyLineParams: () => assert.fail(
      "a callout must re-render — its stroke is applied by the render case, " +
      "not by painting params onto the <g>"),
    _syncParamsPopup: () => {},
    _armedInkTool: () => false,
    _setPref() {},
    _emitChanged: () => {},
    _pushUndo: () => {},
    shapes: [callout],
  };

  setLineParam.call(self, "dash", "dashed", false);
  assert.strictEqual(callout.style.dash, "dashed", "the line type lands on the shape");
  assert.deepStrictEqual(rendered, [callout], "and it re-renders");

  setLineParam.call(self, "width", 10, false);
  assert.strictEqual(callout.style.width, 5,
    "thickness is stored in canvas units, so it tracks zoom like every other line");
  assert.strictEqual(callout.style.width_units, "canvas");

  // The global default is untouched — the whole bug was that it wasn't.
  assert.strictEqual(self.lineParams, undefined);
}

// ── the whole callout is clickable ─────────────────────────────────────────

{
  // A callout whose label sits up and right of the dot it points at.
  const callout = {
    kind: "callout",
    geometry: { anchor: [100, 400], text_box: { x: 300, y: 100, w: 200, h: 60 } },
    _renderedBox: { x: 300, y: 100, w: 200, h: 60 },
    // Where the render left the leader: dot (100,400) → label corner
    // (300,160). Container px, identity projection in this test.
    _leaderContainer: { a: { x: 100, y: 400 }, b: { x: 300, y: 160 }, w: 2 },
  };
  const self = {
    _calloutTextBoxImage: (g) => g.text_box,
    _textDefaultBoxImagePx: () => 16,
    _imageToContainer: (p) => ({ x: p.x, y: p.y }),
    _nearSegment: nearSegment,
    _nearestOnSegment: nearestOnSegment,
  };

  // The label.
  assert.strictEqual(containsPoint.call(self, callout, { x: 400, y: 130 }), true,
    "the text box");
  // The dot.
  assert.strictEqual(containsPoint.call(self, callout, { x: 100, y: 400 }), true,
    "the anchor dot");
  // The leader — the part that did nothing before. Half way along it.
  assert.strictEqual(containsPoint.call(self, callout, { x: 200, y: 280 }), true,
    "the middle of the leader line");
  // …and near its ends, where the two old hit zones didn't quite reach.
  assert.strictEqual(containsPoint.call(self, callout, { x: 150, y: 340 }), true,
    "a quarter of the way along");
  assert.strictEqual(containsPoint.call(self, callout, { x: 250, y: 220 }), true,
    "three quarters");

  // Empty canvas beside the leader is still empty canvas.
  assert.strictEqual(containsPoint.call(self, callout, { x: 260, y: 300 }), false,
    "clear of the line");
  assert.strictEqual(containsPoint.call(self, callout, { x: 700, y: 700 }), false,
    "nowhere near any of it");

  // A fat leader is a fatter target, the way every other stroke is.
  const fat = Object.assign({}, callout, {
    _leaderContainer: { a: { x: 100, y: 400 }, b: { x: 300, y: 160 }, w: 60 },
  });
  assert.strictEqual(containsPoint.call(self, fat, { x: 218, y: 290 }), true,
    "within a fat leader's own width");

  // A callout that has never been rendered has no leader to test, and must
  // answer rather than throw.
  const unrendered = Object.assign({}, callout, { _leaderContainer: null });
  assert.strictEqual(containsPoint.call(self, unrendered, { x: 200, y: 280 }), false);
}

// ── the render paints the params onto the parts that are lines ────────────

{
  const start = src.indexOf('        case "callout": {', src.indexOf("_renderShape: function"));
  assert.notStrictEqual(start, -1, "could not find the callout render case");
  const body = src.slice(start, src.indexOf('\n        case "text": {', start));

  assert.ok(body.includes("self._applyShaftStroke(coLine, shape, coStrokePx, true)"),
    "the leader takes the thickness and the line type");
  assert.ok(body.includes("self._applyShaftStroke(coUnderline, shape, coStrokePx, true)"),
    "so does the underline");
  assert.ok(body.includes("_shaftStrokePx(shape, 2)"),
    "…read from the shape's own style, falling back to what it always drew");
  assert.ok(/coDot\.setAttribute\("r", Math\.max\(2, coStrokePx/.test(body),
    "the dot scales with the weight rather than staying a pinhead on a fat line");
  assert.ok(body.includes('coText.setAttribute("fill-opacity"'),
    "the label fades with the rest instead of staying solid over a ghosted leader");
  assert.ok(body.includes("shape._leaderContainer = {"),
    "the leader's endpoints are kept for the hit-test — only the render knows them");
}

// A styled width still tracks zoom, and an unstyled callout renders exactly
// as it always did.
{
  const self = { _markerScale: () => 3 };
  assert.strictEqual(shaftStrokePx.call(self, { style: {} }, 2), 2,
    "no styled width → the 2px it has always drawn");
  assert.strictEqual(
    shaftStrokePx.call(self, { style: { width: 4, width_units: "canvas" } }, 2), 12,
    "a styled width scales with the zoom");
}

console.log("callout params: all checks passed");
