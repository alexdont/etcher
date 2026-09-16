// Pins the label corner dots' opt-in toggle.
//
// The Label size input is the primary way to size a label — one number,
// applied exactly. The four corner dots are the freehand alternative,
// OFF unless the user switches them on in the ⋯ menu; the preference
// rides the same store as the rest, so the choice holds across sessions
// and surfaces. Title-edit mode itself is unchanged either way.
//
//   node test/js/title_handles_toggle_test.js

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

const handlesOn = extract("_titleHandlesOn");
const handlesTitle = extract("_titleHandlesTitle");
const renderHandles = extract("_renderTitleHandles");

// ── off unless deliberately on ────────────────────────────────────────────

{
  const prefs = {};
  const self = { _getPref: (k) => prefs[k], _titleHandlesOn: handlesOn };
  assert.strictEqual(handlesOn.call(self), false,
    "the dots are opt-in — the size input is the primary control");
  prefs.title_handles = true;
  assert.strictEqual(handlesOn.call(self), true, "…until the user says so");
  prefs.title_handles = false;
  assert.strictEqual(handlesOn.call(self), false, "and off again sticks");
}

// ── the gate is at creation, so every entry point respects it ─────────────

{
  let removed = 0;
  const self = {
    _titleHandlesOn: () => false,
    _removeTitleHandles() { removed++; },
    _shapeTitleBoxImage: () => { throw new Error("must not get this far"); },
  };
  assert.doesNotThrow(() => renderHandles.call(self, { uuid: "s" }),
    "with the toggle off, no handle is even measured for");
  assert.strictEqual(removed, 1, "…and any stale dots are cleared");
}

// ── the switch reads as what it is ────────────────────────────────────────

{
  assert.strictEqual(handlesTitle.call({ _titleHandlesOn: () => true }),
    "Hide label resize dots");
  assert.strictEqual(handlesTitle.call({ _titleHandlesOn: () => false }),
    "Show label resize dots");
}

// ── every text-sizing dot rides the same switch ───────────────────────────

{
  // Text and callout shapes size their text through the same Label size
  // input — their corner dots are the same duplication the label's were.
  const handlePositions = extract("_handlePositions");
  const geomText = { x: 10, y: 20, w: 200, h: 60 };
  const geomCallout = { anchor: [5, 5], text_box: { x: 50, y: 50, w: 120, h: 40 } };
  function board(on) {
    return {
      _titleHandlesOn: () => on,
      _calloutTextBoxImage: (g) => g.text_box,
    };
  }

  assert.deepStrictEqual(
    handlePositions.call(board(false), { kind: "text", geometry: geomText }),
    [], "a text shape shows no dots until asked");
  assert.strictEqual(
    handlePositions.call(board(true), { kind: "text", geometry: geomText }).length,
    4, "…and all four when asked");

  const calloutOff = handlePositions.call(board(false),
    { kind: "callout", geometry: geomCallout });
  assert.deepStrictEqual(calloutOff, [{ x: 5, y: 5 }],
    "a callout keeps its ANCHOR dot — that one is positional, where the " +
    "callout points, not a text-size duplicate");
  const calloutOn = handlePositions.call(board(true),
    { kind: "callout", geometry: geomCallout });
  assert.strictEqual(calloutOn.length, 5, "anchor + four text corners when on");
  assert.deepStrictEqual(calloutOn[0], { x: 5, y: 5 },
    "index 0 means anchor either way — the drag mapping never shifts");

  // Geometric kinds are none of this switch's business.
  assert.strictEqual(
    handlePositions.call(board(false),
      { kind: "rectangle", geometry: { x: 0, y: 0, w: 10, h: 10 } }).length,
    4, "a rectangle's corners resize GEOMETRY, not text — always there");
}

// ── wiring the fakes cannot reach ─────────────────────────────────────────

{
  assert.ok(src.includes('self._setPref("title_handles", !self._titleHandlesOn());'),
    "the ⋯ menu button flips the persisted preference");
  assert.ok(src.includes("popup.appendChild(self.titleHandlesBtn);"),
    "and lives in the same menu as the magnetic-mode switch");
  assert.ok(/if \(this\._titleHandlesOn\(\)\) this\._renderTitleHandles\(this\.editingTitleShape\);\s*\n\s*else this\._removeTitleHandles\(\);/.test(src),
    "a label focused right now gets or loses its dots the moment the " +
    "switch flips, not on the next focus");
  assert.ok(/this\.editingShape\.kind === "text" \|\|\s*\n\s*this\.editingShape\.kind === "callout"/.test(src),
    "…and so does a text or callout already in edit mode");
  assert.ok(src.includes('this.titleHandlesBtn.setAttribute("aria-pressed", thOn ? "true" : "false");'),
    "the button announces its state like the other view toggles");
}

console.log("title handles toggle: all checks passed");
