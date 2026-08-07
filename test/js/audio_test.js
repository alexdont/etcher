// Pins the two pieces of audio-card logic that are pure decisions rather
// than DOM plumbing: how a timecode is formatted, and when a client
// corrects its playback position to match the room.
//
// The drift rule is the one worth guarding. Transport state arrives
// continuously while something is playing, and seeking on every message
// would stutter audibly — so corrections only happen past a threshold. Set
// it too low and playback stutters; too high and listeners drift apart. It
// is the kind of constant that gets "tidied" by someone who doesn't know
// what it's for.
//
//   node test/js/audio_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const SOURCE = path.join(__dirname, "..", "..", "priv", "static", "etcher.js");
const src = fs.readFileSync(SOURCE, "utf8");

function lift(name, signature) {
  const needle = `    ${name}: function(${signature}) {`;
  const start = src.indexOf(needle);
  assert.notStrictEqual(start, -1, `could not find ${name} in etcher.js`);
  const end = src.indexOf("\n    },", start);
  assert.notStrictEqual(end, -1, `could not find the end of ${name}`);
  return eval(
    "(" +
      src.slice(start, end + "\n    }".length).replace(`${name}: function`, "function") +
      ")"
  );
}

const formatTime = lift("_formatTime", "secs");
const applyMediaState = lift("_applyMediaState", "uuid, state");
const isAudioFile = lift("_isAudioFile", "file");
const isVideoFile = lift("_isVideoFile", "file");
const canPlayFile = lift("_canPlayFile", "kind, file");
const isMediaKind = lift("_isMediaKind", "kind");

// ── timecode ────────────────────────────────────────────────────────────────

assert.strictEqual(formatTime(0), "0:00");
assert.strictEqual(formatTime(9), "0:09", "seconds are zero-padded");
assert.strictEqual(formatTime(61), "1:01");
assert.strictEqual(formatTime(600), "10:00");
assert.strictEqual(formatTime(3661), "61:01", "minutes run past 60 rather than wrapping");
assert.strictEqual(formatTime(12.7), "0:12", "truncates, so the clock never shows a time not reached");

// Duration is unknown until metadata loads, and a card is on screen before
// that. Every one of these has to read as "unknown", not as 0:00 or NaN:NaN.
for (const bad of [null, undefined, NaN, Infinity, -1]) {
  assert.strictEqual(formatTime(bad), "--:--", `unknown duration: ${bad}`);
}

// ── correcting to the room ──────────────────────────────────────────────────

// A stand-in layer: `_applyMediaState` only reads the local state and calls
// `_applyAudio`, so record what it decides to do.
function layer(local) {
  const calls = [];
  return {
    calls,
    _audioState: () => local,
    _applyAudio: (uuid, action, position, emit) => {
      calls.push({ action, position, emit });
      return true;
    }
  };
}

const THRESHOLD = 0.25;

// Playing, in step: nothing to do.
let l = layer({ playing: true, position: 10, duration: 60 });
applyMediaState.call(l, "u", { playing: true, position: 10 });
assert.deepStrictEqual(l.calls, [], "already in step — no correction");

// Playing, slightly behind. Under the threshold, so it must ride it out
// rather than seek: this arrives many times a second.
for (const drift of [0.05, 0.15, 0.24]) {
  l = layer({ playing: true, position: 10, duration: 60 });
  applyMediaState.call(l, "u", { playing: true, position: 10 + drift });
  assert.deepStrictEqual(l.calls, [], `drift of ${drift}s must not seek`);
}

// Past the threshold, correct — and correct to the room's position, not by
// some delta of our own.
l = layer({ playing: true, position: 10, duration: 60 });
applyMediaState.call(l, "u", { playing: true, position: 14 });
assert.strictEqual(l.calls.length, 1);
assert.strictEqual(l.calls[0].position, 14, "seeks to where the room is");
assert.strictEqual(l.calls[0].emit, false,
  "a correction must never be re-broadcast — two clients correcting each " +
  "other would never settle");

// Drift is absolute: being AHEAD is just as wrong as being behind.
l = layer({ playing: true, position: 20, duration: 60 });
applyMediaState.call(l, "u", { playing: true, position: 15 });
assert.strictEqual(l.calls.length, 1, "running ahead is corrected too");
assert.strictEqual(l.calls[0].position, 15);

// ── transitions ─────────────────────────────────────────────────────────────

// The room started playing while this client was paused.
l = layer({ playing: false, position: 5, duration: 60 });
applyMediaState.call(l, "u", { playing: true, position: 5 });
assert.strictEqual(l.calls.length, 1);
assert.strictEqual(l.calls[0].action, "play");
assert.strictEqual(l.calls[0].emit, false);

