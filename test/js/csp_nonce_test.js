// GitHub issue #2: Etcher under a nonce-based Content-Security-Policy.
//
// The <style> the bundle creates, and the <script> it adds for SortableJS,
// are stamped with the page's nonce before they are inserted. `cspNonce`
// picks it: the host's window.Etcher.styleNonce / .scriptNonce, else (for a
// style) a nonced <style> on the page, else the <script> that loaded the
// bundle, else any nonced element.
//
//   node test/js/csp_nonce_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher.js"), "utf8");

function body(head, end) {
  const start = src.indexOf(head);
  assert.notStrictEqual(start, -1, `could not find ${head}`);
  return src.slice(start, src.indexOf(end, start) + end.length);
}

const cspNonceSrc = body("  function cspNonce(kind) {", "\n  }\n");

function nonceOf({ styles = [], scripts = [], loader = "", own = {} }, kind) {
  const document = {
    querySelectorAll(sel) {
      const list = sel === "style[nonce]" ? styles : sel === "script[nonce]" ? scripts : [];
      return list.map(nonce => ({ nonce }));
    },
  };
  const run = new Function("window", "document", "LOADER_NONCE",
    cspNonceSrc + "\nreturn cspNonce(" + JSON.stringify(kind) + ");");
  return run({ Etcher: own }, document, loader);
}

// Separate nonces: each element gets its own kind's.
const split = { styles: ["STY"], scripts: ["SCR"], loader: "SCR" };
assert.strictEqual(nonceOf(split, "style"), "STY");
assert.strictEqual(nonceOf(split, "script"), "SCR");

// One nonce for both, with and without a currentScript (bundled into app.js).
assert.strictEqual(nonceOf({ scripts: ["N"], loader: "N" }, "style"), "N");
assert.strictEqual(nonceOf({ scripts: ["N"] }, "style"), "N");
assert.strictEqual(nonceOf({ scripts: ["N"] }, "script"), "N");

// A script never takes a style nonce while the loader's is known.
assert.strictEqual(nonceOf({ styles: ["STY"], loader: "SCR" }, "script"), "SCR");

// The host's settings win.
assert.strictEqual(nonceOf({ ...split, own: { styleNonce: "S!", scriptNonce: "J!" } }, "style"), "S!");
assert.strictEqual(nonceOf({ ...split, own: { styleNonce: "S!", scriptNonce: "J!" } }, "script"), "J!");

// No nonce anywhere: none.
assert.strictEqual(nonceOf({}, "style"), "");
assert.strictEqual(nonceOf({}, "script"), "");

// Both created elements are stamped before they are inserted.
const inject = body("  function injectStyles() {", "\n  }\n");
assert.match(inject, /var nonce = cspNonce\("style"\);\s*if \(nonce\) style\.nonce = nonce;[\s\S]*document\.head\.appendChild\(style\)/);
const sortable = body("    _withSortable: function(cb) {", "\n    },");
assert.match(sortable, /var nonce = cspNonce\("script"\);\s*if \(nonce\) script\.nonce = nonce;[\s\S]*document\.head\.appendChild\(script\)/);

console.log("csp nonce: ok");
