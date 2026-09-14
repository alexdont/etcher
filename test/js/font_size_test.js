// Pins the label font size.
//
// A label's size came from the box you dragged around it, and only from
// there — so making a set of labels agree meant eyeballing every box, and
// they never quite did. There is now a "Label size" box beside thickness
// and opacity: type or step the number you want. No slider — a size is a
// number you know, not a position you hunt for.
//
// Both ways stay: blank means "size it from the box", and dragging a box
// hands the size back to the box, so the drag can never be the gesture that
// does nothing.
//
//   node test/js/font_size_test.js

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

// The module-level constants the lifted functions close over. Lifted from
// the source rather than restated, so the limits can only be checked
// against what the library actually enforces.
for (const name of ["DASH_MODES", "FILL_MODES", "FONT_SIZE_MIN", "FONT_SIZE_MAX"]) {
  const m = src.match(new RegExp(`var ${name} = ([^;]+);`));
  assert.ok(m, `could not find ${name}`);
  global[name] = eval(m[1]);
}

const fontSizeFor = extract("_fontSizeFor");
const hasPinned = extract("_hasPinnedFontSize");
const fontTargets = extract("_fontTargetShapes");
const setFontSize = extract("_setFontSize");
const unpin = extract("_unpinFontSize");
const syncFontRow = extract("_syncFontRow");

// ── what counts as pinned ──────────────────────────────────────────────────

assert.strictEqual(hasPinned({ style: { font_size: 12 } }), true);
for (const bad of [undefined, null, 0, -4, NaN, Infinity, "18"]) {
  assert.strictEqual(hasPinned({ style: { font_size: bad } }), false,
    `${String(bad)} is not a pinned size`);
}
assert.strictEqual(hasPinned({}), false, "no style at all");
assert.strictEqual(hasPinned(null), false, "no shape at all");

// ── the size a shape draws at ──────────────────────────────────────────────

{
  const self = { _hasPinnedFontSize: hasPinned, _markerScale: () => 2 };
  // Unpinned → whatever the box worked out, untouched.
  assert.strictEqual(fontSizeFor.call(self, { style: {} }, 37), 37);
  // Pinned → stored in canvas units, so it scales with the zoom the same
  // way a stroke width does. A label pinned at 20px stays 20px against the
  // DRAWING, not against the screen.
  assert.strictEqual(fontSizeFor.call(self, { style: { font_size: 10 } }, 37), 20);
  const zoomedOut = { _hasPinnedFontSize: hasPinned, _markerScale: () => 0.25 };
  assert.strictEqual(fontSizeFor.call(zoomedOut, { style: { font_size: 40 } }, 37), 10);
  // A broken scale must not produce a zero-height font.
  const broken = { _hasPinnedFontSize: hasPinned, _markerScale: () => { throw new Error("x"); } };
  assert.strictEqual(broken._markerScale.length, 0);
  assert.ok(fontSizeFor.call(broken, { style: { font_size: 14 } }, 37) >= 1);
}

// ── which shapes it applies to ─────────────────────────────────────────────

{
  const text = { kind: "text" };
  const callout = { kind: "callout" };
  const labelled = { kind: "rectangle", metadata: { title: "Boiler" } };
  const blank = { kind: "rectangle" };
  const blankish = { kind: "rectangle", metadata: { title: "   " } };

  const self = { selectedShapes: [text, callout, labelled, blank, blankish] };
  assert.deepStrictEqual(fontTargets.call(self), [text, callout, labelled],
    "text, callouts and anything carrying a label — nothing else has text to size");

  assert.deepStrictEqual(
    fontTargets.call({ selectedShapes: [], editingShape: labelled }), [labelled]);
  // Editing a label directly counts too.
  assert.deepStrictEqual(
    fontTargets.call({ selectedShapes: [], editingTitleShape: labelled }), [labelled]);
  assert.deepStrictEqual(fontTargets.call({ selectedShapes: [], editingShape: blank }), []);
  assert.deepStrictEqual(fontTargets.call({}), []);
}

// ── pinning one ────────────────────────────────────────────────────────────

function board(targets) {
  const rendered = [];
  const undos = [];
  return {
    rendered, undos,
    shapes: targets,
    selectedShapes: targets,
    emitted: 0,
    paramsEmitted: 0,
    _fontTargetShapes: fontTargets,
    _hasPinnedFontSize: hasPinned,
    _markerScale: () => 2,
    _snapshotShape: (s) => ({ was: s.style && s.style.font_size }),
    _renderShape: (s) => rendered.push(s),
    placedTitle: [],
    placedShape: [],
    _positionAllTitleHandles(s) { this.placedTitle.push(s); },
    _positionAllHandles(s) { this.placedShape.push(s); },
    _pushUndo: (uuid, before, after) => undos.push([uuid, before, after]),
    _emitChanged() { this.emitted++; },
    _emitLineParamsChanged() { this.paramsEmitted++; },
  };
}

