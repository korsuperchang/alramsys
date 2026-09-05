import test from 'node:test';
import assert from 'node:assert/strict';
import { Stabilizer, bestShift, STABILIZER_DEFAULTS } from '../js/stabilizer.js';
import { MotionTracker } from '../js/tracker.js';
import { GateSpeedDetector } from '../js/detector.js';

const { maxShift, confidenceRatio, trimRatio } = STABILIZER_DEFAULTS;
const shiftOf = (cur, prev) => bestShift(cur, prev, maxShift, confidenceRatio, trimRatio);

/** 무늬가 있는 1차원 신호 */
function textured(n, seed = 3) {
  let s = seed;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = 120 + ((s >> 16) % 60);
  }
  return out;
}

function shifted(src, by) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    const j = Math.min(src.length - 1, Math.max(0, i + by));
    out[i] = src[j];
  }
  return out;
}

test('무늬가 있으면 밀린 양을 정확히 찾는다', () => {
  const prev = textured(200);
  for (const by of [-4, -1, 0, 2, 5]) {
    assert.equal(shiftOf(shifted(prev, by), prev), by, `${by}px 이동을 못 찾았다`);
  }
});

test('밋밋한 화면에서는 0을 돌려준다 (근거 없는 추정 금지)', () => {
  const flat = new Float32Array(200).fill(150);
  assert.equal(shiftOf(flat, flat), 0);
});

test('배경이 밋밋할 때 지나가는 물체를 화면 흔들림으로 착각하지 않는다', () => {
  const prev = new Float32Array(200).fill(150);
  const cur = new Float32Array(200).fill(150);
  for (let i = 40; i < 60; i++) prev[i] = 60;  // 물체가 40~60에 있다가
  for (let i = 45; i < 65; i++) cur[i] = 60;   // 45~65로 이동
  assert.equal(shiftOf(cur, prev), 0, '물체만 움직였는데 화면이 밀렸다고 판단했다');
});

test('무늬가 있으면 물체가 지나가도 화면 이동량을 찾아낸다', () => {
  const base = textured(200, 11);
  const prev = Float32Array.from(base);
  const cur = shifted(base, 3);
  for (let i = 40; i < 60; i++) prev[i] = 60;   // 지나가는 물체
  for (let i = 60; i < 80; i++) cur[i] = 60;
  assert.equal(shiftOf(cur, prev), 3);
});

test('Stabilizer는 프레임마다 누적된 어긋남을 들고 있다', () => {
  const W = 64;
  const H = 48;
  const world = new Uint8Array((W + 32) * H);
  let s = 5;
  for (let i = 0; i < world.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; world[i] = 120 + ((s >> 16) % 80); }
  const view = (ox) => {
    const g = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) g[y * W + x] = world[y * (W + 32) + x + 16 + ox];
    return g;
  };
  const st = new Stabilizer();
  st.update(view(0), W, H);
  st.update(view(2), W, H);
  st.update(view(4), W, H);
  assert.equal(Math.abs(st.offX), 4, `누적 어긋남 ${st.offX}`);
  st.reset();
  assert.equal(st.offX, 0);
});

/* ---- 흔들리는 카메라로 실제 측정이 되는지 ---- */

const W = 200;
const H = 150;
const FPS = 60;
const FRAME_MS = 1000 / FPS;
const BW = W + 64;
const BH = H + 64;

const world = (() => {
  const w = new Uint8Array(BW * BH);
  let s = 7;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) >> 16) / 32767;
  for (let i = 0; i < w.length; i++) w[i] = 150 + Math.round(rnd() * 20);
  for (let b = 0; b < 260; b++) {
    const x0 = Math.floor(rnd() * (BW - 12));
    const y0 = Math.floor(rnd() * (BH - 8));
    const v = 90 + Math.round(rnd() * 90);
    for (let y = y0; y < y0 + 6; y++) for (let x = x0; x < x0 + 10; x++) w[y * BW + x] = v;
  }
  return w;
})();

function shakyFrame(carX, ox, oy) {
  const g = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const wy = Math.min(BH - 1, Math.max(0, y + 32 + oy));
    for (let x = 0; x < W; x++) {
      g[y * W + x] = world[wy * BW + Math.min(BW - 1, Math.max(0, x + 32 + ox))];
    }
  }
  if (carX !== null) {
    const sx = Math.round(carX - ox);
    const sy = Math.round(62 - oy);
    for (let y = sy; y < sy + 14; y++) {
      if (y < 0 || y >= H) continue;
      for (let x = sx; x < sx + 22; x++) if (x >= 0 && x < W) g[y * W + x] = 40;
    }
  }
  return g;
}

/** 진폭 amp로 흔들리는 카메라 앞을 자동차가 지나간다 */
function shakyRun(amp) {
  const tr = new MotionTracker();
  const det = new GateSpeedDetector({ onRatio: 0.026, offRatio: 0.013, pixelThreshold: 27 });
  const speed = 2.2;
  const truth = (speed / (W - 1)) * FPS;
  let t = 0;
  let phase = 0;
  const passes = [];
  const gates = [];
  let shakingFrames = 0;
  const step = (carX) => {
    phase += 0.9;
    const ox = Math.round(Math.sin(phase) * amp);
    const oy = Math.round(Math.cos(phase * 0.7) * amp * 0.6);
    const f = shakyFrame(carX, ox, oy);
    const r = tr.update(f, W, H, t);
    const d = det.update(f, W, H, t);
    if (r.shaking) shakingFrames++;
    if (r.pass) passes.push(r.pass);
    if (d.measurement) gates.push(d.measurement);
    t += FRAME_MS;
  };
  for (let i = 0; i < 40; i++) step(null);
  for (let i = 0; i < 130; i++) {
    const x = -30 + i * speed;
    step(x > W + 40 ? null : x);
  }
  return { passes, gates, truth, shakingFrames };
}

for (const amp of [1, 2, 4]) {
  test(`카메라가 ±${amp}px 흔들려도 자동 추적 값이 흔들리지 않는다`, () => {
    const { passes, truth } = shakyRun(amp);
    assert.equal(passes.length, 1, `통과 ${passes.length}건`);
    const err = Math.abs(passes[0].fwps - truth) / truth;
    assert.ok(err < 0.1, `오차 ${(err * 100).toFixed(0)}% (측정 ${passes[0].fwps.toFixed(3)}, 참값 ${truth.toFixed(3)})`);
  });

  test(`카메라가 ±${amp}px 흔들려도 기준선이 헛측정을 내지 않는다`, () => {
    const { gates } = shakyRun(amp);
    assert.equal(gates.length, 1, `측정 ${gates.length}건 (${gates.map((g) => g.direction).join(',')})`);
    assert.equal(gates[0].direction, 'AB');
  });
}

test('보정 범위를 넘는 큰 흔들림은 측정하지 않고 흔들림으로 표시한다', () => {
  const { passes, gates, shakingFrames } = shakyRun(12);
  assert.equal(passes.length, 0, '엉터리 값을 내면 안 된다');
  assert.equal(gates.length, 0, '엉터리 값을 내면 안 된다');
  assert.ok(shakingFrames > 10, `흔들림으로 표시된 프레임 ${shakingFrames}`);
});