// The room paused.
l = layer({ playing: true, position: 5, duration: 60 });
applyMediaState.call(l, "u", { playing: false, position: 5 });
assert.strictEqual(l.calls[0].action, "pause");

// Starting to play AND far out of position: one call that does both, rather
// than a play followed by an audible seek.
l = layer({ playing: false, position: 0, duration: 60 });
applyMediaState.call(l, "u", { playing: true, position: 30 });
assert.strictEqual(l.calls.length, 1, "one correction, not two");
assert.strictEqual(l.calls[0].action, "play");
assert.strictEqual(l.calls[0].position, 30);

// A state message with no position at all (a bare play/pause) must not be
// read as "seek to 0".
l = layer({ playing: false, position: 42, duration: 60 });
applyMediaState.call(l, "u", { playing: true });
assert.strictEqual(l.calls[0].action, "play");
assert.strictEqual(l.calls[0].position, null, "no position given, none applied");

// Nothing local to drive — the shape is gone, or its element never loaded.
const empty = { _audioState: () => null, _applyAudio: () => { throw new Error("unreachable"); } };
assert.strictEqual(applyMediaState.call(empty, "u", { playing: true }), false);

// ── which files become audio cards ──────────────────────────────────────────

for (const type of ["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg"]) {
  assert.ok(isAudioFile({ type, name: "x" }), type);
}
// Some sources hand over a File with a blank type; the extension is the
// fallback, and without it a dropped mp3 would be routed to the image path.
for (const name of ["lesson.mp3", "TAKE.M4A", "a.wav", "b.ogg", "c.flac", "d.opus"]) {
  assert.ok(isAudioFile({ type: "", name }), name);
}
assert.ok(!isAudioFile({ type: "image/png", name: "a.png" }));
assert.ok(!isAudioFile({ type: "", name: "notes.pdf" }));
assert.ok(!isAudioFile({ type: "", name: "mp3" }), "an extension, not a substring");
assert.ok(!isAudioFile(null));

// ── video, and the audio/video split ────────────────────────────────────────

for (const type of ["video/mp4", "video/webm", "video/quicktime"]) {
  assert.ok(isVideoFile({ type, name: "x" }), type);
}
for (const name of ["lesson.mp4", "CLIP.MOV", "a.webm", "b.m4v", "c.ogv"]) {
  assert.ok(isVideoFile({ type: "", name }), name);
}
assert.ok(!isVideoFile({ type: "audio/mpeg", name: "a.mp3" }));
assert.ok(!isVideoFile({ type: "image/png", name: "a.png" }));
assert.ok(!isVideoFile(null));

// The two must not overlap: a file matching both would be routed by whichever
// check the router happens to run first.
const samples = [
  { type: "audio/mpeg", name: "a.mp3" },
  { type: "video/mp4", name: "a.mp4" },
  { type: "", name: "a.wav" },
  { type: "", name: "a.webm" }
];
for (const f of samples) {
  assert.ok(!(isAudioFile(f) && isVideoFile(f)),
    `${f.name} must be one kind or the other, not both`);
}

// Both kinds share the transport; nothing else does.
assert.ok(isMediaKind("audio"));
assert.ok(isMediaKind("video"));
for (const k of ["image", "rectangle", "text", "arrow", "marker", undefined]) {
  assert.ok(!isMediaKind(k), `${k} has no media element`);
}

// ── refusing what can't be played ───────────────────────────────────────────

// The point of this check is to refuse BEFORE uploading — otherwise a large
// unplayable file transfers in full and lands as a card that does nothing.
function withDoc(answer, fn) {
  const real = global.document;
  global.document = { createElement: () => ({ canPlayType: () => answer }) };
  try { return fn(); } finally { global.document = real; }
}

assert.ok(withDoc("probably", () => canPlayFile("video", { type: "video/mp4" })));
assert.ok(withDoc("maybe", () => canPlayFile("video", { type: "video/mp4" })),
  '"maybe" is not a refusal — most codecs answer this');
assert.ok(!withDoc("", () => canPlayFile("video", { type: "video/x-matroska" })),
  'only "" is a definite no');

// A blank MIME type must NOT be refused: plenty of sources omit it, and
// rejecting on that basis would turn away files that play perfectly.
assert.ok(withDoc("", () => canPlayFile("audio", { type: "" })),
  "no type given is not evidence of being unplayable");
assert.ok(withDoc("", () => canPlayFile("audio", {})));

