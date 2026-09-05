import { GateSpeedDetector, rgbaToGray, computeSpeed, scaleSpeed } from './detector.js';
import { MotionTracker, passToSpeed } from './tracker.js';

const $ = (id) => document.getElementById(id);

const el = {
  status: $('status'),
  stage: $('stage'),
  stageHint: $('stageHint'),
  video: $('video'),
  demo: $('demo'),
  overlay: $('overlay'),
  readout: $('readout'),
  speedValue: $('speedValue'),
  speedMps: $('speedMps'),
  speedTolerance: $('speedTolerance'),
  speedDt: $('speedDt'),
  speedScale: $('speedScale'),
  btnCamera: $('btnCamera'),
  btnFlip: $('btnFlip'),
  btnDemo: $('btnDemo'),
  btnCalibrate: $('btnCalibrate'),
  btnReset: $('btnReset'),
  distance: $('distance'),
  distanceUnit: $('distanceUnit'),
  orientation: $('orientation'),
  mode: $('mode'),
  modeHint: $('modeHint'),
  viewWidth: $('viewWidth'),
  viewWidthUnit: $('viewWidthUnit'),
  labA: $('labA'),
  labB: $('labB'),
  labThr: $('labThr'),
  labPeak: $('labPeak'),
  unit: document.querySelector('.speed-main .unit'),
  version: $('version'),
  gateA: $('gateA'),
  gateB: $('gateB'),
  gateAVal: $('gateAVal'),
  gateBVal: $('gateBVal'),
  roiStart: $('roiStart'),
  roiEnd: $('roiEnd'),
  roiStartVal: $('roiStartVal'),
  roiEndVal: $('roiEndVal'),
  sensitivity: $('sensitivity'),
  sensitivityVal: $('sensitivityVal'),
  bandWidth: $('bandWidth'),
  bandWidthVal: $('bandWidthVal'),
  sigA: $('sigA'),
  sigB: $('sigB'),
  barA: $('barA'),
  barB: $('barB'),
  sigThr: $('sigThr'),
  sigPeak: $('sigPeak'),
  signalHint: $('signalHint'),
  scale: $('scale'),
  scaleVal: $('scaleVal'),
  sound: $('sound'),
  vibrate: $('vibrate'),
  showMask: $('showMask'),
  records: $('records'),
  recordCount: $('recordCount'),
  bestSpeed: $('bestSpeed'),
  avgSpeed: $('avgSpeed'),
  lastSpeed: $('lastSpeed'),
  btnCopy: $('btnCopy'),
  btnClear: $('btnClear'),
};

/** 화면 아래에 표시되는 버전. 올릴 때 sw.js 의 VERSION 도 같이 올린다. */
const APP_VERSION = 'v5 · 손떨림 보정';
const SETTINGS_KEY = 'toycar-speed/settings-v2';
const RECORDS_KEY = 'toycar-speed/records';
const PROC_MAX_WIDTH = 200; // 감지용 축소 해상도 (성능 확보)
const MAX_RECORDS = 50;

const defaultSettings = {
  mode: 'auto',
  viewWidth: 0,
  viewWidthUnit: 0.01,
  distance: 50,
  distanceUnit: 0.01,
  orientation: 'vertical',
  gateA: 30,
  gateB: 70,
  roiStart: 15,
  roiEnd: 85,
  sensitivity: 12,
  bandWidth: 3,
  scale: 1,
  sound: true,
  vibrate: true,
  showMask: false,
  facingMode: 'environment',
};

let settings = loadJSON(SETTINGS_KEY, defaultSettings);
settings = { ...defaultSettings, ...settings };
let records = loadJSON(RECORDS_KEY, []);
let lastRecord = records[0] || null;

const detector = new GateSpeedDetector();
const tracker = new MotionTracker();
const procCanvas = document.createElement('canvas');
const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });
const octx = el.overlay.getContext('2d');

let stream = null;
let source = null;       // 처리 대상: <video> 또는 데모 캔버스
let mode = 'idle';       // 'idle' | 'camera' | 'demo'
let grayBuf = null;
let rafId = 0;
let running = false;
let frameTimes = [];
let framePeriodMs = 1000 / 30;
let flashUntil = 0;
let lastGray = null;
let calib = null;
const signal = { peaks: [], lastRender: 0, bothHotSince: 0, holdUntil: 0 };
let wakeLock = null;
let audioCtx = null;

/* ---------------- 저장소 ---------------- */
function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* 저장 실패는 무시 */ }
}

/* ---------------- 설정 ---------------- */
/** 화면 가로 실제 길이(m). 0이면 상대 속도만 낸다. */
function viewWidthMeters() {
  const v = parseFloat(el.viewWidth.value);
  return Number.isFinite(v) && v > 0 ? v * parseFloat(el.viewWidthUnit.value) : 0;
}

function distanceMeters() {
  const v = parseFloat(el.distance.value);
  return (Number.isFinite(v) && v > 0 ? v : 50) * parseFloat(el.distanceUnit.value);
}

const SENSITIVITY_MAX = 20;
const ON_RATIO_MIN = 0.25;   // 민감도 1 (큰 물체만)
const ON_RATIO_MAX = 0.005;  // 민감도 20 (아주 작은 물체까지)

/**
 * 민감도 1~20 → 픽셀 임계값 / 면적 비율.
 * 화면에서 자동차가 차지하는 비율은 거리에 따라 수십 배까지 차이가 나므로
 * 임계 비율은 로그 스케일로 훑는다.
 */
function sensitivityToOptions(level) {
  const t = (level - 1) / (SENSITIVITY_MAX - 1); // 0~1
  const onRatio = ON_RATIO_MIN * Math.pow(ON_RATIO_MAX / ON_RATIO_MIN, t);
  return {
    pixelThreshold: Math.round(46 - t * 32),     // 46 → 14
    onRatio,
    offRatio: onRatio * 0.5,
  };
}

