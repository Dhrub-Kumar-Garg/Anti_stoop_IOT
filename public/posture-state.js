/* Shared assessment for the dashboard and its tests. Values are ADC margins, not angles. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PostureState = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function assess(data) {
    const ready1 = data?.flex1_ready !== false;
    const ready2 = data?.flex2_ready !== false;
    const baseline = (ready1 || ready2) && Boolean(data && Number.isFinite(data.baseline1) && Number.isFinite(data.baseline2)
      && Number.isFinite(data.threshold) && data.threshold > 0);
    const calibrating = data?.calibrating === true;
    const deviation = baseline ? Math.max(ready1 ? Math.abs(data.flex1 - data.baseline1) : 0, ready2 ? Math.abs(data.flex2 - data.baseline2) : 0) : null;
    const thresholdCrossed = !calibrating && baseline && deviation > data.threshold;
    const deviceAlert = !calibrating && data?.alert_active === true;
    return {
      baseline, calibrating, ready1, ready2, deviation, thresholdCrossed, deviceAlert,
      warning: thresholdCrossed || deviceAlert,
      margin: baseline && !calibrating ? Math.round(Math.max(0, Math.min(100, 1 - deviation / data.threshold)) * 100) : null,
    };
  }
  return { assess };
});
