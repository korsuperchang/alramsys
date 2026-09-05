/**
 * 자동 추적 엔진 — 기준선 없이 "움직이는 것"을 따라가며 속도를 낸다.
 *
 * 기준선(게이트) 방식은 물체가 얇은 선 위에서 정해진 면적 이상을 가려야 하는데,
 * 멀리서 찍은 작은 자동차는 그 문턱을 못 넘는 일이 잦다. 이 엔진은 화면 전체에서
 * 움직이는 픽셀 덩어리의 중심을 매 프레임 기록하고, 한 번의 통과가 끝나면
 * 위치-시간 표본에 직선을 맞춰(최소제곱) 속도를 구한다.
 *
 * 속도는 "초당 화면 폭의 몇 배"(fwps)로 낸다. 카메라를 고정해 두면 이 값끼리는
 * 그대로 비교할 수 있고, 화면에 담긴 실제 가로 길이를 알려 주면 m/s로 환산된다.
 *
 * DOM에 의존하지 않는다. 입력은 8비트 그레이스케일 배열뿐이다.
 */

import { Stabilizer } from './stabilizer.js';

export const TRACKER_DEFAULTS = {
  /** 손떨림 보정 사용 여부 */
  stabilize: true,
  /** 프레임 간 이동이 이보다 크면 보정 범위를 넘어선 것으로 보고 측정을 멈춘다 */
  maxShakeMagnitude: 5,
  /** 진행 축: 'horizontal'이면 좌우 이동, 'vertical'이면 상하 이동 */
  axis: 'horizontal',
  /** 배경과 이만큼 이상 밝기가 다르면 움직임 픽셀로 본다 */
  pixelThreshold: 26,
  /** 움직임으로 인정할 최소 면적 (전체 픽셀 대비) */
  minPixelRatio: 0.0015,
  /** 이보다 크면 화면 전체가 움직인 것 — 흔들림으로 보고 버린다 */
  maxPixelRatio: 0.5,
  learnRate: 0.06,
  foregroundLearnFactor: 0.05,
  staleForegroundFrames: 120,
  warmupFrames: 12,
  /** 움직임이 이 프레임 수만큼 끊기면 한 번의 통과가 끝난 것으로 본다 */
  gapFrames: 3,
  /** 통과로 인정할 최소 표본 수 */
  minSamples: 5,
  /** 화면 폭의 이 비율 이상 이동해야 통과로 인정한다 */
  minTravelRatio: 0.1,
  /** 직선 적합도(R²) 하한 — 흔들림·그림자처럼 제멋대로 움직이는 것을 걸러낸다 */
  minR2: 0.8,
  /** 한 번의 통과가 이보다 길면 버린다 */
  maxDurationMs: 8000,
};

/** 표본 (t초, 위치 0~1)에 직선을 맞춘다. 기울기가 곧 속도(화면폭/초). */
export function fitLine(samples) {
  const n = samples.length;
  let st = 0;
  let sp = 0;
  for (const s of samples) { st += s.t; sp += s.p; }
  const mt = st / n;
  const mp = sp / n;
  let num = 0;
  let den = 0;
  for (const s of samples) {
    const dt = s.t - mt;
    num += dt * (s.p - mp);
    den += dt * dt;
  }
  if (den === 0) return { slope: 0, intercept: mp, r2: 0 };
  const slope = num / den;
  const intercept = mp - slope * mt;
  let ssRes = 0;
  let ssTot = 0;
  for (const s of samples) {
    const pred = slope * s.t + intercept;
    ssRes += (s.p - pred) ** 2;
    ssTot += (s.p - mp) ** 2;
  }
  return { slope, intercept, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };
}

export class MotionTracker {
  constructor(options = {}) {
    this.opts = { ...TRACKER_DEFAULTS, ...options };
    this.width = 0;
    this.height = 0;
    this.bg = null;
    this.fgFrames = null;
    this.frames = 0;
    this.stabilizer = new Stabilizer();
    this.shake = 0;
    this.track = null;   // 진행 중인 통과 {samples, lastSeen, gap}
    this.coverage = 0;
    this.centroid = null;
    this.box = null;
  }

  configure(partial) { Object.assign(this.opts, partial); }

  reset() {
    this.bg = null;
    this.fgFrames = null;
    this.frames = 0;
    this.stabilizer.reset();
    this.shake = 0;
    this.track = null;
    this.coverage = 0;
    this.centroid = null;
    this.box = null;
  }

  get isWarmingUp() { return this.frames < this.opts.warmupFrames; }

