import { GateSpeedDetector, rgbaToGray, computeSpeed, scaleSpeed } from './detector.js';

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
  btnReset: $('btnReset'),
  distance: $('distance'),
  distanceUnit: $('distanceUnit'),
  orientation: $('orientation'),
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

const SETTINGS_KEY = 'toycar-speed/settings';
const RECORDS_KEY = 'toycar-speed/records';
const PROC_MAX_WIDTH = 200; // 감지용 축소 해상도 (성능 확보)
const MAX_RECORDS = 50;

const defaultSettings = {
  distance: 50,
  distanceUnit: 0.01,
  orientation: 'vertical',
  gateA: 30,
  gateB: 70,
  roiStart: 15,
  roiEnd: 85,
  sensitivity: 5,
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
function distanceMeters() {
  const v = parseFloat(el.distance.value);
  return (Number.isFinite(v) && v > 0 ? v : 50) * parseFloat(el.distanceUnit.value);
}

/** 민감도 1~10 → 픽셀 임계값 / 면적 비율 */
function sensitivityToOptions(level) {
  const t = (level - 1) / 9; // 0~1
  const onRatio = 0.14 - t * 0.12;             // 0.14 → 0.02
  return {
    pixelThreshold: Math.round(46 - t * 32),   // 46 → 14
    onRatio,
    offRatio: onRatio * 0.5,
  };
}

function applySettingsToUI() {
  el.distance.value = settings.distance;
  el.distanceUnit.value = String(settings.distanceUnit);
  el.gateA.value = settings.gateA;
  el.gateB.value = settings.gateB;
  el.roiStart.value = settings.roiStart;
  el.roiEnd.value = settings.roiEnd;
  el.sensitivity.value = settings.sensitivity;
  el.scale.value = settings.scale;
  el.sound.checked = settings.sound;
  el.vibrate.checked = settings.vibrate;
  el.showMask.checked = settings.showMask;
  for (const b of el.orientation.querySelectorAll('button')) {
    b.classList.toggle('on', b.dataset.value === settings.orientation);
  }
  syncLabels();
}

function syncLabels() {
  el.gateAVal.textContent = `${el.gateA.value}%`;
  el.gateBVal.textContent = `${el.gateB.value}%`;
  el.roiStartVal.textContent = `${el.roiStart.value}%`;
  el.roiEndVal.textContent = `${el.roiEnd.value}%`;
  el.sensitivityVal.textContent = el.sensitivity.value;
  el.scaleVal.textContent = el.scale.value;
  updateScaleLine();
}

/** 축척 환산 줄은 마지막 측정값 기준으로 다시 그린다 (설정만 바꿔도 즉시 반영). */
function updateScaleLine() {
  const scale = Number(el.scale.value);
  const show = scale > 1 && !!lastRecord;
  el.speedScale.hidden = !show;
  if (show) {
    el.speedScale.textContent = `1:${scale} 실차 환산 ${scaleSpeed(lastRecord.kmh, scale).toFixed(0)} km/h`;
  }
}

function collectSettings() {
  settings = {
    ...settings,
    distance: parseFloat(el.distance.value) || defaultSettings.distance,
    distanceUnit: parseFloat(el.distanceUnit.value),
    gateA: Number(el.gateA.value),
    gateB: Number(el.gateB.value),
    roiStart: Number(el.roiStart.value),
    roiEnd: Number(el.roiEnd.value),
    sensitivity: Number(el.sensitivity.value),
    scale: Number(el.scale.value),
    sound: el.sound.checked,
    vibrate: el.vibrate.checked,
    showMask: el.showMask.checked,
  };
  saveJSON(SETTINGS_KEY, settings);
}

function applySettingsToDetector({ reset = false } = {}) {
  detector.configure({
    orientation: settings.orientation,
    gateA: settings.gateA / 100,
    gateB: settings.gateB / 100,
    roiStart: settings.roiStart / 100,
    roiEnd: settings.roiEnd / 100,
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
    el.stageHint.innerHTML = `<p>${msg}<br>‘데모 모드’로 동작을 먼저 확인해 볼 수 있습니다.</p>`;
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
  const result = detector.update(grayBuf, pw, ph, timeMs);

  if (result.measurement) handleMeasurement(result.measurement);
  if (result.triggers.length) flashUntil = performance.now() + 180;

  drawOverlay(result);
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
}

function showSpeed(r, { flash = true } = {}) {
  el.speedValue.textContent = r.kmh.toFixed(r.kmh < 10 ? 2 : 1);
  el.speedMps.textContent = `${r.mps.toFixed(2)} m/s · ${(r.mps * 100).toFixed(0)} cm/s`;
  el.speedTolerance.textContent = r.tolerance > 0 ? `± ${r.tolerance.toFixed(2)} km/h` : '';
  el.speedDt.textContent = `${r.dtMs.toFixed(1)} ms · ${r.direction === 'AB' ? 'A→B' : 'B→A'}`;
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
  const best = Math.max(...records.map((r) => r.kmh));
  const avg = records.reduce((a, r) => a + r.kmh, 0) / records.length;
  el.bestSpeed.textContent = `${best.toFixed(1)}`;
  el.avgSpeed.textContent = `${avg.toFixed(1)}`;
  el.lastSpeed.textContent = `${records[0].kmh.toFixed(1)}`;

  el.records.innerHTML = records
    .map((r, i) => {
      const time = new Date(r.at).toLocaleTimeString('ko-KR', { hour12: false });
      return `<li>
        <span class="idx">${i + 1}</span>
        <span class="spd">${r.kmh.toFixed(2)} km/h</span>
        <span>${r.mps.toFixed(2)} m/s</span>
        <span class="meta">${r.dtMs.toFixed(0)}ms · ${r.direction === 'AB' ? 'A→B' : 'B→A'} · ${time}</span>
      </li>`;
    })
    .join('');
}

function recordsToCsv() {
  const header = '측정시각,속도(km/h),속도(m/s),통과시간(ms),거리(m),방향';
  const rows = records.map((r) =>
    [new Date(r.at).toISOString(), r.kmh.toFixed(3), r.mps.toFixed(3), r.dtMs.toFixed(1), r.distance, r.direction].join(','),
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

  for (const g of gates) {
    const hot = g.ratio >= onRatio;
    const color = hot ? '#35d07f' : 'rgba(255,255,255,0.85)';
    octx.lineWidth = hot ? 6 : 3;
    octx.strokeStyle = color;
    octx.setLineDash([]);
    octx.beginPath();
    if (vertical) {
      const x = g.pos * W;
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

for (const input of [el.gateA, el.gateB, el.roiStart, el.roiEnd, el.sensitivity, el.scale]) {
  input.addEventListener('input', () => onSettingChanged({ resetDetector: input === el.sensitivity }));
}
for (const input of [el.distance, el.distanceUnit, el.sound, el.vibrate, el.showMask]) {
  input.addEventListener('change', () => onSettingChanged());
}

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
if (lastRecord) showSpeed(lastRecord, { flash: false }); // 지난 측정값 복원
drawOverlay();
setStatus('‘카메라 시작’을 눌러 주세요');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 캐시는 선택 사항 */ });
  });
}
