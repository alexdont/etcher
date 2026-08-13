// Pins the shape clipboard: ⌘C serializes the selection onto the DOM copy
// event (custom MIME + text/plain), ⌘X additionally deletes, and ⌘V
// rebuilds the shapes offset 16px, freshly-uuid'd, selected — winning
// over the image/text paste paths and ignoring clipboard text that is
// not ours.
//
//   node test/js/shape_clipboard_test.js

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

const serializeSelection = extract("_serializeSelection");
const parseShapeEnvelope = extract("_parseShapeEnvelope");
const pasteShapes = extract("_pasteShapes");
const onShapeCopy = extract("_onShapeCopy");
const translateGeometry = extract("_translateGeometry");

global.window = { getSelection: () => ({ toString: () => "" }) };

// ── serialization: what goes on the clipboard ───────────────────────────────

{
  const shape = {
    uuid: "SECRET-uuid", kind: "rectangle",
    geometry: { x: 10, y: 20, w: 30, h: 40 },
    style: { color: "#f00" }, metadata: { title: "hi" },
    el: {}
  };
  const env = serializeSelection.call({ selectedShapes: [shape], editingShape: null });
  assert.strictEqual(env.etcher, "shapes");
  assert.strictEqual(env.shapes.length, 1);
  assert.ok(!("uuid" in env.shapes[0]),
    "the payload must NOT carry the uuid — _addShape would reuse it and a same-board paste would collide with the original");
  assert.deepStrictEqual(env.shapes[0].geometry, { x: 10, y: 20, w: 30, h: 40 });
  assert.deepStrictEqual(env.shapes[0].metadata, { title: "hi" });

  assert.strictEqual(serializeSelection.call({ selectedShapes: null, editingShape: null }), null,
    "nothing selected → nothing serialized, so the copy event falls through to the page");
}

// ── the envelope parser rejects everything that is not ours ─────────────────

{
  const good = JSON.stringify({ etcher: "shapes", version: 1, shapes: [{ kind: "rectangle", geometry: {} }] });
  assert.strictEqual(parseShapeEnvelope(good).length, 1);
  assert.strictEqual(parseShapeEnvelope("plain words"), null);
  assert.strictEqual(parseShapeEnvelope('{"some":"json"}'), null);
  assert.strictEqual(parseShapeEnvelope('{"etcher":"prefs"}'), null,
    "an etcher envelope of the wrong type must not paste as shapes");
  assert.strictEqual(parseShapeEnvelope(""), null);
  assert.strictEqual(parseShapeEnvelope(null), null);
  // The cap: a hostile payload cannot spray unbounded shapes.
  const many = JSON.stringify({ etcher: "shapes", version: 1,
    shapes: new Array(5000).fill({ kind: "rectangle", geometry: {} }) });
  assert.ok(parseShapeEnvelope(many).length <= 200,
    "the parser must cap the shape count — a hostile payload otherwise creates shapes until the tab dies");
}

// ── copy fills the clipboard; cut also deletes ──────────────────────────────

function copyHarness(isCut, opts) {
  const data = {};
  const deleted = [];
  const shape = {
    uuid: "u1", kind: "rectangle",
    geometry: { x: 0, y: 0, w: 10, h: 10 }, el: {}
  };
  const ctx = Object.assign({
    annotationMode: true,
    selectedShapes: [shape],
    editingShape: null,
    _serializeSelection: serializeSelection,
    _deleteSelectedShapes: () => deleted.push("selection"),
    _deleteShape: (s) => deleted.push(s.uuid)
  }, opts || {});
  let prevented = false;
  const e = {
    target: null,
    preventDefault: () => { prevented = true; },
    clipboardData: { setData: (type, v) => { data[type] = v; } }
  };
  onShapeCopy.call(ctx, e, isCut);
  return { data, deleted, prevented };
}

{
  const { data, deleted, prevented } = copyHarness(false);
  assert.ok(prevented, "a shape copy must consume the event");
  assert.ok(data["application/x-etcher-shapes"], "the custom MIME type must be written");
  assert.ok(data["text/plain"], "the text/plain fallback must be written — it is what crosses apps");
  assert.deepStrictEqual(JSON.parse(data["text/plain"]).etcher, "shapes");
  assert.deepStrictEqual(deleted, [], "copy must not delete anything");
}
{
  const { deleted } = copyHarness(true);
  assert.deepStrictEqual(deleted, ["selection"], "cut must delete what it copied");
}
{
  // Browse mode: the clipboard belongs to the page.
  const { prevented } = copyHarness(false, { annotationMode: false });
  assert.ok(!prevented, "copy outside annotation mode must fall through");
}
{
  // A live text selection wins over shapes.
  global.window = { getSelection: () => ({ toString: () => "some words" }) };
  const { prevented } = copyHarness(false);
  assert.ok(!prevented, "with real text selected, ⌘C must copy the words, not the shapes");
  global.window = { getSelection: () => ({ toString: () => "" }) };
}

