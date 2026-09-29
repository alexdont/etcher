// A press that never moves, on a device that stops reporting.
//
// Reported from an iPhone: the marker draws lines but will not place a dot —
// the one under a question mark, the one on an i. A stroke of any length
// lands; a tap does nothing at all.
//
// iOS stops sending pointer events part-way through a gesture whenever its
// own classifier claims the touch, and a press whose release never arrives
// leaves the drawing it started uncommitted. Every other gesture has samples
// behind it and survives; the press that never moves has nothing BUT its
// release, so it is the one that disappears.
//
// Touch events do not have the problem: `touchend` is the model iOS actually
// implements, and it fires on the element the touch started on. So the
// release is taken from there as well — and does nothing at all when the
// pointer events did arrive, which is the normal case on every other device.
//
//   node test/js/touch_release_test.js

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

const resetTracking = extract("_resetTouchTracking");
const commitStranded = extract("_commitStrandedDraft");

function layer(over) {
  const ups = [];
  return Object.assign({
    _touchIds: [4, 9],
    _multiTouch: true,
    _drawPointerId: 4,
    draftState: { kind: "marker" },
    ups: ups,
    _resetTouchTracking: resetTracking,
    _commitStrandedDraft: commitStranded,
    _onPointerUp(e) { ups.push(e); },
  }, over || {});
}

const release = (x, y) => ({
  type: "touchend",
  touches: [],
  changedTouches: [{ clientX: x, clientY: y, identifier: 1 }],
});

{
  // Whatever the pointer stream sent or failed to send, no fingers are down
  // once the last one leaves. A `_multiTouch` left standing here would
  // swallow the next stroke whole — every press would read as a second
  // finger and be handed to the canvas as a pan.
  const l = layer();
  l._resetTouchTracking();

  assert.deepStrictEqual(l._touchIds, []);
  assert.strictEqual(l._multiTouch, false);
  assert.strictEqual(l._drawPointerId, null);
}

{
  // The draft the pointer stream never closed, finished off the touch's own
  // release — through the same path `pointerup` takes, so the dot is the
  // same shape, styled and emitted the same way, as one placed with a mouse.
  const l = layer();
  l._commitStrandedDraft(release(120, 250), 4);

  assert.strictEqual(l.ups.length, 1, "the release goes through");
  const e = l.ups[0];
  assert.strictEqual(e.clientX, 120, "at the point the finger left");
  assert.strictEqual(e.clientY, 250);
  assert.strictEqual(e.button, 0, "a touch is the primary button, or the press is not ours");
  assert.strictEqual(e.pointerType, "touch");
  assert.strictEqual(e.pointerId, 4, "the finger that owned the stroke");
}

{
  // The normal case, on every device that finishes what it starts: the
  // pointer events arrived, the draft is already a shape, and there is
  // nothing here to do. Committing again would place a second dot on top
  // of the first.
  const l = layer({ draftState: null });
  l._commitStrandedDraft(release(10, 10), 1);

  assert.strictEqual(l.ups.length, 0, "no draft, no second commit");
}

{
  // A release that says nothing about where it happened cannot be used to
  // place anything.
  const l = layer();
  l._commitStrandedDraft({ type: "touchend", touches: [], changedTouches: [] }, 4);
  l._commitStrandedDraft({ type: "touchend", touches: [] }, 4);

  assert.strictEqual(l.ups.length, 0);
}

console.log("touch release: all checks passed");
