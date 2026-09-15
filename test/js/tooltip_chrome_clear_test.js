// Pins the tooltip's respect for the style panel.
//
// Zoom and pan can park a shape underneath the panel; brushing its
// exposed edge on the way to a control then opened a tooltip ON TOP of
// the very menu being aimed for — the tooltip out-stacks the panel, so
// the colour controls vanished behind it. Placement now ends with a
// clear-of-chrome pass that shifts the tooltip left of the panel (and of
// any open popup), floored at the container's left edge.
//
//   node test/js/tooltip_chrome_clear_test.js

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

const clearChrome = extract("_keepTooltipClearOfChrome");

// A tooltip whose measured rect follows its style.left.
function fakeTip(rect, left) {
  const base = Object.assign({}, rect);
  const tip = {
    style: { left: left + "px" },
    getBoundingClientRect() {
      const dx = (parseFloat(tip.style.left) || 0) - left;
      return {
        left: base.left + dx, right: base.right + dx,
        top: base.top, bottom: base.bottom,
        width: base.right - base.left, height: base.bottom - base.top,
      };
    },
  };
  return tip;
}
const rectEl = (r) => ({ getBoundingClientRect: () => Object.assign({
  width: r.right - r.left, height: r.bottom - r.top }, r) });

const containerRect = { left: 0, top: 0, right: 1200, bottom: 800 };

// ── overlapping the panel: shifted to its left ────────────────────────────

{
  const panel = rectEl({ left: 1000, right: 1190, top: 60, bottom: 500 });
  const tip = fakeTip({ left: 980, right: 1120, top: 100, bottom: 150 }, 1050);
  clearChrome.call({ stylePanel: panel }, tip, containerRect);
  // right edge must land 8px left of the panel: 1000 - 8 = 992 → dx = -128
  assert.strictEqual(tip.style.left, (1050 - 128) + "px",
    "the tooltip yields the panel's ground and parks just left of it");
  assert.strictEqual(tip.getBoundingClientRect().right, 992);
}

// ── no overlap, hidden panel: untouched ───────────────────────────────────

{
  const panel = rectEl({ left: 1000, right: 1190, top: 60, bottom: 500 });
  const tip = fakeTip({ left: 300, right: 440, top: 100, bottom: 150 }, 370);
  clearChrome.call({ stylePanel: panel }, tip, containerRect);
  assert.strictEqual(tip.style.left, "370px", "clear already — no shift");
}
{
  const hidden = rectEl({ left: 0, right: 0, top: 0, bottom: 0 });
  const tip = fakeTip({ left: 980, right: 1120, top: 100, bottom: 150 }, 1050);
  clearChrome.call({ stylePanel: hidden }, tip, containerRect);
  assert.strictEqual(tip.style.left, "1050px",
    "a hidden panel (zero rect) blocks nothing");
}

// ── the floor: never pushed past the container's left edge ────────────────

{
  // A panel so wide the full shift would exile the tooltip off-screen.
  const panel = rectEl({ left: 60, right: 1190, top: 60, bottom: 500 });
  const tip = fakeTip({ left: 200, right: 340, top: 100, bottom: 150 }, 270);
  clearChrome.call({ stylePanel: panel }, tip, containerRect);
  assert.strictEqual(tip.getBoundingClientRect().left, containerRect.left + 4,
    "floored at the container's left edge rather than pushed off-screen");
}

// ── open popups block the same way ────────────────────────────────────────

{
  const popup = rectEl({ left: 900, right: 1100, top: 100, bottom: 400 });
  const tip = fakeTip({ left: 950, right: 1090, top: 150, bottom: 200 }, 1020);
  clearChrome.call({ colorsPopup: popup }, tip, containerRect);
  assert.strictEqual(tip.getBoundingClientRect().right, 892,
    "the colour picker popup is chrome too — that is where the picking happens");
}

// ── both placement paths run the pass ─────────────────────────────────────

{
  const count = (src.match(/_keepTooltipClearOfChrome\(tip, containerRect\)/g) || []).length;
  assert.strictEqual(count, 2,
    "the beside-stroke path and the box path both finish with the pass");
}

console.log("tooltip chrome clear: all checks passed");