// ── paste rebuilds, offsets, re-selects ─────────────────────────────────────

{
  const shapes = [];
  const created = [];
  const selected = [];
  let edited = null;
  let nextId = 1;
  const ctx = {
    shapes,
    _translateGeometry: translateGeometry,
    _addShape: (payload) => {
      const uuid = "p" + nextId++;
      shapes.push(Object.assign({ uuid, el: {} }, payload));
      return uuid;
    },
    _pushUndoCreate: (s) => created.push(s.uuid),
    _addToSelection: (s) => selected.push(s.uuid),
    _clearSelection: () => { selected.length = 0; },
    _exitEditMode: () => {},
    _enterEditMode: (s) => { edited = s.uuid; },
    _syncActionBar: () => {}
  };

  const ok = pasteShapes.call(ctx, [
    { kind: "rectangle", geometry: { x: 10, y: 10, w: 40, h: 20 }, uuid: "evil-reuse" },
    { kind: "line", geometry: { a: [0, 0], b: [50, 0] } },
    { nonsense: true },
    "not even an object"
  ]);
  assert.strictEqual(ok, true);
  assert.strictEqual(shapes.length, 2, "malformed entries must be skipped, valid ones pasted");
  assert.deepStrictEqual(shapes[0].geometry, { x: 26, y: 26, w: 40, h: 20 },
    "a pasted shape must land offset 16px from its source, not invisibly under it");
  assert.deepStrictEqual(shapes[1].geometry, { a: [16, 16], b: [66, 16] });
  assert.ok(!("uuid" in Object.assign({}, shapes[0], { uuid: undefined, el: undefined })) || shapes[0].uuid === "p1",
    "the paste must mint fresh uuids — never reuse one from the payload");
  assert.deepStrictEqual(created, ["p1", "p2"], "each pasted shape gets a create-undo entry");
  assert.deepStrictEqual(selected, ["p1", "p2"], "the pasted shapes end up selected");
  assert.strictEqual(edited, null, "a multi-paste stays a multi-selection");

  // A single-shape paste drops into edit mode, like ⌘D.
  const one = pasteShapes.call(ctx, [{ kind: "circle", geometry: { cx: 5, cy: 5, r: 2 } }]);
  assert.strictEqual(one, true);
  assert.strictEqual(edited, "p3", "a single pasted shape goes straight into edit mode");

  assert.strictEqual(pasteShapes.call(ctx, []), false, "an empty paste reports nothing done");
}

// ── the paste handler routes shapes ahead of images and text ────────────────

{
  const handler = src.slice(src.indexOf("    _wireImagePaste: function"),
    src.indexOf("\n    },", src.indexOf("    _wireImagePaste: function")));
  const shapesAt = handler.indexOf("_parseShapeEnvelope");
  const imagesAt = handler.indexOf('indexOf("image/")');
  const gateAt = handler.indexOf("if (self.pasteImages === false) return;");
  assert.ok(shapesAt !== -1, "the paste handler no longer checks for shape envelopes");
  assert.ok(imagesAt !== -1 && shapesAt < imagesAt,
    "shapes must be checked BEFORE images — our own envelope must never become a text label of raw JSON");
  assert.ok(gateAt !== -1 && shapesAt < gateAt,
    "the pasteImages gate must sit AFTER the shapes branch — that flag governs media, not shapes");
  assert.ok(!/if \(self\.pasteImages === false\) return;[\s\S]*_pasteHandler = function/.test(handler),
    "the handler must be wired even when pasteImages is off, or shape paste dies with it");
}

// ── copy/cut are wired and torn down ────────────────────────────────────────

assert.ok(src.includes('document.addEventListener("copy", self._copyHandler)'), "copy is not wired");
assert.ok(src.includes('document.addEventListener("cut", self._cutHandler)'), "cut is not wired");
assert.ok(src.includes('document.removeEventListener("copy", this._copyHandler)'),
  "copy is never unwired — a destroyed board would keep serving its stale selection");
assert.ok(src.includes('document.removeEventListener("cut", this._cutHandler)'), "cut is never unwired");

console.log("shape clipboard: all checks passed");
