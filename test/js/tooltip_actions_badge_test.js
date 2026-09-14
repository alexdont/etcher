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

// ── 4. badge anchoring — label first, else touching the shape ───────────────

{
  const anchorFn = extract("_badgeAnchorContainer");
  const ctx = {
    _imageToContainer: (pt) => pt,                       // identity: image == container
    _shapeBBoxImagePx: (s) => s._bbox || null
  };

  // Circle: the 45° point on the circumference, not the floating bbox corner.
  const circle = { kind: "circle", geometry: { cx: 100, cy: 100, r: 10 } };
  const c = anchorFn.call(ctx, circle);
  assert.ok(Math.abs(c.x - (100 + 10 * Math.SQRT1_2)) < 1e-9, "circle badge x is off the circumference");
  assert.ok(Math.abs(c.y - (100 - 10 * Math.SQRT1_2)) < 1e-9, "circle badge y is off the circumference");

  // Boxy kinds: the actual top-right corner.
  const rect = { kind: "rectangle", geometry: { x: 10, y: 20, w: 30, h: 40 } };
  assert.deepStrictEqual(anchorFn.call(ctx, rect), { x: 40, y: 20 });

  // Point-built kinds: the vertex nearest the bbox top-right, so the bubble
  // touches the shape even when the corner itself is empty air.
  const poly = {
    kind: "polygon",
    geometry: { points: [[0, 100], [50, 0], [100, 100]] },
    _bbox: { x: 0, y: 0, w: 100, h: 100 }
  };
  assert.deepStrictEqual(anchorFn.call(ctx, poly), { x: 50, y: 0 },
    "polygon badge should sit on its nearest vertex, not the empty bbox corner");

  // A rendered label rect wins over everything (host: "top right of the
  // label if there is one").
  const labelled = {
    kind: "rectangle",
    geometry: { x: 10, y: 20, w: 30, h: 40 },
    titleGroup: {
      querySelector: () => ({
        getAttribute: (k) => ({ x: "200", y: "300", width: "80" }[k])
      })
    }
  };
  assert.deepStrictEqual(anchorFn.call(ctx, labelled), { x: 280, y: 300 });
}

// ── 5. host header actions render next to the trash ─────────────────────────

assert.ok(src.includes("window.Etcher.tooltipActions"),
  "tooltipActions host API is gone");
assert.ok(src.includes('class="etcher-tooltip-btn etcher-tooltip-delete"'),
  "delete no longer shares the header button base class");
assert.ok(src.includes('if (!a || !a.action || a.action === "delete") return;'),
  "host actions may shadow the built-in delete");

// ── 6. tooltip anchors to the whole annotation ──────────────────────────────

// The label sibling and badge join the anchor union, so the tooltip opens
// above ALL of it instead of on top of the label it describes.
assert.ok(src.includes("[shape.titleGroup, shape._badgeEl].forEach(function(extra) {"),
  "tooltip positioning no longer unions the label/badge into its anchor box");

console.log("tooltip actions + badge: all checks passed");


// ── hover tooltips are a cursor-tool affordance ─────────────────────────────
//
// The doc-level hover detector hit-tests geometrically whatever the armed
// tool is (only grabber / marker / pointer were special-cased), so moving
// over an existing shape while a drawing tool was armed popped its tooltip
// up over the canvas mid-stroke. Hover STYLING and connector dots must
// survive — they are how you aim an arrow at a shape you are drawing
// toward — so only the tooltip is withheld.

{
  const setHoveredShape = extract("_setHoveredShape");
  const hoverTooltipsAllowed = extract("_hoverTooltipsAllowed");

  function hoverSelf(tool) {
    return {
      annotationMode: true,
      activeTool: tool,
      _hoveredShape: null,
      _hoveredOnTitle: false,
      tooltipPinned: false,
      shown: [],
      dots: [],
      _hoverTooltipsAllowed: hoverTooltipsAllowed,
      _showTooltipFor(s) { this.shown.push(s); },
      _scheduleHideTooltip() {},
      _refreshImageRing() {},
      _refreshMediaChrome() {},
      _syncConnectorDots(s) { this.dots.push(s); },
    };
  }

  const shape = { uuid: "u1", el: { classList: { add() {}, remove() {} } } };

  // Cursor tool (no tool armed): hovering a shape shows its tooltip.
  const cursor = hoverSelf(null);
  setHoveredShape.call(cursor, shape, false);
  assert.deepStrictEqual(cursor.shown, [shape], "cursor tool still gets tooltips");

  // Drawing tools: no tooltip, but hover state and connector dots stay.
  for (const tool of ["rectangle", "circle", "arrow", "polygon", "freehand", "text"]) {
    const drawing = hoverSelf(tool);
    setHoveredShape.call(drawing, shape, false);
    assert.deepStrictEqual(drawing.shown, [], `${tool} must not raise a tooltip`);
    assert.strictEqual(drawing._hoveredShape, shape, `${tool} keeps hover state`);
    assert.deepStrictEqual(drawing.dots, [shape], `${tool} keeps connector dots`);
  }

  // Outside annotation mode nothing is armed, so browsing still gets them.
  const browsing = hoverSelf("rectangle");
  browsing.annotationMode = false;
  setHoveredShape.call(browsing, shape, false);
  assert.deepStrictEqual(browsing.shown, [shape], "browse mode is unaffected");
}

// Deliberate shows must NOT be gated — the host's selectShape pin and the
// re-show after a handle drag go straight to _showTooltipFor.
{
  const pin = src.slice(
    src.indexOf("_pinTooltipFor: function(shape) {"),
    src.indexOf("_unpinTooltip: function()")
  );
  assert.ok(
    pin.includes("this._showTooltipFor(shape);") &&
      !pin.includes("_hoverTooltipsAllowed"),
    "pinning a shape (api.selectShape) is not subject to the hover gate"
  );
}
