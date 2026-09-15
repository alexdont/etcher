// Pins the highlighter tool.
//
// Exactly the marker in every way that matters — same capture, same
// spline, same committed KIND (so persistence, hit test and every marker
// behaviour come free) — at a fixed half opacity. A separate tool rather
// than a setting, so writing and highlighting never fight over one
// opacity slider.
//
//   node test/js/highlighter_test.js

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

{ const m = src.match(/var HIGHLIGHT_OPACITY = ([\d.]+);/);
  assert.ok(m, "could not find HIGHLIGHT_OPACITY");
  global.HIGHLIGHT_OPACITY = Number(m[1]);
  assert.strictEqual(global.HIGHLIGHT_OPACITY, 0.5, "half, per the spec"); }

const styleFor = extract("_styleForNewShape");

function board(tool) {
  return {
    activeTool: tool,
    _currentMarkerStyle: () => ({ color: "#fca5a5", width: 6, opacity: 1, dash: "solid" }),
    _isStrokeShape: () => false,
    _isShaftKind: () => false,
    _labelBgFor: () => null,
    _getPref: () => null,
    _currentLineParams: () => ({}),
    _lineParamsForNewShape: () => ({}),
    activeColor: "#fca5a5",
  };
}

// ── the highlighter is the marker at half opacity ─────────────────────────

{
  const hi = styleFor.call(board("highlighter"), "marker");
  assert.strictEqual(hi.opacity, 0.5,
    "half transparent, whatever the marker's own opacity is set to");
  assert.strictEqual(hi.color, "#fca5a5", "…in the same ink");
  assert.strictEqual(hi.width, 6, "…at the same width");

  const mk = styleFor.call(board("marker"), "marker");
  assert.strictEqual(mk.opacity, 1,
    "the marker itself is untouched — two tools, two looks, no dial");
}

// ── it draws and commits as a MARKER ──────────────────────────────────────

{
  // The committed kind is "marker": persistence (phoenix_kit's @kinds and
  // the DB CHECK), the hit test, the spline, node editing — all come free,
  // and no server migration exists for a kind called "highlighter".
  assert.ok(src.includes('case "highlighter": this._startMarker(pt, e); break;'),
    "the tool routes into the marker's capture");
  assert.ok(src.includes('case "highlighter": this._commitFreehand(pt); break;'),
    "…and the marker's commit");
  assert.ok(/case "highlighter":\s*\n\s*case "marker": \{/.test(src),
    "…and the marker's coalesced sampling on move");
}

// ── on the bar, with a shortcut, drawn like a tool ────────────────────────

{
  const defs = src.slice(src.indexOf("var TOOL_DEFS"), src.indexOf("var TOOL_SHORTCUTS"));
  assert.ok(defs.includes("highlighter:"), "a real toolbar tool");
  assert.ok(src.includes('g: "highlighter"'), "with its own shortcut (h is the grabber's)");
  assert.ok(src.match(/var CURSOR_BADGES = \{[\s\S]*?highlighter:/),
    "and a badge, so remote cursors can show someone highlighting");
}

console.log("highlighter: all checks passed");
