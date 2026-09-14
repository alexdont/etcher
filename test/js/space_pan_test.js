// Pins hold-space-to-pan.
//
// The convention in every comparable tool, and worth having for the same
// reason they all do: reaching for the hand tool means losing your place
// in whatever you were drawing with. Hold space, pan, let go, carry on.
//
//   node test/js/space_pan_test.js

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

const beginSpacePan = extract("_beginSpacePan");
const endSpacePan = extract("_endSpacePan");

function board(over) {
  return Object.assign({
    activeTool: "rectangle",
    tools: ["grabber", "rectangle", "line"],
    _selectToolByShortcut(key) {
      if (key !== null && this.tools.indexOf(key) === -1) return false;
      this.activeTool = key;
      return true;
    },
    _beginSpacePan: beginSpacePan,
    _endSpacePan: endSpacePan,
  }, over || {});
}

// ── hold, pan, release ────────────────────────────────────────────────────

{
  const self = board();
  self._beginSpacePan();
  assert.strictEqual(self.activeTool, "grabber", "space arms the hand");
  assert.strictEqual(self._spacePanning, true);

  self._endSpacePan();
  assert.strictEqual(self.activeTool, "rectangle",
    "…and releasing puts back what you were drawing with");
  assert.strictEqual(self._spacePanning, false);
}

{
  // The cursor is a real tool to come back to. `null` is its value, so the
  // FLAG is what says a pan is in progress — using the remembered value
  // for that would strand anyone who pressed space with the cursor armed.
  const self = board({ activeTool: null });
  self._beginSpacePan();
  assert.strictEqual(self.activeTool, "grabber");
  self._endSpacePan();
  assert.strictEqual(self.activeTool, null, "back to the cursor");
}

{
  // Held: the key repeats while down, and the second press must not
  // overwrite what to come back to with "grabber".
  const self = board();
  self._beginSpacePan();
  self._beginSpacePan();
  self._beginSpacePan();
  self._endSpacePan();
  assert.strictEqual(self.activeTool, "rectangle", "a repeat is not a new press");
}

{
  // A stray release with nothing held changes nothing.
  const self = board();
  self._endSpacePan();
  assert.strictEqual(self.activeTool, "rectangle");
}

// ── it does not fight a deliberate choice ─────────────────────────────────

{
  // Picking another tool mid-pan says what you want; keyup must not undo
  // it.
  const self = board();
  self._beginSpacePan();
  self.activeTool = "line";
  self._endSpacePan();
  assert.strictEqual(self.activeTool, "line",
    "a tool chosen during the pan survives the release");
  assert.strictEqual(self._spacePanning, false, "and the pan still ends");
}

// ── it refuses to eat work ────────────────────────────────────────────────

{
  // Changing tools cancels the draft, so panning mid-shape would silently
  // destroy the rectangle being dragged out, or the arrow waiting for its
  // second click. Losing work to a key pressed for a look around is a far
  // worse trade than not panning for a moment.
  for (const inFlight of ["draftState", "draftPolygon", "draftCallout", "_arrowDrag"]) {
    const self = board();
    self[inFlight] = { kind: "line" };
    self._beginSpacePan();
    assert.strictEqual(self.activeTool, "rectangle",
      `space must not switch tools while ${inFlight} is in flight`);
    assert.ok(!self._spacePanning);
  }
}

{
  // A board that doesn't offer the grabber doesn't get space-pan either.
  const self = board({ tools: ["rectangle"] });
  self._beginSpacePan();
  assert.strictEqual(self.activeTool, "rectangle");
  assert.ok(!self._spacePanning, "nothing to come back from");
}

// ── the wiring ────────────────────────────────────────────────────────────

{
  const handler = src.slice(src.indexOf("self._undoKeyHandler = function(e) {"),
                            src.indexOf("document.addEventListener(\"keydown\", self._undoKeyHandler);"));

  // Typing a space into a label must type a space. The INPUT / TEXTAREA /
  // contentEditable gate at the top of the handler is what guarantees it,
  // so the space branch has to sit after it.
  const gate = handler.indexOf('t.tagName === "INPUT"');
  const space = handler.indexOf('e.key === " " || e.code === "Space"');
  assert.ok(gate !== -1 && space !== -1);
  assert.ok(gate < space,
    "the space branch must come after the typing gate, or holding space " +
    "while naming a shape pans instead of typing");

  // Bare space only — a modifier makes it a chord belonging to something
  // else.
  assert.ok(/e\.code === "Space"\) &&\s*\n\s*!e\.metaKey && !e\.ctrlKey && !e\.altKey/.test(handler),
    "modified space is not ours");

  // Space scrolls the page, which is never what someone holding it over a
  // canvas meant.
  assert.ok(handler.includes("if (self._spacePanning) e.preventDefault();"),
    "a space that pans is swallowed");
  assert.ok(handler.includes("!e.repeat && !self._spacePanning"),
    "…and the auto-repeat while held is not a second press");
}

{
  // A keyup that never arrives: alt-tab away with space held and the
  // browser hands the release to whatever has focus next.
  assert.ok(src.includes('window.addEventListener("blur", self._spaceBlurHandler);'),
    "losing focus ends the pan");
  assert.ok(src.includes('document.addEventListener("keyup", self._spaceUpHandler);'),
    "and so does the release");

  // Both come off on teardown — they are on document and window, which
  // outlive the layer.
  const destroyed = src.slice(src.indexOf("    destroyed: function() {"),
                              src.indexOf("\n    },", src.indexOf("    destroyed: function() {")));
  for (const h of ["_spaceUpHandler", "_spaceBlurHandler"]) {
    assert.ok(destroyed.includes(h), `${h} must be unwired on destroy`);
  }
}

console.log("space pan: all checks passed");