  /**
   * 프레임 한 장을 처리한다.
   * @returns {{coverage:number, centroid:?number, box:?{min:number,max:number},
   *            shaking:boolean, tracking:boolean, warmingUp:boolean, pass:?object}}
   */
  update(gray, width, height, timeMs) {
    const o = this.opts;
    if (!this.bg || width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.bg = new Float32Array(gray.length);
      this.bg.set(gray);
      this.fgFrames = new Uint16Array(gray.length);
      this.frames = 0;
      this.stabilizer.reset();
      this.track = null;
    }

    // 화면 전체가 밀린 양을 먼저 재고, 그만큼 어긋난 자리끼리 비교한다.
    const shift = o.stabilize
      ? this.stabilizer.update(gray, width, height)
      : { offX: 0, offY: 0, magnitude: 0 };
    this.shake = shift.magnitude;
    const offX = shift.offX;
    const offY = shift.offY;

    const thr = o.pixelThreshold;
    const horizontal = o.axis === 'horizontal';
    const axisLen = horizontal ? width : height;
    let count = 0;
    let sum = 0;
    let min = axisLen;
    let max = -1;

    // 어긋난 만큼은 배경 모델 바깥이므로 아예 보지 않는다.
    const y0 = Math.max(0, -offY);
    const y1 = Math.min(height, height - offY);
    const x0 = Math.max(0, -offX);
    const x1 = Math.min(width, width - offX);
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      const bgRow = (y + offY) * width + offX;
      for (let x = x0; x < x1; x++) {
        const diff = gray[row + x] - this.bg[bgRow + x];
        if (diff > thr || diff < -thr) {
          const a = horizontal ? x : y;
          count++;
          sum += a;
          if (a < min) min = a;
          if (a > max) max = a;
        }
      }
    }

    const total = Math.max(1, (y1 - y0) * (x1 - x0));
    const coverage = count / total;
    this.coverage = coverage;

    const enough = coverage >= o.minPixelRatio;
    // 보정 범위를 넘는 큰 흔들림이거나, 화면 대부분이 한꺼번에 달라졌을 때
    const shaking = coverage > o.maxPixelRatio || this.shake > o.maxShakeMagnitude;
    const usable = enough && !shaking && !this.isWarmingUp;

    this.centroid = usable ? sum / count / (axisLen - 1) : null;
    this.box = usable ? { min: min / (axisLen - 1), max: max / (axisLen - 1) } : null;

    let pass = null;
    if (usable) {
      if (!this.track) this.track = { samples: [], gap: 0 };
      this.track.gap = 0;
      this.track.samples.push({ t: timeMs / 1000, p: this.centroid });
      if (timeMs / 1000 - this.track.samples[0].t > o.maxDurationMs / 1000) {
        this.track = null; // 너무 오래 끄는 움직임은 통과가 아니다
      }
    } else if (this.track) {
      this.track.gap++;
      if (this.track.gap >= o.gapFrames) {
        pass = this._finishTrack();
      }
    }

    this.frames++;
    this._updateBackground(gray, offX, offY);

    return {
      coverage,
      shake: this.shake,
      centroid: this.centroid,
      box: this.box,
      shaking,
      tracking: !!this.track,
      warmingUp: this.isWarmingUp,
      pass,
    };
  }

  /** 진행 중인 통과를 마감하고, 조건을 만족하면 결과를 돌려준다. */
  _finishTrack() {
    const o = this.opts;
    const samples = this.track.samples;
    this.track = null;
    if (samples.length < o.minSamples) return null;

    const travel = samples[samples.length - 1].p - samples[0].p;
    if (Math.abs(travel) < o.minTravelRatio) return null;

    const { slope, r2 } = fitLine(samples);
    if (r2 < o.minR2) return null;

    const durationMs = (samples[samples.length - 1].t - samples[0].t) * 1000;
    if (durationMs <= 0) return null;

    return {
      /** 초당 화면 폭의 몇 배로 움직였는가 (부호는 방향) */
      fwps: Math.abs(slope),
      direction: slope >= 0 ? 'LR' : 'RL',
      travel: Math.abs(travel),
      durationMs,
      r2,
      samples: samples.length,
    };
  }

  _updateBackground(gray, offX, offY) {
    const o = this.opts;
    const a = o.learnRate;
    const aFg = a * o.foregroundLearnFactor;
    const thr = o.pixelThreshold;
    const stale = o.staleForegroundFrames;
    const bg = this.bg;
    const fg = this.fgFrames;
    const width = this.width;
    const y0 = Math.max(0, -offY);
    const y1 = Math.min(this.height, this.height - offY);
    const x0 = Math.max(0, -offX);
    const x1 = Math.min(width, width - offX);
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      const bgRow = (y + offY) * width + offX;
      for (let x = x0; x < x1; x++) {
        const i = bgRow + x;
        const diff = gray[row + x] - bg[i];
        if (diff > thr || diff < -thr) {
          bg[i] += (fg[i]++ > stale ? a : aFg) * diff;
        } else {
          fg[i] = 0;
          bg[i] += a * diff;
        }
      }
    }
  }
}

/** 화면 폭 기준 속도(fwps)를 실제 속도로 바꾼다. viewWidthMeters를 모르면 null. */
export function passToSpeed(fwps, viewWidthMeters) {
  if (!(viewWidthMeters > 0)) return null;
  const mps = fwps * viewWidthMeters;
  return { mps, kmh: mps * 3.6, cmps: mps * 100 };
}
