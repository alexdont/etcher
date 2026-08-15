// Pins the host-integration surface added in 0.13:
//
//  1. Tooltip buttons with a `data-etcher-action` other than "delete" are
//     re-dispatched to the host as a bubbling `etcher:tooltip-action`
//     CustomEvent (the tooltip's own click handler stops propagation, so
//     without the re-dispatch a host button would be a dead click).
//  2. `api.editLabel(uuid)` opens the inline label editor programmatically.
//  3. `metadata.badge` renders a screen-sized count bubble: drawn at the end
//     of every `_renderShape`, torn down with the shape, capped at "99+".
//
//   node test/js/tooltip_actions_badge_test.js

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

// ── 1. tooltip action re-dispatch ───────────────────────────────────────────

{
  // Both tooltip click handlers (canvas + strip) must route unknown actions.
  const routed = src.split("self._dispatchTooltipAction(btn.dataset.etcherAction);").length - 1;
  assert.strictEqual(routed, 2,
    `expected both tooltip click handlers to route host actions, found ${routed}`);

  const dispatch = extract("_dispatchTooltipAction");
  let seen = null;
  const ctx = {
    frescoId: "f-1",
    _tooltipShape: { uuid: "u-1" },
    el: { dispatchEvent: (ev) => { seen = ev; } }
  };
  dispatch.call(ctx, "reply");
  assert.ok(seen, "no CustomEvent dispatched for a host action");
  assert.strictEqual(seen.type, "etcher:tooltip-action");
  assert.strictEqual(seen.bubbles, true, "event must bubble so ancestors can listen");
  assert.deepStrictEqual(seen.detail, { fresco_id: "f-1", uuid: "u-1", action: "reply" });

  // Etcher's own delete never leaves the layer.
  seen = null;
  assert.ok(src.includes('if (btn.dataset.etcherAction === "delete") {'),
    "delete is no longer handled internally");
}

// ── 2. programmatic label editing ───────────────────────────────────────────

assert.ok(/editLabel:\s*function\(uuid\)/.test(src),
  "api.editLabel is missing");
assert.ok(src.includes("if (shape && !shape.readonly) self._startTextEdit(shape);"),
  "editLabel must guard readonly shapes and delegate to _startTextEdit");

// ── 3. badge lifecycle ──────────────────────────────────────────────────────

assert.ok(src.includes("self._renderBadge(shape);"),
  "_renderShape no longer renders the badge at its tail");
assert.ok(src.includes('if (/^\\d+$/.test(label) && parseInt(label, 10) > 99) label = "99+";'),
  "badge count is no longer capped at 99+");
assert.ok(src.includes("if (shape._badgeEl && shape._badgeEl.parentNode) {"),
  "_removeShape no longer tears the badge down with the shape");

// The hide branch: absent / 0 / "" / "0" all remove the bubble. Pinned via
// the predicate text so a refactor that drops one form is caught.
assert.ok(src.includes('var show = value != null && value !== 0 && value !== "" && value !== "0";'),
  "badge show predicate changed — 0/empty must hide the bubble");

console.log("tooltip actions + badge: all checks passed");
