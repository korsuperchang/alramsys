/**
 * 자동 추적 엔진 — 기준선 없이 "움직이는 것"을 따라가며 속도를 낸다.
 *
 * 기준선(게이트) 방식은 물체가 얇은 선 위에서 정해진 면적 이상을 가려야 하는데,
 * 멀리서 찍은 작은 자동차는 그 문턱을 못 넘는 일이 잦다. 이 엔진은 화면 전체에서
 * 움직이는 픽셀 덩어리의 중심을 매 프레임 기록하고, 한 번의 통과가 끝나면
 * 위치-시간 표본에 직선을 맞춰(최소제곱) 속도를 구한다.
 *
 * 움직임은 "몇 프레임 전과 달라진 곳"으로 찾는다(프레임 간 차분). 오래 쌓아 둔 배경과
 * 비교하는 방식은 카메라가 조금씩 미끄러지기만 해도 바닥 무늬 전체가 달라져 버려서,
 * 실제 촬영에서는 자동차가 그 속에 묻힌다. 프레임 간 차분은 느린 드리프트에 거의
 * 반응하지 않으면서 지나가는 물체만 남긴다.
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
  /** 이만큼 이상 밝기가 달라지면 움직임 픽셀로 본다 */
  pixelThreshold: 26,
  /**
   * 몇 프레임 전과 비교할지. 1이면 바로 직전 프레임.
   * 2~3으로 두면 느리게 움직이는 물체의 신호가 그만큼 커진다.
   * 물체가 지나간 자리와 새 자리의 중간이 중심으로 잡히지만, 그 치우침은 일정하므로
   * 기울기(속도)에는 영향이 없다.
   */
  motionLag: 2,
  /** 움직임으로 인정할 최소 면적 (전체 픽셀 대비). 가장 큰 덩어리 기준이다. */
  minPixelRatio: 0.0015,
  /** 덩어리를 찾을 때 진행 축 방향으로 뭉개는 폭 (축 길이 대비) */
  blobSmoothRatio: 0.03,
  /** 봉우리에서 이 비율 이상인 곳까지를 한 덩어리로 본다 */
  blobEdgeRatio: 0.3,
  /** 한 덩어리로 인정할 최대 폭 (축 길이 대비). 이보다 넓게 퍼지면 물체가 아니라 잡음이다 */
  blobMaxWidthRatio: 0.45,
  /**
   * 덩어리로 뭉치지 않는 움직임이 화면의 이만큼을 넘으면 카메라가 움직인 것으로 본다.
   * (물체는 한곳에 뭉치고, 카메라가 움직이면 화면 전체가 넓게 달라진다)
   */
  spreadMotionRatio: 0.02,
  /** 이보다 크면 화면 전체가 움직인 것 — 흔들림으로 보고 버린다 */
  maxPixelRatio: 0.5,
  /** 비교할 과거 프레임이 쌓일 때까지 기다리는 프레임 수 */
  warmupFrames: 4,
  /**
   * 움직임이 이 프레임 수만큼 끊기면 한 번의 통과가 끝난 것으로 본다.
   * 너무 크면 물체가 나간 뒤 들어온 잔 움직임에 통과가 계속 이어져 끝나지 않는다.
   */
  gapFrames: 2,
  /** 통과로 인정할 최소 표본 수 (직선을 믿을 수 있는 최소한) */
  minSamples: 4,
  /** 화면 폭의 이 비율 이상 이동해야 통과로 인정한다 */
  minTravelRatio: 0.1,
  /** 직선 적합도(R²) 하한 — 흔들림·그림자처럼 제멋대로 움직이는 것을 걸러낸다 */
  minR2: 0.8,
  /** 한 번의 통과가 이보다 길면 버린다 */
  maxDurationMs: 8000,
  /**
   * 다음 프레임에서 물체가 이만큼(축 길이 대비) 넘게 튀면 다른 물체로 본다.
   * 자동차를 굴려 주는 손이 화면 한쪽에서 움직이다가 자동차가 반대쪽에 나타나면,
   * 이 둘을 한 통과로 묶어 버려서 아무것도 측정하지 못한다.
   */
  maxJumpRatio: 0.3,
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

