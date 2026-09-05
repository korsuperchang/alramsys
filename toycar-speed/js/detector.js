/**
 * 장난감 자동차 속도 측정 - 감지 엔진
 *
 * 화면에 두 개의 "게이트(트립 라인)"를 두고, 배경 차분(background subtraction)으로
 * 각 게이트를 물체가 가리는 순간을 잡아낸다. 두 게이트 통과 시각의 차이(dt)와
 * 사용자가 입력한 실제 게이트 간격(d)으로 속도 v = d / dt 를 구한다.
 *
 * 이 파일은 DOM/캔버스에 의존하지 않는다. 입력은 8비트 그레이스케일 배열뿐이라
 * Node에서 그대로 테스트할 수 있다.
 */

export const DEFAULT_OPTIONS = {
  /** 게이트 방향: 'vertical'이면 세로선(차가 좌우로 이동), 'horizontal'이면 가로선(차가 상하로 이동) */
  orientation: 'vertical',
  /** 게이트 위치 (0~1 정규화). gateA가 항상 작은 값일 필요는 없다. */
  gateA: 0.3,
  gateB: 0.7,
  /** 게이트 선의 두께(정규화). 화면 폭(또는 높이) 대비 비율 */
  bandWidth: 0.02,
  /** 감지 영역(ROI): 게이트 선에서 실제로 살펴볼 구간 (0~1) */
  roiStart: 0.15,
  roiEnd: 0.85,
  /** 배경과 이만큼(0~255) 이상 밝기가 달라지면 "움직임 있는 픽셀"로 본다 */
  pixelThreshold: 28,
  /** 게이트가 켜지는/꺼지는 움직임 픽셀 비율 (히스테리시스) */
  onRatio: 0.08,
  offRatio: 0.04,
  /** 비율과 별개로 요구하는 최소 움직임 픽셀 수 (센서 노이즈 방지) */
  minMovedPixels: 10,
  /** 배경 학습률 (0~1). 클수록 조명 변화에 빨리 적응하지만 느린 물체를 배경에 흡수한다 */
  learnRate: 0.06,
  /** 전경(움직임)으로 분류된 픽셀의 학습률 배수. 0에 가까울수록 지나가는 물체를 배경에 덜 섞는다 */
  foregroundLearnFactor: 0.05,
  /** 배경이 안정될 때까지 무시할 프레임 수 */
  warmupFrames: 12,
  /** 같은 게이트가 다시 트리거되기까지의 최소 간격(ms) */
  refractoryMs: 120,
  /** 두 게이트 통과 간격이 이 범위를 벗어나면 측정으로 인정하지 않는다 */
  minDtMs: 8,
  maxDtMs: 4000,
};

class GateState {
  constructor() {
    this.active = false;
    this.prevRatio = 0;
    this.prevTime = 0;
    this.lastTriggerTime = -Infinity;
    this.hasPrev = false;
  }
  reset() {
    this.active = false;
    this.prevRatio = 0;
    this.prevTime = 0;
    this.lastTriggerTime = -Infinity;
    this.hasPrev = false;
  }
}

/** RGBA 픽셀 버퍼를 그레이스케일로 변환한다. out을 재사용하면 할당이 없다. */
export function rgbaToGray(rgba, out) {
  const n = rgba.length >> 2;
  const dst = out && out.length === n ? out : new Uint8Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    // 정수 근사: (77R + 150G + 29B) >> 8
    dst[i] = (77 * rgba[j] + 150 * rgba[j + 1] + 29 * rgba[j + 2]) >> 8;
  }
  return dst;
}

export class GateSpeedDetector {
  constructor(options = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    this.width = 0;
    this.height = 0;
    this.bg = null;
    this.frames = 0;
    this.gates = [new GateState(), new GateState()];
    this.ratios = [0, 0];
    this.movedPixels = [0, 0];
    /** 먼저 통과한 게이트 정보 {index, time} */
    this.pending = null;
  }

  configure(partial) {
    Object.assign(this.opts, partial);
  }

  /** 배경 모델과 게이트 상태를 모두 초기화한다 (카메라 전환, 설정 변경 후 호출). */
  reset() {
    this.bg = null;
    this.frames = 0;
    this.ratios = [0, 0];
    this.movedPixels = [0, 0];
    this.pending = null;
    for (const g of this.gates) g.reset();
  }

  get isWarmingUp() {
    return this.frames < this.opts.warmupFrames;
  }

  /** 게이트 선이 지나는 픽셀 인덱스 범위를 계산한다. */
  _bandRange(position) {
    const o = this.opts;
    const axisLen = o.orientation === 'vertical' ? this.width : this.height;
    const half = Math.max(1, Math.round((o.bandWidth * axisLen) / 2));
    const center = Math.round(position * (axisLen - 1));
    const start = Math.max(0, center - half);
    const end = Math.min(axisLen - 1, center + half);
    return { start, end };
  }

  /** 한 게이트에서 움직임 픽셀 수와 비율을 센다. */
  _sampleRatio(gray, position) {
    const o = this.opts;
    const { start, end } = this._bandRange(position);
    const crossLen = o.orientation === 'vertical' ? this.height : this.width;
    const roiFrom = Math.max(0, Math.round(Math.min(o.roiStart, o.roiEnd) * (crossLen - 1)));
    const roiTo = Math.min(crossLen - 1, Math.round(Math.max(o.roiStart, o.roiEnd) * (crossLen - 1)));
    const thr = o.pixelThreshold;
    let moved = 0;
    let total = 0;

    if (o.orientation === 'vertical') {
      for (let y = roiFrom; y <= roiTo; y++) {
        const row = y * this.width;
        for (let x = start; x <= end; x++) {
          const i = row + x;
          const diff = gray[i] - this.bg[i];
          if (diff > thr || diff < -thr) moved++;
          total++;
        }
      }
    } else {
      for (let y = start; y <= end; y++) {
        const row = y * this.width;
        for (let x = roiFrom; x <= roiTo; x++) {
          const i = row + x;
          const diff = gray[i] - this.bg[i];
          if (diff > thr || diff < -thr) moved++;
          total++;
        }
      }
    }
    return { ratio: total === 0 ? 0 : moved / total, moved };
  }

