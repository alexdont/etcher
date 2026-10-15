// Escape is claimed ahead of the page when it has something of the layer's
// to cancel: a host's own Escape (closing the viewer, ending the session)
// must not also fire. An idle Escape is left for the page.
//
//   node test/js/escape_capture_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher.js"), "utf8");

assert.ok(src.includes('window.addEventListener("keydown", self._escapeCaptureHandler, true);'),
  "on the window, in the capture phase — ahead of every document listener");
assert.ok(src.includes('window.removeEventListener("keydown", this._escapeCaptureHandler, true);'),
  "and taken down with the layer");

const start = src.indexOf("self._escapeCaptureHandler = function(e) {");
const body = src.slice(start, src.indexOf("\n      };", start));
// The handler closes over `self`; give it one per case.
function layer(over) {
  return Object.assign({ annotationMode: true, _openChip: null, _textEditor: null, _openPopupKind: null,
    layersMenu: null, actionMenu: null, calls: [],
    _closeChipPop() { this.calls.push("chip"); }, _cancelTextEdit() { this.calls.push("edit"); },
    _closePopup() { this.calls.push("popup"); }, _closeLayersMenu() {}, _closeActionMenu() {},
    _escapeLadder() { this.calls.push("ladder"); return !!this.ladderFires; } }, over);
}
const evalIn = (self) => eval("(function(){ var self = arguments[0]; return " + body.replace("self._escapeCaptureHandler = ", "") + "\n      }; })")(self);
function fire(self) {
  const h = evalIn(self);
  const e = { key: "Escape", target: { tagName: "DIV" }, prevented: 0, stopped: 0,
    preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; } };
  h(e);
  return e;
}

{ const l = layer({ ladderFires: true }); const e = fire(l);
  assert.deepStrictEqual(l.calls, ["ladder"]); assert.strictEqual(e.stopped, 1, "a draft cancelled: the key stops here"); }
{ const l = layer({ ladderFires: false }); const e = fire(l);
  assert.strictEqual(e.stopped, 0, "nothing to cancel: the page gets its Escape"); }
{ const l = layer({ _openChip: {} }); const e = fire(l);
  assert.deepStrictEqual(l.calls, ["chip"]); assert.strictEqual(e.stopped, 1, "an open pop-up closes, and only it"); }
{ const l = layer({ _openPopupKind: "tools" }); const e = fire(l);
  assert.deepStrictEqual(l.calls, ["popup"]); assert.strictEqual(e.stopped, 1, "an open menu closes, and only it"); }
{ const l = layer({ _textEditor: { input: {} } }); const e = fire(l);
  assert.deepStrictEqual(l.calls, ["edit"]); assert.strictEqual(e.stopped, 1, "the text editor cancels"); }
{ const l = layer({ annotationMode: false, ladderFires: true }); const e = fire(l);
  assert.strictEqual(e.stopped, 0, "outside annotation mode it stays out of the way"); }

console.log("escape capture: all checks passed");
