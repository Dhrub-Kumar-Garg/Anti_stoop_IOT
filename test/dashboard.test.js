const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const PostureState = require('../public/posture-state');

function dashboard() {
  let now = 0;
  const elements = new Map(), handlers = {}, intervals = [];
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, { id, textContent: '', innerHTML: '', hidden: false, style: {}, clientWidth: 0, clientHeight: 0,
        classList: { toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); }, remove(name) { classes.delete(name); }, contains(name) { return classes.has(name); } },
        events: {}, addEventListener(name, callback) { this.events[name] = callback; }, parentElement: { querySelector: () => ({ style: {} }) } });
    }
    return elements.get(id);
  };
  const socket = { on(name, callback) { handlers[name] = callback; } };
  const context = vm.createContext({
    document: { getElementById: element, querySelectorAll: () => [] },
    window: { addEventListener() {} }, location: { hash: '', protocol: 'http:', host: 'localhost' },
    io: () => socket, PostureState, performance: { now: () => now }, Date,
    requestAnimationFrame() {}, ResizeObserver: class { observe() {} },
    setInterval(callback) { intervals.push(callback); }, setTimeout() {}, clearInterval() {}, clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync(require.resolve('../public/app'), 'utf8'), context);
  handlers.connect();
  return { element, handlers, packet(data) { now += 100; handlers.esp32_data({ ...data, simulated: false }); }, tick() { now += 1000; intervals.forEach(fn => fn()); } };
}
const base = { flex1: 173, flex2: 500, baseline1: 173, baseline2: 500, threshold: 100, alert_active: false };

test('actual dashboard updates percentage, warns immediately, and keeps warning across timer ticks', () => {
  const ui = dashboard();
  ui.packet(base); assert.equal(ui.element('uprightValue').innerHTML, '100<small>%</small>');
  ui.packet({ ...base, flex1: 135 }); assert.equal(ui.element('uprightValue').innerHTML, '62<small>%</small>');
  ui.packet({ ...base, flex1: 72 });
  assert.equal(ui.element('uprightValue').innerHTML, '0<small>%</small>');
  assert.equal(ui.element('alertToast').hidden, false);
  assert.match(ui.element('alertTitle').textContent, /threshold/);
  ui.tick(); assert.equal(ui.element('alertToast').hidden, false);
  ui.packet({ ...base, flex1: 72, alert_active: true });
  assert.match(ui.element('alertTitle').textContent, /posture alert/);
  assert.equal(ui.element('alertCount').textContent, 1);
  ui.packet(base); assert.equal(ui.element('alertToast').hidden, true);
  assert.equal(ui.element('uprightValue').innerHTML, '100<small>%</small>');
});
test('snooze hides only popup; live margin and warning card still show the bend', () => {
  const ui = dashboard(); ui.packet({ ...base, flex1: 72 });
  ui.element('snoozeBtn').events.click(); ui.tick();
  assert.equal(ui.element('alertToast').hidden, true);
  assert.equal(ui.element('uprightValue').innerHTML, '0<small>%</small>');
  assert.equal(ui.element('postureCard').classList.contains('warning'), true);
});
test('calibration and disconnect do not leave a stale live percentage or alert', () => {
  const ui = dashboard(); ui.packet({ ...base, flex1: 72 });
  ui.packet({ ...base, flex1: 72, calibrating: true });
  assert.equal(ui.element('alertToast').hidden, true);
  assert.equal(ui.element('uprightValue').innerHTML, '—<small>%</small>');
  ui.packet({ ...base, alert_active: true }); ui.handlers.disconnect();
  assert.equal(ui.element('alertToast').hidden, true);
  assert.equal(ui.element('uprightValue').innerHTML, '—<small>%</small>');
});
