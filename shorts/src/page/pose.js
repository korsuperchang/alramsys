/* ------------------------------------------------------------------
 * pose.js — 페이스온(정면) 시점 골프 스윙의 파라메트릭 모델
 *
 * 좌표계: x 오른쪽(+), y 아래(+), 도형 박스 0..100
 * 각도 u(θ): θ=0 위, 90 오른쪽, 180 아래, 270 왼쪽
 * 타깃(볼이 날아가는 방향) = 화면 왼쪽, 백스윙 = 화면 오른쪽
 * ------------------------------------------------------------------ */

const D = Math.PI / 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;
const seg = (t, a, b) => clamp01((t - a) / (b - a));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;
const u = (th) => ({ x: Math.sin(th * D), y: -Math.cos(th * D) });
const rotp = (p, c, deg) => {
  const s = Math.sin(deg * D), co = Math.cos(deg * D);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * co - dy * s, y: c.y + dx * s + dy * co };
};

/* 2본 IK — a(어깨/골반)에서 b(손/발목)까지 l1,l2 길이의 관절 위치 */
function ik(a, b, l1, l2, bend) {
  let dx = b.x - a.x, dy = b.y - a.y;
  let dist = Math.hypot(dx, dy) || 0.001;
  const ux = dx / dist, uy = dy / dist;
  const max = l1 + l2 - 0.01;
  const min = Math.abs(l1 - l2) + 0.01;
  const d = Math.min(Math.max(dist, min), max);
  const a1 = (d * d + l1 * l1 - l2 * l2) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a1 * a1));
  return { x: a.x + ux * a1 - uy * h * bend, y: a.y + uy * a1 + ux * h * bend };
}

/* 스윙 구간 상수 */
const CLUB = 36.5;      // 클럽 길이(도형 단위)
const TOP = 0.44;      // 백스윙 톱
const IMPACT = 0.635;  // 임팩트
const FINISH = 0.86;   // 피니시

const PERSONA = {
  pro: {
    key: 'pro', label: 'PRO', ko: '프로',
    shoulderTop: 92, hipTop: 45,            // 회전량 (스토리보드 수치)
    armTop: -143, armFinish: 143,
    cockTop: 107, cockImpact: 12, cockFinish: 200,
    openShoulderImpact: 25, openHipImpact: 42,
    tiltImpact: 13, sway: 1.3, release: 'late',
    seq: { hip: 0.455, torso: 0.482, arm: 0.508, club: 0.562 },
    order: ['골반', '몸통', '팔', '클럽'],
  },
  am: {
    key: 'am', label: 'AMATEUR', ko: '일반인',
    shoulderTop: 76, hipTop: 28,
    armTop: -126, armFinish: 116,
    cockTop: 88, cockImpact: -14, cockFinish: 165,
    openShoulderImpact: 8, openHipImpact: 13,
    tiltImpact: 3, sway: 3.6, release: 'early',
    seq: { arm: 0.450, club: 0.459, torso: 0.500, hip: 0.536 },
    order: ['팔', '클럽', '몸통', '골반'],
  },
};

