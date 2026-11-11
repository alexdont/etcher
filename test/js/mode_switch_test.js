// Pins the View / Annotate switch (`nav_buttons: [:modes]`): the viewer's two
// modes side by side in its nav, the current one lit, like Affinity's persona
// switcher (head dev, 2026-11-11). Only when asked for by name — a host with
// no allowlist keeps the single pencil — and it replaces the pencil.
//
//   node test/js/mode_switch_test.js

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
  return eval("(" + src.slice(start, end + "\n    }".length)
    .replace(`${name}: function`, "function") + ")");
}
const NAV_SLOTS = eval("(" + src.match(/var NAV_SLOTS = (\{[^}]*\});/)[1] + ")");
const ICONS = { image: "<svg i/>", pencil: "<svg p/>" };

function btn() {
  const classes = new Set();
  return { attrs: {}, classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), has: (c) => classes.has(c),
                                   add: (...cs) => cs.forEach((c) => classes.add(c)) },
           setAttribute(k, v) { this.attrs[k] = v; } };
}

function layer(allow) {
  const appended = [];
  const l = {
    annotationMode: false,
    _navButtonAllowlist: allow ? new Set(allow) : null,
    handle: {
      appendNavButton(icon, title, onClick, opts) {
        const remove = () => {};
        remove.el = btn();
        appended.push({ icon, title, onClick, slot: opts && opts.slot, el: remove.el });
        return remove;
      },
    },
    _setAnnotationMode(on) { this.annotationMode = on; this._syncNavPencil(); },
    _modeSwitchOn: extract("_modeSwitchOn"),
    _buildModeSwitch: extract("_buildModeSwitch"),
    _syncNavPencil: extract("_syncNavPencil"),
  };
  return { l, appended };
}

// ── asked for by name only ────────────────────────────────────────────────
assert.strictEqual(layer(null).l._modeSwitchOn(), false, "no allowlist: the pencil, as before");
assert.strictEqual(layer(["pencil"]).l._modeSwitchOn(), false);
assert.strictEqual(layer(["modes"]).l._modeSwitchOn(), true);

// ── two buttons, View beside Annotate, the current mode lit ───────────────
{
  const { l, appended } = layer(["modes"]);
  l._buildModeSwitch();
  assert.deepStrictEqual(appended.map((a) => a.title), ["View", "Annotate"]);
  const view = appended[0], annotate = appended[1];
  assert.ok(view.slot > annotate.slot && view.slot < NAV_SLOTS.chevron,
    "right after the pencil's slot: View | Annotate in phoenix_kit's mirrored row");
  assert.ok(view.el.classList.has("etcher-nav-on"), "the viewer opens in View");
  // One segmented control: both halves tagged, the pencil first in order.
  assert.ok(annotate.el.classList.has("etcher-mode-seg") && annotate.el.classList.has("etcher-mode-a"));
  assert.ok(view.el.classList.has("etcher-mode-seg") && view.el.classList.has("etcher-mode-b"));
  assert.strictEqual(view.el.attrs["aria-pressed"], "true");

  annotate.onClick();
  assert.strictEqual(l.annotationMode, true);
  assert.ok(!view.el.classList.has("etcher-nav-on"));
  assert.ok(annotate.el.classList.has("etcher-pencil-active"), "Annotate lit while annotating");
  assert.strictEqual(annotate.el.attrs["aria-pressed"], "true");

  annotate.onClick();
  assert.strictEqual(l.annotationMode, true, "pressing the current mode leaves it on, unlike the pencil toggle");
  view.onClick();
  assert.strictEqual(l.annotationMode, false);
  assert.ok(view.el.classList.has("etcher-nav-on"));
}

// ── it replaces the pencil wherever the nav is built ──────────────────────
assert.strictEqual(
  (src.match(/if \(self\._modeSwitchOn\(\)\) self\._buildModeSwitch\(\);\n\s+else if \(self\._chromeEnabled\("pencil"\)\) self\._buildNavButton\(\);/g) || []).length, 2);

// ── drawn as one control in every nav layout, with outer dividers ─────────
for (const sel of ['[data-layout=\\"row\\"]:not([data-reverse])', '[data-layout=\\"row\\"][data-reverse]', ':not([data-layout=\\"row\\"])']) {
  assert.ok(src.includes(`.fresco-nav${sel} .etcher-mode-b {`), `halves joined in ${sel}`);
  assert.ok(src.includes(`.fresco-nav${sel} .etcher-mode-a:not(:first-child)::after`), `outer divider in ${sel}`);
  assert.ok(src.includes(`.fresco-nav${sel} .etcher-mode-b:not(:last-child)::after`), `outer divider in ${sel}`);
}

console.log("Mode switch: all checks passed");
