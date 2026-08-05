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

console.log("audio: all checks passed");