/** 민감도 1~20 → 자동 추적에서 "움직임"으로 인정할 최소 면적 비율 */
function sensitivityToTrackerOptions(level) {
  const t = (level - 1) / (SENSITIVITY_MAX - 1);
  return {
    pixelThreshold: Math.round(46 - t * 32),
    minPixelRatio: 0.008 * Math.pow(0.0004 / 0.008, t), // 0.8% → 0.04%
  };
}

/** 목표 임계 비율에 가장 가까운 민감도 단계를 찾는다 (자동 맞춤용). */
function ratioToSensitivity(targetRatio) {
  let best = 1;
  let bestErr = Infinity;
  for (let lv = 1; lv <= SENSITIVITY_MAX; lv++) {
    const err = Math.abs(sensitivityToOptions(lv).onRatio - targetRatio);
    if (err < bestErr) { bestErr = err; best = lv; }
  }
  return best;
}

function applySettingsToUI() {
  el.viewWidth.value = settings.viewWidth || '';
  el.viewWidthUnit.value = String(settings.viewWidthUnit);
  el.distance.value = settings.distance;
  el.distanceUnit.value = String(settings.distanceUnit);
  el.gateA.value = settings.gateA;
  el.gateB.value = settings.gateB;
  el.roiStart.value = settings.roiStart;
  el.roiEnd.value = settings.roiEnd;
  el.sensitivity.value = settings.sensitivity;
  el.bandWidth.value = settings.bandWidth;
  el.scale.value = settings.scale;
  el.sound.checked = settings.sound;
  el.vibrate.checked = settings.vibrate;
  el.showMask.checked = settings.showMask;
  for (const b of el.orientation.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.value === settings.orientation);
  }
  for (const b of el.mode.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.value === settings.mode);
  }
  applyModeToUI();
  syncLabels();
}

function syncLabels() {
  el.gateAVal.textContent = `${el.gateA.value}%`;
  el.gateBVal.textContent = `${el.gateB.value}%`;
  el.roiStartVal.textContent = `${el.roiStart.value}%`;
  el.roiEndVal.textContent = `${el.roiEnd.value}%`;
  el.sensitivityVal.textContent = el.sensitivity.value;
  el.bandWidthVal.textContent = `${el.bandWidth.value}%`;
  el.scaleVal.textContent = el.scale.value;
  el.sigThr.textContent = pct(sensitivityToOptions(Number(el.sensitivity.value)).onRatio);
  updateScaleLine();
  if (!lastRecord) {
    el.unit.textContent = settings.mode === 'auto' && !viewWidthMeters() ? '화면폭/초' : 'km/h';
  }
}

/** 축척 환산 줄은 마지막 측정값 기준으로 다시 그린다 (설정만 바꿔도 즉시 반영). */
function updateScaleLine() {
  const scale = Number(el.scale.value);
  const show = scale > 1 && !!lastRecord && lastRecord.kmh != null;
  el.speedScale.hidden = !show;
  if (show) {
    el.speedScale.textContent = `1:${scale} 실차 환산 ${scaleSpeed(lastRecord.kmh, scale).toFixed(0)} km/h`;
  }
}

/** 방식에 따라 필요 없는 설정과 계기판 라벨을 정리한다. */
function applyModeToUI() {
  const auto = settings.mode === 'auto';
  for (const node of document.querySelectorAll('.gate-only')) node.hidden = auto;
  for (const node of document.querySelectorAll('.auto-only')) node.hidden = !auto;
  el.btnCalibrate.hidden = auto;
  el.modeHint.textContent = auto
    ? '움직이는 것을 찾아 따라가며 속도를 냅니다. 맞출 것도, 넘어야 할 문턱도 없습니다.'
    : '두 기준선을 지나는 시간을 잽니다. 거리를 정확히 재면 가장 정확합니다.';
  el.labA.textContent = auto ? '움직임' : 'A';
  el.labB.textContent = auto ? '위치' : 'B';
  el.labThr.textContent = auto ? '필요' : '기준';
  el.labPeak.textContent = auto ? '최근 최대' : '최근 최대';
}

function collectSettings() {
  settings = {
    ...settings,
    viewWidth: parseFloat(el.viewWidth.value) || 0,
    viewWidthUnit: parseFloat(el.viewWidthUnit.value),
    distance: parseFloat(el.distance.value) || defaultSettings.distance,
    distanceUnit: parseFloat(el.distanceUnit.value),
    gateA: Number(el.gateA.value),
    gateB: Number(el.gateB.value),
    roiStart: Number(el.roiStart.value),
    roiEnd: Number(el.roiEnd.value),
    sensitivity: Number(el.sensitivity.value),
    bandWidth: Number(el.bandWidth.value),
    scale: Number(el.scale.value),
    sound: el.sound.checked,
    vibrate: el.vibrate.checked,
    showMask: el.showMask.checked,
  };
  saveJSON(SETTINGS_KEY, settings);
}

function applySettingsToDetector({ reset = false } = {}) {
  tracker.configure({
    // 게이트의 '세로선'은 자동차가 좌우로 움직인다는 뜻이다.
    axis: settings.orientation === 'vertical' ? 'horizontal' : 'vertical',
    ...sensitivityToTrackerOptions(settings.sensitivity),
  });
  if (reset) tracker.reset();
  detector.configure({
    orientation: settings.orientation,
    gateA: settings.gateA / 100,
    gateB: settings.gateB / 100,
    roiStart: settings.roiStart / 100,
    roiEnd: settings.roiEnd / 100,
    bandWidth: settings.bandWidth / 100,
    ...sensitivityToOptions(settings.sensitivity),
  });
  if (reset) detector.reset();
}

function onSettingChanged({ resetDetector = false } = {}) {
  collectSettings();
  syncLabels();
  applySettingsToDetector({ reset: resetDetector });
  drawOverlay();
}

/* ---------------- 감지 반응 표시 ---------------- */
const pct = (x) => `${(x * 100).toFixed(1)}%`;

