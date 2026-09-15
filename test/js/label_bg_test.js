// Pins the plate behind a label.
//
// A label written straight onto a photograph is often unreadable — the
// colour that works over the sky is invisible over the roof. So a label
// can sit on a plate: a filled rect behind its text, off by default,
// black or white nine times out of ten but an ordinary colour with an
// ordinary picker.
//
// The controls are split the way the settings are: the toggle sits with
// the label SIZE (both describe the label), and the colour sits beside
// the label's own colour (contrast is a property of the pair, so the two
// swatches share a row and the plate chip previews both together).
//
//   node test/js/label_bg_test.js

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

// The constant the plate painter closes over.
{
  const m = src.match(/var LABEL_BG_RADIUS_RATIO = ([\d.]+);/);
  assert.ok(m, "could not find LABEL_BG_RADIUS_RATIO");
  global.LABEL_BG_RADIUS_RATIO = Number(m[1]);
}

const labelBgFor = extract("_labelBgFor");
const applyLabelBg = extract("_applyLabelBg");
const setLabelBg = extract("_setLabelBg");
const currentLabelBg = extract("_currentLabelBg");
const toggleLabelBg = extract("_toggleLabelBg");
const fontTargets = extract("_fontTargetShapes");
const syncBgRow = extract("_syncLabelBgRow");
const refreshSwatch = extract("_refreshLabelSwatch");
const currentLabelColor = extract("_currentLabelColor");
const styleForNewShape = extract("_styleForNewShape");

// ── what counts as a plate ────────────────────────────────────────────────

assert.strictEqual(labelBgFor({ style: { label_bg: "#000000" } }), "#000000");
for (const bad of [undefined, null, "", 0, 16]) {
  assert.strictEqual(labelBgFor({ style: { label_bg: bad } }), null,
    `${String(bad)} is not a plate`);
}
assert.strictEqual(labelBgFor({}), null, "no style");
assert.strictEqual(labelBgFor(null), null, "no shape");

// ── it paints the rect every label already has behind it ──────────────────

{
  const m = src.match(/var LABEL_BG_RADIUS_RATIO = ([\d.]+);/);
  assert.ok(m, "could not find LABEL_BG_RADIUS_RATIO");
  const RATIO = Number(m[1]);
  // A rounded CARD, not a pill, however tall the label is set.
  assert.ok(RATIO > 0 && RATIO < 0.5, "the radius ratio should stay well under half");

  function fakeRect(height) {
    const attrs = height == null ? {} : { height: String(height) };
    return {
      style: {}, attrs,
      getAttribute: (k) => (k in attrs ? attrs[k] : null),
      setAttribute: (k, v) => (attrs[k] = v),
      removeAttribute: (k) => delete attrs[k],
    };
  }
  const ctx = { _labelBgFor: labelBgFor };

  // Inline fill, because the stylesheet pins that rect to `fill: transparent`.
  const rect = fakeRect(40);
  applyLabelBg.call(ctx, rect, { style: { label_bg: "#112233" } });
  assert.strictEqual(rect.style.fill, "#112233");
  assert.strictEqual(Number(rect.attrs.rx), 40 * RATIO,
    "the plate's corners round in proportion to its height");

  // Twice the height, twice the radius — the same shape at any size, which
  // a fixed radius would not be.
  const big = fakeRect(80);
  applyLabelBg.call(ctx, big, { style: { label_bg: "#112233" } });
  assert.strictEqual(Number(big.attrs.rx), 2 * Number(rect.attrs.rx));

  // Back to "" rather than "transparent" when there is no plate, so the
  // stylesheet rule goes back to owning it — and the rounding goes with it:
  // without a plate this rect is the invisible hit box, and its dashed
  // hover outline is a different thing nobody asked to reshape.
  applyLabelBg.call(ctx, rect, { style: {} });
  assert.strictEqual(rect.style.fill, "");
  assert.ok(!("rx" in rect.attrs), "no plate, no rounding");

  // A rect that has no height yet gets a fill but no nonsense radius.
  const unsized = fakeRect(null);
  applyLabelBg.call(ctx, unsized, { style: { label_bg: "#112233" } });
  assert.strictEqual(unsized.style.fill, "#112233");
  assert.ok(!("rx" in unsized.attrs));

  // A rect that isn't there yet must not throw.
  assert.doesNotThrow(() => applyLabelBg.call(ctx, null, {}));
  assert.doesNotThrow(() => applyLabelBg.call(ctx, {}, {}));
}

