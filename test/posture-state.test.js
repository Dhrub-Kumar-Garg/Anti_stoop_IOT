const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assess } = require('../public/posture-state');
const { normalizePacket } = require('../server');
const packet = { flex1: 173, flex2: 500, baseline1: 173, baseline2: 500, threshold: 100, alert_active: false };

test('live margin changes immediately with deviation from baseline', () => {
  assert.equal(assess(packet).margin, 100);
  assert.equal(assess({ ...packet, flex1: 135 }).margin, 62);
  assert.equal(assess({ ...packet, flex1: 223 }).margin, 50);
  assert.equal(assess({ ...packet, flex1: 273 }).margin, 0);
});
test('crossing either sensor threshold triggers a warning before delayed hardware alert', () => {
  assert.equal(assess({ ...packet, flex1: 274 }).warning, true);
  assert.equal(assess({ ...packet, flex1: 72 }).warning, true);
  assert.equal(assess({ ...packet, flex2: 601 }).warning, true);
  assert.equal(assess({ ...packet, flex2: 399 }).warning, true);
  assert.equal(assess({ ...packet, flex1: 273 }).warning, false);
  assert.equal(assess({ ...packet, flex1: 100, flex2: 500 }).warning, false);
});
test('legacy alerts work without fabricating a live percentage or baseline', () => {
  const legacy = assess({ flex1: 4095, flex2: 4095, alert_active: false });
  assert.equal(legacy.margin, null); assert.equal(legacy.warning, false);
  assert.equal(assess({ flex1: 1, flex2: 1, alert_active: true }).deviceAlert, true);
});
test('calibration suppresses alerts and undefined margins', () => {
  const state = assess({ ...packet, flex1: 4000, calibrating: true, alert_active: true });
  assert.equal(state.warning, false); assert.equal(state.margin, null);
});
test('server preserves calibration and motor metadata required by the UI', () => {
  const data = normalizePacket({ ...packet, calibrating: true, calibration_id: 7, motor_test: false, motor_active: false, alert_delay_ms: 1000 });
  assert.equal(data.calibrating, true); assert.equal(data.calibration_id, 7);
  assert.equal(data.motor_active, false); assert.equal(data.motor_test, false);
  assert.equal(data.alert_delay_ms, 1000);
});

test('server preserves source provenance and excludes unavailable channels from bending', () => {
  const input = { ...packet, flex1: 0, flex1_ready: false, flex2_ready: true, source1: 'flex', source2: 'pot', raw_flex1: 0, raw_flex2: 0, pot_value: 500 };
  const data = normalizePacket(input);
  assert.equal(data.bending, false); assert.equal(data.source2, 'pot');
  assert.equal(data.raw_flex2, 0); assert.equal(data.pot_value, 500);
  assert.equal(assess(data).margin, 100);
  assert.equal(normalizePacket({ ...packet, source1: 'arbitrary value' }).source1, undefined);
});