/** 최근 3초간의 최대 반응을 추적하고, 상황에 맞는 안내를 띄운다. */
function trackSignal(ratios, timeMs, info = {}) {
  const onRatio = detector.opts.onRatio;
  const peakNow = Math.max(ratios[0], ratios[1]);
  signal.peaks.push({ t: timeMs, r: peakNow });
  while (signal.peaks.length && timeMs - signal.peaks[0].t > 3000) signal.peaks.shift();

  // 두 게이트가 동시에 오래 반응하면 화면 전체가 흔들리는 상황이다.
  const bothHot = ratios[0] >= onRatio && ratios[1] >= onRatio;
  if (bothHot) { if (!signal.bothHotSince) signal.bothHotSince = timeMs; }
  else signal.bothHotSince = 0;
  const shaking = signal.bothHotSince && timeMs - signal.bothHotSince > 1500;

  const now = performance.now();
  if (now - signal.lastRender < 120) return;
  signal.lastRender = now;

  const peak = signal.peaks.reduce((a, p) => Math.max(a, p.r), 0);
  renderSignal(ratios, peak, onRatio, shaking, info);
}

function renderSignal(ratios, peak, onRatio, shaking, info = {}) {
  const cells = [
    { box: el.sigA.parentElement, val: el.sigA, bar: el.barA, r: ratios[0] },
    { box: el.sigB.parentElement, val: el.sigB, bar: el.barB, r: ratios[1] },
  ];
  for (const c of cells) {
    c.val.textContent = pct(c.r);
    c.bar.style.width = `${Math.min(100, (c.r / onRatio) * 100)}%`;
    c.box.classList.toggle('hot', c.r >= onRatio);
  }
  el.sigThr.textContent = pct(onRatio);
  el.sigPeak.textContent = pct(peak);

  // 자동 맞춤이 남긴 안내는 잠시 그대로 둔다
  if (calib || performance.now() < signal.holdUntil) return;
  let hint = '자동차가 기준선을 지날 때 A·B 수치가 <b>기준</b>보다 커져야 측정됩니다.';
  let warn = false;
  if (info.tooShaky) {
    hint = '흔들림이 너무 커서 <b>측정을 멈췄습니다</b> — 폰을 어딘가에 기대 주세요.';
    warn = true;
  } else if (info.shake >= 1) {
    hint = `손떨림 <b>${info.shake.toFixed(1)}px</b>을 보정하며 재는 중입니다. 고정하면 더 정확합니다.`;
  } else if (shaking) {
    hint = '두 기준선이 동시에 계속 반응합니다 — <b>화면 전체가 흔들리고 있습니다.</b> 폰을 고정하세요.';
    warn = true;
  } else if (peak > 0.0005 && peak < onRatio * 0.9) {
    hint = `최대 반응이 <b>${pct(peak)}</b>로 기준 <b>${pct(onRatio)}</b>에 못 미칩니다 — <b>자동 맞춤</b>을 누르거나 민감도를 올리세요.`;
    warn = true;
  }
  el.signalHint.innerHTML = hint;
  el.signalHint.className = warn ? 'signal-hint warn' : 'signal-hint';
}

/** 자동 추적 모드의 계기판 — 얼마나 움직였고, 지금 어디를 보고 있는지 */
function trackAutoSignal(result) {
  const needed = tracker.opts.minPixelRatio;
  signal.peaks.push({ t: performance.now(), r: result.coverage });
  while (signal.peaks.length && performance.now() - signal.peaks[0].t > 3000) signal.peaks.shift();

  const now = performance.now();
  if (now - signal.lastRender < 120) return;
  signal.lastRender = now;
  const peak = signal.peaks.reduce((a, p) => Math.max(a, p.r), 0);

  el.sigA.textContent = pct(result.coverage);
  el.sigA.parentElement.classList.toggle('hot', result.coverage >= needed && !result.shaking);
  el.barA.style.width = `${Math.min(100, (result.coverage / needed) * 100)}%`;
  el.sigB.textContent = result.centroid == null ? '--' : pct(result.centroid);
  el.sigB.parentElement.classList.toggle('hot', result.tracking);
  el.barB.style.width = `${result.centroid == null ? 0 : result.centroid * 100}%`;
  el.sigThr.textContent = pct(needed);
  el.sigPeak.textContent = pct(peak);

  if (performance.now() < signal.holdUntil) return;
  let hint = '자동차를 굴리면 알아서 따라갑니다. 폰만 고정해 두세요.';
  let warn = false;
  if (result.warmingUp) {
    hint = '배경을 학습하는 중입니다 — 잠시 그대로 두세요.';
  } else if (result.shaking) {
    hint = '흔들림이 너무 커서 <b>측정을 멈췄습니다</b> — 폰을 어딘가에 기대 주세요.';
    warn = true;
  } else if (result.shake >= 1) {
    hint = `손떨림 <b>${result.shake.toFixed(1)}px</b>을 보정하며 재는 중입니다. 고정하면 더 정확합니다.`;
  } else if (result.tracking) {
    hint = '움직임을 따라가는 중…';
  } else if (peak > 0.0002 && peak < needed) {
    hint = `가장 큰 움직임이 <b>${pct(peak)}</b>로 기준 <b>${pct(needed)}</b>에 못 미칩니다 — 민감도를 올리거나 카메라를 더 가까이 두세요.`;
    warn = true;
  }
  el.signalHint.innerHTML = hint;
  el.signalHint.className = warn ? 'signal-hint warn' : 'signal-hint';
}