// All three things that draw a label paint it — a plate that appeared on
// text shapes but not on the label hanging off a rectangle would read as a
// bug in the toggle.
{
  for (const [marker, what] of [
    ["this._applyLabelBg(rectEl, shape);", "a label on a shape"],
    ["self._applyLabelBg(trect, shape);", "a text shape"],
    ["self._applyLabelBg(coRect, shape);", "a callout"],
  ]) {
    assert.ok(src.includes(marker), `${what} must paint the plate`);
  }
  // The label rect always shrink-wraps now (text drives the box), so
  // there is exactly one sizing branch to paint.
  assert.strictEqual((src.match(/this\._applyLabelBg\(rectEl, shape\);/g) || []).length, 1,
    "the label's single sizing branch paints the plate");
}

// ── setting one ───────────────────────────────────────────────────────────

function board(over) {
  return Object.assign({
    prefs: {},
    rendered: [],
    restyled: 0,
    shapes: [],
    selectedShapes: [],
    _fontTargetShapes: fontTargets,
    _labelBgFor: labelBgFor,
    _setLabelBg: setLabelBg,
    _currentLabelBg: currentLabelBg,
    _getPref(k) { return this.prefs[k]; },
    _setPref(k, v) { this.prefs[k] = v; },
    _renderShape(s) { this.rendered.push(s); },
    _restyleDrafts() { this.restyled++; },
    _refreshTextEditorStyle() {},
    _syncLabelBgRow() {},
    _refreshLabelSwatch() {},
    _snapshotShape: () => ({}),
    _pushUndo() {},
    _emitChanged() { this.emitted = (this.emitted || 0) + 1; },
  }, over || {});
}

{
  // Nothing selected → the colour new labels start with.
  const self = board();
  setLabelBg.call(self, "#ffffff", true);
  assert.strictEqual(self.prefs.label_bg, "#ffffff");
  assert.strictEqual(self.prefs.label_bg_last, "#ffffff",
    "remembered even for when it is switched off");
  assert.ok(self.restyled > 0, "anything being drawn right now picks it up");

  setLabelBg.call(self, null, true);
  assert.strictEqual(self.prefs.label_bg, null, "and off again");
  assert.strictEqual(self.prefs.label_bg_last, "#ffffff",
    "…without forgetting what it was");
}

{
  // With text-bearing shapes selected it plates THOSE, like the size
  // control beside it. What you can size, you can plate.
  const a = { uuid: "a", kind: "text", style: {} };
  const b = { uuid: "b", kind: "rectangle", metadata: { title: "x" }, style: {} };
  const plain = { uuid: "c", kind: "rectangle", style: {} };
  const self = board({ selectedShapes: [a, b, plain] });
  self.shapes = [a, b, plain];

  setLabelBg.call(self, "#000000", true);
  assert.strictEqual(a.style.label_bg, "#000000");
  assert.strictEqual(b.style.label_bg, "#000000");
  assert.ok(!("label_bg" in plain.style),
    "a shape with no text has no label to put a plate behind");
  assert.strictEqual(self.prefs.label_bg, undefined,
    "and the default is left alone — this edited the selection");
  assert.strictEqual(self.emitted, 1, "the change persists with the shapes");

  setLabelBg.call(self, null, true);
  assert.ok(!("label_bg" in a.style), "removing it removes the key, not sets it empty");
}

