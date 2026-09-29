// Two fingers move the canvas, whichever tool is armed.
//
// Reported from a phone: with the marker out, a second finger made the line
// whip back and forth between the two fingers for as long as they both moved.
// The overlay claims pointer input (`data-fresco-no-capture`), so the viewer
// had been told to ignore the first finger — leaving the second one nothing to
// pinch WITH, and it fed the same stroke instead. Moving around a board meant
// switching to the pan tool, panning, and switching back.
//
// The viewer's half of the fix is in Fresco (`overlay_pinch_test.exs`): a
// claimed finger is counted, a second one is a pinch. This is Etcher's half —
// knowing how many fingers are down, so the drawing stops at two and does not
// resume halfway through someone's pan.
//
//   node test/js/two_finger_pan_test.js

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

// ── counting fingers ─────────────────────────────────────────────────────

const trackTouch = extract("_trackTouch");

function tracker() {
  return {
    _touchIds: null,
    _multiTouch: false,
    _drawPointerId: null,
    _touchReleaseWired: true,          // the document listeners are not the subject
    _trackTouch: trackTouch,
    _wireTouchRelease() {},
  };
}

const finger = (id) => ({ pointerId: id, pointerType: "touch" });

{
  const t = tracker();
  t._trackTouch(finger(1), true);

  assert.strictEqual(t._multiTouch, false, "one finger is a drawing, not a gesture");
  assert.strictEqual(t._drawPointerId, 1, "and it is the finger that owns the stroke");
}

{
  // The second finger. Everything about the stroke stops here; the canvas
  // gesture belongs to Fresco, which is counting the same two fingers.
  const t = tracker();
  t._trackTouch(finger(1), true);
  t._trackTouch(finger(2), true);

  assert.strictEqual(t._multiTouch, true);
  assert.strictEqual(t._drawPointerId, 1,
    "the second finger does not take the stroke over — it ends it");
}

{
  // Lifting back to one finger mid-pinch does NOT hand drawing back: the
  // remaining finger is somewhere else entirely by now, and resuming would
  // draw a line from wherever it happens to be.
  const t = tracker();
  t._trackTouch(finger(1), true);
  t._trackTouch(finger(2), true);
  t._trackTouch(finger(2), false);

  assert.strictEqual(t._multiTouch, true, "still in the gesture until the hand is off");
  assert.strictEqual(t._drawPointerId, 1);

  t._trackTouch(finger(1), false);
  assert.strictEqual(t._multiTouch, false, "hand off: the next press draws again");
  assert.strictEqual(t._drawPointerId, null);
}

{
  // Same, lifting the drawing finger first.
  const t = tracker();
  t._trackTouch(finger(1), true);
  t._trackTouch(finger(2), true);
  t._trackTouch(finger(1), false);

  assert.strictEqual(t._drawPointerId, null, "the stroke's finger is gone");
  assert.strictEqual(t._multiTouch, true, "but a finger is still down");
}

{
  // A press repeated for the same id — defensive; a duplicate must not read
  // as a second finger and kill the stroke.
  const t = tracker();
  t._trackTouch(finger(1), true);
  t._trackTouch(finger(1), true);

  assert.strictEqual(t._multiTouch, false);
  assert.strictEqual(t._touchIds.length, 1);
}

{
  // A release for a finger never seen going down leaves the rest alone.
  const t = tracker();
  t._trackTouch(finger(1), true);
  t._trackTouch(finger(9), false);

  assert.deepStrictEqual(t._touchIds, [1]);
  assert.strictEqual(t._drawPointerId, 1);
}

{
  // A mouse and a pen are single pointers by nature: two of them are not a
  // pinch, and the drag that draws must not also pan. They are claimed
  // outright (Fresco never counts them) and only name the drawing pointer.
  for (const type of ["mouse", "pen"]) {
    const t = tracker();
    t._trackTouch({ pointerId: 4, pointerType: type }, true);

    assert.strictEqual(t._multiTouch, false, `${type}: never a gesture`);
    assert.strictEqual(t._drawPointerId, 4, `${type}: still owns the stroke`);
    assert.strictEqual(t._touchIds, null, `${type}: not a finger, not counted`);
  }
}

// ── letting go of an erase ───────────────────────────────────────────────

const cancelErase = extract("_cancelErase");

function erasing() {
  const mark = () => {
    const cls = new Set();
    return { classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), has: (c) => cls.has(c) } };
  };
  const a = { uuid: "a", el: mark(), titleGroup: mark() };
  const b = { uuid: "b", el: mark() };
  a.el.classList.add("is-erasing");
  a.titleGroup.classList.add("is-erasing");
  b.el.classList.add("is-erasing");

  return {
    shapes: [a, b],
    hits: [a, b],
    _erasingActive: true,
    _erasingHits: [a, b],
    _erasingHitSet: new Set([a, b]),
    _cancelErase: cancelErase,
  };
}

{
  // The eraser is the one tool that does not build a draft: it greys its
  // hits during the press and deletes them on release. So abandoning a
  // stroke has to disarm that release as well — a second finger landing is
  // the user reaching for the canvas, not confirming a deletion.
  const l = erasing();
  l._cancelErase();

  assert.strictEqual(l._erasingActive, false, "the release will not commit");
  assert.strictEqual(l.shapes.length, 2, "and nothing was deleted");
  assert.strictEqual(l.hits[0].el.classList.has("is-erasing"), false,
    "the greying comes off — it was a question, and the answer was no");
  assert.strictEqual(l.hits[0].titleGroup.classList.has("is-erasing"), false,
    "including a shape's title, which greys with it");
  assert.strictEqual(l.hits[1].el.classList.has("is-erasing"), false);
  assert.strictEqual(l._erasingHits, null);
  assert.strictEqual(l._erasingHitSet, null);
}

{
  // Nothing being erased: cancelling is a no-op, not a crash. It is called
  // from a press handler that cannot know what the last tool was doing.
  const l = { _erasingActive: false, _erasingHits: null, _cancelErase: cancelErase };
  assert.doesNotThrow(() => l._cancelErase());
  assert.strictEqual(l._erasingActive, false);
}

{
  // Armed, pressed, nothing hit yet.
  const l = {
    _erasingActive: true, _erasingHits: [], _erasingHitSet: new Set(),
    _cancelErase: cancelErase,
  };
  l._cancelErase();
  assert.strictEqual(l._erasingActive, false);
}

console.log("two finger pan: all checks passed");