{
  const label = { uuid: "s1", kind: "text", style: { color: "#fff" } };
  const self = board([label]);

  setFontSize.call(self, 24, false);
  assert.strictEqual(label.style.font_size, 12,
    "stored in canvas units — 24 screen px at a zoom of 2");
  assert.strictEqual(label.style.color, "#fff", "the rest of the style is left alone");
  assert.deepStrictEqual(self.rendered, [label], "and it redraws");
  assert.strictEqual(self.emitted, 0, "nothing persisted mid-drag");

  // The resize handles sit on the label's corners, and the label just
  // changed size under them — they have to be re-placed or they hang in the
  // air where the label used to end.
  self.editingShape = label;
  setFontSize.call(self, 20, false);
  assert.deepStrictEqual(self.placedShape, [label],
    "the corner dots follow the label as it resizes");
  self.editingShape = null;
  self.editingTitleShape = label;
  setFontSize.call(self, 21, false);
  assert.deepStrictEqual(self.placedTitle, [label],
    "…and so do a label's own handles, when it is the label being edited");
  self.editingTitleShape = null;

  setFontSize.call(self, 30, true);
  assert.strictEqual(label.style.font_size, 15);
  assert.strictEqual(self.emitted, 1, "the commit persists it");
  assert.strictEqual(self.undos.length, 1, "and leaves one undo entry");
  // The undo snapshot is from BEFORE the whole gesture, not from the last
  // frame of it — one drag is one undo.
  assert.deepStrictEqual(self.undos[0][1], { was: undefined });

  // Blank → back to box-sizing. The key is REMOVED, not set to zero: a zero
  // would be a pinned size that happens to be invalid.
  setFontSize.call(self, null, true);
  assert.ok(!("font_size" in label.style), "auto removes the key");
  assert.strictEqual(hasPinned(label), false);
}

{
  // Several at once — the point of the number box is making them agree.
  const a = { uuid: "a", kind: "text", style: {} };
  const b = { uuid: "b", kind: "callout", style: {} };
  const c = { uuid: "c", kind: "rectangle", metadata: { title: "x" }, style: {} };
  const self = board([a, b, c]);
  setFontSize.call(self, 18, true);
  for (const s of [a, b, c]) assert.strictEqual(s.style.font_size, 9);
  assert.strictEqual(self.undos.length, 3, "one undo entry each");
}

{
  // Nothing selected → the default new labels start at, like the thickness
  // slider. Screen px here; converted when a shape is actually made.
  const self = board([]);
  self.selectedShapes = [];
  setFontSize.call(self, 22, true);
  assert.strictEqual(self.lineParams.font_size, 22);
  assert.strictEqual(self.paramsEmitted, 1, "the host is told, so it can persist it");
  assert.strictEqual(self.emitted, 0, "no annotation changed");

  setFontSize.call(self, null, true);
  assert.ok(!("font_size" in self.lineParams));
}

// ── dragging the box takes over ────────────────────────────────────────────

{
  let synced = 0;
  const self = { _hasPinnedFontSize: hasPinned, _syncFontRow() { synced++; } };

  const shape = { style: { font_size: 10, color: "#fff" } };
  unpin.call(self, shape);
  assert.ok(!("font_size" in shape.style), "the pin is released");
  assert.strictEqual(shape.style.color, "#fff", "without disturbing the rest");
  // The panel is told on the very first frame of the drag: the number in
  // the box is no longer what the label is, and leaving it there reads as
  // "still 10px" while the user watches it grow past 10.
  assert.strictEqual(synced, 1, "the panel is re-read as soon as the pin goes");

  // A shape with nothing pinned is left exactly as it was — no style object
  // conjured onto a shape that had none, and no pointless resync on every
  // frame of a drag that already released it.
  const bare = {};
  unpin.call(self, bare);
  assert.deepStrictEqual(bare, {});
  assert.strictEqual(synced, 1, "…and nothing happens on later frames");
}

