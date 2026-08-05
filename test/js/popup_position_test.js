// Pins which side of its trigger a popup opens on.
//
// These popups hang off toolbars, and for most of them the toolbar is at the
// bottom of the canvas, so opening upward is right. But the colour swatches
// live in the style panel, which is pinned near the TOP — opening upward
// from there put the picker off the top of the viewport entirely, which is
// the bug this covers.
//
// `_popupTop` is lifted out of the source by name and driven directly: it's
// pure arithmetic over four numbers, and a rename fails loudly rather than
// silently testing nothing.
//
//   node test/js/popup_position_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

const NEEDLE =
  "    _popupTop: function(triggerTop, triggerBottom, popupHeight, bounds) {";
const start = src.indexOf(NEEDLE);
assert.notStrictEqual(start, -1, "could not find _popupTop in etcher.js");
const end = src.indexOf("\n    },", start);
assert.notStrictEqual(end, -1, "could not find the end of _popupTop");
const popupTop = eval(
  "(" +
    src.slice(start, end + "\n    }".length).replace("_popupTop: function", "function") +
    ")"
);

const GAP = 8;
// A 900px-tall canvas and a 200px-tall popup, unless a case says otherwise.
const BOUNDS = { top: 0, bottom: 900 };
const H = 200;

// ── the common case: a toolbar at the bottom ────────────────────────────────

// Trigger near the bottom edge. Plenty of room above, so the popup opens
// there and its bottom edge lands one gap above the trigger.
const bottomTrigger = popupTop(840, 880, H, BOUNDS);
assert.strictEqual(bottomTrigger, 840 - H - GAP, "opens above");
assert.strictEqual(bottomTrigger + H + GAP, 840, "…sitting one gap clear");
assert.ok(bottomTrigger >= BOUNDS.top, "and stays inside the canvas");

// ── the bug: a trigger near the top ─────────────────────────────────────────

// A swatch 22px down, 24px tall — the style panel's real geometry. Above
// would be 22 - 200 - 8 = -186, i.e. almost entirely off-screen.
const topTrigger = popupTop(22, 46, H, BOUNDS);
assert.strictEqual(topTrigger, 46 + GAP, "flips below when above won't fit");
assert.ok(topTrigger >= BOUNDS.top, "which is the whole point");
assert.ok(topTrigger + H <= BOUNDS.bottom, "and it fits there");

// The boundary. At exactly enough room above, it must still open upward —
// the flip is for when it genuinely doesn't fit, not "when it's close".
const exact = popupTop(H + GAP + GAP, 250, H, BOUNDS);
assert.strictEqual(exact, GAP, "exactly enough room above → still above");
// One pixel less and it flips.
const oneLess = popupTop(H + GAP + GAP - 1, 250, H, BOUNDS);
assert.strictEqual(oneLess, 250 + GAP, "a pixel short → below");

// ── neither side fits ───────────────────────────────────────────────────────

// A popup taller than the space on either side of a mid-canvas trigger. It
// has to land somewhere visible rather than off-screen, and on the roomier
// side. Here the trigger sits high, so below has more room.
const tallBounds = { top: 0, bottom: 300 };
const squeezed = popupTop(100, 130, 400, tallBounds);
assert.ok(squeezed >= tallBounds.top, "clamped into view at the top");
assert.ok(squeezed <= tallBounds.bottom, "…and not pushed past the bottom");

// Trigger low in a short canvas: above has more room, so it goes up — and
// still can't be positioned off the top.
const squeezedLow = popupTop(280, 295, 400, tallBounds);
assert.ok(squeezedLow >= tallBounds.top,
  "a popup taller than the canvas is pinned in view, not floated above it");

// ── bounds are honoured, not assumed to start at 0 ──────────────────────────

// Strip mode passes viewport bounds; a future caller could pass an inset
// region. Nothing may be positioned above `bounds.top`.
const offset = { top: 500, bottom: 1400 };
const inOffset = popupTop(520, 545, H, offset);
assert.strictEqual(inOffset, 545 + GAP,
  "no room above 520 within bounds starting at 500 → below");
assert.ok(inOffset >= offset.top, "respects a non-zero top bound");

const roomyOffset = popupTop(1000, 1030, H, offset);
assert.strictEqual(roomyOffset, 1000 - H - GAP, "room above → above");
assert.ok(roomyOffset >= offset.top);

console.log("popup positioning: all checks passed");