// ── the toggle ────────────────────────────────────────────────────────────

{
  const self = board();
  assert.strictEqual(currentLabelBg.call(self), null, "off to begin with");

  toggleLabelBg.call(self);
  assert.strictEqual(self.prefs.label_bg, "#000000",
    "first press turns it on in black — what a label needs behind it most often");

  toggleLabelBg.call(self);
  assert.strictEqual(self.prefs.label_bg, null, "second press turns it off");

  // A colour the user picked comes back, rather than reverting to black.
  self.prefs.label_bg_last = "#ffffff";
  toggleLabelBg.call(self);
  assert.strictEqual(self.prefs.label_bg, "#ffffff", "the remembered colour returns");
}

{
  // With a selection, the toggle reads and writes THAT shape.
  const s = { uuid: "s", kind: "text", style: { label_bg: "#123456" } };
  const self = board({ selectedShapes: [s] });
  self.shapes = [s];
  assert.strictEqual(currentLabelBg.call(self), "#123456", "it reads the selection");
  toggleLabelBg.call(self);
  assert.ok(!("label_bg" in s.style), "and turns that shape's plate off");
}

// ── new shapes start with the default plate ───────────────────────────────

{
  const self = {
    prefs: { label_bg: "#000000" },
    activeColor: "#93c5fd",
    _getPref(k) { return this.prefs[k]; },
    _isStrokeShape: (k) => ["rectangle", "circle", "polygon", "freehand"].indexOf(k) !== -1,
    _isShaftKind: (k) => ["line", "arrow", "dimension"].indexOf(k) !== -1,
    _markerScale: () => 1,
    _currentMarkerStyle: () => ({ color: "#93c5fd" }),
    _currentLineParams: () => ({ color: "#93c5fd", width: 2, opacity: 1, dash: "solid", fill: "semi" }),
    _lineParamsForNewShape() {
      return Object.assign({}, this._currentLineParams(), { width_units: "canvas" });
    },
  };

  // EVERY kind: any shape can carry a label, so the plate is not a
  // text-kinds-only setting.
  for (const kind of ["rectangle", "circle", "line", "arrow", "dimension",
                      "callout", "text", "marker", "image"]) {
    assert.strictEqual(styleForNewShape.call(self, kind).label_bg, "#000000",
      `${kind} should carry the default plate`);
  }

  // Off → the key is absent, not empty. A shape carrying `label_bg: ""`
  // would ride every payload for nothing.
  self.prefs.label_bg = null;
  for (const kind of ["rectangle", "text"]) {
    assert.ok(!("label_bg" in (styleForNewShape.call(self, kind) || {})),
      `${kind} should carry no plate key when it is off`);
  }
}

// ── the row shows where the size does ─────────────────────────────────────

{
  function rowSelf(targets, paramTargets, bg) {
    const btn = { textContent: "", classes: new Set(), attrs: {},
                  classList: { toggle: (c, on) => btn.classes[on ? "add" : "delete"](c) },
                  setAttribute: (k, v) => (btn.attrs[k] = v) };
    return {
      btn,
      row: { style: {} },
      _paramsBgRow: null, _paramsBgBtn: btn,
      _fontTargetShapes: () => targets,
      _paramsTargetShapes: () => paramTargets || [],
      _currentLabelBg: () => bg || null,
      // The row sync repaints the swatches, since that is the hook that
      // runs on every selection change.
      _refreshLabelSwatch() { this.refreshed = (this.refreshed || 0) + 1; },
    };
  }

  const on = rowSelf([{ kind: "text" }], [], "#000000");
  on._paramsBgRow = on.row;
  syncBgRow.call(on);
  assert.strictEqual(on.row.style.display, "", "shown for a shape with text");
  assert.strictEqual(on.btn.textContent, "On");

  const off = rowSelf([{ kind: "text" }], [], null);
  off._paramsBgRow = off.row;
  syncBgRow.call(off);
  assert.strictEqual(off.btn.textContent, "Off");

  // A shape with no text: hidden, like the size row — a control that
  // cannot do anything is worse than a missing one.
  const none = rowSelf([], [{ kind: "rectangle" }], null);
  none._paramsBgRow = none.row;
  syncBgRow.call(none);
  assert.strictEqual(none.row.style.display, "none");
  assert.ok(none.refreshed > 0,
    "the swatches repaint even when this row hides — they live in the colour " +
    "row, and a shape with no text still changes what 'the current label' means");

  assert.ok(on.refreshed > 0, "and of course when it is shown");

  // Nothing selected: shown, setting the default.
  const global = rowSelf([], [], null);
  global._paramsBgRow = global.row;
  syncBgRow.call(global);
  assert.strictEqual(global.row.style.display, "");

  // A panel that was never built must not throw.
  assert.doesNotThrow(() => syncBgRow.call({}));
}