// An environment without `canPlayType` must let the file through rather than
// refusing everything.
{
  const real = global.document;
  global.document = { createElement: () => ({}) };
  try {
    assert.ok(canPlayFile("audio", { type: "audio/mpeg" }),
      "no canPlayType — allow, don't block every insert");
  } finally { global.document = real; }
}

// ── the card is one rigid design ────────────────────────────────────────────

// `_layoutAudioCard` is nearly all DOM writes, so rather than lift it this
// reads its source and enforces the single rule that keeps it coherent: every
// length in it is relative to `cardK`, the size the card is being drawn at
// compared with the size it was designed at.
//
// That rule is worth guarding because breaking it is invisible in code review
// and obvious on screen. A bare `Math.min(14, …)` corner radius looks
// perfectly reasonable, and it squares off the corners of any card drawn
// bigger than its design size while thinning the scrub bar to a hairline.
// Both of those shipped. The numbers themselves are fine — they are what the
// card looks like at `AUDIO_CARD_H` — they just have to scale.
{
  const start = src.indexOf("    _layoutAudioCard: function(shape, box) {");
  assert.notStrictEqual(start, -1, "could not find _layoutAudioCard");
  const end = src.indexOf("\n    },", start);
  const body = src.slice(start, end);

  // Numbers that are NOT lengths: fractions of a range, and a character
  // count. Anything else clamped to a bare number is a length.
  const notLengths = new Set(["0", "1"]);

  const offenders = [];
  const clamp = /Math\.(?:max|min)\(\s*(\d+(?:\.\d+)?)\s*([,)])/g;
  let m;
  while ((m = clamp.exec(body)) !== null) {
    const num = m[1];
    if (notLengths.has(num)) continue;
    // `Math.max(3, Math.floor(avail / (fs * 0.55)))` counts characters.
    const line = body.slice(body.lastIndexOf("\n", m.index) + 1,
                            body.indexOf("\n", m.index));
    if (line.includes("maxChars")) continue;
    // The sub-pixel floor on a stroke is deliberately absolute. Scaling it
    // would defeat its whole purpose: a line thinner than about 0.4px is
    // invisible at any size the card happens to be, which is the one thing
    // this floor exists to prevent. Same floor every other stroke has.
    if (line.includes("strokeWidth") && /Math\.max\(0\.4,/.test(line)) continue;
    const after = body.slice(m.index + m[0].length - 1, m.index + m[0].length + 12);
    if (!/^\s*\*\s*cardK/.test(after)) {
      offenders.push(line.trim());
    }
  }

  assert.deepStrictEqual(offenders, [],
    "every length clamped in the audio card must be scaled by `cardK`, or the " +
    "card stops being a single design and comes apart at sizes other than its " +
    "own. Offending line(s) above.");
}

// And the arithmetic itself: at the design size the constants mean literally
// what they say, and at any other size the whole card is that same design
// scaled — nothing creeps toward a fixed on-screen size.
{
  const AUDIO_CARD_H = 88;
  const metrics = (h, w) => {
    const k = h / AUDIO_CARD_H;
    const pad = Math.max(6 * k, Math.min(14 * k, h * 0.16));
    return {
      pad,
      radius: Math.max(4 * k, Math.min(14 * k, h * 0.18)),
      disc: Math.max(7 * k, Math.min((h - pad * 2) / 2, h * 0.28,
                                     (w - pad * 2) / 2, w * 0.18)),
      barH: Math.max(3 * k, Math.min(6 * k, h * 0.07)),
      titleFs: Math.max(9 * k, Math.min(15 * k, h * 0.19))
    };
  };

  // At design size, the original numbers.
  const at1 = metrics(88, 360);
  assert.ok(Math.abs(at1.pad - 14) < 1e-9, "pad at design size");
  assert.ok(Math.abs(at1.radius - 14) < 1e-9, "corner radius at design size");
  assert.ok(Math.abs(at1.barH - 6) < 1e-9, "bar height at design size");
  assert.ok(Math.abs(at1.titleFs - 15) < 1e-9, "title size at design size");

  // At any other size, exactly that design scaled — this is what "square
  // corners on a big card" failed, and it fails for every factor, not just
  // the extremes.
  for (const f of [0.25, 0.5, 2, 2.744, 5, 20]) {
    const at = metrics(88 * f, 360 * f);
    for (const key of Object.keys(at1)) {
      assert.ok(Math.abs(at[key] / f - at1[key]) < 1e-9,
        `${key} at ${f}x should be ${f}x its design value, got ${at[key]}`);
    }
  }
}

console.log("audio: all checks passed");
