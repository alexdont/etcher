// Pins the label-colour memory: colouring a label is remembered, and the
// next label the user creates starts in that colour.
//
// Labelling three parts of a drawing in blue shouldn't mean recolouring
// each label by hand. The swatch path (a focused label + a colour pick)
// saves the choice as the `label_color` pref — persisted wherever the host
// stores prefs — and `_commitTextEdit` stamps it onto brand-new labels at
// creation. Creation only: re-editing text never repaints a label, and an
// explicit `title_color` is never overwritten.
//
//   node test/js/label_color_memory_test.js

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

global.normalizeTitleAlign = () => null;
const commitTextEdit = extract("_commitTextEdit");

// Run a text-edit commit against a shape and report the metadata it wrote.
function commit(shape, typed, remembered) {
  const ctx = {
    _textEditor: { shape, input: { value: typed } },
    _getPref: (k) => (k === "label_color" ? remembered : undefined),
    _isTextKind: (k) => k === "text" || k === "callout" || k === "dimension",
    _labelRidesShaft: (k) => k === "dimension" || k === "arrow",
    _snapshotShape: () => ({}),
    _endTextEdit: () => {},
    _renderShape: () => {},
    _syncLabelSection: () => {},
    _discardEmptyTextShape: () => {},
    _emitChanged: () => {},
    _pushUndo: () => {}
  };
  commitTextEdit.call(ctx);
  return shape.metadata || {};
}

// ── a new label adopts the remembered colour ────────────────────────────────

{
  const meta = commit({ kind: "rectangle", uuid: "u1", metadata: null }, "part A", "#3b82f6");
  assert.strictEqual(meta.title_color, "#3b82f6",
    "a brand-new label should start in the colour the user last gave a label");
}
{
  // Shaft-riding labels (dimension, arrow) default to their LINE's colour
  // — a red arrow gets a red label — so the remembered preference must
  // not stamp them. Recolouring one by hand still writes title_color,
  // which _titleColorFor honours ahead of the inherited colour.
  const meta = commit({ kind: "dimension", uuid: "u2", metadata: null }, "42 cm", "#3b82f6");
  assert.strictEqual(meta.title_color, undefined,
    "a dimension's label rides its line's colour, not the remembered one");
}
{
  const meta = commit({ kind: "arrow", uuid: "u3", metadata: null }, "here", "#3b82f6");
  assert.strictEqual(meta.title_color, undefined,
    "an arrow's label rides its line's colour, not the remembered one");
}

// ── what an unstamped shaft label actually renders in ───────────────────────

{
  // The other half of the shaft rule: _titleColorFor resolves an
  // unstamped label to the SHAPE's colour — dimension included, whose
  // old hardcoded black default read as an annotation disconnected from
  // the line it measures. An explicit title_color still wins.
  const titleColorFor = extract("_titleColorFor");
  const red = { kind: "dimension", style: { color: "#ef4444" }, metadata: {} };
  assert.strictEqual(titleColorFor.call({}, red), "#ef4444",
    "a red dimension gets a red label, not a black one");
  const arrow = { kind: "arrow", style: { color: "#ef4444" }, metadata: {} };
  assert.strictEqual(titleColorFor.call({}, arrow), "#ef4444");
  const explicit = {
    kind: "dimension",
    style: { color: "#ef4444" },
    metadata: { title_color: "#111111" }
  };
  assert.strictEqual(titleColorFor.call({}, explicit), "#111111",
    "…but a colour given by hand always wins");
}

// ── with nothing remembered, nothing is stamped ─────────────────────────────

{
  const meta = commit({ kind: "rectangle", uuid: "u3", metadata: null }, "part B", undefined);
  assert.ok(!("title_color" in meta),
    "no remembered colour → the label follows its shape, as labels always have");
}

// ── never repaints: creation only, explicit colours win ─────────────────────

{
  const meta = commit(
    { kind: "rectangle", uuid: "u4", metadata: { title: "old", title_color: "#f59e0b" } },
    "renamed", "#3b82f6");
  assert.strictEqual(meta.title_color, "#f59e0b",
    "re-editing a label's text repainted its explicit colour");
}
{
  const meta = commit(
    { kind: "rectangle", uuid: "u5", metadata: { title: "old" } },
    "renamed", "#3b82f6");
  assert.ok(!("title_color" in meta),
    "re-editing text stamped a colour onto an existing label that was following its shape");
}

// ── text and callout are their own text — never stamped ─────────────────────

for (const kind of ["text", "callout"]) {
  const meta = commit({ kind, uuid: "u6", metadata: null }, "hello", "#3b82f6");
  assert.ok(!("title_color" in meta),
    `${kind} text takes the shape's colour; title_color on it is dead data`);
}

// ── the swatch path saves the memory ────────────────────────────────────────

// The write site: recolouring a focused label must both stamp the label
// AND remember the choice for the next one.
{
  const site = src.indexOf("title_color: color");
  assert.notStrictEqual(site, -1, "could not find the label recolour site");
  const after = src.slice(site, site + 800);
  assert.ok(after.includes('_setPref("label_color", color)'),
    "recolouring a label no longer remembers the colour — the next label reverts to the shape default");
}

console.log("label color memory: all checks passed");
