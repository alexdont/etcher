// Pins the open text editor's truce with the style panel.
//
// Place a text box, realise it is too small, reach for the panel — that
// used to COMMIT the (empty) editor on the way, which for a fresh text
// shape means discard: the box vanished mid-thought. Chrome presses now
// leave the editor open, the panel's controls target the box being
// typed into, and the editor re-dresses in place so the user sees the
// new size/colour before a single character lands.
//
//   node test/js/text_edit_panel_test.js

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

const fontTargets = extract("_fontTargetShapes");
const inspected = extract("_inspectedShape");
const refresh = extract("_refreshTextEditorStyle");

// ── the open editor's shape is what the panel edits ───────────────────────

{
  const fresh = { uuid: "t", kind: "text", style: {} };
  const board = { _textEditor: { shape: fresh }, selectedShapes: [] };
  assert.deepStrictEqual(fontTargets.call(board), [fresh],
    "an open text editor is the most explicit focus there is — size and " +
    "label controls hit IT, not the global default");
  assert.strictEqual(inspected.call(board), fresh,
    "and a palette press dresses the box being typed into");
}

{
  const board = { _textEditor: null, selectedShapes: [], editingShape: null,
    editingTitleShape: null };
  assert.deepStrictEqual(fontTargets.call(board), [],
    "no editor, no selection — the defaults path is unchanged");
}

// ── the editor re-dresses in place, caret intact ──────────────────────────

{
  let refit = 0, sizeSet = null;
  const input = { style: { fontSize: "14px" } };
  const board = {
    _textEditor: {
      shape: { uuid: "t", kind: "text", style: {} },
      input,
      fit() { refit++; },
      setFontSize(s) { sizeSet = s; },
    },
    _textEditHost: () => ({ querySelector: () => ({ getAttribute: () => "28" }) }),
    _fontSizeFor: (s, base) => base,
    _titleColorFor: () => "#d8b4fe",
    _labelBgFor: () => "#86efac",
  };
  refresh.call(board);
  assert.strictEqual(input.style.fontSize, "28px",
    "the rendered size lands on the editor — no recreate, no lost caret");
  assert.strictEqual(sizeSet, 28, "…and the fit closure measures at it");
  assert.strictEqual(input.style.color, "#d8b4fe", "the ink follows");
  assert.strictEqual(input.style.background, "#86efac", "so does the plate");
  assert.strictEqual(refit, 1, "and the box re-hugs at the new size");

  assert.doesNotThrow(() => refresh.call({ _textEditor: null }),
    "with no editor open it is a no-op");
}

// ── chrome does not close the editor ──────────────────────────────────────

{
  const down = src.slice(src.indexOf("self._textEditOutsideDown = function"),
                         src.indexOf("document.addEventListener(\"pointerdown\", self._textEditOutsideDown"));
  assert.ok(down.includes("e.target.closest(CHROME_SELECTOR)) return;"),
    "a press on the panel/popup/toolbar leaves the editor open — " +
    "committing there threw an empty fresh text box away mid-thought");

  // Several inputs listen for blur; the editor's is the one that defers
  // to let Enter/Esc win — anchor there.
  const blurAt = src.indexOf("// Defer so synchronous Enter/Esc handling above wins.");
  assert.notStrictEqual(blurAt, -1, "could not find the editor's blur commit");
  const blur = src.slice(blurAt, blurAt + 900);
  assert.ok(blur.includes("a.closest(CHROME_SELECTOR)) return;"),
    "focus moving into the panel is styling, not leaving — the blur " +
    "commit skips it");
}

// ── the editor itself is clickable ────────────────────────────────────────

{
  // It lives inside the overlay SVG, which is pointer-events:none so
  // drags reach the canvas — without the override, a click INTO the open
  // editor fell through to the document handler and committed it. Coming
  // back from the style panel is exactly that click.
  assert.ok(/\.etcher-text-editor \{ z-index: 10; pointer-events: auto; \}/.test(src),
    "the editor overrides the overlay's pointer-events, or clicking it closes it");
}

console.log("text edit panel: all checks passed");
