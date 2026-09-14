// The style panel's two new host-facing behaviors:
//
//   - `panel_offset` — a host whose own chrome lives in the container's
//     top-right corner (phoenix_kit's media page keeps its details
//     minimizer there) moves the whole cluster: the chevron sits at the
//     anchor, the panel 40px below, via two CSS custom properties.
//
//   - styleless tools — the grabber takes no stroke or fill, so the panel
//     (and its chevron) hide while it is armed instead of advertising
//     swatches that apply to nothing.
//
//   node test/js/style_panel_tools_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

function lift(name, signature) {
  const needle = `    ${name}: function(${signature}) {`;
  const start = src.indexOf(needle);
  assert.notStrictEqual(start, -1, `could not find ${name} in etcher.js`);
  const end = src.indexOf("\n    },", start);
  assert.notStrictEqual(end, -1, `could not find the end of ${name}`);
  return eval(
    "(" +
      src.slice(start, end + "\n    }".length).replace(`${name}: function`, "function") +
      ")"
  );
}

// ── panel offset → CSS custom properties ───────────────────────────────────

const applyPanelOffset = lift("_applyPanelOffset", "");

function fakeSelf(raw) {
  const props = {};
  return {
    props,
    self: {
      el: { dataset: { panelOffset: raw } },
      handle: {
        container: {
          style: { setProperty: (k, v) => (props[k] = v) },
        },
      },
    },
  };
}

{
  const { props, self } = fakeSelf(JSON.stringify({ top: 56, right: 20 }));
  applyPanelOffset.call(self);
  assert.strictEqual(props["--etcher-panel-anchor-top"], "56px");
  assert.strictEqual(props["--etcher-panel-anchor-right"], "20px");
}

{
  // Partial offsets set only what they name.
  const { props, self } = fakeSelf(JSON.stringify({ top: 56 }));
  applyPanelOffset.call(self);
  assert.strictEqual(props["--etcher-panel-anchor-top"], "56px");
  assert.strictEqual(props["--etcher-panel-anchor-right"], undefined);
}

{
  // Garbage input must be inert, never a crash.
  const { props, self } = fakeSelf("{not json");
  applyPanelOffset.call(self);
  assert.deepStrictEqual(props, {});
  const bare = fakeSelf(undefined);
  applyPanelOffset.call(bare.self);
  assert.deepStrictEqual(bare.props, {});
}

// ── the CSS reads the same properties the JS writes ─────────────────────────

