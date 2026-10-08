// Host-supplied SortableJS: `window.Etcher.sortableUrl` and
// `window.Etcher.loadSortableFromCdn`, so a strict-CSP, offline or
// no-third-party host can keep Etcher's Customise dialog from ever
// requesting the CDN (phoenix_kit's
// dev_docs/plans/2026-10-07-etcher-local-sortable-request.md).
//
// Drives the real `_withSortable` against a fake page and checks the
// ATTEMPTED script URLs, not just successful loads — an enforced CSP alone
// can hide an unwanted attempt.
//
//   node test/js/host_sortable_test.js

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher.js"), "utf8");
const CDN = src.match(/var SORTABLE_CDN = "([^"]+)";/)[1];
const start = src.indexOf("    _withSortable: function(cb) {");
const end = src.indexOf("\n    },", start);
const body = src.slice(start, end + "\n    }".length).replace("_withSortable: function", "function");

function page(etcherCfg, sortable) {
  const scripts = [];
  const window = { Etcher: etcherCfg, Sortable: sortable };
  const document = {
    createElement: () => ({}),
    head: { appendChild: (s) => scripts.push(s) }
  };
  const withSortable = new Function("window", "document", "SORTABLE_CDN", "return (" + body + ");")(
    window, document, CDN);
  const layer = { _withSortable: withSortable };
  const results = [];
  const ask = () => layer._withSortable((lib) => results.push(lib));
  return { window, scripts, layer, results, ask };
}

function FakeSortable() {}

// window.Sortable present: nothing is requested, as today.
{
  const p = page({ loadSortableFromCdn: false }, FakeSortable);
  p.ask();
  assert.deepStrictEqual(p.results, [FakeSortable]);
  assert.strictEqual(p.scripts.length, 0);
}

// Defaults still request the CDN.
{
  const p = page({}, undefined);
  p.ask();
  assert.strictEqual(p.scripts[0].src, CDN);
}

// loadSortableFromCdn = false, no Sortable: no <script>, native path at once.
{
  const p = page({ loadSortableFromCdn: false }, undefined);
  p.ask();
  assert.strictEqual(p.scripts.length, 0, "no request at all");
  assert.deepStrictEqual(p.results, [null], "native drag-and-drop");
}

// sortableUrl set: only that URL, whatever the CDN flag says.
for (const flag of [true, false, undefined]) {
  const p = page({ sortableUrl: "/assets/vendor/lib/sortable.js", loadSortableFromCdn: flag }, undefined);
  p.ask();
  assert.deepStrictEqual(p.scripts.map((s) => s.src), ["/assets/vendor/lib/sortable.js"],
    `custom URL only (flag ${flag})`);
}

// A custom URL that fails never falls back to the CDN — now or later.
{
  const p = page({ sortableUrl: "/missing.js", loadSortableFromCdn: true }, undefined);
  p.ask();
  p.ask(); // a queued second open
  p.scripts[0].onerror();
  assert.deepStrictEqual(p.results, [null, null], "both waiters settle once, natively");
  p.ask();
  assert.strictEqual(p.scripts.length, 1, "no CDN attempt after the custom URL failed");
  assert.deepStrictEqual(p.results, [null, null, null]);
}

// A script that loads but leaves no usable constructor takes the native path.
{
  const p = page({ sortableUrl: "/not-sortable.js" }, undefined);
  p.ask();
  p.window.Sortable = { not: "a constructor" };
  p.scripts[0].onload();
  assert.deepStrictEqual(p.results, [null]);
}

// A good custom URL resolves with the library.
{
  const p = page({ sortableUrl: "/sortable.js" }, undefined);
  p.ask();
  p.window.Sortable = FakeSortable;
  p.scripts[0].onload();
  assert.deepStrictEqual(p.results, [FakeSortable]);
}

// Empty, whitespace-only and non-string URLs mean "no custom URL": the flag
// decides — and the current page is never requested as a "URL".
for (const bad of ["", "   ", 42, null]) {
  const off = page({ sortableUrl: bad, loadSortableFromCdn: false }, undefined);
  off.ask();
  assert.strictEqual(off.scripts.length, 0, `${JSON.stringify(bad)} + flag false: no request`);
  const on = page({ sortableUrl: bad }, undefined);
  on.ask();
  assert.deepStrictEqual(on.scripts.map((s) => s.src), [CDN], `${JSON.stringify(bad)}: CDN by default`);
}

// Settings supplied after etcher.js evaluated, but before the first open,
// are honoured — they are read when the library is needed.
{
  const p = page({}, undefined);
  p.window.Etcher.loadSortableFromCdn = false;
  p.ask();
  assert.strictEqual(p.scripts.length, 0);
}

// A valid global supplied after a failure still enables enhanced reordering.
{
  const p = page({ sortableUrl: "/missing.js" }, undefined);
  p.ask();
  p.scripts[0].onerror();
  p.window.Sortable = FakeSortable;
  p.ask();
  assert.deepStrictEqual(p.results, [null, FakeSortable]);
}

// Settings set before etcher.js loads survive its evaluation.
assert.match(src, /window\.Etcher = window\.Etcher \|\| \{\};/);

console.log("host sortable: all checks passed");
