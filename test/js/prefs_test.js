// Pins the preferences contract — the part a host builds against.
//
// Preferences are how someone likes the board set up: the background dots,
// the connector anchors, the style panel's size, which tools are on the bar,
// their colours. They are not board content, and two people looking at the
// same board can want different answers.
//
// Etcher does not know who anyone is, so it cannot follow a user between
// devices. The host can, and the contract exists so it may: listen for the
// change event, store it wherever makes sense — a user record, a row keyed by
// user AND board, a cookie — and hand it back on mount. Nothing here may
// assume which of those it is.
//
// The failure modes worth guarding are all quiet ones: blanking a host's
// stored keys because ours has more of them, echoing what the host just told
// us straight back at it as a fresh write, or writing on every frame of a
// dragged slider.
//
//   node test/js/prefs_test.js

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

const debounce = (src.match(/var PREFS_SAVE_DEBOUNCE_MS = (\d+);/) || [])[1];
assert.ok(debounce, "could not read PREFS_SAVE_DEBOUNCE_MS");
global.PREFS_SAVE_DEBOUNCE_MS = Number(debounce);

const defaultPrefs = lift("_defaultPrefs", "");
const loadPrefs = lift("_loadPrefs", "");
const savePrefs = lift("_savePrefs", "");
const setPref = lift("_setPref", "name, value");
const getPref = lift("_getPref", "name");
const hydratePrefs = lift("_hydratePrefs", "stored");

// A layer with the store, the clock and the DOM stubbed. Everything the
// preferences touch beyond themselves is recorded rather than done.
function layer(opts) {
  const o = opts || {};
  const l = {
    _prefsKey: "etcher:prefs",
    _prefsAdapter: o.adapter || null,
    applied: 0,
    events: [],
    timers: [],
    _defaultPrefs: defaultPrefs,
    _loadPrefs: loadPrefs,
    _savePrefs: savePrefs,
    _setPref: setPref,
    _getPref: getPref,
    _hydratePrefs: hydratePrefs,
    _applyPrefs() { this.applied++; },
    _dispatch(name, detail) { this.events.push({ name, detail }); }
  };
  return l;
}

// The store and the clock, shared by the stubs above.
let saved = null;
let writeCount = 0;
global.window = {
  localStorage: {
    getItem: () => saved,
    setItem: (_k, v) => { saved = v; writeCount++; }
  }
};
let pending = [];
global.setTimeout = (fn) => { pending.push(fn); return pending.length; };
global.clearTimeout = (id) => { if (id) pending[id - 1] = null; };
const flush = () => { const p = pending; pending = []; p.forEach((fn) => fn && fn()); };

// ── defaults ────────────────────────────────────────────────────────────────

{
  const d = defaultPrefs();
  // Everything a host might store has to be present, or `setPrefs` merging
  // over the defaults silently drops keys it has never heard of.
  assert.deepStrictEqual(
    Object.keys(d).sort(),
    ["colors", "connectors", "grid", "panel", "tools"],
    "the full set of preferences"
  );
  // The two that mean 'the host's own choice stands' must default to null,
  // not to an empty list — an empty list is a user saying "none", which
  // would wipe a board's palette and empty its toolbar.
  assert.strictEqual(d.tools, null);
  assert.strictEqual(d.colors, null);
  assert.strictEqual(d.grid, true);
  assert.strictEqual(d.connectors, true);
  assert.strictEqual(d.panel, "full");
  // A fresh object each time, or one layer's preferences become every
  // layer's.
  assert.notStrictEqual(defaultPrefs(), defaultPrefs());
}

// ── the host hands us what it stored ────────────────────────────────────────

// Merged over the defaults, so a host that keeps three keys does not blank
// the rest.
{
  const l = layer();
  assert.strictEqual(l._hydratePrefs({ panel: "compact", grid: false }), true);
  assert.strictEqual(l._getPref("panel"), "compact");
  assert.strictEqual(l._getPref("grid"), false);
  assert.strictEqual(l._getPref("connectors"), true, "untouched keys keep their default");
  assert.strictEqual(l.applied, 1, "and the board is brought into line");
}

// It must NOT be saved back. The host just told us; echoing it is a write on
// every page load, which for a host saving to a server is a request per load
// per user.
{
  const l = layer();
  l._hydratePrefs({ panel: "hidden" });
  assert.deepStrictEqual(l.events, [], "no change event");
  flush();
  assert.strictEqual(saved, null, "and nothing written");
}

