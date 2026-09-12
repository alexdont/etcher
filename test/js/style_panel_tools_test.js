// The style panel's two new host-facing behaviors:
//
//   - `panel_offset` — a host whose own chrome lives in the container's
//     top-right corner (phoenix_kit's media page keeps its details
//     minimizer there) moves the whole cluster: the chevron sits at the
//     anchor, the panel 40px below, via two CSS custom properties.
//
//   - styleless tools — the grabber takes no stroke or fill, so the panel
//     (and its chevron) hide while it is armed instead of advertising
//     swatches that apply to nothing.
//
//   node test/js/style_panel_tools_test.js

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

// ── panel offset → CSS custom properties ───────────────────────────────────

const applyPanelOffset = lift("_applyPanelOffset", "");

function fakeSelf(raw) {
  const props = {};
  return {
    props,
    self: {
      el: { dataset: { panelOffset: raw } },
      handle: {
        container: {
          style: { setProperty: (k, v) => (props[k] = v) },
        },
      },
    },
  };
}

{
  const { props, self } = fakeSelf(JSON.stringify({ top: 56, right: 20 }));
  applyPanelOffset.call(self);
  assert.strictEqual(props["--etcher-panel-anchor-top"], "56px");
  assert.strictEqual(props["--etcher-panel-anchor-right"], "20px");
}

{
  // Partial offsets set only what they name.
  const { props, self } = fakeSelf(JSON.stringify({ top: 56 }));
  applyPanelOffset.call(self);
  assert.strictEqual(props["--etcher-panel-anchor-top"], "56px");
  assert.strictEqual(props["--etcher-panel-anchor-right"], undefined);
}

{
  // Garbage input must be inert, never a crash.
  const { props, self } = fakeSelf("{not json");
  applyPanelOffset.call(self);
  assert.deepStrictEqual(props, {});
  const bare = fakeSelf(undefined);
  applyPanelOffset.call(bare.self);
  assert.deepStrictEqual(bare.props, {});
}

// ── the CSS reads the same properties the JS writes ─────────────────────────

assert.ok(
  src.includes("top: calc(var(--etcher-panel-anchor-top, 12px) + 40px);"),
  "the panel derives its top from the anchor (chevron height folded in)"
);
assert.ok(
  /\.etcher-panel-toggle \{[\s\S]{0,400}var\(--etcher-panel-anchor-top, 12px\)/.test(src),
  "the chevron sits at the anchor itself"
);

// ── styleless gating ────────────────────────────────────────────────────────

assert.ok(
  /grabber:\s*\{[^}]*styleless: true/.test(src),
  "the grabber is declared styleless"
);
assert.ok(
  src.includes("var wantsStyle = !!this.annotationMode && !(toolDef && toolDef.styleless);"),
  "_syncStylePanel gates the panel on the active tool wanting style"
);
assert.ok(
  src.match(/is-active", wantsStyle\)/g).length >= 2,
  "the panel and its chevron both follow the gate"
);

// ── the grabber has all five digits ─────────────────────────────────────────

{
  const iconsStart = src.indexOf("grabber: '<svg");
  const iconEnd = src.indexOf("',", iconsStart);
  const icon = src.slice(iconsStart, iconEnd);
  const paths = icon.match(/<path /g) || [];
  assert.strictEqual(
    paths.length,
    4,
    "three fingertip strokes + the palm/thumb outline — the coherent hand"
  );
}

console.log("style panel anchor, styleless gating and grabber icon: ok");