/** 자동 추적 화면: 지금 잡고 있는 덩어리와 지나온 자취를 보여 준다. */
function drawAutoOverlay(result) {
  resizeOverlay();
  const W = el.overlay.width;
  const H = el.overlay.height;
  octx.clearRect(0, 0, W, H);
  if (mode === 'idle') return;

  const horizontal = tracker.opts.axis === 'horizontal';
  const axisLen = horizontal ? W : H;

  // 지나온 자취
  const samples = tracker.track?.samples;
  if (samples && samples.length > 1) {
    octx.strokeStyle = 'rgba(74, 168, 255, 0.8)';
    octx.lineWidth = 3;
    octx.beginPath();
    samples.forEach((sample, i) => {
      const a = sample.p * axisLen;
      const x = horizontal ? a : W / 2;
      const y = horizontal ? H / 2 : a;
      if (i === 0) octx.moveTo(x, y);
      else octx.lineTo(x, y);
    });
    octx.stroke();
  }

  if (result.box) {
    const from = result.box.min * axisLen;
    const to = result.box.max * axisLen;
    octx.fillStyle = 'rgba(53, 208, 127, 0.18)';
    octx.strokeStyle = '#35d07f';
    octx.lineWidth = 3;
    if (horizontal) {
      octx.fillRect(from, 0, to - from, H);
      octx.strokeRect(from, 2, to - from, H - 4);
    } else {
      octx.fillRect(0, from, W, to - from);
      octx.strokeRect(2, from, W - 4, to - from);
    }
  }

  if (result.centroid != null) {
    const a = result.centroid * axisLen;
    octx.strokeStyle = '#fff';
    octx.lineWidth = 2;
    octx.beginPath();
    if (horizontal) { octx.moveTo(a, 0); octx.lineTo(a, H); }
    else { octx.moveTo(0, a); octx.lineTo(W, a); }
    octx.stroke();
  }

  if (result.warmingUp) {
    octx.fillStyle = 'rgba(0,0,0,0.55)';
    octx.fillRect(0, H / 2 - 26, W, 52);
    octx.fillStyle = '#fff';
    octx.font = `${Math.round(W / 26)}px system-ui, sans-serif`;
    octx.textAlign = 'center';
    octx.fillText('배경 학습 중… 잠시 그대로 두세요', W / 2, H / 2 + 8);
  }

  if (performance.now() < flashUntil) {
    octx.strokeStyle = '#35d07f';
    octx.lineWidth = 8;
    octx.strokeRect(4, 4, W - 8, H - 8);
  }
}

/* ---------------- 자동 맞춤 ---------------- */
const CALIBRATION_MS = 8000;

function startCalibration() {
  if (mode === 'idle') {
    setStatus('먼저 카메라를 시작한 뒤 눌러 주세요', 'warn');
    return;
  }
  calib = { endsAt: performance.now() + CALIBRATION_MS, peak: 0 };
  el.btnCalibrate.classList.add('on');
  signal.holdUntil = 0;
  el.signalHint.className = 'signal-hint warn';
  el.signalHint.innerHTML = '지금부터 <b>자동차를 두세 번</b> 기준선 위로 지나가게 하세요. 반응 크기를 보고 민감도를 맞춥니다.';
  detector.reset();
}

function updateCalibration(ratios) {
  calib.peak = Math.max(calib.peak, ratios[0], ratios[1]);
  const left = Math.max(0, calib.endsAt - performance.now());
  setStatus(`자동 맞춤 중… ${Math.ceil(left / 1000)}초`, 'warn');
  if (left <= 0) finishCalibration();
}

function finishCalibration() {
  const peak = calib.peak;
  calib = null;
  el.btnCalibrate.classList.remove('on');
  signal.holdUntil = performance.now() + 8000;
  if (peak < 0.004) {
    setStatus('반응이 거의 없었습니다', 'err');
    el.signalHint.className = 'signal-hint warn';
    el.signalHint.innerHTML =
      '자동차 움직임이 거의 잡히지 않았습니다 — <b>카메라를 더 가까이</b> 두거나, <b>감지 구간</b>을 자동차가 지나는 높이만 남도록 좁혀 보세요.';
    return;
  }
  // 최대 반응의 40% 지점을 기준으로 삼는다 (지나갈 때는 확실히 넘고, 평소에는 안 넘도록)
  const level = ratioToSensitivity(Math.max(0.004, peak * 0.4));
  el.sensitivity.value = level;
  onSettingChanged({ resetDetector: true });
  setStatus(`자동 맞춤 완료 — 민감도 ${level}`, 'ok');
  el.signalHint.className = 'signal-hint';
  el.signalHint.innerHTML = `최대 반응 <b>${pct(peak)}</b>에 맞춰 기준을 <b>${pct(sensitivityToOptions(level).onRatio)}</b>로 잡았습니다. 이제 자동차를 굴려 보세요.`;
}

/* ---------------- 상태 표시 ---------------- */
function setStatus(text, kind = '') {
  el.status.textContent = text;
  el.status.className = `status ${kind}`;
}

/* ---------------- 카메라 ---------------- */
async function startCamera() {
  stopDemo();
  setStatus('카메라 여는 중…');
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('이 브라우저는 카메라를 지원하지 않습니다.');
    }
    stopStream();
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: settings.facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60, min: 24 },
      },
      audio: false,
    });
    el.video.srcObject = stream;
    el.video.hidden = false;
    el.demo.hidden = true;
    await el.video.play();
    source = el.video;
    mode = 'camera';
    el.stageHint.hidden = true;
    el.btnCamera.textContent = '카메라 정지';
    el.btnDemo.classList.remove('on');

    const track = stream.getVideoTracks()[0];
    const fps = track?.getSettings?.().frameRate;
    if (fps) framePeriodMs = 1000 / fps;
    setStatus(fps ? `측정 중 · ${Math.round(fps)}fps` : '측정 중', 'ok');
    requestWakeLock();
    startLoop();
  } catch (err) {
    mode = 'idle';
    const name = err?.name || '';
    let msg = err?.message || '카메라를 열지 못했습니다.';
    if (name === 'NotAllowedError') msg = '카메라 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요.';
    else if (name === 'NotFoundError') msg = '사용 가능한 카메라를 찾지 못했습니다.';
    else if (!window.isSecureContext) msg = 'HTTPS(또는 localhost)에서만 카메라를 쓸 수 있습니다.';
    setStatus(msg, 'err');
    el.stageHint.hidden = false;
    const framed = window.self !== window.top
      ? '<br>이 화면이 다른 페이지 안에 들어가 있으면 카메라가 차단될 수 있습니다. <b>새 탭에서 열기</b>로 열어 보세요.'
      : '';
    el.stageHint.innerHTML = `<p>${msg}${framed}<br>‘데모 모드’로 동작을 먼저 확인해 볼 수 있습니다.</p>`;
  }
}

