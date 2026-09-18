// Pins the ink-sizing policy.
//
// The old behaviour: a panel value meant "this many px on screen right
// now", so a 3px line drawn zoomed-in and a 3px line drawn zoomed-out
// were different real thicknesses — visually constant for the hand,
// inconsistent for the drawing. Head dev's call: consistency wins by
// default — every stroke drawn at 3 IS the same thickness — and the old
// behaviour lives on behind the ⋯ toggle ("zoom_anchor"). Rendering is
// untouched either way: stored canvas units × the current zoom, so ink
// always scales with the drawing.
//
// What a value MEASURES is the canvas, not its pixels: the panel number
// is quoted against a reference canvas, so a 5 on a small photo and a 5
// on a huge one look the same when both are viewed at the same size.
// Stored as document px still (nothing about rendering or old shapes
// changes), but the number the user types converts through the canvas's
// own size on the way in and back out.
//
//   node test/js/ink_scale_test.js

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

const inkScale = extract("_inkScale");
const canvasInkScale = extract("_canvasInkScale");
const REFERENCE = (() => {
  const m = src.match(/var REFERENCE_CANVAS_PX = (\d+);/);
  assert.ok(m, "the reference canvas size must exist");
  return Number(m[1]);
})();
global.REFERENCE_CANVAS_PX = REFERENCE;
const lineParamsForNew = extract("_lineParamsForNewShape");
const markerStyle = extract("_currentMarkerStyle");

function board(anchored, zoom, imageSize) {
  const prefs = anchored ? { zoom_anchor: true } : {};
  return {
    // No imageSize → scale 1, which is the behaviour every assertion
    // below was written against.
    imageSize: imageSize || null,
    _getPref: (k) => prefs[k],
    _markerScale: () => zoom,
    _inkScale: inkScale,
    _canvasInkScale: canvasInkScale,
    _currentLineParams: () => ({ width: 3, opacity: 1, dash: "solid" }),
    lineParams: { width: 3 },
    activeColor: "#fca5a5",
    activeTool: "marker",
  };
}

// ── the default: a value is document px, whatever the zoom ───────────────

{
  const zoomedIn = lineParamsForNew.call(board(false, 4));
  const zoomedOut = lineParamsForNew.call(board(false, 0.25));
  assert.strictEqual(zoomedIn.width, 3, "3 means 3, drawn zoomed in");
  assert.strictEqual(zoomedOut.width, 3, "3 means 3, drawn zoomed out");
  assert.strictEqual(zoomedIn.width, zoomedOut.width,
    "two strokes drawn at wildly different zooms are the SAME thickness — " +
    "the consistency the whole change is for");
  assert.strictEqual(zoomedIn.width_units, "canvas",
    "still canvas units — rendering (and old shapes) are untouched");

  const mk = markerStyle.call(board(false, 4));
  assert.strictEqual(mk.width, 3, "the marker sizes the same way");
}

// ── the ⋯ toggle restores the old draw-what-you-see behaviour ─────────────

{
  const zoomedIn = lineParamsForNew.call(board(true, 4));
  const zoomedOut = lineParamsForNew.call(board(true, 0.25));
  assert.strictEqual(zoomedIn.width, 3 / 4,
    "anchored: the value is screen px at draw time");
  assert.strictEqual(zoomedOut.width, 3 / 0.25,
    "…so different zooms give different real thicknesses, as before");
}

// ── one conversion, used by panel reads and writes alike ─────────────────