  /**
   * 프레임 한 장을 처리한다.
   * @param {Uint8Array|Uint8ClampedArray} gray 그레이스케일 픽셀 (width*height)
   * @param {number} width
   * @param {number} height
   * @param {number} timeMs 프레임 표시 시각(ms). 단조 증가해야 한다.
   * @returns {{ratios:number[], triggers:Array<{gate:number,time:number}>, measurement:?object, warmingUp:boolean}}
   */
  update(gray, width, height, timeMs) {
    const o = this.opts;
    if (!this.bg || width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.bg = new Float32Array(gray.length);
      this.bg.set(gray);
      this.frames = 0;
      this.pending = null;
      for (const g of this.gates) g.reset();
    }

    const sampleA = this._sampleRatio(gray, o.gateA);
    const sampleB = this._sampleRatio(gray, o.gateB);
    const ratios = [sampleA.ratio, sampleB.ratio];
    const moved = [sampleA.moved, sampleB.moved];
    this.ratios = ratios;
    this.movedPixels = moved;
    this.frames++;

    const triggers = [];
    let measurement = null;

    if (!this.isWarmingUp) {
      for (let i = 0; i < 2; i++) {
        const gate = this.gates[i];
        const r = ratios[i];
        if (!gate.active && r >= o.onRatio && moved[i] >= o.minMovedPixels) {
          // 프레임 사이를 선형 보간해서 실제 통과 시각을 추정한다 (프레임 양자화 오차 감소).
          let tCross = timeMs;
          if (gate.hasPrev && r > gate.prevRatio) {
            const f = (o.onRatio - gate.prevRatio) / (r - gate.prevRatio);
            const clamped = Math.min(1, Math.max(0, f));
            tCross = gate.prevTime + clamped * (timeMs - gate.prevTime);
          }
          if (tCross - gate.lastTriggerTime >= o.refractoryMs) {
            gate.active = true;
            gate.lastTriggerTime = tCross;
            triggers.push({ gate: i, time: tCross });
            measurement = this._onTrigger(i, tCross) || measurement;
          } else {
            gate.active = true;
          }
        } else if (gate.active && r <= o.offRatio) {
          gate.active = false;
        }
        gate.prevRatio = r;
        gate.prevTime = timeMs;
        gate.hasPrev = true;
      }
    } else {
      for (let i = 0; i < 2; i++) {
        this.gates[i].prevRatio = ratios[i];
        this.gates[i].prevTime = timeMs;
        this.gates[i].hasPrev = true;
      }
    }

    // 배경 갱신 (선택적 업데이트)
    // 움직이는 물체 위의 픽셀까지 빠르게 학습하면, 물체가 배경에 흡수됐다가
    // 지나간 뒤 "유령"이 남아 같은 게이트가 한 번 더 트리거된다. 전경으로 분류된
    // 픽셀은 아주 천천히만 갱신해서 그 현상을 막는다.
    const a = o.learnRate;
    const aFg = a * o.foregroundLearnFactor;
    const thr = o.pixelThreshold;
    const bg = this.bg;
    for (let i = 0; i < bg.length; i++) {
      const diff = gray[i] - bg[i];
      bg[i] += (diff > thr || diff < -thr ? aFg : a) * diff;
    }

    return { ratios, triggers, measurement, warmingUp: this.isWarmingUp };
  }

  _onTrigger(index, time) {
    const o = this.opts;
    if (this.pending && time - this.pending.time > o.maxDtMs) {
      this.pending = null; // 너무 오래된 대기 상태는 버린다
    }
    if (!this.pending) {
      this.pending = { index, time };
      return null;
    }
    if (this.pending.index === index) {
      this.pending = { index, time }; // 같은 게이트 재트리거 → 시작 시각 갱신
      return null;
    }
    const dtMs = time - this.pending.time;
    const first = this.pending.index;
    this.pending = null;
    if (dtMs < o.minDtMs || dtMs > o.maxDtMs) return null;
    return {
      dtMs,
      firstGate: first,
      /** 진행 방향: 'AB'는 A→B, 'BA'는 B→A */
      direction: first === 0 ? 'AB' : 'BA',
      time,
    };
  }
}

/**
 * 통과 시간(dt)과 게이트 간 실제 거리로 속도를 계산한다.
 * framePeriodMs를 주면 프레임 양자화에 따른 오차 범위도 함께 돌려준다.
 */
export function computeSpeed(distanceMeters, dtMs, framePeriodMs = 0) {
  const seconds = dtMs / 1000;
  const mps = distanceMeters / seconds;
  const kmh = mps * 3.6;
  let uncertaintyKmh = 0;
  if (framePeriodMs > 0 && dtMs > framePeriodMs) {
    // dt 오차를 ±(프레임 주기의 절반 × 게이트 2개) = ±framePeriodMs 로 보수적으로 잡는다.
    const rel = framePeriodMs / dtMs;
    uncertaintyKmh = kmh * rel;
  }
  return { mps, kmh, cmps: mps * 100, uncertaintyKmh };
}

/** 축척 모형 속도를 실차 환산 속도로 바꾼다 (1:scale 모형). */
export function scaleSpeed(kmh, scale) {
  return kmh * (scale > 0 ? scale : 1);
}
