// The laser measure tool on the layer side: where a reading goes, what label
// each kind gets, the rectangle's two readings, the held reading, and that
// it is one undo step like a typed label.
//
//   node test/js/laser_measure_test.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "../../priv/static/etcher.js"), "utf8");

function block(startMark, endMark) {
  const start = src.indexOf(startMark);
  assert.ok(start !== -1, startMark);
  const end = src.indexOf(endMark, start);
  return src.slice(start, end + endMark.length);
}
// The constants the methods read, taken from the source itself.
// eslint-disable-next-line no-unused-vars
const MEASURE_UNITS = eval("(" + block("var MEASURE_UNITS = {", "\n  };").replace("var MEASURE_UNITS = ", "").replace(/;$/, "") + ")");
// eslint-disable-next-line no-unused-vars
const MEASURE_SKIP_KINDS = eval(block("var MEASURE_SKIP_KINDS = [", "];").replace("var MEASURE_SKIP_KINDS = ", ""));
// eslint-disable-next-line no-unused-vars
let laserOwner = null;
// eslint-disable-next-line no-unused-vars
const normalizeTitleAlign = (v) => v || null;
let laserState = "on";
// eslint-disable-next-line no-unused-vars
const Laser = { state: () => laserState, supported: () => true, measure: () => Promise.resolve() };

function lift(name) {
  const head = "    " + name + ": function(";
  const start = src.indexOf(head);
  assert.ok(start !== -1, name);
  const end = src.indexOf("\n    },\n", start);
  return eval("(function(" + src.slice(start + head.length, end + 6) + ")");
}

function classList() {
  const set = new Set();
  return { set, toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c) };
}

function layer(fmt) {
  const self = {
    tools: ["dimension", "measure"],
    shapes: [], selectedShapes: [], editingShape: null, editingTitleShape: null,
    undo: [], emitted: 0, events: [], toasts: [], annotationMode: true, activeTool: "measure",
    _measureFormat: null,
    _isTextKind: (k) => k === "text" || k === "callout",
    _labelRidesShaft: (k) => k === "dimension" || k === "arrow",
    _snapshotShape: (s) => ({ metadata: s.metadata ? JSON.parse(JSON.stringify(s.metadata)) : null }),
    _renderShape: () => {},
    _renderHandles: () => {},
    _syncLabelSection: () => {},
    _emitChanged: () => { self.emitted++; },
    _pushUndo: (uuid, before, after) => self.undo.push({ uuid, before, after }),
    _syncMeasureChip: () => {},
    _showToast: (t) => self.toasts.push(t),
    _dispatch: (name, detail) => self.events.push(detail),
    _commitTextEdit: () => { throw new Error("no editor in these tests"); }
  };
  ["_measureOffered", "_readMeasureFormat", "_formatMeasure", "_measureTargetable",
   "_setMeasureTarget", "_clearMeasureTarget", "_syncMeasureMark", "_applyMeasureTo",
   "_onLaserReading", "_setShapeLabel"].forEach((n) => { self[n] = lift(n); });
  self._measureFormat = self._readMeasureFormat(fmt ? JSON.stringify(fmt) : undefined);
  return self;
}

let n = 0;
function shape(kind, extra) {
  const s = Object.assign({ uuid: "s" + (++n), kind, el: { classList: classList() }, metadata: null }, extra || {});
  return s;
}
const reading = (metres) => ({ type: "measurement", metres, source: "device" });

// --- Format --------------------------------------------------------------
{
  const l = layer();
  assert.strictEqual(l._formatMeasure(2.28695), "2287 mm", "mm, no decimals, by default");
  assert.strictEqual(layer({ unit: "cm" })._formatMeasure(2.28695), "228.7 cm");
  assert.strictEqual(layer({ unit: "m" })._formatMeasure(2.28695), "2.287 m");
  assert.strictEqual(layer({ unit: "in" })._formatMeasure(0.0254), "1.00 in");
  assert.strictEqual(layer({ unit: "mm", precision: 1, suffix: false })._formatMeasure(2.28695), "2287.0", "half rounds up");
  assert.strictEqual(l._formatMeasure(0.00005 * 45739), "2287 mm");
  assert.strictEqual(l._formatMeasure(1.0005), "1001 mm", "x.5 mm rounds up");
  assert.strictEqual(layer({ unit: "furlong" })._formatMeasure(1), "1000 mm", "unknown unit falls back");
}

// --- A pulsing dimension takes the reading: label, measured_m, one undo ----
{
  const l = layer();
  const d = shape("dimension");
  l.shapes.push(d);
  l._setMeasureTarget(d);
  assert.ok(d.el.classList.contains("etcher-measure-target"), "pulses while waiting");
  l._onLaserReading(reading(2.28695));
  assert.deepStrictEqual(d.metadata, { title: "2287 mm", measured_m: 2.28695 });
  assert.ok(!d.el.classList.contains("etcher-measure-target"), "stops pulsing");
  assert.strictEqual(l._measureTarget, null);
  assert.strictEqual(l.undo.length, 1, "one undo step");
  assert.strictEqual(l.undo[0].before.metadata, null, "undo goes back to no label");
  assert.strictEqual(l.emitted, 1, "saved once");
  assert.deepStrictEqual(l.events[0], { frescoId: null, metres: 2.28695, text: "2287 mm", source: "device", uuid: d.uuid, held: false });
}