// All three box-drag gestures release the pin, or the drag would resize the
// box around text that refused to change — which reads as a broken drag.
{
  const sites = [
    ["_startTitleHandleDrag", "self._unpinFontSize(shape);", "a label's own box"],
    ["_applyHandleDrag", 'if (shape.kind === "text") this._unpinFontSize(shape);',
     "a text shape's box"],
  ];
  for (const [fn, needle, what] of sites) {
    const start = src.indexOf(`    ${fn}: function`);
    assert.notStrictEqual(start, -1, `could not find ${fn}`);
    const body = src.slice(start, src.indexOf("\n    },", start));
    assert.ok(body.includes(needle), `dragging ${what} must release the pin`);
  }
  // The callout's box is resized inside _applyHandleDrag's own branch.
  const applyStart = src.indexOf("    _applyHandleDrag: function");
  const applyBody = src.slice(applyStart, src.indexOf("\n    },", applyStart));
  assert.ok(/text_box: \{ x: nx, y: ny, w: nw, h: nh \}[\s\S]{0,220}_unpinFontSize\(shape\)/
    .test(applyBody), "dragging a callout's label box must release the pin");
}

// ── the pinned size is not capped to the box ───────────────────────────────
//
// Both the callout and the label cap the font so the text fits the box
// width. That cap breaks a feedback loop — box height drives the font, the
// font drives the measured height, the height is written back to the box —
// and a pinned size is not in that loop, so it must be honoured as given
// and the box allowed to grow.
for (const guard of [
  "if (!self._hasPinnedFontSize(shape) && coWidthAtHeightFont > coAvailWidth) {",
  "if (!this._hasPinnedFontSize(shape) && widthAtHeightFont > availWidth) {",
]) {
  assert.ok(src.includes(guard), `missing cap bypass: ${guard}`);
}

// ── the row only appears when it can do something ─────────────────────────

function fakeRow() {
  return {
    row: { style: {} },
    num: { value: "sentinel" },
  };
}

function rowSelf(targets, paramTargets, lineParams) {
  const els = fakeRow();
  return {
    els,
    _paramsFontRow: els.row,
    _paramsFontNum: els.num,
    _fontTargetShapes: () => targets,
    _paramsTargetShapes: () => paramTargets || [],
    _hasPinnedFontSize: hasPinned,
    _markerScale: () => 2,
    lineParams: lineParams || {},
  };
}

{
  // A pinned label: the box shows the size in SCREEN px, not canvas units.
  const self = rowSelf([{ style: { font_size: 9 } }]);
  syncFontRow.call(self);
  assert.strictEqual(self.els.row.style.display, "");
  assert.strictEqual(self.els.num.value, "18");
}

{
  // An unpinned label: blank, so the placeholder can say "auto".
  const self = rowSelf([{ style: {} }]);
  syncFontRow.call(self);
  assert.strictEqual(self.els.num.value, "", "empty means auto, not 0");
  assert.strictEqual(self.els.row.style.display, "");
}

{
  // Nothing selected: the row sets the default for new labels.
  const self = rowSelf([], [], { font_size: 30 });
  syncFontRow.call(self);
  assert.strictEqual(self.els.row.style.display, "");
  assert.strictEqual(self.els.num.value, "30", "a default is already in screen px");
}

{
  // A shape with no text: the row hides rather than offering a control that
  // cannot do anything.
  const self = rowSelf([], [{ kind: "rectangle" }]);
  syncFontRow.call(self);
  assert.strictEqual(self.els.row.style.display, "none");
  assert.strictEqual(self.els.num.value, "sentinel", "and is not rewritten on the way out");
}

// A panel that was never built must not throw.
syncFontRow.call({});


// ── the row is a number box, nothing more ─────────────────────────────────
//
// It briefly had a slider beside the box. Nothing else in the panel pairs
// a slider with a read-out you can type into, and a font size is a number
// you already know rather than a position to hunt for.
{
  const start = src.indexOf("      // Font size: a number you type or step");
  assert.notStrictEqual(start, -1, "could not find the font row");
  const body = src.slice(start, src.indexOf("var dashRow = document.createElement", start));
  assert.ok(!body.includes('type = "range"'), "no slider in the font row");
  assert.ok(body.includes('fontNum.type = "number"'), "a number box");
  assert.ok(body.includes('fontNum.step = "1"'),
    "stepping it by one is the increase / decrease");
  assert.ok(body.includes('fontNum.placeholder = "custom"'),
    'blank reads as "custom" — the size you dragged the box to, not a ' +
    "size chosen for you, and not an empty control");
}
assert.ok(!src.includes("_paramsFontInput"),
  "the slider's reference is gone from the sync too, not just from the markup");

