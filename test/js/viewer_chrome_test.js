// A press on the viewer's own controls is for the control, never also for
// the shape underneath it.
//
// Etcher reads presses from document listeners and hit-tests by coordinate,
// so whatever floats over the canvas has to be named or excluded. Fresco's
// nav and zoom control were not: with a shape under the zoom-out button a
// press selected the shape, and a quick second press opened its label
// editor instead of zooming. A host's own buttons laid over the picture —
// a close button, a next-file tab — sit outside the container and fell
// through the same way.
//
//   node test/js/viewer_chrome_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher.js"), "utf8");

// ── CHROME_SELECTOR names Fresco's controls ────────────────────────────────

const chrome = eval(src.match(/var CHROME_SELECTOR =\n([\s\S]*?);\n/)[1]);
const names = chrome.split(",").map((x) => x.trim());
assert.ok(names.includes(".fresco-nav"), "Fresco's nav (and its ⋯ popover, also a .fresco-nav)");
assert.ok(names.includes(".fresco-zoom"), "Fresco's zoom control");
assert.ok(names.includes(".etcher-toolbar"), "and Etcher's own chrome is still there");

// ── overContainer: inside the box AND pressed on something of the viewer's ─

const body = src.match(/      function overContainer\(e\) \{[\s\S]*?\n      \}\n/)[0];
const make = new Function("self", "document", body + "\nreturn overContainer;");

const doc = { documentElement: { nodeType: 1 }, body: { nodeType: 1 } };
const inside = { nodeType: 1 };
const hostButton = { nodeType: 1 };
const container = {
  contains: (n) => n === inside,
  getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 300 })
};
const over = make({ handle: { container } }, doc);

assert.strictEqual(over({ target: inside, clientX: 100, clientY: 100 }), true, "a press on the canvas");
assert.strictEqual(over({ target: inside, clientX: 500, clientY: 100 }), false, "outside the box");
assert.strictEqual(
  over({ target: hostButton, clientX: 100, clientY: 100 }),
  false,
  "a host's button over the picture is not the canvas, whatever lies beneath"
);
assert.strictEqual(over({ target: doc.body, clientX: 100, clientY: 100 }), true, "no element of its own: the coordinates decide");
assert.strictEqual(over({ target: null, clientX: 100, clientY: 100 }), true, "nor with no target at all");
assert.strictEqual(make({ handle: null }, doc)({ target: inside, clientX: 1, clientY: 1 }), false, "no viewer, no canvas");

console.log("viewer chrome: ok");