/* 시간 t(0..1, 한 번의 스윙)에서 각 채널 값 */
function channels(P, t) {
  const S = P.seq;
  const bs = easeInOut(seg(t, 0.10, TOP));
  const rel = P.release === 'late' ? easeIn : (x) => x;

  let sh = P.shoulderTop * bs;
  if (t >= S.torso) sh = lerp(P.shoulderTop, -P.openShoulderImpact, easeInOut(seg(t, S.torso, IMPACT)));
  if (t >= IMPACT) sh = lerp(-P.openShoulderImpact, -128, easeOut(seg(t, IMPACT, FINISH)));

  let hip = P.hipTop * bs;
  if (t >= S.hip) hip = lerp(P.hipTop, -P.openHipImpact, easeInOut(seg(t, S.hip, IMPACT)));
  if (t >= IMPACT) hip = lerp(-P.openHipImpact, -100, easeOut(seg(t, IMPACT, FINISH)));

  let arm = 180 + P.armTop * bs;
  if (t >= S.arm) arm = lerp(180 + P.armTop, 180, easeInOut(seg(t, S.arm, IMPACT)));
  if (t >= IMPACT) arm = lerp(180, 180 + P.armFinish, easeOut(seg(t, IMPACT, FINISH)));

  let cock = P.cockTop * easeInOut(seg(t, 0.14, TOP));
  if (t >= S.club) cock = lerp(P.cockTop, P.cockImpact, rel(seg(t, S.club, IMPACT)));
  if (t >= IMPACT) cock = lerp(P.cockImpact, P.cockFinish, easeIn(seg(t, IMPACT, FINISH)));

  let sway = P.sway * bs;
  if (t >= S.hip) sway = lerp(P.sway, -P.sway * 0.7, easeInOut(seg(t, S.hip, IMPACT)));
  if (t >= IMPACT) sway = lerp(-P.sway * 0.7, -P.sway * 1.5, easeOut(seg(t, IMPACT, FINISH)));

  let tilt = 5 * bs;
  if (t >= S.torso) tilt = lerp(5, P.tiltImpact, easeInOut(seg(t, S.torso, IMPACT)));
  if (t >= IMPACT) tilt = lerp(P.tiltImpact, -9, easeOut(seg(t, IMPACT, FINISH)));

  const fin = easeOut(seg(t, IMPACT, FINISH));
  return { sh, hip, arm, cock, sway, tilt, fin, bs };
}

/* 관절 좌표 계산 */
function pose(P, t) {
  const c = channels(P, t);
  const pelvis = { x: 50 + c.sway, y: 54 };

  const hw = 8.6 * Math.cos(c.hip * D);
  const hipTilt = -c.hip * 0.09;
  const hipL = rotp({ x: pelvis.x - hw, y: pelvis.y }, pelvis, hipTilt);
  const hipR = rotp({ x: pelvis.x + hw, y: pelvis.y }, pelvis, hipTilt);

  const neck = rotp({ x: pelvis.x, y: pelvis.y - 26 }, pelvis, c.tilt);
  const sw = 11.6 * Math.cos(c.sh * D);
  const shTilt = -c.sh * 0.17 + c.tilt;
  const shL = rotp({ x: neck.x - sw, y: neck.y }, neck, shTilt);
  const shR = rotp({ x: neck.x + sw, y: neck.y }, neck, shTilt);
  const head = rotp({ x: neck.x, y: neck.y - 9 }, neck, c.tilt * 0.7);

  const chest = { x: (shL.x + shR.x) / 2, y: (shL.y + shR.y) / 2 + 4 };
  const dir = u(c.arm);
  const hands = { x: chest.x + dir.x * 23 * 0.82, y: chest.y + dir.y * 23 };

  const elbowL = ik(shL, hands, 13.4, 14.2, +1);   // 리드 팔: 거의 펴짐
  const elbowR = ik(shR, hands, 11.6, 12.4, -1);   // 트레일 팔: 접힘

  const ankleL = { x: 41, y: 95 };
  const ankleR = { x: 59 - 3.5 * c.fin, y: 95 - 7 * c.fin };
  const kneeL = ik(hipL, ankleL, 20.8, 21.4, +1);
  const kneeR = ik(hipR, ankleR, 20.8, 21.4, -1);

  const cd = u(c.arm - c.cock);
  const clubhead = { x: hands.x + cd.x * CLUB, y: hands.y + cd.y * CLUB };

  return {
    head, neck, shL, shR, elbowL, elbowR, hands, chest,
    pelvis, hipL, hipR, kneeL, kneeR, ankleL, ankleR, clubhead,
    ch: c,
  };
}

/* 클럽 헤드 궤적 샘플 */
function clubPath(P, t0, t1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = lerp(t0, t1, i / n);
    pts.push(pose(P, t).clubhead);
  }
  return pts;
}
