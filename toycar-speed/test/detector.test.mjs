import test from 'node:test';
import assert from 'node:assert/strict';
import { GateSpeedDetector, computeSpeed, rgbaToGray, scaleSpeed } from '../js/detector.js';

const W = 160;
const H = 120;
const FPS = 30;
const FRAME_MS = 1000 / FPS;

/** 균일한 밝은 배경 위에 어두운 사각형(장난감 자동차)을 그린 프레임을 만든다. */
function frame({ carX = null, carW = 16, carTop = 40, carH = 30, noise = 0, seed = 1 } = {}) {
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
    for (let y = carTop; y < carTop + carH; y++) {
      for (let x = x0; x <= x1; x++) g[y * W + x] = 40;
    }
  }
  return g;
}

function run(detector, frames) {
  const out = [];
  let t = 0;
  for (const f of frames) {
    const res = detector.update(f, W, H, t);
    if (res.measurement) out.push(res.measurement);
    t += FRAME_MS;
  }
  return out;
}

test('워밍업 중에는 아무것도 트리거되지 않는다', () => {
  const d = new GateSpeedDetector();
  const frames = Array.from({ length: 10 }, () => frame({ carX: 20 }));
  assert.equal(run(d, frames).length, 0);
});

test('정지된 배경(노이즈 포함)에서는 오검출이 없다', () => {
  const d = new GateSpeedDetector();
  const frames = Array.from({ length: 120 }, (_, i) => frame({ noise: 10, seed: i + 1 }));
  assert.equal(run(d, frames).length, 0);
});

test('왼쪽에서 오른쪽으로 지나가는 차의 통과 시간을 측정한다', () => {
  const d = new GateSpeedDetector({ gateA: 0.3, gateB: 0.7 });
  const speedPxPerFrame = 6;
  const frames = [];
  for (let i = 0; i < 30; i++) frames.push(frame()); // 배경 학습
  for (let i = 0; i < 60; i++) frames.push(frame({ carX: -20 + i * speedPxPerFrame }));

  const results = run(d, frames);
  assert.equal(results.length, 1, `측정 1건이어야 하는데 ${results.length}건`);
  const m = results[0];
  assert.equal(m.direction, 'AB');

  // 게이트 간 거리(px) / (px per frame) * 프레임주기 = 기대 dt
  const gapPx = (0.7 - 0.3) * (W - 1);
  const expectedDt = (gapPx / speedPxPerFrame) * FRAME_MS;
  assert.ok(
    Math.abs(m.dtMs - expectedDt) < FRAME_MS * 1.5,
    `dt=${m.dtMs.toFixed(1)}ms, 기대=${expectedDt.toFixed(1)}ms`,
  );
});

test('오른쪽에서 왼쪽으로 지나가면 방향이 BA로 나온다', () => {
  const d = new GateSpeedDetector({ gateA: 0.3, gateB: 0.7 });
  const frames = [];
  for (let i = 0; i < 30; i++) frames.push(frame());
  for (let i = 0; i < 60; i++) frames.push(frame({ carX: W + 10 - i * 6 }));
  const results = run(d, frames);
  assert.equal(results.length, 1);
  assert.equal(results[0].direction, 'BA');
});

test('가로 게이트(위→아래 이동)도 측정한다', () => {
  const d = new GateSpeedDetector({ orientation: 'horizontal', gateA: 0.25, gateB: 0.75 });
  const frames = [];
  for (let i = 0; i < 30; i++) frames.push(frame());
  const speed = 4;
  for (let i = 0; i < 60; i++) {
    frames.push(frame({ carX: 50, carW: 40, carTop: Math.round(-20 + i * speed), carH: 16 }));
  }
  const results = run(d, frames);
  assert.equal(results.length, 1);
  assert.equal(results[0].direction, 'AB');
  const expectedDt = ((0.75 - 0.25) * (H - 1) / speed) * FRAME_MS;
  assert.ok(Math.abs(results[0].dtMs - expectedDt) < FRAME_MS * 1.5);
});

test('차 두 대가 연달아 지나가면 측정도 두 번 나온다', () => {
  const d = new GateSpeedDetector({ gateA: 0.3, gateB: 0.7 });
  const frames = [];
  for (let i = 0; i < 30; i++) frames.push(frame());
  for (let i = 0; i < 45; i++) frames.push(frame({ carX: -20 + i * 8 }));
  for (let i = 0; i < 20; i++) frames.push(frame());
  for (let i = 0; i < 45; i++) frames.push(frame({ carX: -20 + i * 4 }));
  const results = run(d, frames);
  assert.equal(results.length, 2);
  assert.ok(results[1].dtMs > results[0].dtMs, '느린 차의 dt가 더 커야 한다');
});

test('느린 차가 지나가도 배경에 흡수되지 않아 유령 트리거가 없다', () => {
  // 배경 학습이 지나가는 물체까지 흡수하면, 물체가 빠져나갈 때 같은 게이트가
  // 한 번 더 트리거되어 방향이 뒤집힌 가짜 측정(BA)이 생긴다. 회귀 테스트.
  const d = new GateSpeedDetector({ gateA: 0.3, gateB: 0.7 });
  const frames = [];
  for (let i = 0; i < 30; i++) frames.push(frame());
  for (let lap = 0; lap < 2; lap++) {
    for (let i = 0; i < 100; i++) frames.push(frame({ carX: -30 + i * 2, carW: 24 })); // 느린 통과
    for (let i = 0; i < 30; i++) frames.push(frame());
  }
  const results = run(d, frames);
  assert.equal(results.length, 2, `측정 2건이어야 하는데 ${results.length}건`);
  assert.deepEqual(results.map((r) => r.direction), ['AB', 'AB']);
});

test('reset() 이후에는 다시 워밍업부터 시작한다', () => {
  const d = new GateSpeedDetector();
  run(d, Array.from({ length: 30 }, () => frame()));
  assert.equal(d.isWarmingUp, false);
  d.reset();
  assert.equal(d.isWarmingUp, true);
});

test('computeSpeed: 0.5m를 0.25초에 통과하면 2m/s = 7.2km/h', () => {
  const s = computeSpeed(0.5, 250);
  assert.ok(Math.abs(s.mps - 2) < 1e-9);
  assert.ok(Math.abs(s.kmh - 7.2) < 1e-9);
  assert.ok(Math.abs(s.cmps - 200) < 1e-9);
});

test('computeSpeed: 프레임 주기를 주면 오차 범위가 함께 나온다', () => {
  const s = computeSpeed(0.5, 250, 33.33);
  assert.ok(s.uncertaintyKmh > 0.9 && s.uncertaintyKmh < 1.0, `±${s.uncertaintyKmh}`);
  assert.equal(computeSpeed(0.5, 250, 0).uncertaintyKmh, 0);
});

test('scaleSpeed: 1:64 모형의 7.2km/h는 실차 환산 460.8km/h', () => {
  assert.ok(Math.abs(scaleSpeed(7.2, 64) - 460.8) < 1e-9);
  assert.equal(scaleSpeed(7.2, 0), 7.2);
});

test('rgbaToGray: 흰색은 밝게, 검정은 어둡게 변환된다', () => {
  const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255]);
  const gray = rgbaToGray(rgba);
  assert.equal(gray.length, 2);
  assert.ok(gray[0] > 245);
  assert.equal(gray[1], 0);
});
