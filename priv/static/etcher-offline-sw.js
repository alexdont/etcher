// Etcher's offline service worker.
//
// Keeps the pages a board was opened on, and the files they loaded, so the
// board opens with no connection. Only what a page asked it to keep: every
// other request goes to the network untouched.
//
//   keep    a page posts { type: "etcher-offline:keep", page, urls } after it
//           has loaded online. The worker fetches each one fresh and stores
//           it, and remembers the list.
//   fetch   for a kept URL: the network first, the stored copy when the
//           network fails or takes too long. Only `keep` writes: a page and the
//           files it loaded are stored together, from one load, so an ordinary
//           visit can never leave a newer page beside an older script it needs.
//
// The host serves this file (`Etcher.offline_worker/0`) and the layer
// registers it (`offline_sw` attr).
"use strict";

var CACHE = "etcher-offline-v1";
var INDEX = "/__etcher_offline_index__";
var NETWORK_WAIT_MS = 6000;
var kept = null; // Set of kept URLs, loaded lazily (a worker can be restarted at any time)
// URL prefixes kept as they are loaded: a deep-zoom picture's tiles, too many
// to fetch up front. Each one fetched online is stored; offline, it is served.
var keptPrefixes = [];

self.addEventListener("install", function() { self.skipWaiting(); });
self.addEventListener("activate", function(event) { event.waitUntil(self.clients.claim()); });

function strip(url) {
  return String(url).split("#")[0];
}

function index() {
  if (kept) return Promise.resolve(kept);
  return caches.open(CACHE).then(function(cache) {
    return cache.match(INDEX);
  }).then(function(res) {
    return res ? res.json() : [];
  }).then(function(list) {
    // Older indexes were a bare list of URLs.
    var urls = Array.isArray(list) ? list : (list && list.urls) || [];
    keptPrefixes = (list && Array.isArray(list.prefixes)) ? list.prefixes : [];
    kept = new Set(urls);
    return kept;
  }, function() {
    kept = new Set();
    return kept;
  });
}

function byPrefix(url) {
  for (var i = 0; i < keptPrefixes.length; i++) {
    if (url.indexOf(keptPrefixes[i]) === 0) return true;
  }
  return false;
}

function saveIndex(cache) {
  return cache.put(INDEX, new Response(JSON.stringify({ urls: Array.from(kept), prefixes: keptPrefixes }), {
    headers: { "content-type": "application/json" }
  }));
}

function store(cache, url) {
  var sameOrigin = new URL(url).origin === self.location.origin;
  var req = new Request(url, sameOrigin
    ? { credentials: "same-origin", cache: "no-cache" }
    : { mode: "no-cors", credentials: "omit" });
  return fetch(req).then(function(res) {
    if (res && (res.ok || res.type === "opaque")) {
      kept.add(strip(url));
      return cache.put(strip(url), res).then(function() { return true; });
    }
    return false;
  }).catch(function() { return false; });
}

self.addEventListener("message", function(event) {
  var data = event.data || {};
  if (data.type !== "etcher-offline:keep") return;
  event.waitUntil(index().then(function() {
    return caches.open(CACHE);
  }).then(function(cache) {
    var urls = (Array.isArray(data.urls) ? data.urls : []).filter(function(u) {
      return /^https?:/.test(u);
    });
    (Array.isArray(data.prefixes) ? data.prefixes : []).forEach(function(p) {
      if (/^https?:/.test(p) && keptPrefixes.indexOf(p) === -1) keptPrefixes.push(p);
    });
    var jobs = urls.map(function(u) { return store(cache, u); });
    if (data.page) {
      kept.add(strip(data.page));
      jobs.push(fetch(new Request(data.page, { credentials: "same-origin" })).then(function(res) {
        if (res && res.ok) return cache.put(strip(data.page), res).then(function() { return true; });
        return false;
      }).catch(function() { return false; }));
    }
    return Promise.all(jobs).then(function(results) {
      return saveIndex(cache).then(function() {
        var failed = results.filter(function(r) { return r === false; }).length;
        if (event.source && event.source.postMessage) {
          event.source.postMessage({ type: "etcher-offline:kept", page: data.page, count: jobs.length, failed: failed });
        }
      });
    });
  }));
});

function fromNetwork(request, key) {
  return new Promise(function(resolve, reject) {
    var timer = setTimeout(function() { reject(new Error("timeout")); }, NETWORK_WAIT_MS);
    fetch(request).then(function(res) {
      clearTimeout(timer);
      resolve(res);
    }, function(err) {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// A page answered from this cache says so, so it can start the board at
// once instead of waiting for a LiveView that cannot connect.
function marked(res) {
  return res.text().then(function(html) {
    var tag = '<meta name="etcher-offline-copy" content="1">';
    var out = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, function(h) { return h + tag; }) : tag + html;
    var headers = new Headers(res.headers);
    headers.delete("content-length");
    return new Response(out, { status: 200, statusText: "OK", headers: headers });
  });
}

self.addEventListener("fetch", function(event) {
  var request = event.request;
  if (request.method !== "GET") return;
  var key = strip(request.url);
  if (key.indexOf(INDEX) !== -1) return;
  // Known not to be kept: leave it to the browser entirely.
  if (kept && !kept.has(key) && !byPrefix(key)) return;

  // Answering asynchronously means deciding synchronously: the index is
  // checked inside respondWith, and a URL that is not kept goes straight to
  // the network as it would have without the worker.
  event.respondWith(index().then(function(set) {
    var tile = !set.has(key) && byPrefix(key);
    if (!set.has(key) && !tile) return fetch(request);
    return fromNetwork(request, key).then(function(res) {
      // A tile is immutable (its address names its level and place) and is
      // stored as it comes; the rest is written by `keep` only.
      if (tile && res && (res.ok || res.type === "opaque")) {
        var copy = res.clone();
        caches.open(CACHE).then(function(cache) { return cache.put(key, copy); }).catch(function() {});
      }
      return res;
    }).catch(function(err) {
      return caches.open(CACHE).then(function(cache) {
        return cache.match(key, { ignoreVary: true });
      }).then(function(hit) {
        if (!hit) throw err;
        return request.mode === "navigate" ? marked(hit) : hit;
      });
    });
  }));
});