// Nothing to hydrate is not an error — a user who has never changed anything
// has nothing stored, which is the common case.
{
  const l = layer();
  for (const empty of [null, undefined, "", 0, []]) {
    assert.strictEqual(l._hydratePrefs(empty), Array.isArray(empty) ? true : false,
      `hydrating ${JSON.stringify(empty)}`);
  }
}

// A stored value we have never heard of is carried rather than dropped: a
// host may be on a newer etcher than this one, and losing the key would
// silently reset that preference every time an older client loads.
{
  const l = layer();
  l._hydratePrefs({ somethingNew: 42 });
  assert.strictEqual(l._loadPrefs().somethingNew, 42);
}

// ── changes go out ──────────────────────────────────────────────────────────

// The event is immediate and carries the whole set, so a host can store it
// without tracking which key changed.
{
  saved = null;
  const l = layer();
  l._setPref("panel", "compact");
  assert.strictEqual(l.events.length, 1);
  assert.strictEqual(l.events[0].name, "etcher:prefs-changed");
  assert.strictEqual(l.events[0].detail.panel, "compact");
  assert.strictEqual(l.events[0].detail.grid, true, "the whole set, not a diff");
  // A copy — a host holding the object must not be able to reach back in.
  l.events[0].detail.panel = "tampered";
  assert.strictEqual(l._getPref("panel"), "compact");
}

// Setting a preference to what it already is does nothing at all: no event,
// no write. Otherwise re-applying stored preferences on mount looks like a
// change to every host listening.
{
  const l = layer();
  l._setPref("panel", "full");
  assert.deepStrictEqual(l.events, []);
  assert.strictEqual(l.applied, 0);
}

// The write is debounced, and a burst collapses to ONE. Dragging a slider is
// dozens of changes a second, and for a host saving over the network each of
// those would be a request.
{
  // Timers left pending by earlier blocks would be flushed here too and
  // counted as writes from this one.
  flush();
  saved = null;
  writeCount = 0;
  const l = layer();
  l._setPref("panel", "compact");
  l._setPref("panel", "hidden");
  l._setPref("panel", "full");
  assert.strictEqual(saved, null, "nothing written yet");
  assert.strictEqual(l.events.length, 3, "though the host heard every one");
  flush();
  // The COUNT is the point, not the value — three writes also end on the
  // right value, and a host saving over the network pays for each one.
  assert.strictEqual(writeCount, 1, `one write for the burst, got ${writeCount}`);
  assert.strictEqual(JSON.parse(saved).panel, "full", "and it is the final value");
}

// ── the host owns storage instead ───────────────────────────────────────────

{
  saved = null;
  const writes = [];
  const l = layer({ adapter: { load: () => ({ panel: "hidden" }), save: (p) => writes.push(p) } });
  assert.strictEqual(l._getPref("panel"), "hidden", "read through the adapter");
  l._setPref("grid", false);
  flush();
  assert.strictEqual(writes.length, 1);
  assert.strictEqual(writes[0].grid, false);
  assert.strictEqual(saved, null, "and localStorage is left alone entirely");
}

// An adapter that throws must not take the board with it. Preferences are a
// convenience; a broken store is not worth failing a drawing over.
{
  const l = layer({
    adapter: { load() { throw new Error("nope"); }, save() { throw new Error("nope"); } }
  });
  assert.strictEqual(l._getPref("panel"), "full", "falls back to the defaults");
  l._setPref("grid", false);
  flush();  // must not throw
}

// A host reading from a server answers with a promise. The board carries on
// with the defaults rather than waiting for a round trip about chrome, and
// adopts the real answer when it lands.
{
  let resolve;
  const later = new Promise((r) => { resolve = r; });
  const l = layer({ adapter: { load: () => later, save() {} } });
  assert.strictEqual(l._getPref("panel"), "full", "not blocked on the promise");
  resolve({ panel: "compact" });
  return later.then(() => new Promise((r) => setImmediate(r))).then(() => {
    assert.strictEqual(l._getPref("panel"), "compact", "and adopted once it lands");
    assert.ok(l.applied > 0, "and applied to the board");
    console.log("prefs: all checks passed");
  });
}