/**
 * 직선을 맞추되, 크게 벗어나는 표본은 버리고 다시 맞춘다.
 * 통과 앞뒤에 잔 움직임 한두 개가 끼면 그것만으로 적합도가 무너지는데,
 * 실제 통과는 대다수 표본이 만드는 직선 쪽이다.
 */
export function fitLineRobust(samples, { rounds = 2, keepRatio = 0.8 } = {}) {
  let kept = samples;
  let fit = fitLine(kept);
  for (let r = 0; r < rounds; r++) {
    if (kept.length < 6) break;
    const residuals = kept.map((s) => Math.abs(s.p - (fit.slope * s.t + fit.intercept)));
    const sorted = [...residuals].sort((a, b) => a - b);
    const cut = sorted[Math.max(0, Math.floor(sorted.length * keepRatio) - 1)];
    const next = kept.filter((_, i) => residuals[i] <= cut + 1e-9);
    if (next.length < 4 || next.length === kept.length) break;
    kept = next;
    fit = fitLine(kept);
  }
  return { ...fit, kept };
}

export class MotionTracker {
  constructor(options = {}) {
    this.opts = { ...TRACKER_DEFAULTS, ...options };
    this.width = 0;
    this.height = 0;
    /** 최근 프레임 보관 (프레임 간 차분용) */
    this.history = [];
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
    this.history = [];
    this.frames = 0;
    this.stabilizer.reset();
    this.shake = 0;
    this.track = null;
    this.coverage = 0;
    this.centroid = null;
    this.box = null;
  }

  get isWarmingUp() { return this.frames < this.opts.warmupFrames; }

  /** 지금 본 위치가 보던 물체의 다음 위치로 볼 수 없을 만큼 동떨어져 있는가 */
  _isJump(centroid, timeMs) {
    const samples = this.track.samples;
    const last = samples[samples.length - 1];
    let expected = last.p;
    if (samples.length >= 2) {
      const prev = samples[samples.length - 2];
      const dt = last.t - prev.t;
      if (dt > 0) expected = last.p + ((last.p - prev.p) / dt) * (timeMs / 1000 - last.t);
    }
    return Math.abs(centroid - expected) > this.opts.maxJumpRatio;
  }

  _profileFor(axisLen) {
    if (!this._profile || this._profile.length !== axisLen) this._profile = new Int32Array(axisLen);
    else this._profile.fill(0);
    return this._profile;
  }

  /**
   * 진행 축 방향 분포에서 가장 두꺼운 덩어리 하나를 골라낸다.
   * 잡음은 얇게 퍼지고 물체는 뭉치므로, 봉우리 주변만 취하면 물체만 남는다.
   */
  _dominantBlob(profile, axisLen) {
    const o = this.opts;
    const radius = Math.max(1, Math.round(axisLen * o.blobSmoothRatio));
    // 누적합으로 이동 평균 (O(n))
    const cum = new Float32Array(axisLen + 1);
    for (let i = 0; i < axisLen; i++) cum[i + 1] = cum[i] + profile[i];
    const smooth = new Float32Array(axisLen);
    let peak = 0;
    let peakAt = -1;
    for (let i = 0; i < axisLen; i++) {
      const from = Math.max(0, i - radius);
      const to = Math.min(axisLen, i + radius + 1);
      smooth[i] = (cum[to] - cum[from]) / (to - from);
      if (smooth[i] > peak) { peak = smooth[i]; peakAt = i; }
    }
    if (peakAt < 0 || peak <= 0) return null;

    const edge = peak * o.blobEdgeRatio;
    let lo = peakAt;
    let hi = peakAt;
    while (lo > 0 && smooth[lo - 1] >= edge) lo--;
    while (hi < axisLen - 1 && smooth[hi + 1] >= edge) hi++;
    if (hi - lo > axisLen * o.blobMaxWidthRatio) return null; // 너무 퍼졌다 = 물체가 아니다

    let mass = 0;
    let weighted = 0;
    for (let i = lo; i <= hi; i++) {
      mass += profile[i];
      weighted += profile[i] * i;
    }
    if (mass <= 0) return null;
    return { centroid: weighted / mass, mass, lo, hi };
  }