// ── the two swatches share a row, and stack when the panel narrows ────────

{
  assert.ok(src.includes('labelRow.className = "etcher-label-row"'),
    "the two label colours share a row");
  assert.ok(src.includes('<span class="etcher-label-swatch-text">Text</span>') &&
              src.includes('<span class="etcher-label-swatch-text">Behind</span>'),
    "one half for the label's colour, one for what is behind it");

  const rowCss = src.slice(src.indexOf('".etcher-label-row {"'),
                           src.indexOf('"}"', src.indexOf('".etcher-label-row {"')));
  assert.ok(rowCss.includes("display: flex"), "side by side at full width");
  const swatchCss = src.slice(src.indexOf('".etcher-label-swatch {"'),
                              src.indexOf('"}"', src.indexOf('".etcher-label-swatch {"')));
  assert.ok(swatchCss.includes("flex: 1 1 0"), "…sharing the width evenly");

  const compact = src.slice(
    src.indexOf('".etcher-stylepanel[data-size=\\"compact\\"] .etcher-label-row {"')
  );
  assert.ok(compact.slice(0, 200).includes("flex-direction: column"),
    "and stacked into one column when the panel narrows");
}

// (The chip previewing the PAIR — the label's colour drawn on the plate
// colour — is asserted against the real thing in the swatch block below,
// rather than by reading the source for variable names.)


// ── the swatches follow the label you click ───────────────────────────────
//
// They were only ever repainted when something SET them, so clicking from
// one label to another left both chips describing the one before — which
// reads as the selected one's settings, and is the worst kind of wrong:
// confidently.

function swatchSelf(targets, prefs) {
  const chip = { style: {}, classes: new Set(),
                 classList: { toggle: (c, on) => chip.classes[on ? "add" : "delete"](c) } };
  const glyph = { style: {} };
  const q = (sel) => (sel.indexOf("bg-chip") !== -1 ? chip : glyph);
  const mk = () => ({ querySelector: q, setAttribute() {}, title: "" });
  const self = {
    chip, glyph,
    labelSwatchEl: mk(),
    labelBgSwatchEl: mk(),
    prefs: prefs || {},
    _fontTargetShapes: () => targets,
    _currentLabelBg: currentLabelBg,
    _currentLabelColor: currentLabelColor,
    _labelBgFor: labelBgFor,
    _getPref(k) { return this.prefs[k]; },
  };
  return self;
}

{
  // A label with a plate: the chip shows it.
  const withPlate = { kind: "text", style: { color: "#ff0000", label_bg: "#00ff00" } };
  const a = swatchSelf([withPlate]);
  refreshSwatch.call(a);
  assert.strictEqual(a.chip.style.background, "#00ff00", "the plate colour");
  assert.ok(!a.chip.classes.has("is-off"));
  assert.strictEqual(a.glyph.style.color, "#ff0000",
    "…written in the label's own colour, which is the pair being judged");

  // Click a label with NO plate: the chip must go transparent, not keep
  // showing the last one. Whether there is a plate at all is the question
  // the chip answers, and the remembered colour answers it wrong.
  const bare = { kind: "text", style: { color: "#0000ff" } };
  const b = swatchSelf([bare], { label_bg: "#00ff00", label_bg_last: "#00ff00" });
  refreshSwatch.call(b);
  assert.strictEqual(b.chip.style.background, "transparent",
    "off reads as transparent even with a colour remembered");
  assert.ok(b.chip.classes.has("is-off"), "and is marked off for the stylesheet");
  assert.strictEqual(b.glyph.style.color, "#0000ff", "the text chip follows too");
}