// --- Rectangle: width, then height, in one label ------------------------
{
  const l = layer();
  const r = shape("rectangle");
  l.shapes.push(r);
  l._setMeasureTarget(r);
  l._onLaserReading(reading(0.6));
  assert.strictEqual(r.metadata, null, "nothing written after the width");
  assert.ok(r.el.classList.contains("etcher-measure-target"), "still waiting for the height");
  assert.deepStrictEqual(l._measurePartial, { uuid: r.uuid, width: 0.6 });
  l._onLaserReading(reading(0.9));
  assert.strictEqual(r.metadata.title, "600 × 900 mm", "one unit, at the end");
  assert.deepStrictEqual(r.metadata.measured_m, [0.6, 0.9]);
  assert.deepStrictEqual(r.metadata.title_align, { h: "center", v: "middle" }, "centred like a typed label");
  assert.strictEqual(l.undo.length, 1, "the pair is one undo step");
  assert.ok(!r.el.classList.contains("etcher-measure-target"));
}

// --- Circle gets a diameter mark; text becomes the reading ----------------
{
  const l = layer({ suffix: false });
  const c = shape("circle");
  const t = shape("text", { metadata: { title: "x" } });
  l.shapes.push(c, t);
  l._setMeasureTarget(c);
  l._onLaserReading(reading(0.6));
  assert.strictEqual(c.metadata.title, "Ø 600");
  l._setMeasureTarget(t);
  l._onLaserReading(reading(1.2));
  assert.strictEqual(t.metadata.title, "1200");
  assert.strictEqual(t.metadata.title_align, undefined, "text kinds keep their own alignment");
}

// --- Nothing waiting: the reading is held, then goes to the next shape -----
{
  const l = layer();
  l._onLaserReading(reading(1.5));
  assert.strictEqual(l._heldReading, 1.5, "held");
  assert.strictEqual(l.events[0].held, true);
  assert.strictEqual(l.undo.length, 0, "nothing guessed");
  const d = shape("dimension");
  l.shapes.push(d);
  l._setMeasureTarget(d);
  assert.strictEqual(d.metadata.title, "1500 mm", "the next shape takes it");
  assert.strictEqual(l._heldReading, null);
  assert.ok(!d.el.classList.contains("etcher-measure-target"), "done, no pulse");
}

// --- One shape selected (no pulse) takes it, as the brief asked -----------
{
  const l = layer();
  const d = shape("dimension", { metadata: { title: "old" } });
  l.shapes.push(d);
  l.selectedShapes = [d];
  l._onLaserReading(reading(0.5));
  assert.strictEqual(d.metadata.title, "500 mm", "replaces the selected label");
  assert.strictEqual(l.undo[0].before.metadata.title, "old");
}

// --- Locked shapes, pictures and ink are never written --------------------
{
  const l = layer();
  const locked = shape("dimension", { readonly: true });
  const img = shape("image");
  const ink = shape("marker");
  assert.strictEqual(l._measureTargetable(locked), false);
  assert.strictEqual(l._measureTargetable(img), false);
  assert.strictEqual(l._measureTargetable(ink), false);
  assert.strictEqual(l._measureTargetable(shape("polygon")), true);
  l.shapes.push(locked);
  l.selectedShapes = [locked];
  l._onLaserReading(reading(0.5));
  assert.strictEqual(locked.metadata, null, "locked shape untouched");
  assert.strictEqual(l._heldReading, 0.5, "held instead");
}

// --- A device error writes nothing and says so ----------------------------
{
  const l = layer();
  const d = shape("dimension");
  l.shapes.push(d);
  l._setMeasureTarget(d);
  l._onLaserReading({ type: "error", status: 3 });
  assert.strictEqual(d.metadata, null);
  assert.ok(/error 3/.test(l.toasts[0]));
  assert.ok(d.el.classList.contains("etcher-measure-target"), "still waiting, try again");
  assert.strictEqual(l.events.length, 0);
}

// --- A target deleted while waiting is not written to ---------------------
{
  const l = layer();
  const d = shape("dimension");
  l.shapes.push(d);
  l._setMeasureTarget(d);
  l.shapes = [];
  l._onLaserReading(reading(0.5));
  assert.strictEqual(d.metadata, null);
  assert.strictEqual(l._heldReading, 0.5);
}

// --- setLabel (the public API's path) -------------------------------------
{
  const l = layer();
  const d = shape("dimension", { metadata: { title: "2287 mm", measured_m: 2.287, color: "red" } });
  assert.strictEqual(l._setShapeLabel(d, "about 2.3 m"), true);
  assert.deepStrictEqual(d.metadata, { title: "about 2.3 m", color: "red" }, "a hand-set label drops the stale reading");
  assert.strictEqual(l.undo.length, 1);
  assert.strictEqual(l._setShapeLabel(d, "about 2.3 m"), true, "same label");
  assert.strictEqual(l.undo.length, 1, "no-op adds no undo step");
  assert.strictEqual(l._setShapeLabel(shape("dimension", { readonly: true }), "x"), false, "locked");
  assert.strictEqual(l._setShapeLabel(shape("text", { metadata: { title: "a" } }), ""), false, "text can't be emptied");
  assert.strictEqual(l._setShapeLabel(null, "x"), false);
}

console.log("laser_measure_test: ok");