{
  // Every panel<->storage conversion goes through _inkScale, so the number
  // shown for a selected shape and the number stored on a new one can
  // never disagree about what a px means.
  for (const site of [
    "* this._inkScale()));",            // width displays (marker popup, params popup)
    'prop === "width" ? value / this._inkScale() : value;', // marker slider store
    "shape.style.width = value / self._inkScale();",        // shape slider store
    "width: (lp.width || 2) / this._inkScale(),",           // new marker style
    "textStyle.font_size = lp.font_size / this._inkScale();", // text creation
    "px = Math.round(first.style.font_size * this._inkScale());", // font row display
  ]) {
    assert.ok(src.includes(site), `conversion site missing: ${site}`);
  }
  assert.ok(!/var scale = 1;\s*\n\s*try \{ scale = self\._markerScale\(\)/.test(
    src.slice(src.indexOf("_setFontSize: function"), src.indexOf("_setFontSize: function") + 800)),
    "_setFontSize converts through _inkScale, not raw zoom");
}

// ── text defaults ride the same policy ────────────────────────────────────

{
  // The lines got the uniform treatment first; text minted through the
  // default box was still zoom-baked. The ink twin sizes what NEW text
  // comes out at; the screen-relative original stays for gesture
  // thresholds and hit tolerances.
  const inkBox = extract("_textDefaultBoxInkPx");
  const on = { _getPref: (k) => (k === "zoom_anchor" ? true : null),
    _markerScale: () => 4, _inkScale: inkScale, _canvasInkScale: canvasInkScale };
  const off = { _getPref: () => null, _markerScale: () => 4, _inkScale: inkScale,
    _canvasInkScale: canvasInkScale };
  assert.strictEqual(inkBox.call(off), 16,
    "un-anchored: 16 image px, whatever the zoom — same relative text size");
  assert.strictEqual(inkBox.call(on), 4,
    "anchored: screen-constant, the old behaviour, behind the toggle");
  for (const [site, what] of [
    ["var basePx = this._textDefaultBoxInkPx();\n      var w = basePx * 6;", "legacy callout box"],
    ["shape._titleBasePx = this._textDefaultBoxInkPx();", "a label's first box"],
    ["var boxPx = this._textDefaultBoxInkPx();", "a clicked text's minted box"],
  ]) {
    assert.ok(s_includes(site), `text-size mint not ink-scaled: ${what}`);
  }
  function s_includes(needle) { return src.includes(needle.replace(/\\n/g, "\n")); }
  // The gesture threshold deliberately stays screen-relative.
  assert.ok(src.includes("var minImagePx = this._textDefaultBoxImagePx();"),
    "click-vs-drag is a finger judgement and keeps the screen-relative unit");
}

// ── the switch lives with the other view toggles ──────────────────────────

{
  assert.ok(src.includes('self._setPref("zoom_anchor", !self._zoomAnchorOn());'),
    "the ⋯ menu button flips the persisted preference");
  assert.ok(src.includes('this.zoomAnchorBtn.setAttribute("aria-pressed", zaOn ? "true" : "false");'),
    "and announces its state like the rest");
}

console.log("ink scale: all checks passed");

// ── the same number is the same thickness on any resolution ───────────────

{
  // The complaint this answers: a 5 set on a low-res image was a fat
  // stroke, and the same 5 on a high-res one a hairline — the value was
  // a count of document pixels, and a big image simply has more of them.
  const small = lineParamsForNew.call(board(false, 1, { x: 800, y: 600 }));
  const huge = lineParamsForNew.call(board(false, 1, { x: 11384, y: 4221 }));
  assert.strictEqual(small.width, 3 * 800 / REFERENCE);
  assert.strictEqual(huge.width, 3 * 11384 / REFERENCE);
  assert.ok(huge.width > small.width * 14,
    "the big canvas stores a proportionally bigger number of its own px");

  // …and that is exactly what makes them LOOK the same. Displayed at one
  // size, the zoom each needs is inversely proportional to its pixels, so
  // the rendered weights land on top of each other.
  const shown = 1000;                       // both images displayed 1000px wide
  const renderedSmall = small.width * (shown / 800);
  const renderedHuge = huge.width * (shown / 11384);
  assert.ok(Math.abs(renderedSmall - renderedHuge) < 1e-9,
    "same number, same ink on screen — whatever the image's resolution");
  assert.strictEqual(Math.round(renderedSmall), 3,
    "…and it is the number the user typed, at the reference size");
}

{
  // The longest side, so landscape and portrait of the same picture agree.
  assert.strictEqual(canvasInkScale.call({ imageSize: { x: 4000, y: 3000 } }),
    REFERENCE / 4000);
  assert.strictEqual(canvasInkScale.call({ imageSize: { x: 3000, y: 4000 } }),
    REFERENCE / 4000);
  // A board that cannot report a size keeps the old behaviour exactly.
  assert.strictEqual(canvasInkScale.call({}), 1);
  assert.strictEqual(canvasInkScale.call({ imageSize: { x: 0, y: 0 } }), 1);
  assert.strictEqual(canvasInkScale.call({ imageSize: { x: Infinity, y: 2 } }), 1);
  assert.strictEqual(canvasInkScale.call({ imageSize: { x: REFERENCE, y: 10 } }), 1,
    "the reference canvas itself is unscaled — the number IS document px there");
}

{
  // Zoom-anchoring measures the screen, so it is already resolution-proof
  // and must NOT take the reference on top.
  const anchored = lineParamsForNew.call(board(true, 4, { x: 11384, y: 4221 }));
  assert.strictEqual(anchored.width, 3 / 4,
    "anchored still means screen px at draw time, on any image");
}

// ── and the panel stops calling it px ─────────────────────────────────────

{
  // The number is a weight against a reference canvas, not a count of
  // pixels — a "px" suffix promised a measure that never held across
  // resolutions, which is the whole bug. The readouts show a bare
  // number, and no user-facing string calls a stroke or a label size px.
  // The sliders travel a curve now (see weight_slider_test), so the
  // readout shows the WEIGHT that position maps to — still a bare number.
  for (const readout of [
    'w.val.textContent = String(mw);',
    'w.val.textContent = String(pw);',
    'this._markerWeightVal.textContent = String(width);',
    'this._paramsWeightVal.textContent = String(width);',
  ]) {
    assert.ok(src.includes(readout), `readout still carries a unit: ${readout}`);
  }
  assert.ok(!/textContent = [^;]*\+ "px"/.test(src),
    "no weight readout may append px");

  // Titles and placeholders are user-facing too.
  const strings = src.match(/(?:title|placeholder|textContent)\s*=\s*\n?\s*"[^"]*"/g) || [];
  const offenders = strings.filter((s) => /\bpx\b/.test(s));
  assert.deepStrictEqual(offenders, [],
    `user-facing strings still say px: ${offenders.join(" | ")}`);
}
