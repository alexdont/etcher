// Pins how dimensions, lines and callouts get drawn.
//
// Three things, all about the same gesture:
//
//   1. Press, drag, release draws one in a single gesture, previewing as
//      you go. (Unchanged — this already worked.)
//   2. Click once and click again where the far end goes. That is how you
//      place one whose ends are further apart than a comfortable drag, and
//      how you place one precisely without holding a button down. The first
//      click leaves the draft ARMED, still following the cursor, so it has
//      visible consequences — two-click was tried before without a preview
//      and removed, because a first click that changes nothing on screen
//      reads as the tool being broken.
//   3. A second click landing on the first — i.e. a double-click, which
//      people do — makes nothing. There is no shape to build from one
//      point, and committing anyway left a trail of zero-length arrows
//      behind an impatient user.
//
//   node test/js/two_click_place_test.js

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

{
  const m = src.match(/var CLICK_PLACE_THRESHOLD_PX = ([\d.]+);/);
  assert.ok(m, "could not find CLICK_PLACE_THRESHOLD_PX");
  global.CLICK_PLACE_THRESHOLD_PX = Number(m[1]);
}

const placeArmed = extract("_placeArmedDraft");
const commitDimension = extract("_commitDimension");
const commitCallout = extract("_commitCallout");
const isClickGesture = extract("_isClickGesture");

const FAR = { x: 400, y: 300 };
const ORIGIN = { x: 100, y: 100 };
// Inside the click threshold — a double-click with a pixel of hand jitter.
const JITTER = { x: 101, y: 100 };

function board(over) {
  return Object.assign({
    committed: [],
    calloutCommits: [],
    _isClickGesture: isClickGesture,
    _markerScale: () => 1,
    _constrainShaftPoint: (a, pt) => pt,
    _commitShaftDraft(geom) { this.committed.push(geom); },
    _commitCallout(pt, second) { this.calloutCommits.push([pt, second]); },
  }, over || {});
}

// ── drag still draws in one gesture ────────────────────────────────────────

{
  const self = board({ draftState: { kind: "dimension", anchor: ORIGIN } });
  commitDimension.call(self, FAR);
  assert.deepStrictEqual(self.committed, [{ a: [100, 100], b: [400, 300] }],
    "a release past the threshold commits exactly the span dragged");
  assert.ok(!self.draftState.armed, "and nothing is left waiting");
}

// ── a click arms rather than committing a stub ────────────────────────────

{
  const self = board({ draftState: { kind: "dimension", anchor: ORIGIN } });
  commitDimension.call(self, JITTER);
  assert.deepStrictEqual(self.committed, [],
    "a click commits nothing — no default-length stub to drag into place");
  assert.strictEqual(self.draftState.armed, true,
    "the draft waits for the click that places its far end");
}

// ── …and the second click places it ───────────────────────────────────────

{
  const self = board({
    draftState: { kind: "dimension", anchor: ORIGIN, armed: true },
  });
  assert.strictEqual(placeArmed.call(self, FAR), true, "the press is consumed");
  assert.deepStrictEqual(self.committed, [{ a: [100, 100], b: [400, 300] }],
    "click, click — anchor to far end");
}

// ── a double-click in one spot makes nothing ──────────────────────────────

{
  const self = board({
    draftState: { kind: "dimension", anchor: ORIGIN, armed: true },
  });
  assert.strictEqual(placeArmed.call(self, JITTER), true,
    "the stray press is swallowed rather than starting a second draft");
  assert.deepStrictEqual(self.committed, [], "and builds nothing from one point");
  assert.strictEqual(self.draftState.armed, true,
    "the draft stays armed, so the NEXT click still places the far end");

  // The release that follows that second press re-arms rather than
  // committing — the whole double-click leaves no shape behind.
  commitDimension.call(self, JITTER);
  assert.deepStrictEqual(self.committed, []);
  assert.strictEqual(self.draftState.armed, true);
}

// ── callouts behave the same way ──────────────────────────────────────────

