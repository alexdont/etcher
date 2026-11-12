// The laser meter driver: CRC, frames, decoding, and the connect flow
// against a fake Web Bluetooth stack. Fixtures are the frames captured from
// a real Bosch GLM on 2026-11-12.
//
//   node test/js/laser_driver_test.js
"use strict";
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const src = fs.readFileSync(path.join(__dirname, "../../priv/static/etcher.js"), "utf8");

// The driver is one self-contained block; run it with its own globals.
function loadDriver(globals) {
  const start = src.indexOf("  var Laser = (function() {");
  const end = src.indexOf("  window.Etcher.laser = Laser;", start);
  assert.ok(start !== -1 && end !== -1, "driver block");
  const body = src.slice(start, end) + "  return Laser;";
  const window = Object.assign({ Etcher: {}, isSecureContext: true }, globals.window || {});
  const navigator = globals.navigator || {};
  return new Function("window", "navigator", body)(window, navigator);
}

const hex = (s) => new Uint8Array(s.split(" ").map((h) => parseInt(h, 16)));
const L = loadDriver({});

// --- CRC: reproduces every captured frame, both directions ----------------
const CAPTURED = [
  "C0 55 02 01 00 1A", // enable autosync
  "C0 40 01 00 FA",    // measure
  "C0 41 00 96",       // laser on
  "C0 45 00 D0",       // beeper on
  "C0 46 00 58",       // beeper off
  "00 04 AB B2 00 00 FC",
  "00 10 02 00 6C 17 00 00 00 00 00 00 00 00 00 00 00 00 7E",
  "C0 11 00 3A"
];
CAPTURED.forEach((f) => {
  const b = hex(f);
  assert.strictEqual(L.crc8(b, b.length - 1), b[b.length - 1], "crc of " + f);
});

// --- Encoding: the requests we send are byte-for-byte the captured ones ---
assert.strictEqual(L.hex(L.FRAMES.autosync()), "C0 55 02 01 00 1A");
assert.strictEqual(L.hex(L.FRAMES.measure()), "C0 40 01 00 FA");
assert.strictEqual(L.hex(L.FRAMES.laserOn()), "C0 41 00 96");

// --- The short-form reply to "measure" ------------------------------------
{
  const m = L.decode(hex("00 04 AB B2 00 00 FC"));
  assert.strictEqual(m.type, "measurement");
  assert.strictEqual(m.source, "reply");
  assert.ok(Math.abs(m.metres - 2.28695) < 1e-9, "45739 × 0.05 mm = " + m.metres);
}
// A DataView over a slice of a bigger buffer (what Chrome hands over).
{
  const buf = new Uint8Array([9, 9, 0x00, 0x04, 0xAB, 0xB2, 0x00, 0x00, 0xFC, 9]);
  const m = L.decode(new DataView(buf.buffer, 2, 7));
  assert.strictEqual(m.type, "measurement", "reads a DataView at an offset");
}

// --- The autosync acknowledgement is a container with no result -----------
{
  const m = L.decode(hex("00 10 02 00 6C 17 00 00 00 00 00 00 00 00 00 00 00 00 7E"));
  assert.strictEqual(m.type, "status", "zero result is not a measurement");
  assert.strictEqual(m.container.id, 0x176C);
  assert.strictEqual(m.container.mode, 0);
}

// --- A device-button container (built to the documented layout) ----------
function containerFrame(prefix, metres, flags) {
  const c = new Uint8Array(16);
  c[0] = (1 << 2) | 0;   // mode 1, reference edge 0
  c[1] = flags || 0;
  new DataView(c.buffer).setUint16(2, 42, true);
  new DataView(c.buffer).setFloat32(4, metres, true);
  const out = prefix.concat(Array.from(c));
  out.push(L.crc8(out));
  return new Uint8Array(out);
}
{
  const pushed = L.decode(containerFrame([0xC0, 0x55, 0x10], 2.287));
  assert.strictEqual(pushed.type, "measurement", "C0 55 10 push");
  assert.strictEqual(pushed.source, "device");
  assert.strictEqual(pushed.metres, 2.287, "float32 noise snapped to 0.05 mm");
  assert.strictEqual(pushed.container.id, 42);
  assert.strictEqual(pushed.container.mode, 1);
  assert.strictEqual(pushed.lowBattery, false);

  const asReply = L.decode(containerFrame([0x00, 0x10], 1.5, 0x04 | 0x08));
  assert.strictEqual(asReply.type, "measurement", "00 10 framing read too");
  assert.strictEqual(asReply.lowBattery, true, "flag bit 2");
  assert.strictEqual(asReply.container.metric, true, "flag bit 3");
}

