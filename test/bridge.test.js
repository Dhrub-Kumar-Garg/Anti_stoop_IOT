const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');
const { createBridge, normalizePacket } = require('../server');

const frame = (ws, predicate) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for frame')); }, 4000);
  const listener = data => {
    const value = data.toString();
    if (value === '2') ws.send('3');
    if (predicate(value)) { cleanup(); resolve(value); }
  };
  function cleanup() { clearTimeout(timeout); ws.off('message', listener); }
  ws.on('message', listener);
});
const event = (ws, name) => frame(ws, value => value.startsWith('42') && JSON.parse(value.slice(2))[0] === name).then(value => JSON.parse(value.slice(2))[1]);

async function setup(t) {
  const bridge = createBridge();
  await new Promise(resolve => bridge.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${bridge.server.address().port}`;
  const sockets = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); await bridge.close(); });
  async function connect(endpoint) {
    const ws = new WebSocket(base.replace('http', 'ws') + endpoint);
    sockets.push(ws);
    await once(ws, 'open');
    return ws;
  }
  async function browser() {
    const ws = new WebSocket(base.replace('http', 'ws') + '/socket.io/?EIO=4&transport=websocket');
    sockets.push(ws);
    await frame(ws, value => value.startsWith('0'));
    const ready = frame(ws, value => value.startsWith('40'));
    ws.send('40'); await ready;
    return ws;
  }
  return { base, connect, browser };
}

test('validates ADC telemetry and preserves legacy firmware compatibility', () => {
  assert.equal(normalizePacket({ flex1: 4096, flex2: 1, alert_active: false }), null);
  assert.equal(normalizePacket({ flex1: '10', flex2: 1, alert_active: false }), null);
  assert.equal(normalizePacket({ flex1: 10, flex2: 1, alert_active: 'false' }), null);
  assert.deepEqual(normalizePacket({ flex1: 2000, flex2: 2100, alert_active: false }), { flex1: 2000, flex2: 2100, alert_active: false });
  assert.equal(normalizePacket({ flex1: 2600, flex2: 1900, baseline1: 1800, baseline2: 1900, threshold: 500, alert_active: false }).bending, true);
});

test('serves public assets without exposing firmware or repository files', async t => {
  const { base } = await setup(t);
  for (const path of ['/', '/app.js', '/styles.css', '/serene.css', '/socket.io/socket.io.js', '/api/status']) {
    assert.equal((await fetch(base + path)).status, 200, path);
  }
  for (const path of ['/server.js', '/package.json', '/espcode/espcode.ino', '/.git/config']) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
});

test('bridges original firmware on /, preserves its alert decisions, and never commands the vest', async t => {
  const { base, connect, browser } = await setup(t);
  const ui = await browser();
  const vest = await connect('/');
  // High absolute ADC values do not imply bending: only the firmware knows its baseline.
  const payload = { flex1: 3500, flex2: 3900, alert_active: false };
  const received = event(ui, 'esp32_data');
  vest.send(JSON.stringify(payload));
  const packet = await received;
  assert.equal(packet.flex1, 3500); assert.equal(packet.simulated, false);
  assert.equal(packet.alert_active, false); assert.equal(packet.bending, undefined);
  for (const active of [true, false]) {
    const next = event(ui, 'esp32_data');
    vest.send(JSON.stringify({ flex1: 100, flex2: 200, alert_active: active }));
    assert.equal((await next).alert_active, active);
  }
  let deviceCommands = 0;
  vest.on('message', () => { deviceCommands++; });
  ui.send('42["calibrate"]');
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(deviceCommands, 0, 'Browser must not alter original device behavior');
  const competitor = new WebSocket(base.replace('http', 'ws') + '/');
  const closed = once(competitor, 'close');
  assert.equal((await closed)[0], 1008);
  assert.equal((await (await fetch(base + '/api/status')).json()).connected, true);
  const disconnected = event(ui, 'hardware_status');
  vest.close();
  assert.equal((await disconnected).connected, false);
});

test('keeps demo mode synchronized and yields immediately to real hardware', async t => {
  const { base, connect, browser } = await setup(t);
  const ui = await browser();
  const demoPacket = event(ui, 'esp32_data');
  ui.send('42["toggle_simulation",true]');
  assert.equal((await demoPacket).simulated, true);
  const ui2 = await browser();
  const secondPacket = event(ui2, 'esp32_data');
  assert.equal((await secondPacket).simulated, true);
  const stopped = event(ui, 'sim_status');
  await connect('/');
  assert.equal((await stopped).running, false);
  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(status.connected, true); assert.equal(status.simulated, false);
  const ack = frame(ui, value => value.startsWith('438'));
  ui.send('428["toggle_simulation",true]');
  assert.equal(JSON.parse((await ack).slice(3))[0].ok, false);
});

test('marks connected devices with stalled telemetry as stale', async t => {
  const { base, connect } = await setup(t);
  const vest = await connect('/esp32');
  vest.send(JSON.stringify({ flex1: 1700, flex2: 1800, alert_active: false }));
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal((await (await fetch(base + '/api/status')).json()).fresh, true);
  await new Promise(resolve => setTimeout(resolve, 5050));
  const status = await (await fetch(base + '/api/status')).json();
  assert.equal(status.connected, true); assert.equal(status.fresh, false);
});