{
  // Drag → committed where released.
  const self = board({
    draftCallout: {
      kind: "callout",
      geometry: { anchor: [100, 100], text_box: { x: 0, y: 0, w: 80, h: 30 } },
      el: { classList: { remove() {} } },
    },
    _finalizeLabeled(kind, geom) { this.finalized = [kind, geom]; },
  });
  delete self._commitCallout;
  commitCallout.call(self, FAR);
  assert.strictEqual(self.finalized[0], "callout");
  assert.deepStrictEqual(self.finalized[1].text_box,
    { x: 400, y: 285, w: 80, h: 30 }, "the label lands where it was released");
  assert.strictEqual(self.draftCallout, null, "and the draft is spent");
}

{
  // Click → armed, nothing committed.
  const self = board({
    draftCallout: {
      kind: "callout",
      geometry: { anchor: [100, 100], text_box: { x: 0, y: 0, w: 80, h: 30 } },
      el: { classList: { remove() {} } },
    },
    _finalizeLabeled() { assert.fail("a click must not commit a callout"); },
  });
  delete self._commitCallout;
  commitCallout.call(self, JITTER);
  assert.strictEqual(self.draftCallout.armed, true);
}

{
  // The placing click routes through the same commit, flagged so it does
  // not re-arm: by then the press is already known to be past the
  // threshold, and re-testing it against the anchor would arm forever.
  const self = board({
    draftCallout: {
      kind: "callout",
      geometry: { anchor: [100, 100], text_box: { x: 0, y: 0, w: 80, h: 30 } },
      armed: true,
    },
  });
  assert.strictEqual(placeArmed.call(self, FAR), true);
  assert.deepStrictEqual(self.calloutCommits, [[FAR, true]],
    "the second click commits the callout, marked as the placing click");

  // And a double-click on the anchor still makes nothing.
  const dbl = board({
    draftCallout: {
      kind: "callout",
      geometry: { anchor: [100, 100], text_box: { x: 0, y: 0, w: 80, h: 30 } },
      armed: true,
    },
  });
  assert.strictEqual(placeArmed.call(dbl, JITTER), true);
  assert.deepStrictEqual(dbl.calloutCommits, []);
}

// ── nothing armed → the press starts a new gesture ────────────────────────

{
  assert.strictEqual(placeArmed.call(board(), FAR), false,
    "with no draft in flight the press falls through to the tool");
  assert.strictEqual(
    placeArmed.call(board({ draftState: { kind: "dimension", anchor: ORIGIN } }), FAR),
    false, "an UNARMED draft is mid-drag — its own pointerup owns it");
}

// ── wiring ────────────────────────────────────────────────────────────────

{
  // The armed draft has to be offered the press before the tool switch, or
  // the second click starts a fresh draft on top of the one waiting.
  const down = src.slice(src.indexOf("    _onPointerDown: function(e) {"),
                         src.indexOf("    _onPointerMove: function(e) {"));
  assert.ok(down.includes("if (this._placeArmedDraft(pt)) return;"),
    "the press is offered to an armed draft first");
  assert.ok(down.indexOf("_placeArmedDraft") < down.indexOf("switch (this.activeTool)"),
    "…before the tool dispatch");
}

{
  // While armed, the preview keeps following the cursor — that is what
  // makes the first click visibly do something, and it is the reason this
  // flow is worth having when the last attempt at it was removed.
  const move = src.slice(src.indexOf("    _onPointerMove: function(e) {"),
                         src.indexOf("    _onPointerUp: function(e) {"));
  assert.ok(move.includes('case "dimension": this._updateDimension(pt); break;'),
    "a shaft draft previews on every move, armed or mid-drag");
  assert.ok(move.includes("this._calloutHover("),
    "and so does a callout's");
}

{
  // Escape has to reach an armed draft, or a user who changes their mind
  // is stuck with a preview trailing the cursor.
  const cancel = src.slice(src.indexOf("    _cancelDraft: function() {"),
                           src.indexOf("\n    },", src.indexOf("    _cancelDraft: function() {")));
  assert.ok(cancel.includes("this.draftState = null;") &&
              cancel.includes("this.draftCallout = null;"),
    "cancelling drops both kinds of armed draft");
}

console.log("two-click place: all checks passed");
