// Pins the ink-sizing policy.
//
// The old behaviour: a panel value meant "this many px on screen right
// now", so a 3px line drawn zoomed-in and a 3px line drawn zoomed-out
// were different real thicknesses — visually constant for the hand,
// inconsistent for the drawing. Head dev's call: consistency wins by
// default. A value is document px — every stroke drawn at 3 IS the same
// thickness — and the old behaviour lives on behind the ⋯ toggle
// ("zoom_anchor"). Rendering is untouched either way: stored canvas
// units × the current zoom, so ink always scales with the drawing.
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
const lineParamsForNew = extract("_lineParamsForNewShape");
const markerStyle = extract("_currentMarkerStyle");

function board(anchored, zoom) {
  const prefs = anchored ? { zoom_anchor: true } : {};
  return {
    _getPref: (k) => prefs[k],
    _markerScale: () => zoom,
    _inkScale: inkScale,
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

// ── the switch lives with the other view toggles ──────────────────────────

{
  assert.ok(src.includes('self._setPref("zoom_anchor", !self._zoomAnchorOn());'),
    "the ⋯ menu button flips the persisted preference");
  assert.ok(src.includes('this.zoomAnchorBtn.setAttribute("aria-pressed", zaOn ? "true" : "false");'),
    "and announces its state like the rest");
}

console.log("ink scale: all checks passed");
