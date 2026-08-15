// Pins who decides whether connector anchors are on.
//
// Three layers, most specific wins: the user's saved preference (a toggle
// they touched is their answer, in either direction), else the host's
// declared default (`connectors={true}` → `data-connectors="true"`), else
// OFF. They used to default ON — the anchors are an affordance for boards
// where people draw connectors, and everywhere else they were eight dots
// that appeared under the cursor on every shape passed over.
//
//   node test/js/connectors_default_test.js

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

const connectorsOn = extract("_connectorsOn");
const hardOff = extract("_connectorsHardOff");
const availableFor = extract("_connectorsAvailableFor");

function ctx(pref, hostAttr) {
  return {
    _getPref: (name) => (name === "connectors" ? pref : undefined),
    el: { dataset: hostAttr === undefined ? {} : { connectors: hostAttr } },
    _connectorsOn: connectorsOn,
    _connectorsHardOff: hardOff
  };
}

// ── the three-layer resolution ──────────────────────────────────────────────

assert.strictEqual(connectorsOn.call(ctx(undefined, undefined)), false,
  "no preference and no host default must mean OFF — this is the flipped default");

assert.strictEqual(connectorsOn.call(ctx(undefined, "true")), true,
  "the host's connectors={true} default is ignored");

assert.strictEqual(connectorsOn.call(ctx(true, undefined)), true,
  "the user's saved 'on' (usermeta) is ignored");

assert.strictEqual(connectorsOn.call(ctx(false, "true")), false,
  "the user turned them OFF but the host default overrode it — the user's toggle must win in either direction");

// A stray non-boolean in the prefs blob falls through to the host layer
// rather than counting as an answer.
assert.strictEqual(connectorsOn.call(ctx("yes", undefined)), false,
  "a malformed pref value should fall through the layers, not enable anchors");

// ── the hard form: connectors={:off} beats even the user's pref ─────────────

// The pref is shared across every Etcher surface in the browser, so a toggle
// flipped on a board used to follow the user into surfaces where the anchors
// point at nothing (no arrow tool offered). "off" is the host saying the
// surface has no use for anchors at all — the one layer above the user.
assert.strictEqual(connectorsOn.call(ctx(true, "off")), false,
  "data-connectors=\"off\" must beat a saved pref of true — that pref leaking across surfaces is the bug");

assert.strictEqual(connectorsOn.call(ctx(undefined, "off")), false,
  "data-connectors=\"off\" with no pref must be off");

// And the toggle is hidden there — a switch that can't switch reads as
// broken, not as policy.
assert.ok(src.includes("if (!self._connectorsHardOff()) {"),
  "the connectors toggle is still built on hard-off surfaces");

// ── the hover gate consults the resolution ──────────────────────────────────

// Everything else about this context is maximally permissive, so the only
// thing standing between the cursor and eight dots is the resolver.
function permissive(on) {
  return Object.assign(ctx(on ? true : undefined, undefined), {
    annotationMode: true,
    activeTool: null,
    editingShape: null,
    selectedShapes: null,
    _arrowDrag: null
  });
}
const shape = { kind: "rectangle", readonly: false };

assert.strictEqual(availableFor.call(permissive(false), shape), false,
  "_connectorsAvailableFor shows anchors while they are resolved OFF");
assert.strictEqual(availableFor.call(permissive(true), shape), true,
  "_connectorsAvailableFor never shows anchors — the gate broke in the other direction");

// ── the toggle flips the RESOLVED state ─────────────────────────────────────

// Toggling from the raw pref (the old `=== false` dance) breaks the first
// press when no pref is stored: resolved OFF, raw undefined, and the toggle
// would write `false` — a no-op the user reads as a dead button.
assert.ok(src.includes('self._setPref("connectors", !self._connectorsOn());'),
  "the toggle no longer writes the inverse of the resolved state");

// ── nothing bypasses the resolver ───────────────────────────────────────────

// Every consumer must go through `_connectorsOn`; a site reading the pref
// directly resurrects the old always-on default for whatever it gates.
{
  const raw = src.split('_getPref("connectors")').length - 1;
  assert.strictEqual(raw, 1,
    `expected exactly one raw read of the connectors pref (inside _connectorsOn), found ${raw}`);
}

console.log("connectors default: all checks passed");
