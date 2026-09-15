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

// ── wiring the fakes cannot reach ─────────────────────────────────────────

{
  assert.ok(src.includes('self._setPref("title_handles", !self._titleHandlesOn());'),
    "the ⋯ menu button flips the persisted preference");
  assert.ok(src.includes("popup.appendChild(self.titleHandlesBtn);"),
    "and lives in the same menu as the magnetic-mode switch");
  assert.ok(/if \(this\._titleHandlesOn\(\)\) this\._renderTitleHandles\(this\.editingTitleShape\);\s*\n\s*else this\._removeTitleHandles\(\);/.test(src),
    "a label focused right now gets or loses its dots the moment the " +
    "switch flips, not on the next focus");
  assert.ok(src.includes('this.titleHandlesBtn.setAttribute("aria-pressed", thOn ? "true" : "false");'),
    "the button announces its state like the other view toggles");
}

console.log("title handles toggle: all checks passed");