function stopStream() {
  if (stream) {
    for (const t of stream.getTracks()) t.stop();
    stream = null;
  }
  el.video.srcObject = null;
}

function stopCamera() {
  stopLoop();
  stopStream();
  mode = 'idle';
  source = null;
  el.btnCamera.textContent = '카메라 시작';
  el.stageHint.hidden = false;
  setStatus('정지됨');
  releaseWakeLock();
}

/* ---------------- 데모 모드 ---------------- */
const demoState = { x: -60, speed: 260, ctx: null, lastT: 0, pxPerSec: 260 };

function startDemo() {
  stopCamera();
  el.video.hidden = true;
  el.demo.hidden = false;
  demoState.ctx = el.demo.getContext('2d');
  demoState.x = -120;
  demoState.lastT = performance.now();
  source = el.demo;
  mode = 'demo';
  el.stageHint.hidden = true;
  el.btnDemo.classList.add('on');
  framePeriodMs = 1000 / 60;
  setStatus('데모 모드 (가상 자동차)', 'warn');
  startLoop();
}

function stopDemo() {
  if (mode === 'demo') {
    stopLoop();
    el.demo.hidden = true;
    el.btnDemo.classList.remove('on');
    mode = 'idle';
    source = null;
  }
}

function drawDemoFrame(now) {
  const ctx = demoState.ctx;
  const w = el.demo.width;
  const h = el.demo.height;
  const dt = Math.min(0.1, (now - demoState.lastT) / 1000);
  demoState.lastT = now;

  ctx.fillStyle = '#8d9199';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#7b7f87';
  for (let i = 0; i < 20; i++) ctx.fillRect((i * 61) % w, (i * 37) % h, 26, 14); // 바닥 무늬
  ctx.fillStyle = '#5f636b';
  ctx.fillRect(0, h * 0.72, w, 3);

  demoState.x += demoState.pxPerSec * dt;
  if (demoState.x > w + 80) {
    demoState.x = -120;
    demoState.pxPerSec = 140 + Math.random() * 420; // 매번 다른 속도
  }
  const y = h * 0.40;
  ctx.fillStyle = '#d7263d';
  ctx.fillRect(demoState.x, y, 96, 52);
  ctx.fillStyle = '#b81f33';
  ctx.fillRect(demoState.x + 18, y - 16, 54, 18);
  ctx.fillStyle = '#1b1b1b';
  ctx.fillRect(demoState.x + 12, y + 46, 22, 14);
  ctx.fillRect(demoState.x + 62, y + 46, 22, 14);
}

/* ---------------- 프레임 루프 ---------------- */
function startLoop() {
  if (running) return;
  running = true;
  frameTimes = [];
  detector.reset();
  applySettingsToDetector();
  if (mode === 'camera' && typeof el.video.requestVideoFrameCallback === 'function') {
    el.video.requestVideoFrameCallback(onVideoFrame);
  } else {
    rafId = requestAnimationFrame(onAnimationFrame);
  }
}

