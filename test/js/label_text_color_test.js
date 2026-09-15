// Pins the label TEXT colour chip against the selection.
//
// The label swatch row is split in two: the text ink and the plate behind
// it. The plate half always worked on the selection; the text half
// silently edited the "what colour new labels start in" default instead —
// so with a shape selected, picking a text colour did nothing you could
// see, while the chip's own caption said "this label". _setLabelColor is
// the missing write half, shaped exactly like _setLabelBg: selection
// first, default only when there is no selection.
//
//   node test/js/label_text_color_test.js

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

const setLabelColor = extract("_setLabelColor");
const fontTargets = extract("_fontTargetShapes");
const titleColorFor = extract("_titleColorFor");

function board(over) {
  return Object.assign({
    prefs: {},
    rendered: [],
    restyled: 0,
    undos: [],
    shapes: [],
    selectedShapes: [],
    _fontTargetShapes: fontTargets,
    _getPref(k) { return this.prefs[k]; },
    _setPref(k, v) { this.prefs[k] = v; },
    _renderShape(s) { this.rendered.push(s); },
    _restyleDrafts() { this.restyled++; },
    _refreshLabelSwatch() {},
    _syncStyleInspector() {},
    _snapshotShape: (s) => JSON.parse(JSON.stringify(s || {})),
    _pushUndo(uuid, before, after) { this.undos.push({ uuid, before, after }); },
    _emitChanged() { this.emitted = (this.emitted || 0) + 1; },
  }, over || {});
}

// ── nothing selected: the default for new labels ──────────────────────────

{
  const self = board();
  setLabelColor.call(self, "#ff0000");
  assert.strictEqual(self.prefs.label_color, "#ff0000",
    "with no selection the pick is a statement about new labels");
  assert.ok(self.restyled > 0, "anything being drawn right now picks it up");
}

// ── with a selection: the pick lands on IT, visibly ───────────────────────

{
  const titled = { uuid: "a", kind: "rectangle", metadata: { title: "hi" }, style: { color: "#0000ff" } };
  const text = { uuid: "b", kind: "text", style: { color: "#0000ff" } };
  const callout = { uuid: "c", kind: "callout", style: { color: "#0000ff" } };
  const plain = { uuid: "d", kind: "rectangle", style: { color: "#0000ff" } };
  const self = board({ selectedShapes: [titled, text, callout, plain] });
  self.shapes = [titled, text, callout, plain];

  setLabelColor.call(self, "#00ff00");

  // A titled shape keeps its own ink separate from its outline: the label
  // recolours, the rectangle does not.
  assert.strictEqual(titled.metadata.title_color, "#00ff00");
  assert.strictEqual(titled.style.color, "#0000ff", "the shape's own colour is untouched");

  // A text or callout IS its label, so theirs is the shape's colour —
  // mirroring exactly where _currentLabelColor reads from.
  assert.strictEqual(text.style.color, "#00ff00");
  assert.strictEqual(callout.style.color, "#00ff00");

  assert.ok(!(plain.metadata && plain.metadata.title_color),
    "a shape with no label has no label to recolour");

  assert.strictEqual(self.prefs.label_color, undefined,
    "the authoring default is left alone — this edited the selection");
  assert.strictEqual(self.undos.length, 3, "one undo entry per recoloured shape");
  assert.strictEqual(self.emitted, 1, "the change persists with the shapes");
  assert.strictEqual(self.rendered.length, 3, "each recoloured shape re-renders");
}

// ── the renderer honours what was written ─────────────────────────────────

{
  assert.strictEqual(
    titleColorFor({ kind: "rectangle", metadata: { title_color: "#00ff00" }, style: { color: "#0000ff" } }),
    "#00ff00",
    "a label's own ink beats the shape's colour");
}

// ── the picker routes here ────────────────────────────────────────────────

{
  // The regression this file exists for: the _labelPickTarget branch used
  // to write the pref directly, whatever was selected.
  const applyPicked = extract("_applyPickedColor");
  let landed = null;
  const self = {
    _labelBgPickTarget: false,
    _labelPickTarget: true,
    _setLabelColor(hex) { landed = hex; },
  };
  applyPicked.call(self, "#123456");
  assert.strictEqual(landed, "#123456",
    "a pick from the label swatch goes through _setLabelColor, which " +
    "prefers the selection over the default");
}

console.log("label text color: all checks passed");
