// Offline mode's merge: what a device did while offline, put together with
// what the server has by the time it reconnects. Three lists — base (what the
// server last confirmed to this device), local (what the device has now),
// server (what the server has now) — merged shape by shape.
//
//   node test/js/offline_merge_test.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher.js"), "utf8");
const start = src.indexOf("  var Offline = (function() {");
const end = src.indexOf("  window.Etcher.offline = Offline;", start);
assert.ok(start !== -1 && end !== -1, "offline block");
const O = new Function("window", "navigator", "document", "indexedDB",
  src.slice(start, end) + "  return Offline;")({ location: { pathname: "/", search: "" } }, {}, undefined, undefined);

const sh = (uuid, x, extra) => Object.assign({ uuid, kind: "rectangle", geometry: { x, y: 0, w: 10, h: 10 } }, extra || {});
const ids = (list) => list.map((s) => s.uuid + (s.geometry ? "@" + s.geometry.x : ""));

// Nothing changed anywhere: the server's list.
{
  const base = [sh("a", 1), sh("b", 2)];
  assert.deepStrictEqual(ids(O.merge(base, base, base)), ["a@1", "b@2"]);
}

// Only this device changed: its version wins, additions kept, deletions applied.
{
  const base = [sh("a", 1), sh("b", 2)];
  const local = [sh("a", 5), sh("c", 3)];            // moved a, deleted b, added c
  assert.deepStrictEqual(ids(O.merge(base, local, base)), ["a@5", "c@3"]);
}

// Only the server changed: its changes come through, and this device does not
// revert them (an untouched shape takes the server's version — even a deletion).
{
  const base = [sh("a", 1), sh("b", 2)];
  const server = [sh("a", 9), sh("d", 4)];           // peer moved a, deleted b, added d
  assert.deepStrictEqual(ids(O.merge(base, base, server)), ["a@9", "d@4"]);
}

// Both changed different shapes: both kept.
{
  const base = [sh("a", 1), sh("b", 2)];
  const local = [sh("a", 5), sh("b", 2), sh("c", 3)];
  const server = [sh("a", 1), sh("b", 7)];
  assert.deepStrictEqual(ids(O.merge(base, local, server)), ["a@5", "b@7", "c@3"]);
}

// Both changed the SAME shape: this device wins (one person on site).
{
  const base = [sh("a", 1)];
  assert.deepStrictEqual(ids(O.merge(base, [sh("a", 5)], [sh("a", 9)])), ["a@5"]);
}

// Deleted here, changed on the server: the change is kept, not thrown away.
{
  const base = [sh("a", 1), sh("b", 2)];
  const local = [sh("b", 2)];
  const server = [sh("a", 9), sh("b", 2)];
  assert.deepStrictEqual(ids(O.merge(base, local, server)), ["b@2", "a@9"]);
}

// Deleted here, deleted on the server too: gone.
{
  const base = [sh("a", 1), sh("b", 2)];
  assert.deepStrictEqual(ids(O.merge(base, [sh("b", 2)], [sh("b", 2)])), ["b@2"]);
}

// Order: this device's order, then shapes only the server added.
{
  const base = [sh("a", 1), sh("b", 2)];
  const local = [sh("b", 2), sh("a", 1), sh("c", 3)];
  const server = [sh("a", 1), sh("b", 2), sh("d", 4)];
  assert.deepStrictEqual(ids(O.merge(base, local, server)), ["b@2", "a@1", "c@3", "d@4"]);
}

// Equality ignores key order and fields a save does not carry — a list read
// from the server and one Etcher emitted compare equal when they mean the same.
{
  const fromServer = [{ geometry: { h: 10, w: 10, y: 0, x: 1 }, kind: "rectangle", uuid: "a", el: {}, _cache: 1 }];
  const emitted = [sh("a", 1)];
  assert.strictEqual(O.canon(O.norm(fromServer)), O.canon(O.norm(emitted)));
  const server = [sh("a", 9)];
  // base read from the server, local emitted by Etcher, nothing changed here →
  // the server's later move wins rather than the device re-sending its copy.
  assert.deepStrictEqual(ids(O.merge(fromServer, emitted, server)), ["a@9"]);
}

// Style and metadata count as changes; nulls and junk entries are dropped.
{
  const base = [sh("a", 1)];
  const local = [sh("a", 1, { metadata: { title: "600 mm" } })];
  const merged = O.merge(base, local, [sh("a", 1), null, { kind: "x" }]);
  assert.strictEqual(merged[0].metadata.title, "600 mm");
  assert.strictEqual(merged.length, 1);
}

// The "synced N changes" count.
{
  assert.strictEqual(O.changes([sh("a", 1)], [sh("a", 1)]), 0);
  assert.strictEqual(O.changes([sh("a", 5), sh("c", 3)], [sh("a", 1), sh("b", 2)]), 3);
}

// A save counts as stored only when the server answered, and not with
// `saved: false` (boards' answer to a failed write).
{
  const ok = { status: "fulfilled", value: { reply: {}, ref: 1 } };
  assert.strictEqual(O.acknowledged([ok]), true, "an ordinary reply");
  assert.strictEqual(O.acknowledged([{ status: "fulfilled", value: { reply: { saved: false } } }]), false, "saved: false");
  assert.strictEqual(O.acknowledged([{ status: "fulfilled", value: { reply: { saved: true } } }]), true);
  assert.strictEqual(O.acknowledged([{ status: "rejected", reason: new Error("not connected") }]), false, "not connected");
  assert.strictEqual(O.acknowledged([ok, { status: "rejected" }]), false, "every target must answer");
  assert.strictEqual(O.acknowledged([]), false, "no target, no answer");
  assert.strictEqual(O.acknowledged(undefined), false, "standalone: nothing was sent");
}

console.log("offline_merge_test: ok");
