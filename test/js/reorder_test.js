// Pins the z-order array maths in priv/static/etcher.js.
//
// Etcher's JS has no test harness, and standing up a DOM one to exercise a
// pure array transform would be far more machinery than the thing under test.
// So `_reorderShapes` is lifted out of the source and run directly: if it is
// renamed or its signature changes, extraction fails loudly rather than
// silently testing nothing.
//
// Run via `mix test` (test/js_reorder_test.exs shells out) or directly:
//   node test/js/reorder_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

// Grab `_reorderShapes: function(targets, where) { … },` up to the closing
// brace at its own indentation — the file is uniformly 4-space indented
// inside the hook object.
const start = src.indexOf("    _reorderShapes: function(targets, where) {");
assert.notStrictEqual(start, -1, "could not find _reorderShapes in etcher.js");
const end = src.indexOf("\n    },", start);
assert.notStrictEqual(end, -1, "could not find the end of _reorderShapes");
const body = src.slice(start, end + "\n    }".length).replace("_reorderShapes: function", "function");

const reorderShapes = eval("(" + body + ")");

// Minimal stand-in: the function only touches `this.shapes`.
function ctx(names) {
  return { shapes: names.map((n) => ({ uuid: n })) };
}
function order(c) {
  return c.shapes.map((s) => s.uuid);
}
function pick(c, names) {
  return c.shapes.filter((s) => names.includes(s.uuid));
}

let ran = 0;
function check(label, fn) {
  fn();
  ran++;
  console.log("  ok  " + label);
}

console.log("_reorderShapes");

check("front moves the target past everything", () => {
  const c = ctx(["a", "b", "c"]);
  assert.strictEqual(reorderShapes.call(c, pick(c, ["a"]), "front"), true);
  assert.deepStrictEqual(order(c), ["b", "c", "a"]);
});

check("back moves the target behind everything", () => {
  const c = ctx(["a", "b", "c"]);
  assert.strictEqual(reorderShapes.call(c, pick(c, ["c"]), "back"), true);
  assert.deepStrictEqual(order(c), ["c", "a", "b"]);
});

check("forward steps exactly one position", () => {
  const c = ctx(["a", "b", "c"]);
  assert.strictEqual(reorderShapes.call(c, pick(c, ["a"]), "forward"), true);
  assert.deepStrictEqual(order(c), ["b", "a", "c"]);
});

check("backward steps exactly one position", () => {
  const c = ctx(["a", "b", "c"]);
  assert.strictEqual(reorderShapes.call(c, pick(c, ["c"]), "backward"), true);
  assert.deepStrictEqual(order(c), ["a", "c", "b"]);
});

// No-ops must report false so the caller skips the undo entry and the
// change event — otherwise hammering ] at the top fills history with nothing
// and re-broadcasts an unchanged list to every peer.
check("front is a no-op when already frontmost", () => {
  const c = ctx(["a", "b"]);
  assert.strictEqual(reorderShapes.call(c, pick(c, ["b"]), "front"), false);
  assert.deepStrictEqual(order(c), ["a", "b"]);
});

check("forward is a no-op at the top", () => {
  const c = ctx(["a", "b"]);
  assert.strictEqual(reorderShapes.call(c, pick(c, ["b"]), "forward"), false);
});

check("backward is a no-op at the bottom", () => {
  const c = ctx(["a", "b"]);
  assert.strictEqual(reorderShapes.call(c, pick(c, ["a"]), "backward"), false);
});

check("front preserves the targets' relative order", () => {
  const c = ctx(["a", "b", "c", "d"]);
  // Selection order deliberately reversed — the result must follow list
  // order, not the order they happened to be clicked in.
  assert.strictEqual(reorderShapes.call(c, pick(c, ["c", "a"]), "front"), true);
  assert.deepStrictEqual(order(c), ["b", "d", "a", "c"]);
});

check("back preserves the targets' relative order", () => {
  const c = ctx(["a", "b", "c", "d"]);
  assert.strictEqual(reorderShapes.call(c, pick(c, ["b", "d"]), "back"), true);
  assert.deepStrictEqual(order(c), ["b", "d", "a", "c"]);
});

// A contiguous block must travel as a unit; stepping each member
// independently would have them trample one another.
check("adjacent targets slide together going forward", () => {
  const c = ctx(["a", "b", "c", "d"]);
  assert.strictEqual(reorderShapes.call(c, pick(c, ["a", "b"]), "forward"), true);
  assert.deepStrictEqual(order(c), ["c", "a", "b", "d"]);
});

check("adjacent targets slide together going backward", () => {
  const c = ctx(["a", "b", "c", "d"]);
  assert.strictEqual(reorderShapes.call(c, pick(c, ["c", "d"]), "backward"), true);
  assert.deepStrictEqual(order(c), ["a", "c", "d", "b"]);
});

check("a blocked member of a block stays put", () => {
  // `b` can move up; `d` is already at the top and cannot.
  const c = ctx(["a", "b", "c", "d"]);
  assert.strictEqual(reorderShapes.call(c, pick(c, ["b", "d"]), "forward"), true);
  assert.deepStrictEqual(order(c), ["a", "c", "b", "d"]);
});

