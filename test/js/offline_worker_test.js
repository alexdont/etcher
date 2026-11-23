// Etcher's offline service worker, run against a fake browser: a cache, a
// network that can be switched off, and the events a page and the browser
// send it. Pins what it keeps, that it answers kept URLs network-first with
// the stored copy as the fallback, that deep-zoom tiles are kept as they load
// (they are too many to fetch up front), and that it leaves everything else
// to the browser.
//
//   node test/js/offline_worker_test.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "..", "priv", "static", "etcher-offline-sw.js"), "utf8");
const ORIGIN = "https://site.test";

function world() {
  const store = new Map(); // url -> body
  let online = true;
  const fetched = [];
  class Res {
    constructor(body, init) { this.body = body; this.status = (init && init.status) || 200; this.ok = this.status < 400; this.type = "basic"; this.headers = new Map(Object.entries((init && init.headers) || {})); }
    clone() { return new Res(this.body, { status: this.status }); }
    text() { return Promise.resolve(String(this.body)); }
    json() { return Promise.resolve(JSON.parse(this.body)); }
  }
  class Req { constructor(url, opts) { this.url = new URL(url, ORIGIN).href; this.method = (opts && opts.method) || "GET"; this.mode = (opts && opts.mode) || "cors"; } }
  const cache = {
    put: (k, res) => { store.set(typeof k === "string" ? new URL(k, ORIGIN).href : k.url, res.body); return Promise.resolve(); },
    match: (k) => { const key = typeof k === "string" ? new URL(k, ORIGIN).href : k.url; return Promise.resolve(store.has(key) ? new Res(store.get(key)) : undefined); }
  };
  const listeners = {};
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (n, fn) => { listeners[n] = fn; },
    skipWaiting: () => {},
    clients: { claim: () => Promise.resolve() }
  };
  const g = {
    self, Request: Req, Response: Res, Headers: Map, URL, Set, Promise, setTimeout, clearTimeout, JSON, Array, String,
    caches: { open: () => Promise.resolve(cache) },
    fetch: (req) => {
      const url = typeof req === "string" ? new URL(req, ORIGIN).href : req.url;
      fetched.push(url);
      return online ? Promise.resolve(new Res("net:" + url)) : Promise.reject(new TypeError("offline"));
    }
  };
  new Function(...Object.keys(g), src)(...Object.values(g));
  return {
    store, fetched, setOnline: (v) => { online = v; },
    keep: (data) => {
      let done; const posted = [];
      listeners.message({ data, source: { postMessage: (m) => posted.push(m) }, waitUntil: (p) => { done = p; } });
      return done.then(() => posted);
    },
    get: (url, mode) => {
      let answered = null;
      listeners.fetch({ request: new Req(url, { mode }), respondWith: (p) => { answered = Promise.resolve(p); } });
      return answered; // null: left to the browser
    }
  };
}

(async () => {
  // keep: the page and its files stored together, and reported back
  {
    const w = world();
    const posted = await w.keep({
      type: "etcher-offline:keep",
      page: ORIGIN + "/admin/media?file=f1",
      urls: [ORIGIN + "/app.js", ORIGIN + "/f/large.jpg", "data:image/png;base64,xx"],
      prefixes: [ORIGIN + "/f/pic_files/"]
    });
    assert.ok(w.store.has(ORIGIN + "/admin/media?file=f1"), "the page");
    assert.ok(w.store.has(ORIGIN + "/app.js") && w.store.has(ORIGIN + "/f/large.jpg"), "its files");
    assert.ok(![...w.store.keys()].some((k) => k.startsWith("data:")), "a data URL is not fetched");
    assert.deepStrictEqual(posted.map((m) => [m.type, m.failed]), [["etcher-offline:kept", 0]], "says it is done");

    // Not kept: left to the browser untouched.
    assert.strictEqual(w.get(ORIGIN + "/other.js"), null, "an unkept URL is not answered");

    // Kept: the network first, online…
    let res = await w.get(ORIGIN + "/app.js");
    assert.strictEqual(await res.text(), "net:" + ORIGIN + "/app.js");

    // …the stored copy offline.
    w.setOnline(false);
    res = await w.get(ORIGIN + "/f/large.jpg");
    assert.strictEqual(await res.text(), "net:" + ORIGIN + "/f/large.jpg", "served from the store");

    // A kept page answered from the store says so (the page then starts without the server).
    res = await w.get(ORIGIN + "/admin/media?file=f1", "navigate");
    assert.ok((await res.text()).includes('<meta name="etcher-offline-copy"'), "marked as the offline copy");

    // Only keep writes: an ordinary online visit does not replace a stored copy.
    w.setOnline(true);
    const before = w.store.get(ORIGIN + "/app.js");
    w.store.set(ORIGIN + "/app.js", "kept-version");
    await w.get(ORIGIN + "/app.js");
    assert.strictEqual(w.store.get(ORIGIN + "/app.js"), "kept-version", "a visit does not rewrite the store");
    w.store.set(ORIGIN + "/app.js", before);

    // Deep-zoom tiles: kept as they load online, served offline.
    const tile = ORIGIN + "/f/pic_files/12/3_4.jpg?v=1";
    assert.ok(!w.store.has(tile));
    res = await w.get(tile);
    assert.strictEqual(await res.text(), "net:" + tile);
    await new Promise((r) => setTimeout(r, 0));
    assert.ok(w.store.has(tile), "a tile loaded online is kept");
    w.setOnline(false);
    res = await w.get(tile);
    assert.strictEqual(await res.text(), "net:" + tile, "and served offline");

    // A tile never seen online is not there offline; the network error stands.
    await assert.rejects(w.get(ORIGIN + "/f/pic_files/13/0_0.jpg"));
  }

  // A restarted worker reads its index back, prefixes included.
  {
    const w = world();
    await w.keep({ type: "etcher-offline:keep", page: ORIGIN + "/b/1", urls: [], prefixes: [ORIGIN + "/t_files/"] });
    const w2 = world();
    for (const [k, v] of w.store) w2.store.set(k, v);
    const res = await w2.get(ORIGIN + "/t_files/0/0_0.jpg");
    assert.ok(res, "a fresh worker still recognises the tile prefix from the stored index");
  }

  console.log("offline_worker_test: ok");
})().catch((e) => { console.error(e); process.exit(1); });