// The box carries the same weight as the controls around it — full width
// and the same height as the dash buttons, rather than a small field
// tucked into the corner of a row.
{
  const start = src.indexOf('".etcher-num {"');
  assert.notStrictEqual(start, -1, "could not find the number box styling");
  const rule = src.slice(start, src.indexOf('"}"', start));
  assert.ok(rule.includes("width: 100%"), "full width");
  assert.ok(rule.includes("height: 30px"), "matching the dash buttons' height");
}


// ── the default survives a reload ─────────────────────────────────────────
//
// Per-shape sizes ride `style` and persist with the annotation. The DEFAULT
// travels a different road: out through `etcher:line-params-changed`, into
// the host's storage, and back in through the `line_params` attr on the
// next mount. It was dropped at both ends.

{
  const emit = extract("_emitLineParamsChanged");
  function payloadFor(lineParams) {
    let sent = null;
    const self = {
      _currentLineParams: () => lineParams,
      pushEventTo: (el, name, p) => { sent = p.line_params; },
      _dispatch: () => {},
      el: {},
    };
    emit.call(self);
    return sent;
  }

  const pinned = payloadFor({ width: 2, opacity: 1, dash: "solid", fill: "semi", font_size: 18 });
  assert.strictEqual(pinned.font_size, 18, "a pinned default reaches the host");

  const auto = payloadFor({ width: 2, opacity: 1, dash: "solid", fill: "semi" });
  assert.ok(!("font_size" in auto),
    "…and its ABSENCE is how 'size labels by their box' travels: the host " +
    "replaces this map wholesale, so an omitted key is a cleared key");
}

{
  const seed = extract("_setLineParamsDirect");
  function seeded(map) {
    const self = { lineParams: {}, _syncParamsPopup: () => {} };
    seed.call(self, map);
    return self.lineParams;
  }

  assert.strictEqual(seeded({ font_size: 18 }).font_size, 18,
    "a stored default comes back on the next mount");
  // Clamped to the same limits the control offers, so a hand-edited or
  // corrupted stored value can't produce an unreadable or absurd label.
  assert.strictEqual(seeded({ font_size: 5000 }).font_size, 200);
  assert.strictEqual(seeded({ font_size: 1 }).font_size, 6);
  // Anything unusable leaves labels sized by their box — which is what
  // every board did before there was a control for it.
  for (const bad of [0, -3, NaN, "18", null, undefined]) {
    assert.ok(!("font_size" in seeded({ font_size: bad })),
      `${String(bad)} must not pin a default`);
  }
}


// ── it is named after what it sizes, and it survives the compact strip ────

{
  const start = src.indexOf("      // Font size: a number you type or step");
  const body = src.slice(start, src.indexOf("var dashRow = document.createElement", start));
  assert.ok(body.includes('fontLabel.textContent = "Label size";'),
    'the row says what it sizes — "Label size", not "Font size"');
  assert.ok(/fontNum\.title =\s*\n?\s*"Label size in px/.test(body),
    "and the input's tooltip says it too, which is all there is to go on " +
    "in the compact strip where the caption cannot be drawn");
  assert.ok(body.includes('"etcher-marker-row etcher-font-row"'),
    "the row is tagged so the compact strip can keep it");
}

{
  // The compact strip hides every slider row. This row is a number box, it
  // fits, and setting one size everywhere is most of the point of having it
  // — so it is put back.
  const hide = '".etcher-stylepanel[data-size=\\"compact\\"] .etcher-marker-row { display: none; }"';
  const show = '".etcher-stylepanel[data-size=\\"compact\\"] .etcher-font-row {"';
  assert.ok(src.includes(hide), "sliders still fold away in the strip");
  assert.ok(src.indexOf(show) > src.indexOf(hide),
    "and the font row is restored AFTER that rule, or it would lose to it");

  const rule = src.slice(src.indexOf(show), src.indexOf('"}"', src.indexOf(show)));
  assert.ok(rule.includes("display: flex;"), "shown in the strip");

  // Its caption has nowhere to go at that width, and the spinners would
  // leave too little room for the digits.
  assert.ok(src.includes(
    '".etcher-stylepanel[data-size=\\"compact\\"] .etcher-font-row .etcher-marker-row-head {"'),
    "the caption folds away instead of wrapping");
  assert.ok(src.includes('"  -moz-appearance: textfield; appearance: textfield;"'),
    "and the spinners do too, so three digits fit");
}

console.log("font size: all checks passed");
