/**
 * 흔들림 추정 — 화면 전체가 얼마나 밀렸는지 알아낸다.
 *
 * 손으로 든 폰은 화면 전체가 매 프레임 조금씩 밀린다. 이걸 그대로 두면 바닥 무늬가
 * 통째로 "움직이는 것"으로 잡혀서, 추적은 아무것도 못 잡고 기준선은 헛트리거를 낸다.
 *
 * 프레임마다 가로/세로 방향의 밝기 합(투영)을 구하고, **배경 모델**의 투영과 가장 잘
 * 겹치는 이동량을 찾는다. 1차원 두 개만 비교하므로 아주 싸다. 회전은 다루지 못하지만
 * 손떨림은 대부분 평행 이동이라 이것으로 충분하다.
 *
 * 직전 프레임과 비교하면 안 된다. 천천히 미끄러지는 카메라는 프레임 간 이동이 1픽셀
 * 미만이라 매번 0으로 반올림되는데, 그게 쌓이면 배경과 몇 픽셀씩 어긋난다. 그러면
 * 바닥 무늬 전체가 "움직이는 것"으로 잡혀서 정작 자동차를 못 찾는다.
 * 배경 모델과 직접 견주면 누적된 어긋남이 그대로 측정된다.
 */

export const STABILIZER_DEFAULTS = {
  /** 어긋난 양을 찾아볼 최대 범위(픽셀). 이 범위를 넘는 흔들림은 보정하지 못한다. */
  maxShift: 12,
  /**
   * 최소 오차와 평균 오차의 비. 이보다 크면 무늬가 밋밋해 신뢰할 수 없다고 보고 0으로 둔다.
   * (벽처럼 균일한 면을 비추면 어떤 이동량이든 비슷하게 맞는다)
   */
  confidenceRatio: 0.92,
  /**
   * 오차를 합칠 때 값이 큰 쪽부터 버리는 비율.
   * 지나가는 자동차 한 대는 투영의 일부만 크게 흔들어 놓는데, 이걸 그대로 합치면
   * 화면이 아니라 자동차를 따라가 버린다. 큰 값들을 버리면 남는 것은 배경이다.
   */
  trimRatio: 0.45,
  /**
   * "안 움직였다"에 유리하게 두는 정도. 0 이동일 때의 오차에 이 값을 곱한 것보다
   * 확실히 작아야 이동했다고 인정한다. 타일 바닥처럼 같은 무늬가 반복되면 어느
   * 이동량이든 그럴듯하게 맞아서, 가만히 있는 화면을 흔들린다고 보기 쉽다.
   */
  zeroBias: 0.85,
  /**
   * 정렬 판단에 필요한 최소 신호(밝기 단위). 이보다 작으면 견줄 무늬가 없다는 뜻이라
   * 어떤 이동량을 골라도 근거가 없다. 부동소수점 오차로 이동량을 정하는 일을 막는다.
   */
  minSignal: 0.5,
};

/**
 * 1차원 투영 두 개를 비교해 가장 잘 겹치는 이동량을 찾는다.
 * 오차는 큰 쪽부터 trimRatio만큼 버리고 합친다(움직이는 물체의 영향 제거).
 */