  /**
   * 프레임 한 장을 처리한다.
   * @returns {{coverage:number, centroid:?number, box:?{min:number,max:number},
   *            shaking:boolean, tracking:boolean, warmingUp:boolean, pass:?object}}
   */
  update(gray, width, height, timeMs) {
    const o = this.opts;
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.history = [];
      this.frames = 0;
      this.stabilizer.reset();
      this.track = null;
    }

    // 비교 대상은 몇 프레임 전의 화면이다.
    const ref = this.history.length >= o.motionLag
      ? this.history[this.history.length - o.motionLag]
      : null;

    // 그 사이 화면이 밀렸으면(손떨림·팬) 그만큼 어긋난 자리끼리 비교한다.
    const shift = ref && o.stabilize
      ? this.stabilizer.update(gray, ref, width, height)
      : { offX: 0, offY: 0, magnitude: 0 };
    this.shake = shift.magnitude;
    const offX = shift.offX;
    const offY = shift.offY;

    const thr = o.pixelThreshold;
    const horizontal = o.axis === 'horizontal';
    const axisLen = horizontal ? width : height;
    // 진행 축 위치별 움직임 픽셀 수. 바닥 무늬에서 오는 잡음은 화면 전체에 얇게
    // 퍼지지만 자동차는 한곳에 뭉치므로, 가장 두꺼운 덩어리만 골라내면 구분된다.
    const profile = this._profileFor(axisLen);
    let total0 = 0;

    // 어긋난 만큼은 비교할 짝이 없으므로 아예 보지 않는다.
    const y0 = Math.max(0, -offY);
    const y1 = Math.min(height, height - offY);
    const x0 = Math.max(0, -offX);
    const x1 = Math.min(width, width - offX);
    if (ref) {
      for (let y = y0; y < y1; y++) {
        const row = y * width;
        const refRow = (y + offY) * width + offX;
        for (let x = x0; x < x1; x++) {
          const diff = gray[row + x] - ref[refRow + x];
          if (diff > thr || diff < -thr) {
            profile[horizontal ? x : y]++;
            total0++;
          }
        }
      }
    }

    const total = Math.max(1, (y1 - y0) * (x1 - x0));
    const blob = this._dominantBlob(profile, axisLen);
    const coverage = blob ? blob.mass / total : 0;
    this.coverage = coverage;

    const enough = !!blob && coverage >= o.minPixelRatio;
    // 뭉치지 않은 움직임이 화면 곳곳에 퍼져 있다 = 카메라가 움직였다
    const cameraMoving = !blob && total0 / total > o.spreadMotionRatio;
    // 보정 범위를 넘는 큰 흔들림이거나, 화면 대부분이 한꺼번에 달라졌을 때
    const saturated = Math.abs(offX) >= this.stabilizer.opts.maxShift
      || Math.abs(offY) >= this.stabilizer.opts.maxShift;
    // 크게 움직였다는 사실 자체는 문제가 아니다. 보정하고 나서 화면 대부분이 여전히
    // 달라져 있거나(보정 실패), 찾을 수 있는 범위를 넘었을 때만 측정을 멈춘다.
    this.shakeLevel = Math.max(saturated ? 99 : this.shake, (this.shakeLevel || 0) * 0.93);
    const shaking = total0 / total > o.maxPixelRatio || saturated;
    const usable = enough && !shaking && !this.isWarmingUp;

    this.centroid = usable ? blob.centroid / (axisLen - 1) : null;
    this.box = usable ? { min: blob.lo / (axisLen - 1), max: blob.hi / (axisLen - 1) } : null;

