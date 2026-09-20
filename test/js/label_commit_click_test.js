// Pins that the click which sets a label does not also draw something.
//
// A tool stays armed after it draws (so you can draw several without
// re-arming). A dimension drops straight into label editing when it lands.
// Put those together and one click did two things: typing the measurement
// and clicking away to set it ALSO started the next dimension, left armed
// and rubber-banding off the cursor. Nobody asked for that one.
//
// The rule is the user's: clicking away sets the label, dragging draws a
// new one — "clicking and dragging is intentional and clicking is not". So
// the press that closes an editor is HELD, and released into the tool only
// once it travels far enough to be a drag; from where it landed, so the
// shape still starts under the finger.
//
//   node test/js/label_commit_click_test.js

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

const onDown = extract("_onPointerDown");
const onMove = extract("_onPointerMove");
const onUp = extract("_onPointerUp");

// A press at (x, y) in image px; the stub's projection is the identity.
const ev = (x, y) => ({ button: 0, clientX: x, clientY: y, shiftKey: false });

function board(state) {
  return Object.assign({
    annotationMode: true,
    activeTool: "dimension",
    draftState: null,
    draftPolygon: null,
    draftCallout: null,
    _erasingActive: false,
    _pendingDraw: null,
    _drawSuppressedUntilDrag: false,
    started: [],
    _toImage: (e) => ({ x: e.clientX, y: e.clientY }),
    _placeArmedDraft: () => false,
    _dispatchToolDown(pt, e) { this.started.push([pt.x, pt.y]); },
    // A click is a press that travelled less than the threshold; the real
    // one converts to screen px first, which this stub has no zoom for.
    _isClickGesture: (a, b) =>
      (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y) < 25,
    _syncHoverAt() {},
    _eraserHover() {},
    _updateMidpointHandles() {},
  }, state);
}

// ── the press that sets a label draws nothing ────────────────────────────

{
  const b = board({ _drawSuppressedUntilDrag: true });
  onDown.call(b, ev(100, 100));

  assert.deepStrictEqual(b.started, [],
    "the click that commits a label must not start a shape — it is a full " +
    "stop, not the beginning of the next sentence");
  assert.deepStrictEqual(b._pendingDraw && [b._pendingDraw.pt.x, b._pendingDraw.pt.y], [100, 100],
    "…but it is held, not dropped, so a drag that follows starts where the finger landed");
  assert.strictEqual(b._drawSuppressedUntilDrag, false, "one press, one use");
}

// ── releasing without moving draws nothing at all ────────────────────────

{
  const b = board({ _drawSuppressedUntilDrag: true });
  onDown.call(b, ev(100, 100));
  onMove.call(b, ev(102, 101));            // hand jitter, still a click
  assert.deepStrictEqual(b.started, [], "a couple of pixels is not a drag");
  assert.ok(b._pendingDraw, "and the press is still waiting");

  onUp.call(b, ev(102, 101));
  assert.strictEqual(b._pendingDraw, null, "the release ends the wait");
  assert.deepStrictEqual(b.started, [], "nothing drawn: the click only set the label");
}

// ── but a drag draws one, from where the press landed ────────────────────

{
  const b = board({ _drawSuppressedUntilDrag: true });
  onDown.call(b, ev(100, 100));
  onMove.call(b, ev(140, 100));

  assert.deepStrictEqual(b.started, [[100, 100]],
    "a deliberate drag draws — anchored at the press, not at the point it " +
    "crossed the threshold, or the shape would start short");
  assert.strictEqual(b._pendingDraw, null, "released into the tool, once");

  // And the same move does not start a second one.
  onMove.call(b, ev(180, 100));
  assert.strictEqual(b.started.length, 1);
}

// ── an ordinary press is untouched ───────────────────────────────────────

{
  const b = board({});
  onDown.call(b, ev(100, 100));
  assert.deepStrictEqual(b.started, [[100, 100]],
    "with no editor just closed, a press draws immediately as it always has");
  assert.strictEqual(b._pendingDraw, null);
}

// ── the flag never outlives its gesture ──────────────────────────────────

{
  // Read and cleared ahead of every early return. A press with no tool
  // armed (or outside annotation mode, or a right-click) still consumes
  // it — otherwise it would lie in wait and swallow the next real press.
  for (const state of [
    { activeTool: null },
    { annotationMode: false },
  ]) {
    const b = board(Object.assign({ _drawSuppressedUntilDrag: true }, state));
    onDown.call(b, ev(100, 100));
    assert.strictEqual(b._drawSuppressedUntilDrag, false,
      `the flag must not survive a press that returned early (${JSON.stringify(state)})`);
    assert.deepStrictEqual(b.started, []);
  }

  const rightClick = board({ _drawSuppressedUntilDrag: true });
  onDown.call(rightClick, { button: 2, clientX: 1, clientY: 1 });
  assert.strictEqual(rightClick._drawSuppressedUntilDrag, false);
}

// ── and it is the editor's own dismissal that arms it ────────────────────

{
  const handler = src.slice(
    src.indexOf("self._textEditOutsideDown = function(e) {"),
    src.indexOf('document.addEventListener("pointerdown", self._textEditOutsideDown, true);')
  );
  assert.ok(handler.includes("self._drawSuppressedUntilDrag = true;"),
    "the press that closes the editor is the one that has to be held back");
  assert.ok(
    handler.indexOf("self._drawSuppressedUntilDrag = true;") <
      handler.indexOf("self._commitTextEdit();"),
    "…armed before the commit, since the same press goes on to the canvas handler"
  );
  assert.ok(/setTimeout\(function\(\) \{ self\._drawSuppressedUntilDrag = false; \}, 0\);/.test(handler),
    "a press that never reaches the canvas handler must still not leave the flag set");
}

// ── a cancelled draft cancels a press still waiting to become one ────────

{
  const cancel = src.slice(src.indexOf("    _cancelDraft: function() {"),
                           src.indexOf("\n    },", src.indexOf("    _cancelDraft: function() {")));
  assert.ok(cancel.includes("this._pendingDraw = null;"),
    "changing tool or leaving annotation mode drops the held press with the drafts");
}

console.log("label commit click: all checks passed");