function stopLoop() {
  running = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function onVideoFrame(now, metadata) {
  if (!running) return;
  const t = typeof metadata?.mediaTime === 'number' ? metadata.mediaTime * 1000 : now;
  processFrame(t);
  el.video.requestVideoFrameCallback(onVideoFrame);
}

function onAnimationFrame(now) {
  if (!running) return;
  if (mode === 'demo') drawDemoFrame(now);
  processFrame(now);
  rafId = requestAnimationFrame(onAnimationFrame);
}

function sourceSize() {
  if (!source) return null;
  const w = source.videoWidth || source.width;
  const h = source.videoHeight || source.height;
  return w && h ? { w, h } : null;
}

function processFrame(timeMs) {
  const size = sourceSize();
  if (!size) return;

  el.stage.style.aspectRatio = `${size.w} / ${size.h}`;

  const pw = Math.min(PROC_MAX_WIDTH, size.w);
  const ph = Math.max(2, Math.round((pw * size.h) / size.w));
  if (procCanvas.width !== pw || procCanvas.height !== ph) {
    procCanvas.width = pw;
    procCanvas.height = ph;
    grayBuf = null;
  }

  procCtx.drawImage(source, 0, 0, pw, ph);
  const img = procCtx.getImageData(0, 0, pw, ph);
  grayBuf = rgbaToGray(img.data, grayBuf);
  lastGray = grayBuf;

  trackFramePeriod(timeMs);

  if (settings.mode === 'auto') {
    const result = tracker.update(grayBuf, pw, ph, timeMs);
    trackAutoSignal(result);
    if (result.pass) {
      handlePass(result.pass);
      flashUntil = performance.now() + 180;
    }
    drawAutoOverlay(result);
    return;
  }

  const result = detector.update(grayBuf, pw, ph, timeMs);

  if (calib) updateCalibration(result.ratios);
  trackSignal(result.ratios, timeMs, { shake: result.shake, tooShaky: result.tooShaky });

  if (result.measurement && !calib) handleMeasurement(result.measurement);
  if (result.triggers.length) flashUntil = performance.now() + 180;

  drawOverlay(result);
}

/** 자동 추적 한 건을 기록한다. 화면 가로 길이를 모르면 상대 속도만 남는다. */
function handlePass(p) {
  const viewW = viewWidthMeters();
  const abs = passToSpeed(p.fwps, viewW);
  const record = {
    kmh: abs ? abs.kmh : null,
    mps: abs ? abs.mps : null,
    fwps: p.fwps,
    dtMs: p.durationMs,
    tolerance: 0,
    direction: p.direction,
    distance: viewW,
    r2: p.r2,
    at: Date.now(),
  };
  lastRecord = record;
  records.unshift(record);
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
  saveJSON(RECORDS_KEY, records);

  showSpeed(record);
  renderRecords();
  feedback();
  setStatus(`측정됨 — 화면의 ${(p.travel * 100).toFixed(0)}% 구간, 표본 ${p.samples}개`, 'ok');
}

function trackFramePeriod(timeMs) {
  frameTimes.push(timeMs);
  if (frameTimes.length > 31) frameTimes.shift();
  if (frameTimes.length >= 8) {
    const diffs = [];
    for (let i = 1; i < frameTimes.length; i++) diffs.push(frameTimes[i] - frameTimes[i - 1]);
    diffs.sort((a, b) => a - b);
    const median = diffs[diffs.length >> 1];
    if (median > 0 && median < 500) framePeriodMs = median;
  }
}

/* ---------------- 측정 결과 ---------------- */
function handleMeasurement(m) {
  const d = distanceMeters();
  const s = computeSpeed(d, m.dtMs, framePeriodMs);
  const record = {
    kmh: s.kmh,
    mps: s.mps,
    dtMs: m.dtMs,
    tolerance: s.uncertaintyKmh,
    direction: m.direction,
    distance: d,
    at: Date.now(),
  };
  lastRecord = record;
  records.unshift(record);
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
  saveJSON(RECORDS_KEY, records);

  showSpeed(record);
  renderRecords();
  feedback();

  if (m.dtMs < framePeriodMs * 4) {
    setStatus(`측정됨 — 통과가 ${m.dtMs.toFixed(0)}ms로 너무 짧아 오차가 큽니다. 기준선 간격을 넓히세요`, 'warn');
  }
}

/** 기록 한 건을 어떻게 읽어 줄지 (절대 속도를 알면 km/h, 모르면 상대 속도) */
function speedLabel(r) {
  if (r.kmh != null) {
    return { value: r.kmh.toFixed(r.kmh < 10 ? 2 : 1), unit: 'km/h', text: `${r.kmh.toFixed(2)} km/h` };
  }
  const v = r.fwps ?? 0;
  return { value: v.toFixed(2), unit: '화면폭/초', text: `${v.toFixed(2)} 화면폭/초` };
}

function directionText(r) {
  if (r.direction === 'AB' || r.direction === 'LR') return '→';
  return '←';
}

function showSpeed(r, { flash = true } = {}) {
  const label = speedLabel(r);
  el.speedValue.textContent = label.value;
  el.unit.textContent = label.unit;
  el.speedMps.textContent = r.mps != null
    ? `${r.mps.toFixed(2)} m/s · ${(r.mps * 100).toFixed(0)} cm/s`
    : `상대 속도 — 화면 가로 길이를 넣으면 km/h로 바뀝니다`;
  el.speedTolerance.textContent = r.tolerance > 0 ? `± ${r.tolerance.toFixed(2)} km/h` : '';
  el.speedDt.textContent = `${r.dtMs.toFixed(0)} ms · ${directionText(r)}`;
  updateScaleLine();
  if (!flash) return;
  el.readout.classList.remove('flash');
  void el.readout.offsetWidth; // 애니메이션 재시작
  el.readout.classList.add('flash');
}

function feedback() {
  if (el.vibrate.checked && navigator.vibrate) navigator.vibrate(60);
  if (!el.sound.checked) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.25, audioCtx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.18);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch { /* 소리 실패는 무시 */ }
}

function renderRecords() {
  el.recordCount.textContent = String(records.length);
  if (!records.length) {
    el.records.innerHTML = '<li class="empty">아직 측정 기록이 없습니다</li>';
    el.bestSpeed.textContent = '--';
    el.avgSpeed.textContent = '--';
    el.lastSpeed.textContent = '--';
    return;
  }
  // km/h 기록과 상대 속도 기록이 섞여 있으면 최근 기록과 같은 단위끼리만 요약한다.
  const absolute = records[0].kmh != null;
  const same = records.filter((r) => (r.kmh != null) === absolute);
  const valueOf = (r) => (absolute ? r.kmh : r.fwps ?? 0);
  const best = Math.max(...same.map(valueOf));
  const avg = same.reduce((a, r) => a + valueOf(r), 0) / same.length;
  const fmt = (v) => (absolute ? v.toFixed(1) : v.toFixed(2));
  el.bestSpeed.textContent = fmt(best);
  el.avgSpeed.textContent = fmt(avg);
  el.lastSpeed.textContent = fmt(valueOf(records[0]));

  el.records.innerHTML = records
    .map((r, i) => {
      const time = new Date(r.at).toLocaleTimeString('ko-KR', { hour12: false });
      const label = speedLabel(r);
      const second = r.mps != null ? `${r.mps.toFixed(2)} m/s` : `${(r.fwps ?? 0).toFixed(2)} 화면폭/초`;
      return `<li>
        <span class="idx">${i + 1}</span>
        <span class="spd">${label.value} ${label.unit}</span>
        <span>${r.kmh != null ? second : ''}</span>
        <span class="meta">${r.dtMs.toFixed(0)}ms · ${directionText(r)} · ${time}</span>
      </li>`;
    })
    .join('');
}

function recordsToCsv() {
  const header = '측정시각,속도(km/h),속도(m/s),상대속도(화면폭/초),통과시간(ms),기준길이(m),방향';
  const rows = records.map((r) =>
    [
      new Date(r.at).toISOString(),
      r.kmh != null ? r.kmh.toFixed(3) : '',
      r.mps != null ? r.mps.toFixed(3) : '',
      (r.fwps ?? '') === '' ? '' : r.fwps.toFixed(4),
      r.dtMs.toFixed(1),
      r.distance,
      r.direction,
    ].join(','),
  );
  return [header, ...rows].join('\n');
}

/* ---------------- 오버레이 ---------------- */
function resizeOverlay() {
  const rect = el.stage.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(rect.width * dpr);
  const h = Math.round(rect.height * dpr);
  if (el.overlay.width !== w || el.overlay.height !== h) {
    el.overlay.width = w;
    el.overlay.height = h;
  }
}

