import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionTracker, fitLine, passToSpeed } from '../js/tracker.js';

const W = 160;
const H = 120;
const FPS = 30;
const FRAME_MS = 1000 / FPS;

function frame({ carX = null, carW = 14, carTop = 50, carH = 12, noise = 0, seed = 1 } = {}) {
  const g = new Uint8Array(W * H).fill(180);
  let s = seed;
  if (noise > 0) {
    for (let i = 0; i < g.length; i++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      g[i] = Math.max(0, Math.min(255, 180 + (((s >> 16) % 100) / 100 - 0.5) * 2 * noise));
    }
  }
  if (carX !== null) {
    const x0 = Math.max(0, Math.round(carX));
    const x1 = Math.min(W - 1, Math.round(carX + carW));
    for (let y = carTop; y < carTop + carH; y++) for (let x = x0; x <= x1; x++) g[y * W + x] = 40;
  }
  return g;
}

/** 프레임들을 흘려보내고 확정된 통과 결과를 모은다. */
function run(tracker, frames) {
  const passes = [];
  let t = 0;
  for (const f of frames) {
    const r = tracker.update(f, W, H, t);
    if (r.pass) passes.push(r.pass);
    t += FRAME_MS;
  }
  return passes;
}

function lap(speedPxPerFrame, opts = {}) {
  const frames = [];
  for (let i = 0; i < 60; i++) {
    const x = -20 + i * speedPxPerFrame;
    if (x > W + 20) break;
    frames.push(frame({ carX: x, ...opts }));
  }
  return frames;
}

test('작은 자동차 한 대가 지나가면 통과 한 건이 나온다', () => {
  const tr = new MotionTracker();
  const speed = 5; // px/frame
  const frames = [...Array.from({ length: 20 }, () => frame()), ...lap(speed), ...Array.from({ length: 10 }, () => frame())];
  const passes = run(tr, frames);

  assert.equal(passes.length, 1);
  const p = passes[0];
  assert.equal(p.direction, 'LR');
  // 기대 속도: (px/frame ÷ 화면폭) × fps = 초당 화면폭 배수
  const expected = (speed / (W - 1)) * FPS;
  assert.ok(Math.abs(p.fwps - expected) / expected < 0.1, `fwps=${p.fwps.toFixed(3)} 기대=${expected.toFixed(3)}`);
  assert.ok(p.r2 > 0.98, `r2=${p.r2}`);
});

test('두 배 빠른 자동차는 두 배의 속도로 나온다', () => {
  const slow = run(new MotionTracker(), [
    ...Array.from({ length: 20 }, () => frame()), ...lap(3), ...Array.from({ length: 10 }, () => frame()),
  ])[0];
  const fast = run(new MotionTracker(), [
    ...Array.from({ length: 20 }, () => frame()), ...lap(6), ...Array.from({ length: 10 }, () => frame()),
  ])[0];
  const ratio = fast.fwps / slow.fwps;
  assert.ok(Math.abs(ratio - 2) < 0.2, `배율 ${ratio.toFixed(2)}`);
});

test('반대 방향으로 지나가면 방향이 RL로 나온다', () => {
  const tr = new MotionTracker();
  const frames = [...Array.from({ length: 20 }, () => frame())];
  for (let i = 0; i < 40; i++) frames.push(frame({ carX: W + 10 - i * 5 }));
  frames.push(...Array.from({ length: 10 }, () => frame()));
  const passes = run(tr, frames);
  assert.equal(passes.length, 1);
  assert.equal(passes[0].direction, 'RL');
});

test('아주 작은 물체(화면의 0.6%)도 잡는다', () => {
  const tr = new MotionTracker();
  const frames = [
    ...Array.from({ length: 20 }, () => frame()),
    ...lap(4, { carW: 8, carH: 8 }),   // 9×9 ≈ 전체의 0.4%
    ...Array.from({ length: 10 }, () => frame()),
  ];
  const passes = run(tr, frames);
  assert.equal(passes.length, 1, '작은 물체가 무시되면 안 된다');
});

test('정지 화면(노이즈 포함)에서는 통과가 없다', () => {
  const tr = new MotionTracker();
  const frames = Array.from({ length: 150 }, (_, i) => frame({ noise: 12, seed: i + 1 }));
  assert.equal(run(tr, frames).length, 0);
});

test('제자리에서 흔들리기만 하면 통과로 인정하지 않는다', () => {
  const tr = new MotionTracker();
  const frames = [...Array.from({ length: 20 }, () => frame())];
  for (let i = 0; i < 40; i++) frames.push(frame({ carX: 70 + (i % 2 ? 3 : -3) })); // 이동 없이 진동
  frames.push(...Array.from({ length: 10 }, () => frame()));
  assert.equal(run(tr, frames).length, 0);
});

test('화면 전체가 움직이면(흔들림) 버린다', () => {
  const tr = new MotionTracker();
  const frames = [...Array.from({ length: 20 }, () => frame())];
  for (let i = 0; i < 30; i++) {
    // 전체 밝기를 크게 흔들어 화면 전부가 배경과 달라지게 만든다
    const g = new Uint8Array(W * H).fill(i % 2 ? 90 : 240);
    frames.push(g);
  }
  const passes = [];
  let t = 0;
  let sawShake = false;
  for (const f of frames) {
    const r = tr.update(f, W, H, t);
    if (r.shaking) sawShake = true;
    if (r.pass) passes.push(r.pass);
    t += FRAME_MS;
  }
  assert.ok(sawShake, '흔들림으로 표시되어야 한다');
  assert.equal(passes.length, 0);
});

test('연달아 두 번 지나가면 통과도 두 건', () => {
  const tr = new MotionTracker();
  const frames = [
    ...Array.from({ length: 20 }, () => frame()),
    ...lap(6), ...Array.from({ length: 15 }, () => frame()),
    ...lap(3), ...Array.from({ length: 10 }, () => frame()),
  ];
  const passes = run(tr, frames);
  assert.equal(passes.length, 2);
  assert.ok(passes[0].fwps > passes[1].fwps, '첫 번째가 더 빨라야 한다');
});

test('fitLine: 기울기와 R²를 정확히 낸다', () => {
  const samples = [0, 1, 2, 3, 4].map((t) => ({ t, p: 0.1 + 0.25 * t }));
  const { slope, intercept, r2 } = fitLine(samples);
  assert.ok(Math.abs(slope - 0.25) < 1e-9);
  assert.ok(Math.abs(intercept - 0.1) < 1e-9);
  assert.ok(Math.abs(r2 - 1) < 1e-9);
});

test('passToSpeed: 화면 가로 1.2m를 초당 0.5배 속도로 지나면 0.6m/s', () => {
  const s = passToSpeed(0.5, 1.2);
  assert.ok(Math.abs(s.mps - 0.6) < 1e-9);
  assert.ok(Math.abs(s.kmh - 2.16) < 1e-9);
  assert.equal(passToSpeed(0.5, 0), null);
});
