// Pins which tools a first-time user finds on the toolbar.
//
// Two lists, and they had drifted apart. `:tools` on the component says
// which tools the board OFFERS; `ESSENTIAL_TOOLS` says which of those get a
// button on the bar, the rest living one press of `⋯` away.
//
// Before this, `line` and `image` were on the bar list but were not offered
// by default — so they could never appear, and the entries were dead. And
// rectangle, circle and arrow, the three shapes people actually draw on a
// picture, were all in the overflow grid. The default bar was the grabber,
// freehand, the eraser, text, callout and the red pointer.
//
// Which of the remaining tools belongs on a bar of eight is a judgement
// about taste and audience, not something this test can settle — what it
// can do is keep the two lists honest with each other, keep the bar
// scannable, and make any change to it deliberate.
//
//   node test/js/default_tools_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");
const LAYER = fs.readFileSync(
  path.join(__dirname, "..", "..", "lib", "etcher", "layer.ex"), "utf8"
);

function listOf(name) {
  const m = src.match(new RegExp(`var ${name} = \\[([\\s\\S]*?)\\];`));
  assert.ok(m, `could not find ${name}`);
  return (m[1].match(/"([a-z]+)"/g) || []).map((s) => s.replace(/"/g, ""));
}

const essentials = listOf("ESSENTIAL_TOOLS");

const toolDefs = (() => {
  const body = src.slice(src.indexOf("var TOOL_DEFS = {"),
                         src.indexOf("var TOOL_SHORTCUTS"));
  return (body.match(/^\s{4}(\w+):\s+\{/gm) || []).map((s) => s.trim().replace(/:.*/, ""));
})();

const offered = (() => {
  const attr = LAYER.slice(LAYER.indexOf("attr(:tools, :list,"),
                           LAYER.indexOf("attr(:image_source"));
  const list = attr.slice(attr.indexOf("default: ["), attr.indexOf("]"));
  return (list.match(/:(\w+)/g) || []).map((s) => s.slice(1));
})();

// ── the two lists agree ───────────────────────────────────────────────────

for (const key of essentials) {
  assert.ok(toolDefs.indexOf(key) !== -1, `"${key}" is on the bar but is not a tool`);
  assert.ok(offered.indexOf(key) !== -1,
    `"${key}" is on the bar but not offered by default — it can never appear, ` +
    "which is what line and image were doing before");
}
assert.strictEqual(new Set(essentials).size, essentials.length, "no duplicates on the bar");

// Everything offered is a real tool, and the offered set is where the ⋯
// grid gets its contents.
for (const key of offered) {
  assert.ok(toolDefs.indexOf(key) !== -1, `":${key}" is offered but is not a tool`);
}

// ── the bar holds what a first-time user reaches for ──────────────────────

// Marking up a picture: get around it, box and circle things, point at them
// or rule a line between them, scribble by hand, label, undo a mistake.
for (const key of ["grabber", "rectangle", "circle", "arrow", "line",
                   "marker", "text", "eraser"]) {
  assert.ok(essentials.indexOf(key) !== -1,
    `"${key}" should be on the bar without customising`);
}

// And not the specialised ones. Each is a real tool — this is about what a
// first-time user meets, not a ranking.
for (const [key, why] of [
  ["polygon", "precise work, reached for on purpose"],
  ["dimension", "measurement — a surveyor's tool on a photo annotator's bar"],
  ["freehand", "the marker's exact cousin — an editable curve, graduated to"],
  ["callout", "a leader and a label welded together; an arrow and a text label already are"],
  ["image", "needs host wiring, and a picture inside a picture is not the common job"],
  ["pointer", "draws nothing on its own — it is for presenting"],
]) {
  assert.strictEqual(essentials.indexOf(key), -1, `"${key}" is niche for the bar: ${why}`);
}

// A bar that holds everything is not a bar. If this ever needs raising,
// raise it deliberately — the `⋯` grid is not a demotion.
assert.ok(essentials.length <= 8,
  `the default bar is up to ${essentials.length} tools; it has to stay scannable`);

// ── the order reads as a sentence ─────────────────────────────────────────

const at = (k) => essentials.indexOf(k);
assert.ok(at("grabber") === 0, "getting around comes first");
assert.ok(at("rectangle") < at("arrow"), "the closed shapes group before the lines");
assert.ok(at("circle") < at("arrow"));
assert.ok(Math.abs(at("arrow") - at("line")) === 1, "the two lines sit together");
assert.ok(at("marker") > at("line"), "then the hand-drawn one");
assert.ok(at("text") > at("marker"), "labelling after drawing");
assert.ok(at("eraser") === essentials.length - 1,
  "the destructive one goes last, away from everything else");

// ── nothing is unreachable ────────────────────────────────────────────────

// Every tool the default offers is either on the bar or in the grid, and
// the grid is exactly the remainder.
{
  const grid = offered.filter((t) => essentials.indexOf(t) === -1);
  assert.ok(grid.length > 0, "the grid should hold the rest");
  for (const t of offered) {
    assert.ok(essentials.indexOf(t) !== -1 || grid.indexOf(t) !== -1,
      `":${t}" is offered but reachable from neither the bar nor the grid`);
  }
  // The source of the grid's contents, so the above is not just arithmetic
  // on two lists that happen to agree.
  assert.ok(src.includes("return !self._isEssentialTool(t) && TOOL_DEFS[t];"),
    "the grid is the offered tools that aren't on the bar");
}

// A user who has customised keeps their own bar — this default is only for
// people who never have.
assert.ok(src.includes('var want = this._getPref("tools");') &&
            src.includes("if (!Array.isArray(want)) return ESSENTIAL_TOOLS;"),
  "a saved arrangement wins over the default");

// ── the docs say the same thing ───────────────────────────────────────────

{
  const tools = LAYER.slice(LAYER.indexOf("  ## Tools"),
                            LAYER.indexOf("  ## Annotation hydration"));
  assert.ok(/one press of\s+`⋯` away/.test(tools),
    "the docs should say the rest are a press away, not missing");
  for (const key of essentials) {
    assert.ok(tools.indexOf(key) !== -1,
      `the docs list the default bar; "${key}" is missing from it`);
  }
}

console.log("default tools: all checks passed");