check("selecting everything is always a no-op", () => {
  for (const where of ["front", "back", "forward", "backward"]) {
    const c = ctx(["a", "b", "c"]);
    assert.strictEqual(
      reorderShapes.call(c, pick(c, ["a", "b", "c"]), where),
      false,
      where + " should not move a full selection"
    );
  }
});

check("a single shape cannot be reordered", () => {
  for (const where of ["front", "back", "forward", "backward"]) {
    const c = ctx(["a"]);
    assert.strictEqual(reorderShapes.call(c, pick(c, ["a"]), where), false);
  }
});

// ── _syncShapeOrder ─────────────────────────────────────────────────────────
//
// Putting the DOM into the order `this.shapes` describes. `insertBefore` on a
// node that is already where it belongs still detaches and re-attaches it, and
// the browser repaints it — images re-decode. This ran over every shape on
// every call, so a collaborative host re-imposing order after each remote edit
// flashed the whole board every time anyone moved anything.

const syncStart = src.indexOf("    _syncShapeOrder: function() {");
assert.notStrictEqual(syncStart, -1, "could not find _syncShapeOrder in etcher.js");
const syncEnd = src.indexOf("\n    },", syncStart);
assert.notStrictEqual(syncEnd, -1, "could not find the end of _syncShapeOrder");
const syncShapeOrder = eval(
  "(" +
    src
      .slice(syncStart, syncEnd + "\n    }".length)
      .replace("_syncShapeOrder: function", "function") +
    ")"
);

// A DOM stand-in that counts moves. Only the few node operations
// `_syncShapeOrder` touches are modelled.
function svgWith(ids) {
  const svg = {
    childNodes: [],
    moves: 0,
    insertBefore(node, ref) {
      svg.moves++;
      const at = svg.childNodes.indexOf(node);
      if (at !== -1) svg.childNodes.splice(at, 1);
      const before = ref ? svg.childNodes.indexOf(ref) : -1;
      if (before === -1) svg.childNodes.push(node);
      else svg.childNodes.splice(before, 0, node);
      relink();
      return node;
    }
  };

  // `nextSibling` is what the skip test reads, so it has to stay honest.
  function relink() {
    svg.childNodes.forEach((n, i) => {
      n.nextSibling = svg.childNodes[i + 1] || null;
    });
  }

  ids.forEach((id) => svg.childNodes.push({ id, parentNode: svg, nextSibling: null }));
  relink();
  return svg;
}

const elIn = (svg, id) => svg.childNodes.find((n) => n.id === id);
const domOrder = (svg) => svg.childNodes.map((n) => n.id);

console.log("\n_syncShapeOrder");

check("already in order moves nothing", () => {
  const svg = svgWith(["a", "b", "c"]);
  const c = { svg, shapes: ["a", "b", "c"].map((id) => ({ uuid: id, el: elIn(svg, id) })) };

  syncShapeOrder.call(c);

  assert.strictEqual(svg.moves, 0, "a settled board must not touch the DOM at all");
  assert.deepStrictEqual(domOrder(svg), ["a", "b", "c"]);
});

check("puts the DOM into the order the shape list describes", () => {
  const svg = svgWith(["a", "b", "c"]);
  const c = { svg, shapes: ["c", "a", "b"].map((id) => ({ uuid: id, el: elIn(svg, id) })) };

  syncShapeOrder.call(c);

  assert.deepStrictEqual(domOrder(svg), ["c", "a", "b"]);
});

check("moves only what is out of place", () => {
  // One shape reseated: the others are already in their final relative
  // positions and must be left alone.
  const svg = svgWith(["a", "b", "c"]);
  const shapes = ["a", "b", "c"].map((id) => ({ uuid: id, el: elIn(svg, id) }));
  const c = { svg, shapes: [shapes[0], shapes[2], shapes[1]] };

  syncShapeOrder.call(c);

  assert.deepStrictEqual(domOrder(svg), ["a", "c", "b"]);
  assert.strictEqual(svg.moves, 1, `moved ${svg.moves} nodes to reseat one`);
});

check("a title rides directly above its shape", () => {
  const svg = svgWith(["a", "a-title", "b"]);
  const c = {
    svg,
    shapes: [
      { uuid: "b", el: elIn(svg, "b") },
      { uuid: "a", el: elIn(svg, "a"), titleGroup: elIn(svg, "a-title") }
    ]
  };

  syncShapeOrder.call(c);

  assert.deepStrictEqual(domOrder(svg), ["b", "a", "a-title"]);
});

check("chrome above the shapes stays above them", () => {
  // Anything after the last shape element is not ours — handles, tooltips —
  // and the shapes have to stay behind it.
  const svg = svgWith(["a", "b", "handles"]);
  const c = { svg, shapes: ["b", "a"].map((id) => ({ uuid: id, el: elIn(svg, id) })) };

  syncShapeOrder.call(c);

  assert.deepStrictEqual(domOrder(svg), ["b", "a", "handles"]);
});

check("no svg is not a crash", () => {
  syncShapeOrder.call({ svg: null, shapes: [] });
});

console.log(`\n${ran} checks passed`);