function drawOverlay(result) {
  resizeOverlay();
  const W = el.overlay.width;
  const H = el.overlay.height;
  octx.clearRect(0, 0, W, H);
  if (mode === 'idle') return;

  const vertical = settings.orientation === 'vertical';
  const ratios = result?.ratios || detector.ratios;
  const onRatio = detector.opts.onRatio;
  const roiFrom = Math.min(settings.roiStart, settings.roiEnd) / 100;
  const roiTo = Math.max(settings.roiStart, settings.roiEnd) / 100;

  if (settings.showMask && lastGray && detector.bg) drawMask(W, H);

  const gates = [
    { pos: settings.gateA / 100, label: 'A', ratio: ratios[0] || 0 },
    { pos: settings.gateB / 100, label: 'B', ratio: ratios[1] || 0 },
  ];
  // 실제로 픽셀을 세는 띠를 그대로 보여 준다 (두께 설정이 눈에 보이도록).
  const bandPx = (settings.bandWidth / 100) * (vertical ? W : H);

  for (const g of gates) {
    const hot = g.ratio >= onRatio;
    const color = hot ? '#35d07f' : 'rgba(255,255,255,0.85)';
    octx.lineWidth = hot ? 6 : 3;
    octx.strokeStyle = color;
    octx.setLineDash([]);
    octx.beginPath();
    if (vertical) {
      const x = g.pos * W;
      octx.fillStyle = hot ? 'rgba(53, 208, 127, 0.22)' : 'rgba(255, 255, 255, 0.10)';
      octx.fillRect(x - bandPx / 2, roiFrom * H, bandPx, (roiTo - roiFrom) * H);
      octx.moveTo(x, roiFrom * H);
      octx.lineTo(x, roiTo * H);
      // ROI 밖은 흐리게
      octx.stroke();
      octx.setLineDash([6, 10]);
      octx.lineWidth = 1;
      octx.strokeStyle = 'rgba(255,255,255,0.25)';
      octx.beginPath();
      octx.moveTo(x, 0); octx.lineTo(x, roiFrom * H);
      octx.moveTo(x, roiTo * H); octx.lineTo(x, H);
      octx.stroke();
      drawGateLabel(g.label, x, roiFrom * H, g.ratio, onRatio, color);
    } else {
      const y = g.pos * H;
      octx.fillStyle = hot ? 'rgba(53, 208, 127, 0.22)' : 'rgba(255, 255, 255, 0.10)';
      octx.fillRect(roiFrom * W, y - bandPx / 2, (roiTo - roiFrom) * W, bandPx);
      octx.moveTo(roiFrom * W, y);
      octx.lineTo(roiTo * W, y);
      octx.stroke();
      octx.setLineDash([6, 10]);
      octx.lineWidth = 1;
      octx.strokeStyle = 'rgba(255,255,255,0.25)';
      octx.beginPath();
      octx.moveTo(0, y); octx.lineTo(roiFrom * W, y);
      octx.moveTo(roiTo * W, y); octx.lineTo(W, y);
      octx.stroke();
      drawGateLabel(g.label, roiFrom * W, y, g.ratio, onRatio, color);
    }
  }

  if (detector.isWarmingUp && mode !== 'idle') {
    octx.fillStyle = 'rgba(0,0,0,0.55)';
    octx.fillRect(0, H / 2 - 26, W, 52);
    octx.fillStyle = '#fff';
    octx.font = `${Math.round(W / 26)}px system-ui, sans-serif`;
    octx.textAlign = 'center';
    octx.fillText('배경 학습 중… 잠시 그대로 두세요', W / 2, H / 2 + 8);
  }

  if (performance.now() < flashUntil) {
    octx.strokeStyle = '#35d07f';
    octx.lineWidth = 8;
    octx.strokeRect(4, 4, W - 8, H - 8);
  }
}

function drawGateLabel(label, rawX, rawY, ratio, onRatio, color) {
  const W = el.overlay.width;
  const size = Math.max(14, Math.round(W / 24));
  const pad = size * 0.4;
  // ROI가 화면 끝에 붙어 있어도 라벨이 잘리지 않도록 안쪽으로 밀어 넣는다.
  const x = Math.min(W - size, Math.max(size, rawX));
  const y = Math.max(size * 1.6, rawY);
  octx.setLineDash([]);
  octx.fillStyle = 'rgba(0,0,0,0.55)';
  octx.fillRect(x - size, y - size - pad, size * 2, size + pad);
  octx.fillStyle = color;
  octx.font = `bold ${size}px system-ui, sans-serif`;
  octx.textAlign = 'center';
  octx.fillText(label, x, y - pad * 1.2);
  // 반응 강도 막대
  const barW = size * 1.6;
  const barH = Math.max(3, size * 0.16);
  const filled = Math.min(1, ratio / Math.max(onRatio, 0.001));
  octx.fillStyle = 'rgba(255,255,255,0.25)';
  octx.fillRect(x - barW / 2, y - pad * 0.8, barW, barH);
  octx.fillStyle = color;
  octx.fillRect(x - barW / 2, y - pad * 0.8, barW * filled, barH);
}

/** 게이트 밴드 안에서 배경과 다른 픽셀을 점으로 찍어 보여준다 (디버그용). */
function drawMask(W, H) {
  const pw = procCanvas.width;
  const ph = procCanvas.height;
  const thr = detector.opts.pixelThreshold;
  const sx = W / pw;
  const sy = H / ph;
  octx.fillStyle = 'rgba(255,80,80,0.55)';
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      const i = y * pw + x;
      const diff = lastGray[i] - detector.bg[i];
      if (diff > thr || diff < -thr) octx.fillRect(x * sx, y * sy, sx, sy);
    }
  }
}

/* ---------------- 기준선 드래그 ---------------- */
let dragging = null;

