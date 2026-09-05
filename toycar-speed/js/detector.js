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

import { Stabilizer } from './stabilizer.js';

export const DEFAULT_OPTIONS = {
  /** 손떨림 보정 사용 여부 */
  stabilize: true,
  /**
   * 배경과 맞춘 뒤에도 화면의 이만큼이 달라져 있으면 정렬에 실패한 것으로 보고
   * 트리거를 막는다. 흔들림이 보정 범위를 넘으면 이 값이 치솟는다.
   */
  maxMisalignRatio: 0.08,
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
  /**
   * 두 게이트 사이(가운데 구간)를 실제로 지나갔는지 확인할 때 쓰는 문턱.
   * 게이트가 요구하는 움직임 픽셀 수에 이 배수를 곱한 값 이상이면 "지나갔다"로 본다.
   */
  midConfirmFactor: 0.25,
  /**
   * 전경으로 계속 남아 있는 픽셀을 배경으로 흡수하기까지의 프레임 수.
   * 배경 학습 시점에 화면에 있던 물체가 빠져나가면 그 자리가 오래 "다름"으로 남는데,
   * 이 값이 그 잔상의 수명을 정한다.
   */
  staleForegroundFrames: 120,
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
    this.prev = null;
    this.fgFrames = null;
    this.frames = 0;
    this.stabilizer = new Stabilizer();
    this.shake = 0;
    this.offX = 0;
    this.offY = 0;
    this.gates = [new GateState(), new GateState()];
    this.ratios = [0, 0];
    this.movedPixels = [0, 0];
    /** 먼저 통과한 게이트 정보 {index, time} */
    this.pending = null;
    /** 대기 중인 짝에 대해, 두 게이트 사이를 실제로 지나갔는지 확인했는가 */
    this.midSeen = false;
  }

  configure(partial) {
    Object.assign(this.opts, partial);
  }

  /** 배경 모델과 게이트 상태를 모두 초기화한다 (카메라 전환, 설정 변경 후 호출). */
  reset() {
    this.bg = null;
    this.prev = null;
    this.fgFrames = null;
    this.frames = 0;
    this.stabilizer.reset();
    this.shake = 0;
    this.offX = 0;
    this.offY = 0;
    this.ratios = [0, 0];
    this.movedPixels = [0, 0];
    this.pending = null;
    this.midSeen = false;
    for (const g of this.gates) g.reset();
  }

  get isWarmingUp() {
    return this.frames < this.opts.warmupFrames;
  }

  /** 게이트 선이 지나는 픽셀 인덱스 범위를 계산한다. */
  _bandRange(position, bandWidth = this.opts.bandWidth) {
    const o = this.opts;
    const axisLen = o.orientation === 'vertical' ? this.width : this.height;
    const half = Math.max(1, Math.round((bandWidth * axisLen) / 2));
    const center = Math.round(position * (axisLen - 1));
    const start = Math.max(0, center - half);
    const end = Math.min(axisLen - 1, center + half);
    return { start, end };
  }

  /** 한 게이트에서 움직임 픽셀 수와 비율을 센다. */
  _sampleRatio(gray, position, bandWidth = this.opts.bandWidth) {
    const o = this.opts;
    const { start, end } = this._bandRange(position, bandWidth);
    const crossLen = o.orientation === 'vertical' ? this.height : this.width;
    const roiFrom = Math.max(0, Math.round(Math.min(o.roiStart, o.roiEnd) * (crossLen - 1)));
    const roiTo = Math.min(crossLen - 1, Math.round(Math.max(o.roiStart, o.roiEnd) * (crossLen - 1)));
    const thr = o.pixelThreshold;
    let moved = 0;
    let total = 0;

    const inside = (x, y) => {
      const mx = x + this.offX;
      const my = y + this.offY;
      return mx >= 0 && mx < this.width && my >= 0 && my < this.height;
    };
    if (o.orientation === 'vertical') {
      for (let y = roiFrom; y <= roiTo; y++) {
        const row = y * this.width;
        const bgRow = (y + this.offY) * this.width + this.offX;
        for (let x = start; x <= end; x++) {
          if (!inside(x, y)) continue;
          const diff = gray[row + x] - this.bg[bgRow + x];
          if (diff > thr || diff < -thr) moved++;
          total++;
        }
      }
    } else {
      for (let y = start; y <= end; y++) {
        const row = y * this.width;
        const bgRow = (y + this.offY) * this.width + this.offX;
        for (let x = roiFrom; x <= roiTo; x++) {
          if (!inside(x, y)) continue;
          const diff = gray[row + x] - this.bg[bgRow + x];
          if (diff > thr || diff < -thr) moved++;
          total++;
        }
      }
    }
    return { ratio: total === 0 ? 0 : moved / total, moved, total };
  }

  /** 구간 안에서 직전 프레임 대비 밝기가 변한 픽셀 수를 센다 (실제 움직임). */
  _sampleMotion(gray, position, bandWidth) {
    const o = this.opts;
    const { start, end } = this._bandRange(position, bandWidth);
    const crossLen = o.orientation === 'vertical' ? this.height : this.width;
    const roiFrom = Math.max(0, Math.round(Math.min(o.roiStart, o.roiEnd) * (crossLen - 1)));
    const roiTo = Math.min(crossLen - 1, Math.round(Math.max(o.roiStart, o.roiEnd) * (crossLen - 1)));
    const thr = o.pixelThreshold;
    const prev = this.prev;
    let moved = 0;
    if (o.orientation === 'vertical') {
      for (let y = roiFrom; y <= roiTo; y++) {
        const row = y * this.width;
        for (let x = start; x <= end; x++) {
          const d = gray[row + x] - prev[row + x];
          if (d > thr || d < -thr) moved++;
        }
      }
    } else {
      for (let y = start; y <= end; y++) {
        const row = y * this.width;
        for (let x = roiFrom; x <= roiTo; x++) {
          const d = gray[row + x] - prev[row + x];
          if (d > thr || d < -thr) moved++;
        }
      }
    }
    return moved;
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
      this.prev = new Uint8Array(gray.length);
      this.prev.set(gray);
      this.fgFrames = new Uint16Array(gray.length);
      this.frames = 0;
      this.pending = null;
      this.midSeen = false;
      for (const g of this.gates) g.reset();
    }

    const shift = o.stabilize
      ? this.stabilizer.update(gray, this.bg, width, height)
      : { offX: 0, offY: 0, magnitude: 0 };
    this.shake = shift.magnitude;
    this.offX = shift.offX;
    this.offY = shift.offY;
    // 보정 한계에 닿았거나, 맞춘 뒤에도 화면이 크게 다르면 정렬에 실패한 것이다.
    // 틀린 값을 내느니 멈춘다. 한 번 실패하면 배경이 다시 자리 잡을 때까지 유지한다.
    const saturated = Math.abs(this.offX) >= this.stabilizer.opts.maxShift
      || Math.abs(this.offY) >= this.stabilizer.opts.maxShift;
    this.misalign = Math.max(saturated ? 1 : this.globalCoverage || 0, (this.misalign || 0) * 0.85);
    const tooShaky = this.misalign > o.maxMisalignRatio;

    const sampleA = this._sampleRatio(gray, o.gateA);
    const sampleB = this._sampleRatio(gray, o.gateB);
    const ratios = [sampleA.ratio, sampleB.ratio];
    const moved = [sampleA.moved, sampleB.moved];
    this.ratios = ratios;
    this.movedPixels = moved;
    this.frames++;

    const triggers = [];
    let measurement = null;

    if (!this.isWarmingUp && !tooShaky) {
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

    // 대기 중인 짝이 있으면, 두 게이트 사이를 실제로 지나가는지 지켜본다.
    // 이게 없으면 게이트 하나를 놓쳤을 때 짝이 어긋난 채로 고정되어,
    // 이후 모든 측정이 "한 바퀴 도는 시간"으로 잡히고 방향까지 뒤집힌다.
    // 첫 게이트를 완전히 벗어난 뒤부터 본다. 게이트 근처에서 어른거리는 것만으로
    // "지나갔다"고 인정하면, 반대편으로 나가 버린 물체도 통과로 잘못 잡힌다.
    if (this.pending && !this.midSeen && !this.gates[this.pending.index].active) {
      const midPos = (o.gateA + o.gateB) / 2;
      const midWidth = Math.max(o.bandWidth, Math.abs(o.gateB - o.gateA) / 3);
      // 배경 차분이 아니라 프레임 간 차분으로 본다. 배경 차분은 학습 시점에 화면에
      // 있던 물체가 남긴 "정지한 잔상"에도 반응하지만, 프레임 간 차분은 실제로
      // 움직이는 것에만 반응한다.
      const moving = this._sampleMotion(gray, midPos, midWidth);
      const needed = Math.max(o.minMovedPixels, o.midConfirmFactor * o.onRatio * sampleA.total);
      if (moving >= needed) this.midSeen = true;
    }

    // 배경 갱신 (선택적 업데이트)
    // 움직이는 물체 위의 픽셀까지 빠르게 학습하면, 물체가 배경에 흡수됐다가
    // 지나간 뒤 "유령"이 남아 같은 게이트가 한 번 더 트리거된다. 전경으로 분류된
    // 픽셀은 아주 천천히만 갱신해서 그 현상을 막는다.
    const a = o.learnRate;
    const aFg = a * o.foregroundLearnFactor;
    const thr = o.pixelThreshold;
    const stale = o.staleForegroundFrames;
    const bg = this.bg;
    const fg = this.fgFrames;
    const prev = this.prev;
    const offX = this.offX;
    const offY = this.offY;
    const y0 = Math.max(0, -offY);
    const y1 = Math.min(height, height - offY);
    const x0 = Math.max(0, -offX);
    const x1 = Math.min(width, width - offX);
    let changed = 0;
    let seen = 0;
    for (let y = y0; y < y1; y++) {
      const row = y * width;
      const bgRow = (y + offY) * width + offX;
      for (let x = x0; x < x1; x++) {
        const i = bgRow + x;
        seen++;
        const diff = gray[row + x] - bg[i];
        if (diff > thr || diff < -thr) {
          changed++;
          // 너무 오래 전경으로 남아 있으면(치워진 물건, 옮겨진 카메라) 배경으로 받아들인다.
          bg[i] += (fg[i]++ > stale ? a : aFg) * diff;
        } else {
          fg[i] = 0;
          bg[i] += a * diff;
        }
      }
    }
    // 배경과 맞춘 뒤에도 화면의 얼마가 다른지 — 정렬이 실패했는지 재는 잣대
    this.globalCoverage = seen ? changed / seen : 0;
    prev.set(gray);

    return { ratios, triggers, measurement, warmingUp: this.isWarmingUp, shake: this.shake, tooShaky };
  }

  _onTrigger(index, time) {
    const o = this.opts;
    if (this.pending && time - this.pending.time > o.maxDtMs) {
      this.pending = null; // 너무 오래된 대기 상태는 버린다
    }
    if (!this.pending) {
      this.pending = { index, time };
      this.midSeen = false;
      return null;
    }
    if (this.pending.index === index) {
      this.pending = { index, time }; // 같은 게이트 재트리거 → 시작 시각 갱신
      this.midSeen = false;
      return null;
    }
    if (!this.midSeen) {
      // 사이 구간을 지나온 흔적이 없다 → 앞선 트리거는 다른 통과의 잔재다.
      // 버리는 대신 이번 트리거를 새 출발점으로 삼아 짝을 다시 맞춘다.
      this.pending = { index, time };
      return null;
    }
    const dtMs = time - this.pending.time;
    const first = this.pending.index;
    this.pending = null;
    this.midSeen = false;
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
