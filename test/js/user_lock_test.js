// The user's own lock (`metadata.locked`): saved with the shape, undoable,
// and the host's lock kept apart from it.
//
//   node test/js/user_lock_test.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "../../priv/static/etcher.js"), "utf8");

function lift(name) {
  const head = "    " + name + ": function(";
  const start = src.indexOf(head);
  assert.ok(start !== -1, name);
  const end = src.indexOf("\n    },\n", start);
  return eval("(function(" + src.slice(start + head.length, end + 6) + ")");
}

function el() {
  const attrs = {};
  return { attrs, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: (k) => { delete attrs[k]; } };
}

function layer() {
  const calls = [];
  const self = {
    calls, undo: [], emitted: 0, editingShape: null, selectedShapes: [],
    _isUserLocked: lift("_isUserLocked"),
    _syncLock: lift("_syncLock"),
    _setLocked: lift("_setLocked"),
    _setShapeReadonly: lift("_setShapeReadonly"),
    _snapshotShape: (s) => ({ metadata: s.metadata ? JSON.parse(JSON.stringify(s.metadata)) : null }),
    _renderShape: () => {},
    _pushUndo: (uuid, before, after) => self.undo.push([uuid, before, after]),
    _emitChanged: () => { self.emitted++; },
    _syncActionBar: () => {},
    _exitEditMode: () => { calls.push("exit"); self.editingShape = null; },
    _isInSelection: (s) => self.selectedShapes.indexOf(s) !== -1,
    _removeFromSelection: (s) => { calls.push("deselect:" + s.uuid); self.selectedShapes = self.selectedShapes.filter((x) => x !== s); }
  };
  return self;
}

// Locking: stored, readonly, deselected, one undo step, saved once.
{
  const l = layer();
  const a = { uuid: "a", el: el(), metadata: { title: "Hi" } };
  const b = { uuid: "b", el: el(), metadata: null };
  l.shapes = [a, b];
  l.editingShape = a; l.selectedShapes = [a, b];
  l._setLocked([a, b], true);
  assert.deepStrictEqual(a.metadata, { title: "Hi", locked: true }, "kept in metadata, beside what was there");
  assert.ok(a.readonly && b.readonly);
  assert.strictEqual(a.el.attrs["data-locked"], "true");
  assert.deepStrictEqual(l.calls, ["exit", "deselect:a", "deselect:b"]);
  assert.strictEqual(l.undo.length, 2, "undoable");
  assert.strictEqual(l.emitted, 1, "saved once");

  l._setLocked([a], true);
  assert.strictEqual(l.emitted, 1, "locking a locked shape changes nothing");

  l._setLocked([a, b], false);
  assert.deepStrictEqual(a.metadata, { title: "Hi" });
  assert.strictEqual(b.metadata, null, "no empty metadata left behind");
  assert.ok(!a.readonly && !b.readonly);
  assert.ok(!("data-readonly" in a.el.attrs) && !("data-locked" in a.el.attrs));
}

// The host's lock is not the user's.
{
  const l = layer();
  const h = { uuid: "h", el: el(), metadata: null, _hostReadonly: true, readonly: true };
  l.shapes = [h];
  l._setLocked([h], true);
  assert.strictEqual(h.metadata, null, "a host-locked shape is not the user's to lock");
  l._setLocked([h], false);
  assert.ok(h.readonly, "nor to unlock");

  // A user-locked shape stays locked when the host lifts its own lock.
  const u = { uuid: "u", el: el(), metadata: { locked: true } };
  l.shapes = [u];
  l._syncLock(u);
  l._setShapeReadonly.call(Object.assign(l, { _exitEditMode() {}, }), "u", false);
  assert.ok(u.readonly, "the user's lock outlives the host's");
}

// A lock arriving from a peer or an undo is picked up on the next draw.
{
  const l = layer();
  const s = { uuid: "s", el: el(), metadata: null, readonly: false };
  l._syncLock(s);
  assert.ok(!s.readonly);
  s.metadata = { locked: true };
  l._syncLock(s);
  assert.ok(s.readonly);
  assert.ok(src.includes("if (shape.uuid) this._syncLock(shape);"), "every draw syncs the lock");
}

console.log("User lock: all checks passed");