    let pass = null;
    let rejected = null;
    if (usable) {
      // 직전에 보던 것과 너무 멀리 떨어져 나타났다면 다른 물체다.
      // 보던 통과를 여기서 끊고, 이 표본으로 새 통과를 시작한다.
      if (this.track && this.track.samples.length && this._isJump(this.centroid, timeMs)) {
        const outcome = this._finishTrack();
        if (outcome && outcome.reason) rejected = outcome;
        else pass = outcome;
      }
      if (!this.track) this.track = { samples: [], gap: 0, cameraMoved: false };
      this.track.gap = 0;
      this.track.samples.push({ t: timeMs / 1000, p: this.centroid });
      if (timeMs / 1000 - this.track.samples[0].t > o.maxDurationMs / 1000) {
        // 화면 안에서 뭔가 계속 움직이고 있어 한 번의 통과를 잘라낼 수 없다
        rejected = { reason: 'tooLong', samples: this.track.samples.length };
        this.track = null;
      }
    } else if (this.track) {
      // 이 통과가 이어지는 동안 카메라가 크게 움직였다면 결과에 표시해 준다.
      if (shaking || cameraMoving) this.track.cameraMoved = true;
      this.track.gap++;
      if (this.track.gap >= o.gapFrames) {
        const outcome = this._finishTrack();
        if (outcome && outcome.reason) rejected = outcome;
        else pass = outcome;
      }
    }

    this.frames++;
    const keep = o.motionLag + 1;
    this.history.push(Uint8Array.from(gray));
    while (this.history.length > keep) this.history.shift();

    return {
      coverage,
      shake: this.shake,
      centroid: this.centroid,
      box: this.box,
      shaking,
      cameraMoving,
      tracking: !!this.track,
      warmingUp: this.isWarmingUp,
      pass,
      rejected,
    };
  }

  /**
   * 진행 중인 통과를 마감한다.
   * 조건을 만족하면 결과를, 아니면 왜 인정하지 않았는지({reason})를 돌려준다.
   * 이유를 남기지 않으면 사용자는 "왜 측정이 안 되는지" 알 방법이 없다.
   */
  _finishTrack() {
    const o = this.opts;
    const samples = this.track.samples;
    const cameraMoved = this.track.cameraMoved;
    this.track = null;
    if (samples.length < 2) return null; // 스쳐 지나간 잡음, 알릴 것도 없다

    const { slope, r2, kept } = fitLineRobust(samples);
    const durationMs = (kept[kept.length - 1].t - kept[0].t) * 1000;
    // 이동 거리는 양 끝 표본이 아니라 맞춘 직선으로 잰다. 통과 앞뒤에 잔 움직임이
    // 하나 끼면 양 끝만 보는 방식은 실제로 가로지른 거리를 통째로 놓친다.
    const travel = slope * (durationMs / 1000);

    if (kept.length < o.minSamples) {
      return { reason: 'tooFast', samples: kept.length, travel: Math.abs(travel), durationMs };
    }
    if (Math.abs(travel) < o.minTravelRatio) {
      return { reason: 'tooShort', samples: kept.length, travel: Math.abs(travel), durationMs };
    }
    if (r2 < o.minR2) {
      return { reason: 'notSteady', samples: kept.length, travel: Math.abs(travel), r2, durationMs };
    }
    if (durationMs <= 0) return null;

    return {
      /** 초당 화면 폭의 몇 배로 움직였는가 (부호는 방향) */
      fwps: Math.abs(slope),
      direction: slope >= 0 ? 'LR' : 'RL',
      travel: Math.abs(travel),
      durationMs,
      r2,
      samples: kept.length,
      /** 통과 도중 카메라가 크게 움직였다 — 값이 실제보다 어긋났을 수 있다 */
      cameraMoved,
    };
  }

}

/** 화면 폭 기준 속도(fwps)를 실제 속도로 바꾼다. viewWidthMeters를 모르면 null. */
export function passToSpeed(fwps, viewWidthMeters) {
  if (!(viewWidthMeters > 0)) return null;
  const mps = fwps * viewWidthMeters;
  return { mps, kmh: mps * 3.6, cmps: mps * 100 };
}