function pointerPos(evt) {
  const rect = el.stage.getBoundingClientRect();
  const nx = (evt.clientX - rect.left) / rect.width;
  const ny = (evt.clientY - rect.top) / rect.height;
  return { nx: Math.min(1, Math.max(0, nx)), ny: Math.min(1, Math.max(0, ny)) };
}

el.overlay.addEventListener('pointerdown', (evt) => {
  if (mode === 'idle') return;
  const { nx, ny } = pointerPos(evt);
  const p = (settings.orientation === 'vertical' ? nx : ny) * 100;
  const dA = Math.abs(p - settings.gateA);
  const dB = Math.abs(p - settings.gateB);
  if (Math.min(dA, dB) > 12) return; // 선에서 너무 멀면 무시
  dragging = dA <= dB ? 'gateA' : 'gateB';
  el.overlay.setPointerCapture(evt.pointerId);
  moveGate(p);
});

el.overlay.addEventListener('pointermove', (evt) => {
  if (!dragging) return;
  const { nx, ny } = pointerPos(evt);
  moveGate((settings.orientation === 'vertical' ? nx : ny) * 100);
});

const endDrag = () => { dragging = null; };
el.overlay.addEventListener('pointerup', endDrag);
el.overlay.addEventListener('pointercancel', endDrag);

function moveGate(percent) {
  const v = Math.round(Math.min(98, Math.max(2, percent)));
  if (dragging === 'gateA') el.gateA.value = v;
  else el.gateB.value = v;
  onSettingChanged();
}

/* ---------------- 화면 꺼짐 방지 ---------------- */
async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch { /* 지원 안 하면 무시 */ }
}
function releaseWakeLock() {
  try { wakeLock?.release(); } catch { /* 무시 */ }
  wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && mode === 'camera') requestWakeLock();
});

/* ---------------- 이벤트 연결 ---------------- */
el.btnCamera.addEventListener('click', () => {
  if (mode === 'camera') stopCamera();
  else startCamera();
});

el.btnFlip.addEventListener('click', () => {
  settings.facingMode = settings.facingMode === 'environment' ? 'user' : 'environment';
  saveJSON(SETTINGS_KEY, settings);
  if (mode === 'camera') startCamera();
  else setStatus(settings.facingMode === 'environment' ? '후면 카메라 선택됨' : '전면 카메라 선택됨');
});

el.btnDemo.addEventListener('click', () => {
  if (mode === 'demo') { stopDemo(); setStatus('정지됨'); el.stageHint.hidden = false; }
  else startDemo();
});

el.btnReset.addEventListener('click', () => {
  detector.reset();
  setStatus('배경을 다시 학습합니다…', 'warn');
  setTimeout(() => {
    if (mode === 'camera') setStatus('측정 중', 'ok');
    else if (mode === 'demo') setStatus('데모 모드 (가상 자동차)', 'warn');
  }, 1200);
});

el.btnCalibrate.addEventListener('click', () => {
  if (calib) finishCalibration();
  else startCalibration();
});

for (const input of [el.gateA, el.gateB, el.roiStart, el.roiEnd, el.sensitivity, el.bandWidth, el.scale]) {
  input.addEventListener('input', () =>
    onSettingChanged({ resetDetector: input === el.sensitivity || input === el.bandWidth }));
}
for (const input of [el.distance, el.distanceUnit, el.viewWidth, el.viewWidthUnit, el.sound, el.vibrate, el.showMask]) {
  input.addEventListener('change', () => onSettingChanged());
}

el.mode.addEventListener('click', (evt) => {
  const btn = evt.target.closest('button[data-value]');
  if (!btn) return;
  settings.mode = btn.dataset.value;
  for (const b of el.mode.querySelectorAll('button')) b.classList.toggle('on', b === btn);
  applyModeToUI();
  onSettingChanged({ resetDetector: true });
  signal.peaks = [];
  if (mode !== 'idle') setStatus(settings.mode === 'auto' ? '자동 추적으로 측정합니다' : '기준선 2개로 측정합니다', 'ok');
});

el.orientation.addEventListener('click', (evt) => {
  const btn = evt.target.closest('button[data-value]');
  if (!btn) return;
  settings.orientation = btn.dataset.value;
  for (const b of el.orientation.querySelectorAll('button')) b.classList.toggle('on', b === btn);
  onSettingChanged({ resetDetector: true });
});

el.btnCopy.addEventListener('click', async () => {
  if (!records.length) { setStatus('복사할 기록이 없습니다', 'warn'); return; }
  const csv = recordsToCsv();
  try {
    await navigator.clipboard.writeText(csv);
    setStatus('CSV를 클립보드에 복사했습니다', 'ok');
  } catch {
    setStatus('복사 실패 — 브라우저가 막았습니다', 'err');
  }
});

el.btnClear.addEventListener('click', () => {
  if (!records.length) return;
  if (!confirm('측정 기록을 모두 지울까요?')) return;
  records = [];
  lastRecord = null;
  saveJSON(RECORDS_KEY, records);
  renderRecords();
  updateScaleLine();
  el.speedValue.textContent = '--';
  el.speedMps.textContent = '-- m/s';
  el.speedTolerance.textContent = '';
  el.speedDt.textContent = '';
});

window.addEventListener('resize', () => drawOverlay());
window.addEventListener('orientationchange', () => setTimeout(() => drawOverlay(), 300));

/* ---------------- 시작 ---------------- */
applySettingsToUI();
applySettingsToDetector({ reset: true });
renderRecords();
el.version.textContent = APP_VERSION;
if (lastRecord) showSpeed(lastRecord, { flash: false }); // 지난 측정값 복원
drawOverlay();
setStatus('‘카메라 시작’을 눌러 주세요');

// [standalone:strip-start] 단일 파일 빌드에는 서비스 워커가 없다
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 캐시는 선택 사항 */ });
  });
  // 새 버전이 넘겨받으면 한 번만 새로고침해서 곧바로 반영한다.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}
// [standalone:strip-end]
