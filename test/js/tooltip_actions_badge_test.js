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


// ── hover belongs to the cursor tool ───────────────────────────────────────
//
// The doc-level hover detector hit-tests geometrically whatever tool is
// armed (only grabber / marker / pointer were special-cased), so moving
// over a shape with a drawing tool armed lit it up: blue hover outline
// AND its tooltip, on top of the canvas you are drawing on. Hover means
// "a press acts on this shape", which is false while a tool is armed —
// the press goes to the tool — so none of it shows.

{
  const setHoveredShape = extract("_setHoveredShape");
  const hoverAllowed = extract("_hoverAllowed");

  function hoverSelf(tool) {
    return {
      annotationMode: true,
      activeTool: tool,
      _hoveredShape: null,
      _hoveredOnTitle: false,
      tooltipPinned: false,
      shown: [],
      dots: [],
      classed: [],
      _hoverAllowed: hoverAllowed,
      _showTooltipFor(s) { this.shown.push(s); },
      // Hover goes through the intent delay now; the harness records the
      // ask, since what it is testing is WHICH shape hover picked.
      _hoverTooltip(s) { this.shown.push(s); },
      _cancelTooltipOpen() {},
      _scheduleHideTooltip() {},
      _refreshImageRing() {},
      _refreshMediaChrome() {},
      _syncConnectorDots(s) { this.dots.push(s); },
    };
  }

  function fakeShape(self) {
    return {
      uuid: "u1",
      el: {
        classList: {
          add: (c) => self.classed.push(["add", c]),
          remove: (c) => self.classed.push(["remove", c]),
        },
      },
    };
  }

  // Cursor tool (nothing armed): hover lights the shape and shows its
  // tooltip, exactly as before.
  const cursor = hoverSelf(null);
  const cursorShape = fakeShape(cursor);
  setHoveredShape.call(cursor, cursorShape, false);
  assert.deepStrictEqual(cursor.shown, [cursorShape], "cursor tool still gets tooltips");
  assert.strictEqual(cursor._hoveredShape, cursorShape, "cursor tool still hovers");
  assert.deepStrictEqual(cursor.classed, [["add", "is-hovered"]], "and gets the outline");

  // Every armed tool: no tooltip, no hover state, no outline, no dots.
  for (const tool of ["rectangle", "circle", "arrow", "polygon", "freehand",
                      "text", "marker", "grabber", "pointer"]) {
    const armed = hoverSelf(tool);
    setHoveredShape.call(armed, fakeShape(armed), false);
    assert.deepStrictEqual(armed.shown, [], `${tool} must not raise a tooltip`);
    assert.strictEqual(armed._hoveredShape, null, `${tool} must not hover`);
    assert.deepStrictEqual(armed.classed, [], `${tool} must not paint the outline`);
    assert.deepStrictEqual(armed.dots, [null], `${tool} clears connector dots`);
  }

  // A hover already on screen when a tool is armed gets cleaned up rather
  // than stranded with its outline still painted.
  const stranded = hoverSelf(null);
  const old = fakeShape(stranded);
  setHoveredShape.call(stranded, old, false);
  stranded.classed.length = 0;
  stranded.activeTool = "rectangle";
  setHoveredShape.call(stranded, fakeShape(stranded), false);
  assert.deepStrictEqual(stranded.classed, [["remove", "is-hovered"]],
    "arming a tool strips the outline left on the previously-hovered shape");

  // Outside annotation mode nothing is armed, so browsing is unaffected.
  const browsing = hoverSelf("rectangle");
  browsing.annotationMode = false;
  const browseShape = fakeShape(browsing);
  setHoveredShape.call(browsing, browseShape, false);
  assert.deepStrictEqual(browsing.shown, [browseShape], "browse mode is unaffected");
}

// The move handler skips the hit-test entirely for an armed tool, and the
// red pointer — whose whole gesture IS the move — still gets it.
{
  const move = src.slice(
    src.indexOf("self._docMouseMove = function(e) {"),
    src.indexOf("var hit = self._shapeAt(pt);")
  );
  assert.ok(
    move.includes("if (self.activeTool != null) {") &&
      move.includes('if (self.activeTool === "pointer" && overContainer(e)) {'),
    "one armed-tool early-out, with the pointer tool's move preserved"
  );
  assert.ok(
    !move.includes('if (self.activeTool === "marker") {') &&
      !move.includes('if (self.activeTool === "grabber") {'),
    "the per-tool copies are gone — one rule, not a list to keep adding to"
  );
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
      !pin.includes("_hoverAllowed"),
    "pinning a shape (api.selectShape) is not subject to the hover gate"
  );
}