export function bestShift(cur, prev, maxShift, confidenceRatio, trimRatio = 0.45, scratch = null,
                          zeroBias = 0.85, minSignal = 0.5, out = null) {
  const n = cur.length;
  const buf = scratch && scratch.length >= n ? scratch : new Float32Array(n);
  let best = 0;
  let bestErr = Infinity;
  let zeroErr = Infinity;
  let sum = 0;
  let tried = 0;
  // 0에 가까운 이동량부터 살펴본다. 반복 무늬에서는 여러 이동량의 오차가 똑같이
  // 0이 되는데, 그때는 "가장 덜 움직인" 쪽을 답으로 삼아야 한다.
  const order = [0];
  for (let k = 1; k <= maxShift; k++) order.push(k, -k);
  for (const s of order) {
    const from = Math.max(0, -s);
    const to = Math.min(n, n - s);
    const len = to - from;
    if (len < n / 2) continue;
    for (let i = 0; i < len; i++) buf[i] = Math.abs(cur[from + i] - prev[from + i + s]);
    const keep = Math.max(1, Math.round(len * (1 - trimRatio)));
    const sorted = buf.subarray(0, len).slice().sort();
    let err = 0;
    for (let i = 0; i < keep; i++) err += sorted[i];
    err /= keep;
    sum += err;
    tried++;
    if (s === 0) zeroErr = err;
    if (err < bestErr) { bestErr = err; best = s; }
  }
  if (out) out.residual = bestErr;
  if (!tried) return 0;
  const mean = sum / tried;
  if (mean < minSignal) return 0;                               // 견줄 무늬가 없다
  if (bestErr / mean > confidenceRatio) return 0;               // 판단 근거가 약하다
  if (best !== 0 && bestErr > zeroErr * zeroBias) return 0;     // 가만히 있는 쪽이 그럴듯하다
  return best;
}

export class Stabilizer {
  constructor(options = {}) {
    this.opts = { ...STABILIZER_DEFAULTS, ...options };
    this.width = 0;
    this.height = 0;
    this.cols = null;
    this.rows = null;
    this.refCols = null;
    this.refRows = null;
    /** 배경 모델 좌표 = 현재 프레임 좌표 + offset */
    this.offX = 0;
    this.offY = 0;
    /** 직전 프레임 대비 움직인 양 (흔들림 세기) */
    this.magnitude = 0;
    this.residual = 0;
  }

  reset() {
    this.offX = 0;
    this.offY = 0;
    this.magnitude = 0;
  }

  /** 가로·세로 방향 평균 밝기 투영을 구한다. */
  _project(src, width, height, cols, rows) {
    cols.fill(0);
    for (let y = 0; y < height; y++) {
      const base = y * width;
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        const v = src[base + x];
        cols[x] += v;
        rowSum += v;
      }
      rows[y] = rowSum / width;
    }
    for (let x = 0; x < width; x++) cols[x] /= height;
  }

  /**
   * 현재 프레임이 배경 모델에서 얼마나 밀려 있는지 구한다.
   * @param {Uint8Array} gray 현재 프레임
   * @param {Float32Array|Uint8Array} reference 배경 모델
   * @returns {{offX:number, offY:number, magnitude:number}}
   */
  update(gray, reference, width, height) {
    const o = this.opts;
    if (width !== this.width || height !== this.height || !this.cols) {
      this.width = width;
      this.height = height;
      this.cols = new Float32Array(width);
      this.rows = new Float32Array(height);
      this.refCols = new Float32Array(width);
      this.refRows = new Float32Array(height);
      this.scratchX = new Float32Array(width);
      this.scratchY = new Float32Array(height);
    }
    this._project(gray, width, height, this.cols, this.rows);
    this._project(reference, width, height, this.refCols, this.refRows);

    const prevX = this.offX;
    const prevY = this.offY;
    const outX = { residual: 0 };
    const outY = { residual: 0 };
    this.offX = bestShift(this.cols, this.refCols, o.maxShift, o.confidenceRatio, o.trimRatio, this.scratchX, o.zeroBias, o.minSignal, outX);
    this.offY = bestShift(this.rows, this.refRows, o.maxShift, o.confidenceRatio, o.trimRatio, this.scratchY, o.zeroBias, o.minSignal, outY);
    /** 맞춘 뒤에도 남은 어긋남(밝기 단위). 크면 정렬에 실패한 것이다. */
    this.residual = Math.max(outX.residual, outY.residual);
    this.magnitude = Math.hypot(this.offX - prevX, this.offY - prevY);

    return { offX: this.offX, offY: this.offY, magnitude: this.magnitude, residual: this.residual };
  }
}
