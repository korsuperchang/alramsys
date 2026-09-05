/**
 * 흔들림 추정 — 화면 전체가 얼마나 밀렸는지 알아낸다.
 *
 * 손으로 든 폰은 화면 전체가 매 프레임 조금씩 밀린다. 이걸 그대로 두면 바닥 무늬가
 * 통째로 "움직이는 것"으로 잡혀서, 추적은 아무것도 못 잡고 기준선은 헛트리거를 낸다.
 *
 * 프레임마다 가로/세로 방향의 밝기 합(투영)을 구하고, 직전 프레임의 투영과 가장 잘
 * 겹치는 이동량을 찾는다. 1차원 두 개만 비교하므로 아주 싸다. 회전은 다루지 못하지만
 * 손떨림은 대부분 평행 이동이라 이것으로 충분하다.
 */

export const STABILIZER_DEFAULTS = {
  /** 한 프레임에서 찾아볼 최대 이동량(픽셀) */
  maxShift: 6,
  /** 배경 모델과 어긋난 채 누적될 수 있는 최대량(픽셀) */
  maxOffset: 10,
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
  trimRatio: 0.3,
  /**
   * "안 움직였다"에 유리하게 두는 정도. 0 이동일 때의 오차에 이 값을 곱한 것보다
   * 확실히 작아야 이동했다고 인정한다. 타일 바닥처럼 같은 무늬가 반복되면 어느
   * 이동량이든 그럴듯하게 맞아서, 가만히 있는 화면을 흔들린다고 보기 쉽다.
   */
  zeroBias: 0.85,
};

/**
 * 1차원 투영 두 개를 비교해 가장 잘 겹치는 이동량을 찾는다.
 * 오차는 큰 쪽부터 trimRatio만큼 버리고 합친다(움직이는 물체의 영향 제거).
 */
export function bestShift(cur, prev, maxShift, confidenceRatio, trimRatio = 0.3, scratch = null,
                          zeroBias = 0.85) {
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
  if (!tried) return 0;
  const mean = sum / tried;
  if (mean === 0 || bestErr / mean > confidenceRatio) return 0; // 판단 근거가 약하다
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
    this.prevCols = null;
    this.prevRows = null;
    /** 배경 모델 좌표 = 현재 프레임 좌표 + offset */
    this.offX = 0;
    this.offY = 0;
    /** 최근 프레임 간 이동량 (흔들림 세기) */
    this.dx = 0;
    this.dy = 0;
    this.magnitude = 0;
  }

  reset() {
    this.prevCols = null;
    this.prevRows = null;
    this.offX = 0;
    this.offY = 0;
    this.dx = 0;
    this.dy = 0;
    this.magnitude = 0;
  }

  /** 프레임 하나를 보고 흔들림을 갱신한다. @returns {{dx,dy,offX,offY,magnitude}} */
  update(gray, width, height) {
    const o = this.opts;
    if (width !== this.width || height !== this.height || !this.cols) {
      this.width = width;
      this.height = height;
      this.cols = new Float32Array(width);
      this.rows = new Float32Array(height);
      this.scratchX = new Float32Array(width);
      this.scratchY = new Float32Array(height);
      this.prevCols = null;
      this.prevRows = null;
    }
    const cols = this.cols.fill(0);
    const rows = this.rows.fill(0);
    for (let y = 0; y < height; y++) {
      const base = y * width;
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        const v = gray[base + x];
        cols[x] += v;
        rowSum += v;
      }
      rows[y] = rowSum / width;
    }
    for (let x = 0; x < width; x++) cols[x] /= height;

    if (this.prevCols) {
      this.dx = bestShift(cols, this.prevCols, o.maxShift, o.confidenceRatio, o.trimRatio, this.scratchX, o.zeroBias);
      this.dy = bestShift(rows, this.prevRows, o.maxShift, o.confidenceRatio, o.trimRatio, this.scratchY, o.zeroBias);
      this.magnitude = Math.hypot(this.dx, this.dy);
      const clamp = (v) => Math.max(-o.maxOffset, Math.min(o.maxOffset, v));
      this.offX = clamp(this.offX + this.dx);
      this.offY = clamp(this.offY + this.dy);
    } else {
      this.prevCols = new Float32Array(width);
      this.prevRows = new Float32Array(height);
    }
    this.prevCols.set(cols);
    this.prevRows.set(rows);

    return { dx: this.dx, dy: this.dy, offX: this.offX, offY: this.offY, magnitude: this.magnitude };
  }
}
