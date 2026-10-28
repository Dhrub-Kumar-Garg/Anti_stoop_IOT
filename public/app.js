'use strict';
const $ = id => document.getElementById(id);
const socket = io({ reconnection: true });
let connected = false;
let hardware = false;
let demo = false;
let latest = null;
let lastArrival = 0;
let sessionSource = null;
let history = [];
let samples = [];
let previous = null;
let trackedMs = 0;
let alertFreeMs = 0;
let streakMs = 0;
let bestMs = 0;
let alerts = 0;
let snoozedUntil = 0;
let soundEnabled = false;
let audio = null;
let noticeTimeout;
let stretchEnd = null;
let stretchInterval = null;
const duration = ms => {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const fresh = () => connected && latest && performance.now() - lastArrival < 5000 && (demo || hardware);
const hasBaseline = data => Number.isFinite(data?.baseline1) && Number.isFinite(data?.baseline2);
const alertFree = data => !data.alert_active && !data.calibrating;

$('dateLabel').textContent = new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
$('wsEndpoint').textContent = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/`;
function notify(message) {
  $('notification').textContent = message;
  $('notification').hidden = false;
  clearTimeout(noticeTimeout);
  noticeTimeout = setTimeout(() => { $('notification').hidden = true; }, 5500);
}
function navigate() {
  const name = location.hash.slice(1);
  const page = ['dashboard', 'insights', 'stretches', 'settings'].includes(name) ? name : 'dashboard';
  document.querySelectorAll('.page').forEach(el => { el.hidden = el.id !== page; });
  document.querySelectorAll('[data-page]').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
    if (el.dataset.page === page) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  $('pageLabel').textContent = { dashboard: 'Overview', insights: 'Session insights', stretches: 'Mindful breaks', settings: 'Device & settings' }[page];
  if (page === 'dashboard') requestAnimationFrame(drawChart);
}
window.addEventListener('hashchange', navigate);
navigate();

function clearSession() {
  trackedMs = alertFreeMs = streakMs = bestMs = alerts = 0;
  history = [];
  samples = [];
  previous = null;
  renderMetrics();
  drawChart();
}
function renderMetrics() {
  const ratio = trackedMs > 0 ? Math.round(alertFreeMs / trackedMs * 100) : null;
  const margin = fresh() ? PostureState.assess(latest).margin : null;
  $('uprightValue').innerHTML = `${margin ?? '—'}<small>%</small>`;
  $('uprightProgress').style.width = `${margin ?? 0}%`;
  $('uprightCaption').textContent = latest?.calibrating ? 'Capturing your neutral posture…'
    : latest && !hasBaseline(latest) ? 'Requires baseline telemetry from the updated sketch'
    : latest && (latest.flex1_ready === false || latest.flex2_ready === false) ? 'Waiting for input · available channels only'
    : '100% at baseline · 0% at threshold';
  $('streakValue').innerHTML = `${trackedMs ? Math.floor(streakMs / 60000) : '—'}<small>min</small>`;
  $('bestStreak').textContent = duration(bestMs);
  $('sessionTime').textContent = duration(trackedMs);
  $('insightTime').textContent = duration(trackedMs);
  $('insightBest').textContent = duration(bestMs);
  $('alertCount').textContent = alerts;
  $('sessionSource').textContent = sessionSource === 'demo' ? 'DEMO SESSION' : 'THIS SESSION';
  $('insightSummary').textContent = trackedMs ? `${sessionSource === 'demo' ? 'Demo' : 'Vest'} session · ${duration(trackedMs)} tracked · ${ratio === null ? 'waiting for readings' : `${ratio}% of observed time without alerts`} · ${alerts} reminders.` : 'Start a live or demo session to see your progress here.';
  $('exportBtn').disabled = samples.length === 0;
}
function chime() {
  if (!soundEnabled || !audio || audio.state !== 'running') return;
  const oscillator = audio.createOscillator();
  const gain = audio.createGain();
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0.07, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 1.2);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.start(); oscillator.stop(audio.currentTime + 1.2);
  oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
}
function renderConnection() {
  const live = fresh();
  const label = !connected ? 'Reconnecting to server' : demo ? 'Demo session' : hardware ? (live ? 'ESP32 connected' : 'Waiting for readings') : 'Waiting for ESP32';
  $('sidebarStatus').textContent = label;
  $('settingsStatus').textContent = label;
  $('deviceDot').classList.toggle('muted', !live);
  $('demoBtn').textContent = demo ? '■  End demo' : '▷  Try demo';
  $('demoBtn').disabled = !connected || hardware;
  $('demoNotice').hidden = !demo;
  $('sourceBadge').innerHTML = `<span class="dot"></span>${demo ? 'Demo data' : live ? 'Live from your vest' : hardware ? 'Awaiting readings' : 'Awaiting device'}`;
  $('sourceBadge').className = `pill ${live ? 'good' : 'neutral'}`;
  $('liveDot').classList.toggle('muted', !live);
  $('sampleLabel').textContent = live ? (demo ? 'Simulated · 2 readings / sec' : 'Live sensor stream') : 'No fresh readings';
  if (!live) {
    $('postureTitle').textContent = connected ? 'A fresh start for your spine.' : 'Let’s reconnect.';
    $('postureDescription').textContent = hardware ? 'The vest is connected, but its readings are not arriving.' : 'Connect your ESP32 or explore with demo data.';
    $('postureBadge').textContent = 'Ready when you are';
    $('postureBadge').className = 'pill neutral';
    $('postureCard').classList.remove('warning');
    $('welcomeText').textContent = 'Settle in, connect your vest, and let’s find your balance.';
    $('alertToast').hidden = true;
    $('motorState').textContent = 'No fresh device status';
    $('fallbackNotice').hidden = true;
    $('upperSource').hidden = $('lowerSource').hidden = true;
    for (const key of ['upper', 'lower']) {
      $(`${key}Value`).innerHTML = '— <small>ADC</small>';
      $(`${key}Bar`).style.width = '0%';
      $(`${key}Detail`).textContent = 'Waiting for fresh readings';
    }
    document.querySelectorAll('#spineJoints > *').forEach(joint => { joint.style.transform = ''; });
  }
}
function renderPacket(data) {
  const state = PostureState.assess(data);
  const baseline = hasBaseline(data);
  const warning = state.deviceAlert;
  const bending = state.thresholdCrossed;
  $('postureCard').classList.toggle('warning', warning || bending);
  $('postureBadge').className = `pill ${warning || bending ? 'warning' : baseline ? 'good' : 'neutral'}`;
  $('postureBadge').textContent = warning ? 'Device-confirmed alert' : bending ? 'Bend threshold crossed' : baseline ? 'Comfortably aligned' : 'No posture alert';
  $('postureTitle').textContent = warning ? 'Let’s find your balance again.' : bending ? 'Come back to your center.' : baseline ? 'Looking good. Keep it comfortable.' : 'A quiet moment for your posture.';
  $('postureDescription').textContent = warning ? 'The ESP32 has confirmed a sustained bend. Check Haptic output for its reported motor-driver signal.' : bending ? 'Your calibrated threshold is crossed. The vest confirms sustained bends after its configured delay.' : baseline ? 'Both sensors are within your calibrated posture threshold.' : 'Your vest is streaming. Its posture reminder is currently inactive.';
  if (state.calibrating) {
    $('postureBadge').className = 'pill neutral';
    $('postureBadge').textContent = 'Calibrating';
    $('postureTitle').textContent = 'Hold your neutral posture.';
    $('postureDescription').textContent = 'Capturing both sensors. Wait for the confirmation pulse.';
  }
  if (!state.calibrating && !state.ready1 && !state.ready2) {
    $('postureBadge').className = 'pill neutral';
    $('postureBadge').textContent = 'Checking sensor inputs';
    $('postureTitle').textContent = 'Waiting for a usable input.';
    $('postureDescription').textContent = 'Zero-valued sensors switch to potentiometer backup after two continuous seconds. Recalibrate if a recovered sensor has no reference.';
  }
  const replacements = [];
  if (data.source1 === 'pot') replacements.push('upper');
  if (data.source2 === 'pot') replacements.push('lower');
  if (replacements.length && !state.warning && !state.calibrating) {
    $('postureBadge').textContent = 'Test input within threshold';
    $('postureTitle').textContent = 'Potentiometer backup is ready.';
    $('postureDescription').textContent = 'Live readings include a manual knob input, identified in the mustard notice.';
  }
  $('fallbackNotice').hidden = replacements.length === 0;
  $('fallbackText').textContent = replacements.length === 2
    ? 'Both flex inputs unavailable — turn the knob to control both channels.'
    : `${replacements[0] === 'upper' ? 'Upper' : 'Lower'} flex input unavailable — turn the knob for that channel.`;
  $('welcomeText').textContent = demo ? 'Explore how your posture companion responds, one little shift at a time.' : warning ? 'A gentle reset is all it takes. Your vest is here to help.' : 'A little check-in with your posture. You’re in the right place.';
  ['upper', 'lower'].forEach((key, index) => {
    const value = data[`flex${index + 1}`];
    const ready = data[`flex${index + 1}_ready`] !== false;
    const isPot = data[`source${index + 1}`] === 'pot';
    const deviation = baseline ? Math.abs(value - data[`baseline${index + 1}`]) : null;
    $(`${key}Source`).hidden = !isPot && ready;
    $(`${key}Source`).textContent = isPot ? 'POT BACKUP' : 'CHECK INPUT';
    $(`${key}Source`).className = isPot ? 'fallback-tag' : 'fallback-tag waiting';
    $(`${key}Value`).innerHTML = `${value}<small>ADC</small>`;
    $(`${key}Bar`).style.width = `${ready ? Math.min(100, (baseline ? deviation / (data.threshold * 2) : value / 4095) * 100) : 0}%`;
    const track = $(`${key}Bar`).parentElement;
    track.querySelector('i').style.display = baseline ? 'block' : 'none';
    track.querySelector('i').style.left = '50%';
    $(`${key}Detail`).textContent = !ready ? 'Input unavailable · waiting for backup or calibration' : isPot ? `Potentiometer · raw flex ${data[`raw_flex${index + 1}`] ?? '—'} · Δ ${deviation ?? '—'}` : baseline ? `Δ ${deviation} from baseline ${data[`baseline${index + 1}`]} · threshold ${data.threshold}` : 'Raw sensor reading · 0–4095 ADC';
  });
  const bend = state.baseline ? Math.min(1, state.deviation / (data.threshold * 2)) : warning ? .75 : 0;
  document.querySelectorAll('#spineJoints > *').forEach((joint, index) => {
    joint.style.transform = `translate(${bend * (6 - index) * 5}px, ${bend * (6 - index)}px)`;
  });
  $('baselineLabel').textContent = baseline ? `${data.baseline1} / ${data.baseline2} ADC${demo ? ' · demo' : ''}` : 'Set on vest · not transmitted';
  $('thresholdLabel').textContent = baseline ? `±${data.threshold} ADC from baseline` : 'Device controlled · not transmitted';
  $('delayLabel').textContent = Number.isFinite(data.alert_delay_ms) ? `${data.alert_delay_ms / 1000} seconds · device firmware` : 'Device controlled · not transmitted';
  $('motorState').textContent = data.motor_test ? 'Motor-test driver pulse'
    : data.motor_active ? 'Driver signal ON' : typeof data.motor_active === 'boolean' ? 'Driver signal OFF' : 'Not reported by firmware';
  if (bending && !warning && Number.isFinite(data.alert_delay_ms)) {
    $('postureDescription').textContent = `Threshold crossed. Hold the bend for ${data.alert_delay_ms / 1000} seconds continuously for the device alert.`;
  }
  renderAlert(data);
}
function renderAlert(data) {
  const state = PostureState.assess(data);
  $('alertTitle').textContent = state.deviceAlert ? 'Your vest’s posture alert is active.' : 'Your bend threshold is crossed.';
  $('alertDescription').textContent = state.deviceAlert
    ? 'A sustained bend was confirmed by the device. Return toward your calibrated neutral position.'
    : Number.isFinite(data.alert_delay_ms)
      ? `Threshold crossed. Hold for ${data.alert_delay_ms / 1000} seconds continuously for the device to activate the motor output.`
      : 'Threshold crossed. The motor waits for the device’s configured delay; check that the latest sketch is uploaded.';
  $('alertToast').hidden = !state.warning || Date.now() < snoozedUntil;
}
socket.on('connect', () => { connected = true; renderConnection(); });
socket.on('disconnect', () => {
  connected = false; latest = null; previous = null; streakMs = 0;
  renderConnection(); renderMetrics();
});
socket.on('hardware_status', status => {
  hardware = status.connected;
  demo = status.simulated;
  if (!hardware && !demo) { latest = null; previous = null; streakMs = 0; }
  renderConnection();
});
socket.on('sim_status', status => {
  demo = status.running;
  if (!demo) { latest = null; previous = null; streakMs = 0; }
  renderConnection();
});
socket.on('esp32_data', data => {
  const source = data.simulated ? 'demo' : 'vest';
  if (source !== sessionSource) { sessionSource = source; clearSession(); }
  const now = performance.now();
  const continuous = previous && now - lastArrival < 5000;
  const delta = continuous && !previous.calibrating && !data.calibrating ? now - lastArrival : 0;
  trackedMs += delta;
  if (continuous) {
    if (alertFree(previous)) { alertFreeMs += delta; streakMs += delta; bestMs = Math.max(bestMs, streakMs); }
    else streakMs = 0;
  }
  if (!continuous || !alertFree(data)) streakMs = 0;
  if (data.alert_active && !previous?.alert_active) alerts++;
  if (PostureState.assess(data).warning && (!continuous || !PostureState.assess(previous).warning) && Date.now() >= snoozedUntil) chime();
  lastArrival = now;
  latest = data;
  previous = data;
  demo = Boolean(data.simulated);
  if (!demo) hardware = true;
  const sample = { ...data, browser_time: Date.now() };
  // Downsample storage and drawing to at most 2 Hz, independent of the ESP32's frame rate.
  if (!samples.length || sample.browser_time - samples.at(-1).browser_time >= 450) {
    samples.push(sample);
    if (samples.length > 3600) samples.shift();
    history.push(sample);
    history = history.filter(point => sample.browser_time - point.browser_time <= 60000);
    drawChart();
  }
  renderPacket(data); renderConnection(); renderMetrics();
});
$('demoBtn').addEventListener('click', () => {
  socket.timeout(4000).emit('toggle_simulation', !demo, (error, result) => {
    if (error || !result?.ok) notify(result?.message || 'Server did not respond. Please reconnect.');
  });
});
$('snoozeBtn').addEventListener('click', () => {
  snoozedUntil = Date.now() + 60000; $('alertToast').hidden = true;
  notify('Browser reminders snoozed for one minute.');
});
$('soundToggle').addEventListener('change', async event => {
  soundEnabled = event.target.checked;
  if (soundEnabled) {
    try { audio ??= new (window.AudioContext || window.webkitAudioContext)(); await audio.resume(); }
    catch { soundEnabled = false; event.target.checked = false; notify('Audio is unavailable in this browser.'); }
  }
});
$('resetSession').addEventListener('click', () => { clearSession(); notify('Session metrics reset.'); });
$('exportBtn').addEventListener('click', () => {
  if (!samples.length) return;
  const columns = ['browser_time', 'received_at', 'simulated', 'flex1', 'flex2', 'baseline1', 'baseline2', 'threshold', 'bending', 'alert_active', 'raw_flex1', 'raw_flex2', 'pot_value', 'source1', 'source2', 'flex1_ready', 'flex2_ready'];
  const csv = [columns.join(','), ...samples.map(row => columns.map(key => row[key] ?? '').join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = `posturepal-${sessionSource}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function drawChart() {
  const canvas = $('historyChart');
  const width = canvas.clientWidth, height = canvas.clientHeight;
  if (!width || !height) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
  const left = 34, right = width - 8, bottom = height - 10;
  ctx.font = '8px -apple-system, sans-serif';
  for (let tick = 0; tick <= 4; tick++) {
    const y = 8 + (bottom - 8) * (1 - tick / 4);
    ctx.strokeStyle = '#eef1e9'; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
    ctx.fillStyle = '#839079'; ctx.fillText(String(Math.round(tick * 4095 / 4)), 0, y + 3);
  }
  ctx.setLineDash([]);
  const now = Date.now();
  const visible = history.filter(point => now - point.browser_time <= 60000);
  $('chartEmpty').hidden = visible.length > 0;
  for (const [key, color] of [['flex1', '#94b485'], ['flex2', '#b2a0ca']]) {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    visible.forEach((point, index) => {
      const x = left + (1 - (now - point.browser_time) / 60000) * (right - left);
      const y = bottom - point[key] / 4095 * (bottom - 8);
      if (!index || point.browser_time - visible[index - 1].browser_time >= 5000) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
}
new ResizeObserver(drawChart).observe($('historyChart').parentElement);
setInterval(() => {
  if (!fresh()) { previous = null; streakMs = 0; renderConnection(); renderMetrics(); }
  else renderAlert(latest);
  drawChart();
}, 1000);

function updateStretch() {
  const remaining = Math.max(0, stretchEnd - Date.now());
  const elapsed = 60 - Math.ceil(remaining / 1000);
  $('stretchTimer').textContent = duration(Math.ceil(remaining / 1000) * 1000);
  const stages = [
    ['Let your shoulders settle.', 'Release your shoulders away from your ears. Breathe slowly.'],
    ['Make a little room.', 'Gently roll your shoulders back, within a comfortable range.'],
    ['Find your center.', 'Return to a relaxed upright position. Take a few easy breaths.'],
  ];
  const stage = stages[Math.min(2, Math.floor(elapsed / 20))];
  $('stretchTitle').textContent = stage[0]; $('stretchInstruction').textContent = stage[1];
  if (!remaining) {
    clearInterval(stretchInterval); stretchEnd = null;
    $('stretchTitle').textContent = 'A little reset. A fresh perspective.';
    $('stretchInstruction').textContent = 'Your mindful minute is complete. Return at your own pace.';
    $('stretchBtn').textContent = 'Take another mindful break';
  }
}
$('stretchBtn').addEventListener('click', () => {
  if (stretchEnd) {
    clearInterval(stretchInterval); stretchEnd = null;
    $('stretchTimer').textContent = '01:00'; $('stretchBtn').textContent = 'Begin mindful break';
    $('stretchTitle').textContent = 'Let your shoulders settle.';
    $('stretchInstruction').textContent = 'Move gently within a comfortable range. Stop if you feel discomfort.';
  } else {
    stretchEnd = Date.now() + 60000; $('stretchBtn').textContent = 'End break';
    updateStretch(); stretchInterval = setInterval(updateStretch, 250);
  }
});
$('quickStretch').addEventListener('click', () => {
  location.hash = 'stretches'; if (!stretchEnd) $('stretchBtn').click();
});
renderConnection(); renderMetrics();