// --- Things that are not measurements -------------------------------------
assert.strictEqual(L.decode(hex("C0 11 00 3A")).type, "keepalive");
{
  const err = L.decode(new Uint8Array([0x03, 0x00, L.crc8([0x03, 0x00])]));
  assert.deepStrictEqual([err.type, err.status], ["error", 3], "non-zero status");
}
{
  const bad = hex("00 04 AB B2 00 00 FC");
  bad[6] ^= 0xFF;
  assert.deepStrictEqual(L.decode(bad), { type: "invalid", reason: "crc" }, "bad CRC dropped");
}
assert.strictEqual(L.decode(hex("00 04 AB B2")).type, "invalid", "truncated");
assert.strictEqual(L.decode([]).type, "invalid");
assert.strictEqual(L.decode(new Uint8Array([0x00, 0x04, 0, 0, 0, 0, L.crc8([0, 4, 0, 0, 0, 0])])).type, "status", "zero distance");

// --- Support detection ------------------------------------------------------
assert.strictEqual(loadDriver({ navigator: {} }).supported(), false, "no Web Bluetooth");
assert.ok(/browser/.test(loadDriver({ navigator: {} }).unsupportedReason()));
{
  const insecure = loadDriver({ navigator: { bluetooth: {} }, window: { isSecureContext: false } });
  assert.strictEqual(insecure.supported(), false, "needs a secure page");
  assert.ok(/https/.test(insecure.unsupportedReason()));
}

// --- Connect, autosync, readings, disconnect (fake Bluetooth) --------------
function fakeBluetooth(layoutIndex) {
  const written = [];
  const listeners = {};
  const devListeners = {};
  const layout = L.LAYOUTS[layoutIndex];
  const ch = {
    value: null,
    addEventListener: (n, fn) => { listeners[n] = fn; },
    startNotifications: () => Promise.resolve(ch),
    writeValueWithResponse: (b) => { written.push(L.hex(b)); return Promise.resolve(); },
    push(bytes) { ch.value = new DataView(bytes.buffer); listeners.characteristicvaluechanged({ target: ch }); }
  };
  const device = {
    name: null,
    gatt: {
      connected: false,
      connect() { device.gatt.connected = true; return Promise.resolve(server); },
      disconnect() { device.gatt.connected = false; }
    },
    addEventListener: (n, fn) => { devListeners[n] = fn; },
    removeEventListener: () => {},
    drop() { device.gatt.connected = false; devListeners.gattserverdisconnected(); }
  };
  const server = {
    getPrimaryService: (uuid) => uuid === layout.service
      ? Promise.resolve({ getCharacteristic: (c) => c === layout.characteristic ? Promise.resolve(ch) : Promise.reject(new Error("no char")) })
      : Promise.reject(new Error("no service"))
  };
  const bluetooth = { requested: null, requestDevice(opts) { bluetooth.requested = opts; return Promise.resolve(device); } };
  return { bluetooth, ch, device, written };
}

async function flow(layoutIndex) {
  const fake = fakeBluetooth(layoutIndex);
  const D = loadDriver({ navigator: { bluetooth: fake.bluetooth } });
  const events = [];
  D.subscribe((e) => events.push(e));
  await D.connect();

  const opts = fake.bluetooth.requested;
  const services = L.LAYOUTS.map((l) => l.service);
  assert.deepStrictEqual(opts.optionalServices, services, "both services optional");
  services.forEach((s) => assert.ok(opts.filters.some((f) => f.services && f.services[0] === s), "filtered on " + s));
  assert.ok(opts.filters.some((f) => f.namePrefix === "Bosch GLM"));
  assert.deepStrictEqual(fake.written, ["C0 55 02 01 00 1A"], "autosync on connect");
  assert.strictEqual(D.state(), "on");
  assert.deepStrictEqual(events.map((e) => e.state), ["connecting", "on"]);

  await D.measure();
  assert.deepStrictEqual(fake.written.slice(1), ["C0 40 01 00 FA"]);

  fake.ch.push(hex("C0 11 00 3A"));                 // keepalive: ignored
  fake.ch.push(hex("00 04 AB B2 00 00 FC"));        // the reply
  fake.ch.push(containerFrame([0xC0, 0x55, 0x10], 0.6)); // the button
  const readings = events.filter((e) => e.type === "measurement");
  assert.strictEqual(readings.length, 2);
  assert.ok(Math.abs(readings[0].metres - 2.28695) < 1e-9);
  assert.ok(Math.abs(readings[1].metres - 0.6) < 1e-6);
  assert.ok(D.frames.some((f) => f.dir === "in" && f.hex === "C0 11 00 3A"), "frames kept for debugging");

  fake.device.drop();
  assert.strictEqual(D.state(), "off", "disconnect reflected");
  await assert.rejects(D.measure(), /not connected/);
}

async function cancelled() {
  const D = loadDriver({ navigator: { bluetooth: { requestDevice: () => {
    const e = new Error("User cancelled the requestDevice() chooser."); e.name = "NotFoundError";
    return Promise.reject(e);
  } } } });
  await assert.rejects(D.connect(), (e) => e.name === "NotFoundError");
  assert.strictEqual(D.state(), "off", "back to off after the picker is closed");
}

(async () => {
  await flow(0); // newer GLM
  await flow(1); // older PLR / GLM
  await cancelled();
  console.log("laser_driver_test: ok");
})().catch((e) => { console.error(e); process.exit(1); });