assert.ok(
  src.includes("top: calc(var(--etcher-panel-anchor-top, 12px) + 40px);"),
  "the panel derives its top from the anchor (chevron height folded in)"
);
assert.ok(
  /\.etcher-panel-toggle \{[\s\S]{0,400}var\(--etcher-panel-anchor-top, 12px\)/.test(src),
  "the chevron sits at the anchor itself"
);

// ── styleless gating ────────────────────────────────────────────────────────

assert.ok(
  /grabber:\s*\{[^}]*styleless: true/.test(src),
  "the grabber is declared styleless"
);
assert.ok(
  src.includes("var wantsStyle = !!this.annotationMode && !(toolDef && toolDef.styleless);"),
  "_syncStylePanel gates the panel on the active tool wanting style"
);
assert.ok(
  src.match(/is-active", wantsStyle\)/g).length >= 2,
  "the panel and its chevron both follow the gate"
);

// ── the grabber has all five digits ─────────────────────────────────────────

{
  const iconsStart = src.indexOf("grabber: '<svg");
  const iconEnd = src.indexOf("',", iconsStart);
  const icon = src.slice(iconsStart, iconEnd);
  const paths = icon.match(/<path /g) || [];
  assert.strictEqual(
    paths.length,
    4,
    "three fingertip strokes + the palm/thumb outline — the coherent hand"
  );
}

console.log("style panel anchor, styleless gating and grabber icon: ok");

// ── the pencil lights while annotation mode is on ───────────────────────────

const syncNavPencil = lift("_syncNavPencil", "");

{
  const classes = new Set();
  const self = {
    annotationMode: true,
    removeNavBtn: {
      el: {
        classList: {
          toggle: (cls, on) => (on ? classes.add(cls) : classes.delete(cls)),
        },
      },
    },
  };
  syncNavPencil.call(self);
  assert.ok(classes.has("etcher-pencil-active"), "lit while on");
  self.annotationMode = false;
  syncNavPencil.call(self);
  assert.ok(!classes.has("etcher-pencil-active"), "unlit while off");
  // No button (chrome disabled) must be inert.
  syncNavPencil.call({ annotationMode: true, removeNavBtn: null });
}

assert.ok(
  src.includes('".etcher-pencil-active, .etcher-pencil-active:hover {'),
  "the lit state has a stylesheet rule"
);

// ── the label swatch retargets the picker ───────────────────────────────────

const applyPickedColor = lift("_applyPickedColor", "hex");

{
  // Label mode: the pick lands on the pref, never the palette.
  const prefs = {};
  const self = {
    _labelPickTarget: true,
    _setPref: (k, v) => (prefs[k] = v),
    _refreshLabelSwatch: () => {},
    _setSlotColor: () => assert.fail("must not touch the palette"),
    _selectColor: () => assert.fail("must not change the stroke color"),
  };
  applyPickedColor.call(self, "#12ab34");
  assert.strictEqual(prefs.label_color, "#12ab34");
}

{
  // Normal mode: the pick edits the active slot, as before.
  const calls = [];
  const self = {
    _labelPickTarget: false,
    _inspectedShape: () => null,
    _activeSlot: 2,
    _setSlotColor: (i, hex) => calls.push(["slot", i, hex]),
    _selectColor: (hex) => calls.push(["select", hex]),
  };
  applyPickedColor.call(self, "#12ab34");
  assert.deepStrictEqual(calls, [["slot", 2, "#12ab34"], ["select", "#12ab34"]]);
}

{
  // Inspect mode: the pick recolors the shape; the palette and the
  // drawing default survive untouched.
  const calls = [];
  const self = {
    _labelPickTarget: false,
    _inspectedShape: () => ({ style: { color: "#000000" } }),
    _applyColorToTargets: (hex) => calls.push(["targets", hex]),
    _syncStyleInspector: () => calls.push(["sync"]),
    _setSlotColor: () => assert.fail("must not touch the palette while inspecting"),
    _selectColor: () => assert.fail("must not change the drawing default while inspecting"),
  };
  applyPickedColor.call(self, "#12ab34");
  assert.deepStrictEqual(calls, [["targets", "#12ab34"], ["sync"]]);
}

assert.ok(
  src.includes('this._labelPickTarget = false;'),
  "closing the picker ends label-targeting"
);
assert.ok(
  /etcher-label-swatch-glyph/.test(src) && /"A"|>A</.test(src.slice(src.indexOf("etcher-label-swatch"))),
  "the label swatch renders the A glyph"
);

// ── new text shapes start in the remembered label colour ────────────────────

assert.ok(
  /kind === "text"\) \{[\s\S]{0,700}_getPref\("label_color"\)/.test(src),
  "_finalizeShape's text branch consults the label colour"
);
assert.ok(
  src.includes('this._applyShapeColor(g, this._getPref("label_color") || this.activeColor);'),
  "the text draft previews in the same colour the commit will use"
);
assert.ok(
  src.includes('etcher-label-swatch-text'),
  "the label swatch is a labelled row, not a bare tile"
);

// ── the grabber's cursor is the toolbar hand ────────────────────────────────

// The parity every drawing app keeps: arming the hand tool puts the same
// hand under your finger. Native `grab` drew the OS's hand, which matches
// nothing in the toolbar.

function pathData(fragment) {
  return (fragment.match(/d="[^"]+"/g) || []).sort();
}

{
  const iconStart = src.indexOf("grabber: '<svg");
  const icon = src.slice(iconStart, src.indexOf("',", iconStart));
  const badgeStart = src.indexOf("grabber:   '<path");
  const badge = src.slice(badgeStart, src.indexOf("',", badgeStart));

  assert.deepStrictEqual(
    pathData(icon),
    pathData(badge),
    "toolbar icon and cursor glyph must be the same hand, path for path"
  );
}

assert.ok(
  src.includes("function grabberCursor(closed)"),
  "the grabber has its own cursor builder"
);
assert.ok(
  src.includes("var hand = closed ? GRAB_CLOSED : CURSOR_BADGES.grabber;"),
  "the open cursor is built FROM the shared glyph, not a copy"
);
assert.ok(
  src.includes("self.handle.container.style.cursor = grabberCursor(false);"),
  "arming the grabber applies the hand cursor"
);
assert.ok(
  src.includes("\") 14 14, '"),
  "hotspot centered for both hand states"
);

{
  // The cursor hand is a solid white glove with a black contour — a
  // fill:none build disappeared into light imagery.
  const start = src.indexOf("function grabberCursor(closed)");
  const body = src.slice(start, src.indexOf("var cursorToolCursorCache", start));
  assert.ok(
    body.includes("var silhouette =") && body.includes('Z"/>'),
    "a CLOSED silhouette path backs the open glyph paths - their chord fills leave palm gaps"
  );
  assert.ok(
    body.indexOf("silhouette + hand") < body.indexOf('stroke="#000"'),
    "the filled silhouette renders under the black contour"
  );
  assert.strictEqual(
    (body.match(/fill="#fff"/g) || []).length,
    1,
    "exactly the silhouette pass fills white; the contour pass stays fill:none or its chord-fills overpaint the finger lines"
  );
}

// ── the cursor tool's pointer is its toolbar arrow ──────────────────────────

assert.ok(
  src.includes("var ARROW_PATH =") &&
    src.includes("aria-hidden=\"true\">' + ARROW_PATH + '</svg>'") &&
    (src.match(/ARROW_PATH \+ '<\/g>'/g) || []).length === 2,
  "one arrow path feeds the toolbar icon and both cursor passes - parity by construction"
);
assert.ok(
  src.includes('cursorToolCursor() : ""'),
  "the armed cursor tool applies its own arrow instead of the OS default"
);
assert.ok(
  src.includes("\") 6 6, default'"),
  "hotspot on the arrow tip, native default kept as the fallback"
);

// ── the grab closes while holding the canvas ────────────────────────────────

assert.ok(
  src.includes("var GRAB_CLOSED =") &&
    src.includes("var hand = closed ? GRAB_CLOSED : CURSOR_BADGES.grabber;"),
  "the builder has a closed-fist variant of the same hand"
);
{
  // The closed hand keeps the open hand's palm verbatim — only the
  // fingers move, so the cursor doesn't jump on state change.
  const open = src.slice(src.indexOf("grabber:   '<path"), src.indexOf("',", src.indexOf("grabber:   '<path")));
  const closed = src.slice(src.indexOf("var GRAB_CLOSED"), src.indexOf(";", src.indexOf("var GRAB_CLOSED")));
  const heel = "m7 15-1.76-1.76a2 2 0 0 0-2.83 2.82l3.6 3.6C7.5 21.14 9.2 22 12 22h2a8 8 0 0 0 8-8";
  assert.ok(open.includes(heel) && closed.includes(heel), "shared palm");
}
assert.ok(
  src.includes('(closed ? "grabbing" : "grab")'),
  "native grab/grabbing stay as the per-state fallbacks"
);
assert.ok(
  src.includes("_wireGrabberCursor: function(on)") &&
    src.includes("self._wireGrabberCursor(grabbing);"),
  "arming the grabber wires the press-to-curl listeners, leaving it unwires them"
);
assert.ok(
  src.includes('document.addEventListener("pointerdown", self._grabberDownHandler, true);') &&
    src.includes("c.style.cursor = grabberCursor(true);") &&
    src.includes("if (!c || !c.contains(e.target)) return;") &&
    (src.match(/grabberCursor\(false\)/g) || []).length >= 2,
  "pointer down curls the hand, release and tool-arm relax it"
);


// ── the style panel inspects the selected shape without touching defaults ──

// Selecting a shape must never eyedrop its colour into the palette: the
// old sync mutated _colorSlots/_activeSlot/activeColor; the new one only
// re-renders the panel.
{
  const gut = src.slice(
    src.indexOf("_syncToolbarColorToShape: function"),
    src.indexOf("},", src.indexOf("_syncToolbarColorToShape: function"))
  );
  assert.ok(
    gut.includes("this._syncStyleInspector();") &&
      !gut.includes("_setSlotColor") &&
      !gut.includes("_selectColor") &&
      !gut.includes("_activeSlot ="),
    "shape select re-renders the inspector instead of eyedropping into the palette"
  );
}

assert.ok(
  src.includes("_inspectedShape: function()") &&
    src.includes("_syncStyleInspector: function()"),
  "the inspector helpers exist"
);

// The inspector re-renders on every selection change: _syncActionBar is the
// sync already wired to all of them.
{
  const bar = src.slice(
    src.indexOf("_syncActionBar: function()"),
    src.indexOf("_computeToolbarOverflow", src.indexOf("_syncActionBar: function()"))
  );
  assert.ok(
    bar.includes("this._scheduleStyleInspectorSync();"),
    "every selection change re-renders the style inspector"
  );
}

// Colour edits while inspecting go to the shape, not the defaults — the
// shared applier exists and both picker paths route through it.
assert.ok(
  src.includes("_applyColorToTargets: function(color)"),
  "the target-only colour applier exists"
);
{
  const picked = src.slice(
    src.indexOf("_applyPickedColor: function(hex)"),
    src.indexOf("_refreshLabelSwatch: function", src.indexOf("_applyPickedColor: function(hex)"))
  );
  assert.ok(
    picked.indexOf("this._inspectedShape()") !== -1 &&
      picked.indexOf("this._applyColorToTargets(hex);") !== -1 &&
      picked.indexOf("this._inspectedShape()") < picked.indexOf("_setSlotColor"),
    "a picker pick recolors the inspected shape before it can touch the active slot"
  );
}
assert.ok(
  (src.match(/self\._applyColorToTargets\(slotColor\);|self\._applyColorToTargets\(color\);/g) || []).length >= 2,
  "toolbar and overflow swatch clicks recolor the inspected shape via the applier"
);

// The palette-persist hook must not fire for inspect-mode edits: nothing
// in the palette changed.
// Also skipped for a label-plate pick: that swatch sets the plate, not the
// palette, so there is nothing about the palette to persist.
assert.strictEqual(
  (src.match(/!self\._labelPickTarget && !self\._labelBgPickTarget && !self\._inspectedShape\(\)\) self\._emitColorsChanged\(\);/g) || []).length,
  2,
  "both persist guards (preset click, drag release) skip inspect-mode and label-plate edits"
);


// ── the label colour pref survives peers, late loads, and compact mode ─────

// Same-page peer layers hydrate from each other's saves — without this, a
// second live layer kept serving its mount-time cache and the label colour
// "didn't take" on it.
assert.ok(
  src.includes('document.addEventListener("etcher:prefs-changed", self._peerPrefsHandler);') &&
    src.includes('document.removeEventListener("etcher:prefs-changed", this._peerPrefsHandler);'),
  "peer pref saves are listened for on mount and unwired on destroy"
);

// A pick made in this instance outranks a slower prefs load.
{
  const setPref = lift("_setPref", "name, value");
  const hydratePrefs = lift("_hydratePrefs", "stored");
  const self = {
    _prefs: { grid: true },
    _loadPrefs() { return this._prefs; },
    _defaultPrefs: () => ({}),
    _savePrefs() {},
    _applyPrefs() {},
  };
  setPref.call(self, "label_color", "#ffee00");
  assert.strictEqual(self._prefs.label_color, "#ffee00");
  // The late answer carries an old label colour — it must lose; its other
  // keys must still land.
  hydratePrefs.call(self, { label_color: "#000000", grid: false });
  assert.strictEqual(self._prefs.label_color, "#ffee00",
    "a user-set pref survives a late host/peer load");
  assert.strictEqual(self._prefs.grid, false,
    "untouched keys still take the loaded value");
  // A key never touched here hydrates normally.
  hydratePrefs.call(self, { panel: "compact" });
  assert.strictEqual(self._prefs.panel, "compact");
}

// Hydrating repaints the label swatch glyph along with everything else.
{
  const applyPrefs = lift("_applyPrefs", "");
  const calls = [];
  applyPrefs.call({
    _loadPrefs: () => ({}),
    _applyGridPref() {}, _applyPanelPref() {}, _applyColorsPref() {},
    _applyCompactParts() {}, _connectorsOn: () => true,
    _removeConnectorDots() {}, _refreshToolbarTools() {},
    _refreshLabelSwatch: () => calls.push("label"),
  });
  assert.deepStrictEqual(calls, ["label"], "_applyPrefs refreshes the label swatch");
}

// Compact mode keeps just the chip: the text is hidden and the button
// squares off to the swatch size, so the one-column strip stays narrow.
assert.ok(
  src.includes('.etcher-stylepanel[data-size=\\"compact\\"] .etcher-label-swatch {') &&
    src.includes('.etcher-stylepanel[data-size=\\"compact\\"] .etcher-label-swatch-text {'),
  "compact mode restyles the label swatch and hides its text"
);
{
  const rule = src.slice(
    src.indexOf('.etcher-stylepanel[data-size=\\"compact\\"] .etcher-label-swatch {'),
    src.indexOf('.etcher-stylepanel[data-size=\\"hidden\\"]')
  );
  assert.ok(
    rule.includes("width: 30px; height: 30px;") && rule.includes("display: none;"),
    "the compact label swatch is a 30px square and its text does not render"
  );
}


// A marquee calls _addToSelection once per shape swept; the inspector reads
// the live zoom, so syncing inline forced a layout per shape. The burst
// folds into one frame — and a frame pending at teardown is cancelled.
{
  const schedule = lift("_scheduleStyleInspectorSync", "");
  const frames = [];
  global.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  const self = { syncs: 0, _syncStyleInspector() { this.syncs++; } };
  for (let i = 0; i < 25; i++) schedule.call(self);
  assert.strictEqual(frames.length, 1, "25 selection changes schedule one frame");
  assert.strictEqual(self.syncs, 0, "nothing syncs until the frame runs");
  frames[0]();
  assert.strictEqual(self.syncs, 1, "the frame syncs once");
  schedule.call(self);
  assert.strictEqual(frames.length, 2, "a later burst schedules again");
  delete global.requestAnimationFrame;

  // No rAF (headless, SSR): fall back to syncing inline rather than never.
  const bare = { syncs: 0, _syncStyleInspector() { this.syncs++; } };
  schedule.call(bare);
  assert.strictEqual(bare.syncs, 1, "without rAF the sync still happens");
}
assert.ok(
  src.includes("cancelAnimationFrame(this._styleInspectorFrame)"),
  "a pending frame is cancelled on destroy"
);


// ── the armed tool's cursor is just the cross ───────────────────────────────
//
// It used to carry the tool's glyph as a badge at bottom-right; that read
// as clutter hanging off the pointer, and the toolbar already says which
// tool is held. The glyphs themselves stay — collaborative hosts draw them
// beside a PEER's cursor, where the question is real.

{
  // Run the real builder against a stub glyph table.
  const start = src.indexOf("  var toolCursorCache = null;");
  assert.notStrictEqual(start, -1, "toolCursor should cache a single value");
  const end = src.indexOf("\n  }", src.indexOf("return toolCursorCache;"));
  const body = src.slice(start, end + 4);
  const toolCursor = eval(
    "(function(){ var CURSOR_BADGES = {rectangle:'<rect/>', marker:'<path/>'};" +
      body + " return toolCursor; })()"
  );

  const rect = toolCursor("rectangle");
  assert.ok(rect.includes("data:image/svg+xml,"), "a data-URI cursor is produced");
  assert.ok(rect.endsWith(") 6 6, crosshair"),
    "hotspot stays on the cross centre, native crosshair still the fallback");
  assert.strictEqual(toolCursor("marker"), rect,
    "every drawing tool shares one cursor value");
  assert.strictEqual(toolCursor("nope"), null,
    "a tool with no glyph still falls back to the stylesheet crosshair");

  const svg = decodeURIComponent(
    rect.slice(rect.indexOf("data:image/svg+xml,") + 19, rect.lastIndexOf('")'))
  );
  assert.strictEqual((svg.match(/<path/g) || []).length, 2,
    "two passes of the cross (white underlay + black) and nothing else");
  assert.ok(!svg.includes("<rect") && !svg.includes("translate(14 14)"),
    "no glyph badge rides the cursor any more");
  assert.strictEqual((svg.match(/<g /g) || []).length, (svg.match(/<\/g>/g) || []).length,
    "the markup balances — removing the badge left no stray group");
  assert.ok(svg.includes('d="M6 1.5v9M1.5 6h9"'), "the cross itself is unchanged");
}

// The glyph table survives for peers' cursors, and the two tools whose
// pointer IS their glyph keep theirs.
assert.ok(
  src.includes("return (key && CURSOR_BADGES[key]) || null;"),
  "toolBadge still hands hosts the glyph for drawing a peer's tool"
);
assert.ok(
  src.includes("var hand = closed ? GRAB_CLOSED : CURSOR_BADGES.grabber;") &&
    src.includes("cursorToolCursor() : \"\""),
  "grabber and cursor tool keep their own full-size pointers"
);
