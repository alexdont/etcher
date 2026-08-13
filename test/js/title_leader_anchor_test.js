// Pins where a label's leader line attaches, on both ends.
//
// The label end was hardcoded to the box's bottom-center — right for the
// float-above default, and exactly wrong for a label dragged BELOW its
// shape: the leader left from the label's far side and crossed the text
// on its way to the parent. Each end now anchors at the point facing the
// other — the parent's nearest perimeter point, clamped into the label
// rect, lands on the label's facing edge or corner wherever it sits.
//
//   node test/js/title_leader_anchor_test.js

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

const leaderAnchors = extract("_titleLeaderAnchors");
const shapeNearestPoint = extract("_shapeNearestPoint");

// The real perimeter helper against a 100×100 rectangle at the origin,
// with a 1:1 image→container mapping so the numbers read directly.
const ctx = {
  _shapeNearestPoint: shapeNearestPoint,
  _imageToContainer: (p) => p
};
const RECT = { kind: "rectangle", geometry: { x: 0, y: 0, w: 100, h: 100 } };

// A 96×22 label placed relative to the shape; anchors() returns both ends.
const anchors = (tx, ty) => leaderAnchors.call(ctx, RECT, tx, ty, 96, 22);

// ── label below-right: the leader leaves the label's facing corner ──────────

{
  const a = anchors(120, 140);
  assert.deepStrictEqual(a.parent, { x: 100, y: 100 },
    "the parent end should land on the shape's nearest corner");
  assert.deepStrictEqual(a.title, { x: 120, y: 140 },
    "the label end should be its top-left corner — the one facing the shape — " +
    "not the bottom-center on the far side, which drew the leader across the text");
}

// ── label directly above: the classic layout is unchanged ───────────────────

{
  const a = anchors(2, -50); // centered over the shape, floating above
  assert.deepStrictEqual(a.parent, { x: 50, y: 0 },
    "the parent end should be the top edge under the label");
  assert.deepStrictEqual(a.title, { x: 50, y: -28 },
    "a label floating above keeps its bottom-center anchor — the default layout must not change");
}

// ── label directly below: leader leaves the TOP edge, not the bottom ────────

{
  const a = anchors(2, 140);
  assert.strictEqual(a.title.y, 140,
    "a label below its shape must anchor on its TOP edge — the bottom would cross the text");
  assert.deepStrictEqual(a.parent, { x: 50, y: 100 });
}

// ── label to the left: leader leaves the right edge ─────────────────────────

{
  const a = anchors(-150, 39); // vertically centered beside the shape
  assert.strictEqual(a.title.x, -150 + 96,
    "a label left of its shape must anchor on its RIGHT edge");
  assert.deepStrictEqual(a.parent, { x: 0, y: 50 });
}

// ── the render actually uses the helper ─────────────────────────────────────

// The endpoint math lived inline in `_renderTitleSibling` before; a revert
// there quietly restores the bottom-center bug while this suite stays green.
{
  const renderStart = src.indexOf("    _renderTitleSibling: function");
  const renderEnd = src.indexOf("\n    },", renderStart);
  const body = src.slice(renderStart, renderEnd);
  assert.ok(body.includes("_titleLeaderAnchors("),
    "_renderTitleSibling no longer routes the leader through _titleLeaderAnchors");
  assert.ok(!/titleAnchor = \{ x: tx \+ tw \/ 2, y: ty \+ th \}/.test(body),
    "the hardcoded bottom-center anchor is back in the render");
}

console.log("title leader anchor: all checks passed");