{
  // A label on a shape carries its colour in metadata; a text shape or a
  // callout IS the label, so theirs is the shape's colour.
  const onShape = { kind: "rectangle", metadata: { title: "x", title_color: "#abcdef" },
                    style: { color: "#111111" } };
  assert.strictEqual(currentLabelColor.call(swatchSelf([onShape]), onShape), "#abcdef");

  const text = { kind: "text", style: { color: "#222222" } };
  assert.strictEqual(currentLabelColor.call(swatchSelf([text]), text), "#222222");

  // Nothing selected → the default new labels start in.
  const none = swatchSelf([], { label_color: "#333333" });
  assert.strictEqual(currentLabelColor.call(none), "#333333");
  assert.strictEqual(currentLabelColor.call(swatchSelf([], {})), null, "and none set");
}

{
  // The repaint hangs off the row sync, which runs on every selection
  // change — and ABOVE its early return, since the swatches live in the
  // colour row and still need repainting when this row is hidden.
  const body = src.slice(src.indexOf("    _syncLabelBgRow: function"),
                         src.indexOf("\n    },", src.indexOf("    _syncLabelBgRow: function")));
  assert.ok(body.includes("this._refreshLabelSwatch();"),
    "the swatches repaint when the panel re-reads the selection");
  assert.ok(body.indexOf("this._refreshLabelSwatch();") < body.indexOf("if (!this._paramsBgBtn) return;"),
    "…before the early return, or a shape with no text leaves them stale");

  // And that sync is in the chain the selection drives.
  const params = src.slice(src.indexOf("    _syncParamsPopup: function"),
                           src.indexOf("\n    },", src.indexOf("    _syncParamsPopup: function")));
  assert.ok(params.includes("this._syncLabelBgRow();"), "which _syncParamsPopup calls");
}

// A panel that was never built must not throw.
assert.doesNotThrow(() => refreshSwatch.call({
  _fontTargetShapes: () => [],
  _currentLabelColor: currentLabelColor,
  _currentLabelBg: currentLabelBg,
  _getPref: () => null,
}));


// ── focusing a label tells the panel ──────────────────────────────────────
//
// Entering and leaving edit mode on a SHAPE both sync the panel. The label
// path did neither, so the panel went on describing whatever was there
// before and only caught up when clicking away happened to trigger a sync
// elsewhere — which meant a label's settings were readable only after you
// stopped editing it. Backwards, and the kind of thing you assume is your
// own mistake.
{
  for (const [fn, what] of [
    ["_enterTitleEditMode", "focusing a label"],
    ["_exitTitleEditMode", "leaving one"],
  ]) {
    const start = src.indexOf(`    ${fn}: function`);
    assert.notStrictEqual(start, -1, `could not find ${fn}`);
    const body = src.slice(start, src.indexOf("\n    },", start));
    assert.ok(body.includes("this._syncActionBar();"),
      `${what} must re-read the panel — it is a selection change for it`);
  }

  // That is the same hook every other selection change goes through, and
  // it reaches the label controls.
  const bar = src.slice(src.indexOf("    _syncActionBar: function"),
                        src.indexOf("\n    },", src.indexOf("    _syncActionBar: function")));
  assert.ok(bar.includes("this._scheduleStyleInspectorSync();"),
    "…which is what carries it to the style panel");
}

console.log("label background: all checks passed");
