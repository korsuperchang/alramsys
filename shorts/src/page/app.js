/* ------------------------------------------------------------------
 * app.js — 씬 구성 + 프레임 렌더러 (결정론적 seek)
 * window.__render(t) 를 호출하면 t초 시점 화면이 그려진다.
 * ------------------------------------------------------------------ */

const W = 1080, H = 1920, PAD = 56, CW = W - PAD * 2;   // 콘텐츠 폭 968
const VB      = { x: 20, y: -8,  w: 66, h: 106 };       // 정지 포즈용(크게)
const VB_WIDE = { x: 17, y: -10, w: 78, h: 108 };       // 다운스윙 재생용
const VB_TRAIL = { x: -4, y: -14, w: 110, h: 118 };     // 스윙 궤적 전체가 들어가는 넓은 프레임
const COL = { pro: '#2fe27a', am: '#ff4d5f', gold: '#ffc83d' };

const fix = (n) => (Math.round(n * 100) / 100);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const SP = 0.68;   // 등장 타이밍 배속(작을수록 빠르게)

/* 등장 애니메이션: 지연 delay 초 후 dur 초 동안 아래에서 페이드인 */
function rise(l, delay, dur = 0.45, dy = 26) {
  const p = clamp01((l - delay * SP) / (dur * SP));
  const e = easeOut(p);
  return `opacity:${fix(e)};transform:translateY(${fix((1 - e) * dy)}px)`;
}
/* SP 배속을 타지 않는 절대 시각용 */
function riseAt(l, at, dur = 0.34, dy = 24) {
  const e = easeOut(clamp01((l - at) / dur));
  return `opacity:${fix(e)};transform:translateY(${fix((1 - e) * dy)}px)`;
}

function pop(l, delay, dur = 0.4) {
  const p = clamp01((l - delay * SP) / (dur * SP));
  const e = 1 - Math.pow(1 - p, 3);
  const s = 0.82 + 0.18 * e + Math.sin(p * Math.PI) * 0.05;
  return `opacity:${fix(e)};transform:scale(${fix(s)})`;
}
function countUp(to, l, delay, dur = 0.9) {
  return Math.round(to * easeOut(clamp01((l - delay * SP) / (dur * SP))));
}

/* viewBox → 패널 픽셀 좌표 매핑 (preserveAspectRatio="xMidYMid meet") */
function mapper(w, h, V = VB) {
  const s = Math.min(w / V.w, h / V.h);
  const ox = (w - V.w * s) / 2 - V.x * s;
  const oy = (h - V.h * s) / 2 - V.y * s;
  return (p) => ({ x: p.x * s + ox, y: p.y * s + oy });
}

/* 회전량 표시 — 수평면을 납작한 타원으로 투영한 '턴 게이지' */
function turnArc(cx, cy, rx, ry, deg, color, w = 2) {
  const n = Math.max(3, Math.round(Math.abs(deg) / 5));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = (-deg * i / n) * Math.PI / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  let s = `<ellipse cx="${fix(cx)}" cy="${fix(cy)}" rx="${rx}" ry="${ry}" fill="none" stroke="rgba(255,255,255,.20)" stroke-width=".6" stroke-dasharray="2 2"/>`;
  s += `<polyline points="${pts.map((p) => p.map(fix).join(',')).join(' ')}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
  const e = pts[pts.length - 1], q = pts[pts.length - 2];
  const dx = e[0] - q[0], dy = e[1] - q[1], m = Math.hypot(dx, dy) || 1;
  const ux = dx / m, uy = dy / m, hx = -uy, hy = ux;
  s += `<polygon points="${fix(e[0] + ux * 3)},${fix(e[1] + uy * 3)} ${fix(e[0] + hx * 1.7)},${fix(e[1] + hy * 1.7)} ${fix(e[0] - hx * 1.7)},${fix(e[1] - hy * 1.7)}" fill="${color}"/>`;
  return s;
}

/* ---------------- 피규어(스켈레톤) SVG ---------------- */
function fig(P, t, o = {}) {
  const c = COL[P.key];
  const p = pose(P, t);
  const L = (a, b, w = 2.7, op = 1) =>
    `<line x1="${fix(a.x)}" y1="${fix(a.y)}" x2="${fix(b.x)}" y2="${fix(b.y)}" stroke="${c}" stroke-width="${w}" stroke-linecap="round" opacity="${op}"/>`;
  const J = (q, r = 1.9) =>
    `<circle cx="${fix(q.x)}" cy="${fix(q.y)}" r="${r}" fill="${c}"/>`;

  const V = o.vb || VB;
  let s = `<svg viewBox="${V.x} ${V.y} ${V.w} ${V.h}" preserveAspectRatio="xMidYMid meet">`;
  s += `<defs><filter id="g${P.key}" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="1.15" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;

  /* 지면 */
  if (o.ground !== false) {
    s += `<line x1="${V.x + 2}" y1="95" x2="${V.x + V.w - 2}" y2="95" stroke="rgba(255,255,255,.16)" stroke-width=".6"/>`;
    s += `<ellipse cx="50" cy="95" rx="26" ry="2.6" fill="rgba(255,255,255,.045)"/>`;
  }

  /* 뒤쪽 보조 그래픽 */
  if (o.pre) s += o.pre(p, c);

  /* 공 */
  if (o.ball !== false) {
    const gone = t > IMPACT ? clamp01((t - IMPACT) / 0.06) : 0;
    if (gone < 1) s += `<circle cx="50" cy="92.6" r="1.7" fill="#fff" opacity="${fix(1 - gone)}"/>`;
  }

  s += `<g filter="url(#g${P.key})">`;
  /* 몸통 */
  s += `<polygon points="${[p.shL, p.shR, p.hipR, p.hipL].map(q => `${fix(q.x)},${fix(q.y)}`).join(' ')}" fill="${c}" opacity=".13"/>`;
  s += L(p.shL, p.shR, 2.9) + L(p.hipL, p.hipR, 2.9);
  s += L(p.neck, p.pelvis, 2.4, .85);
  /* 다리 */
  s += L(p.hipL, p.kneeL) + L(p.kneeL, p.ankleL) + L(p.hipR, p.kneeR) + L(p.kneeR, p.ankleR);
  /* 팔 */
  s += L(p.shL, p.elbowL, 2.4) + L(p.elbowL, p.hands, 2.4);
  s += L(p.shR, p.elbowR, 2.4) + L(p.elbowR, p.hands, 2.4);
  /* 머리 */
  s += `<circle cx="${fix(p.head.x)}" cy="${fix(p.head.y)}" r="5.4" fill="${c}" opacity=".16"/>`;
  s += `<circle cx="${fix(p.head.x)}" cy="${fix(p.head.y)}" r="5.4" fill="none" stroke="${c}" stroke-width="2.2"/>`;
  /* 클럽 */
  const hv = { x: p.clubhead.x - p.hands.x, y: p.clubhead.y - p.hands.y };
  const hn = Math.hypot(hv.x, hv.y) || 1;
  const perp = { x: -hv.y / hn, y: hv.x / hn };
  s += `<line x1="${fix(p.hands.x)}" y1="${fix(p.hands.y)}" x2="${fix(p.clubhead.x)}" y2="${fix(p.clubhead.y)}" stroke="#e7edf3" stroke-width="1.05" stroke-linecap="round" opacity=".92"/>`;
  s += `<line x1="${fix(p.clubhead.x - perp.x * 2.4)}" y1="${fix(p.clubhead.y - perp.y * 2.4)}" x2="${fix(p.clubhead.x + perp.x * 2.4)}" y2="${fix(p.clubhead.y + perp.y * 2.4)}" stroke="#e7edf3" stroke-width="2.6" stroke-linecap="round"/>`;
  /* 관절 */
  if (o.joints !== false) {
    [p.shL, p.shR, p.elbowL, p.elbowR, p.hipL, p.hipR, p.kneeL, p.kneeR, p.ankleL, p.ankleR, p.hands]
      .forEach((q) => { s += J(q); });
  }
  s += `</g>`;

  if (o.post) s += o.post(p, c);
  s += `</svg>`;
  return s;
}

/* 회전 각도 호(arc) */
function arc(cx, cy, r, a0, a1, color, w = 1.6, dash = '') {
  const P0 = { x: cx + r * Math.sin(a0 * Math.PI / 180), y: cy - r * Math.cos(a0 * Math.PI / 180) };
  const P1 = { x: cx + r * Math.sin(a1 * Math.PI / 180), y: cy - r * Math.cos(a1 * Math.PI / 180) };
  const big = Math.abs(a1 - a0) > 180 ? 1 : 0;
  const sweep = a1 > a0 ? 1 : 0;
  return `<path d="M ${fix(P0.x)} ${fix(P0.y)} A ${r} ${r} 0 ${big} ${sweep} ${fix(P1.x)} ${fix(P1.y)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
}

/* 절대좌표 패널 — 멀티 화면(분할/모프)에서 사용 */
function absPanel(P, t, r, o = {}) {
  const tag = o.tag === false ? ''
    : `<div class="tag" style="font-size:${o.tagSize || 31}px;padding:${o.tagSize ? 5 : 8}px ${o.tagSize ? 16 : 26}px">${o.tagText || P.label}</div>`;
  return `<div class="panel ${P.key}" style="position:absolute;left:${fix(r.x)}px;top:${fix(r.y)}px;
    width:${fix(r.w)}px;height:${fix(r.h)}px;opacity:${fix(o.op ?? 1)};border-radius:${o.radius || 26}px">
    <div class="fld"></div>${tag}${fig(P, t, o)}${o.inner || ''}
  </div>`;
}
const lerpRect = (a, b, k) => ({
  x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k),
  w: lerp(a.w, b.w, k), h: lerp(a.h, b.h, k),
});

/* 패널 래퍼 */
function panel(P, t, w, h, o = {}, inner = '') {
  const ghost = o.ghost
    ? `<div style="position:absolute;inset:0;opacity:.28">${fig(o.ghost.P, o.ghost.t, { vb: o.vb, ball: false, joints: false })}</div>`
    : '';
  return `<div class="panel ${P.key}" style="width:${w}px;height:${h}px">
    <div class="fld"></div>
    <div class="tag">${P.label}</div>
    ${ghost}
    ${fig(P, t, o)}
    ${inner}
  </div>`;
}

/* ================================================================
 *  씬 정의
 * ================================================================ */
const PRO = PERSONA.pro, AM = PERSONA.am;
const loop = (l, period) => (l % period) / period;

const SCENES = [];
const TIMING = (typeof window !== 'undefined' && window.__timing) || {};
const S = (id, dur, build) => SCENES.push({ id, dur: TIMING[id]?.dur ?? dur, build });

/* ---------- 1. 인트로 — 4분할로 열고 2패널로 합쳐진다 ---------- */
S('intro', 4, (l) => {
  const H = 860, G = 18;
  const cw = (CW - G) / 2, ch = (H - G) / 2;
  const L = { x: 0, y: 0, w: 472, h: H };            // 합체 후 왼쪽
  const R = { x: CW - 472, y: 0, w: 472, h: H };     // 합체 후 오른쪽
  const cells = [
    { P: PRO, t0: TOP,    r0: { x: 0, y: 0, w: cw, h: ch },                 to: L, d: 0.00 },
    { P: AM,  t0: TOP,    r0: { x: cw + G, y: 0, w: cw, h: ch },            to: R, d: 0.11 },
    { P: PRO, t0: IMPACT, r0: { x: 0, y: ch + G, w: cw, h: ch },            to: L, d: 0.22 },
    { P: AM,  t0: IMPACT, r0: { x: cw + G, y: ch + G, w: cw, h: ch },       to: R, d: 0.33 },
  ];
  const k = easeInOut(clamp01((l - 1.55) / 0.6));   // 합체 진행도(절대 시각)
  let boxes = '';
  cells.forEach((c, i) => {
    const app = easeOut(clamp01((l - c.d) / 0.26));
    if (app <= 0) return;
    const r = lerpRect(c.r0, c.to, k);
    const back = i >= 2;                       // 아래 두 칸은 합쳐지며 사라진다
    const op = (back ? Math.pow(clamp01(1 - k * 2.2), 2) : 1) * app;
    const t = lerp(c.t0, 0.05 + 0.012 * Math.sin(l * 2.1), k);
    boxes += absPanel(c.P, t, r, {
      op, tagText: k > 0.5 ? c.P.ko : null, tagSize: k > 0.5 ? 31 : 24,
      tag: !back || k < 0.5,
      inner: `<div style="position:absolute;left:0;right:0;bottom:14px;text-align:center;
        font-size:24px;font-weight:800;letter-spacing:.06em;color:#9aa6b2;opacity:${fix(clamp01(1 - k * 2.6))}">
        ${c.t0 === TOP ? 'TOP' : 'IMPACT'}</div>`,
    });
  });
  return `<div class="scene">
    <div style="position:relative;width:${CW}px;height:${H}px">${boxes}</div>
    <div style="height:92px"></div>
    <div style="text-align:center">
      <div class="title" style="${riseAt(l, 2.15)}">프로의 스윙과 일반인의 스윙은</div>
      <div class="title" style="font-size:92px;margin-top:20px;${riseAt(l, 2.55)}"><span class="g">왜 다를까?</span></div>
    </div>
  </div>`;
});

/* ---------- 2. 관절 비교 (0:06~0:15) ---------- */
S('joints', 4.5, (l) => {
  const t = 0.05;
  const PW = 404, PH = 820, GAP = 160, OX = PW + GAP;
  const m = mapper(PW, PH);
  const pp = pose(PRO, t), ap = pose(AM, t);
  const rows = [
    ['어깨', 'shR', 'shL'],
    ['팔꿈치', 'elbowR', 'elbowL'],
    ['골반', 'hipR', 'hipL'],
    ['무릎', 'kneeR', 'kneeL'],
    ['발목', 'ankleR', 'ankleL'],
  ];
  let ov = `<svg class="ov" width="${CW}" height="${PH}" style="position:absolute;inset:0;z-index:5;pointer-events:none">`;
  let labels = '';
  rows.forEach((r, i) => {
    const d = 0.75 + i * 0.52;
    const k = clamp01((l - d) / 0.4), e = easeOut(k);
    if (k <= 0) return;
    const a = m(pp[r[1]]), b = m(ap[r[2]]);
    const cx = CW / 2, cy = (a.y + b.y) / 2;
    const x1 = a.x + (cx - 64 - a.x) * e, x2 = b.x + OX + ((cx + 64) - (b.x + OX)) * e;
    ov += `<line x1="${fix(a.x)}" y1="${fix(a.y)}" x2="${fix(x1)}" y2="${fix(cy)}" stroke="${COL.pro}" stroke-width="2" opacity="${fix(e * .85)}"/>`;
    ov += `<line x1="${fix(b.x + OX)}" y1="${fix(b.y)}" x2="${fix(x2)}" y2="${fix(cy)}" stroke="${COL.am}" stroke-width="2" opacity="${fix(e * .85)}"/>`;
    ov += `<circle cx="${fix(a.x)}" cy="${fix(a.y)}" r="5" fill="${COL.pro}" opacity="${fix(e)}"/>`;
    ov += `<circle cx="${fix(b.x + OX)}" cy="${fix(b.y)}" r="5" fill="${COL.am}" opacity="${fix(e)}"/>`;
    labels += `<div style="position:absolute;left:0;right:0;top:${fix(cy - 22)}px;text-align:center;
      font-size:30px;font-weight:800;color:#e8eef4;opacity:${fix(e)};z-index:6">${r[0]}</div>`;
  });
  ov += `</svg>`;
  return `<div class="scene">
    <div class="title sm" style="text-align:center;${rise(l, 0)}">같은 순간을 비교해 보겠습니다</div>
    <div style="height:46px"></div>
    <div class="panels" style="position:relative;gap:${GAP}px;${rise(l, 0.2)}">
      ${panel(PRO, t, PW, PH)}
      ${panel(AM, t, PW, PH)}
      ${ov}${labels}
    </div>
    <div style="height:76px"></div>
    <div class="caption" style="${rise(l, 3.9)}">두 스윙을 같은 각도에서 비교했습니다</div>
  </div>`;
});

/* ---------- 3. 회전의 차이 (0:15~0:28) ---------- */
S('rotation', 10, (l) => {
  const t = lerp(0.05, TOP, easeInOut(clamp01(l / 1.4)));
  const rev = clamp01((l - 1.4) / 0.55);
  

  const post = (P) => (p, c) => {
    if (rev <= 0) return '';
    let s = '';
    const shDeg = P.shoulderTop * rev, hipDeg = P.hipTop * rev;
    s += turnArc(p.neck.x, p.neck.y + 2, 13.5, 4.2, shDeg, COL.gold, 2);
    s += turnArc(p.pelvis.x, p.pelvis.y + 1, 10, 3.2, hipDeg, c, 2);
    return s;
  };
  const stats = (P) => `
    <div class="stat" style="right:22px;top:118px;${pop(l, 2.7)}">
      <div class="k">어깨 회전</div><div class="v">약 ${countUp(P.shoulderTop, l, 2.8, 1.0)}°</div></div>
    <div class="stat" style="right:22px;top:392px;${pop(l, 3.1)}">
      <div class="k">골반 회전</div><div class="v">약 ${countUp(P.hipTop, l, 3.2, 1.0)}°</div></div>`;

  return `<div class="scene">
    <div class="title sm" style="text-align:center;${rise(l, 0)}"><span class="g">1.</span> 회전의 차이</div>
    <div style="height:44px"></div>
    <div class="panels" style="${rise(l, 0.15)}">
      ${panel(PRO, t, 472, 860, { post: post(PRO) }, stats(PRO))}
      ${panel(AM, t, 472, 860, { post: post(AM) }, stats(AM))}
    </div>
    <div style="height:76px"></div>
    <div class="caption" style="${rise(l, 4.6)}">프로는 상체와 하체가<br/>서로 <b style="color:#e8eef4">다른 양</b>으로 회전합니다</div>
  </div>`;
});

/* ---------- 4. 다운스윙 시작 순서 — 큰 화면 2 + 필름스트립 4컷 ---------- */
S('sequence', 7.5, (l) => {
  const cyc = 3.4;
  const u0 = loop(Math.max(0, l - 0.35), cyc);
  const t = u0 < 0.14 ? TOP : lerp(TOP, 0.66, easeInOut((u0 - 0.14) / 0.72));
  const items = [['골반', PRO.seq.hip, 0.47], ['몸통', PRO.seq.torso, 0.51],
                 ['팔', PRO.seq.arm, 0.55], ['클럽', PRO.seq.club, 0.62]];
  const li = items.map((it, i) =>
    `<li class="${t >= it[1] ? 'on' : ''}"><span class="n">${i + 1}</span>${it[0]}</li>`).join('');

  const amArrow = (p, c) => {
    if (t < AM.seq.arm) return '';
    return arc(p.chest.x + 6, p.chest.y + 2, 20, 20, 150, COL.am, 2.2) +
      `<circle cx="${fix(p.hands.x)}" cy="${fix(p.hands.y)}" r="4.6" fill="none" stroke="${COL.am}" stroke-width="1.8"/>`;
  };

  /* 필름스트립 — 다운스윙 네 시점을 한 줄에 */
  const FW = 230, FH = 300;
  const strip = items.map((it, i) => {
    const on = t >= it[1];
    return `<div class="filmcell ${on ? 'on' : ''}" style="width:${FW}px;height:${FH}px;${pop(l, 0.5 + i * 0.18, .32)}">
      ${fig(PRO, it[2], { ball: false, joints: false, ground: false })}
      <div class="cap"><span class="n">${i + 1}</span>${it[0]}</div>
    </div>`;
  }).join('');

  return `<div class="scene">
    <div class="title sm" style="text-align:center;${rise(l, 0)}"><span class="g">2.</span> 다운스윙의 시작 순서</div>
    <div style="height:34px"></div>
    <div class="panels" style="${rise(l, 0.15)}">
      ${panel(PRO, t, 472, 620, { vb: VB_WIDE }, `<ol class="orderlist" style="top:88px;gap:10px;padding:16px 18px">${li}</ol>`)}
      ${panel(AM, t, 472, 620, { post: amArrow, vb: VB_WIDE }, `<div class="callout" style="left:18px;bottom:20px;max-width:280px;font-size:27px;color:${COL.am};${rise(l, 1.1)}">팔과 클럽이<br/>먼저 움직입니다</div>`)}
    </div>
    <div style="height:26px"></div>
    <div class="filmstrip">${strip}</div>
    <div style="height:34px"></div>
    <div class="caption" style="${rise(l, 2.2)}">프로는 하체에서 시작해<br/>상체와 클럽으로 순차적으로 전달됩니다</div>
  </div>`;
});

/* ---------- 5. 일반인의 흔한 움직임 (0:42~0:55) ---------- */
S('amateur', 5.5, (l) => {
  const cyc = 2.6;
  const u0 = loop(Math.max(0, l - 0.3), cyc);
  const t = u0 < 0.12 ? 0.40 : lerp(0.40, 0.645, easeInOut((u0 - 0.12) / 0.7));
  const post = (p, c) => {
    if (t <= 0.46) return '';
    const pts = clubPath(AM, 0.46, Math.min(t, 0.645), 26);
    const hp = pose(PRO, t);
    return `<polyline points="${pts.map((q) => `${fix(q.x)},${fix(q.y)}`).join(' ')}" fill="none" stroke="${COL.am}" stroke-width="1.5" stroke-dasharray="3 3" opacity=".85"/>`
      + `<circle cx="${fix(p.clubhead.x)}" cy="${fix(p.clubhead.y)}" r="4.4" fill="none" stroke="${COL.am}" stroke-width="1.6"/>`
      + `<circle cx="${fix(hp.clubhead.x)}" cy="${fix(hp.clubhead.y)}" r="3.2" fill="none" stroke="${COL.pro}" stroke-width="1.4" opacity=".75"/>`;
  };
  return `<div class="scene">
    <div class="title sm" style="text-align:center;${rise(l, 0)}">일반인의 흔한 움직임</div>
    <div style="height:36px"></div>
    <div class="bar-callout" style="${rise(l, 0.5)}"><span class="q">!</span>
      <span>공을 빨리 맞히려고 <b style="color:${COL.am}">팔과 클럽을 먼저</b> 움직이는 경우가 많습니다</span></div>
    <div style="height:30px"></div>
    <div style="position:relative;display:flex;justify-content:center;${rise(l, 0.2)}">
      ${panel(AM, t, 620, 840, { post, vb: VB_WIDE, ghost: { P: PRO, t } })}
    </div>
    <div style="height:26px"></div>
    <div style="text-align:center;font-size:28px;font-weight:700;color:#8b96a2;${rise(l, 1.4)}">
      옅은 <span style="color:${COL.pro}">초록</span> = 같은 시점의 프로 동작</div>
    <div style="height:44px"></div>
    <div class="caption" style="${rise(l, 2.4)}">클럽이 몸보다 앞서 나가면서<br/>임팩트가 불안정해집니다</div>
  </div>`;
});

/* ---------- 6. 에너지 전달 순서 (0:55~1:08) ---------- */
S('chain', 5, (l) => {
  const col = (P, cls, res, up) => {
    let s = `<div class="chaincol ${cls}"><div class="h">${P.label}</div>`;
    P.order.forEach((k, i) => {
      const d = 0.8 + i * 0.42;
      if (i) s += `<div class="arw" style="${rise(l, d - 0.1, .3, 8)}">▼</div>`;
      s += `<div class="step" style="${rise(l, d, .35, 14)}">${k}</div>`;
    });
    s += `<div class="arw" style="${rise(l, 2.6, .3, 8)}">▼</div>`;
    s += `<div class="res" style="${pop(l, 2.75)}">${res} ${up}</div></div>`;
    return s;
  };
  return `<div class="scene">
    <div class="title sm" style="text-align:center;${rise(l, 0)}">그래서 왜 비거리 차이가 날까?</div>
    <div style="height:52px"></div>
    <div class="chain">${col(PRO, 'pro', 'HEAD SPEED', '▲')}${col(AM, 'am', 'HEAD SPEED', '▼')}</div>
    <div style="height:76px"></div>
    <div class="caption" style="${rise(l, 3.6)}">에너지가 효율적으로 전달되는<br/>순서가 다릅니다</div>
  </div>`;
});

/* ---------- 7. 스윙 궤적 비교 (1:08~1:22) ---------- */
S('path', 4.5, (l) => {
  const cyc = 3.6;
  const u0 = loop(Math.max(0, l - 0.3), cyc);
  const t = clamp01(u0 / 0.78);
  const traces = (self) => (p, c) => {
    if (t <= 0.12) return '';
    const mk = (P, color, dash, op, wd) => {
      const pts = clubPath(P, 0.10, t, 40);
      return `<polyline points="${pts.map(q => `${fix(q.x)},${fix(q.y)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${wd}" ${dash ? `stroke-dasharray="${dash}"` : ''} opacity="${op}" stroke-linejoin="round"/>`;
    };
    return mk(self === 'pro' ? AM : PRO, self === 'pro' ? COL.am : COL.pro, '4 4', .32, 1.2) +
      mk(self === 'pro' ? PRO : AM, self === 'pro' ? COL.pro : COL.am, self === 'pro' ? '' : '5 5', .95, 1.8);
  };
  return `<div class="scene">
    <div class="title sm" style="text-align:center;${rise(l, 0)}">프로와 일반인 스윙 궤적 비교</div>
    <div style="height:40px"></div>
    <div class="panels" style="${rise(l, 0.15)}">
      ${panel(PRO, t, 472, 600, { pre: traces('pro'), vb: VB_TRAIL })}
      ${panel(AM, t, 472, 600, { pre: traces('am'), vb: VB_TRAIL })}
    </div>
    <div style="height:34px"></div>
    <div style="display:flex;gap:52px;justify-content:center;font-size:30px;font-weight:700;${rise(l, 1.2)}">
      <span style="color:${COL.pro}">━━ 프로 궤적</span>
      <span style="color:${COL.am}">╍╍ 일반인 궤적</span>
    </div>
    <div style="height:76px"></div>
    <div class="caption" style="${rise(l, 2.6)}">몸의 중심을 유지하며 회전하면서 클럽이<br/>자연스럽게 따라오는 것이 프로의 특징입니다</div>
  </div>`;
});

/* ---------- 8. 임팩트 순간 (1:22~1:35) ---------- */
S('impact', 6, (l) => {
  const t = lerp(0.50, IMPACT, easeInOut(clamp01(l / 1.1)));
  const post = (P) => (p, c) => {
    const k = clamp01((l - 1.1) / 0.45);
    if (k <= 0) return '';
    const deg = P.openShoulderImpact;
    let s = `<line x1="${fix(p.pelvis.x - 26)}" y1="${fix(p.shL.y)}" x2="${fix(p.pelvis.x + 26)}" y2="${fix(p.shL.y)}" stroke="rgba(255,255,255,.35)" stroke-width="1" stroke-dasharray="3 3" opacity="${fix(k)}"/>`;
    s += `<line x1="${fix(p.shL.x)}" y1="${fix(p.shL.y)}" x2="${fix(p.shR.x)}" y2="${fix(p.shR.y)}" stroke="${c}" stroke-width="2.6" opacity="${fix(k)}"/>`;
    s += turnArc(p.neck.x, p.neck.y + 2, 15, 5, -deg, COL.gold, 2.2);
    return s;
  };
  const stat = (P) => `<div class="stat" style="left:50%;transform:translateX(-50%);top:112px;${pop(l, 2.0)}">
      <div class="k">몸통 열림</div><div class="v">약 ${countUp(P.openShoulderImpact, l, 2.1, .9)}°</div></div>`;
  return `<div class="scene">
    <div class="title sm" style="text-align:center;${rise(l, 0)}">임팩트 순간 비교</div>
    <div style="height:44px"></div>
    <div class="panels" style="${rise(l, 0.15)}">
      ${panel(PRO, t, 472, 860, { post: post(PRO) }, stat(PRO))}
      ${panel(AM, t, 472, 860, { post: post(AM) }, stat(AM))}
    </div>
    <div style="height:76px"></div>
    <div class="caption" style="${rise(l, 3.4)}">프로는 적절히 몸을 열어주며<br/>강한 임팩트를 만듭니다</div>
  </div>`;
});

/* ---------- 8.5 멀티 화면 — 톱·임팩트·피니시 6분할 ---------- */
S('grid', 5, (l) => {
  const cols = [['톱', TOP], ['임팩트', IMPACT], ['피니시', 0.90]];
  const CWD = 310, CHT = 458, G = 14;
  const head = cols.map((c, i) =>
    `<div style="width:${CWD}px;text-align:center;font-size:29px;font-weight:800;color:#cfd8e2;${rise(l, 0.35 + i * 0.3, .3, 12)}">${c[0]}</div>`).join('');
  const row = (P) => cols.map((c, i) =>
    `<div class="gridcell ${P.key}" style="width:${CWD}px;height:${CHT}px;${pop(l, 0.4 + i * 0.3, .34)}">
       ${fig(P, c[1], { ball: false, ground: false })}
     </div>`).join('');
  const tag = (P) => `<div class="rowtag ${P.key}">${P.label}</div>`;
  return `<div class="scene">
    <div class="title sm" style="text-align:center;${rise(l, 0)}">한 화면에서 다시 보기</div>
    <div style="height:30px"></div>
    <div style="display:flex;gap:${G}px;justify-content:center;margin-bottom:10px">${head}</div>
    <div style="display:flex;gap:${G}px;justify-content:center">${row(PRO)}</div>
    <div style="height:${G}px"></div>
    <div style="display:flex;gap:${G}px;justify-content:center">${row(AM)}</div>
    <div style="height:24px"></div>
    <div style="display:flex;gap:26px;justify-content:center;${rise(l, 1.4)}">${tag(PRO)}${tag(AM)}</div>
    <div style="height:30px"></div>
    <div class="caption" style="${rise(l, 1.7)}">같은 구간, 다른 움직임</div>
  </div>`;
});

/* ---------- 9. 핵심 메시지 (1:35~1:48) ---------- */
S('statement', 4.5, (l) => {
  const t = lerp(0.62, 0.94, easeOut(clamp01(l / 2.2)));
  return `<div class="scene" style="justify-content:center;text-align:center">
    <div style="position:absolute;left:52%;top:62%;transform:translate(-50%,-50%);width:820px;height:1080px;opacity:.13">
      ${fig(PRO, t, { ball: false, joints: false, ground: false })}
    </div>
    <div style="position:relative">
      <div class="title" style="font-size:60px;${rise(l, 0.3)}">크게 치는 것이 아니라</div>
      <div style="height:44px"></div>
      <div class="title" style="font-size:60px;${rise(l, 1.1)}">몸의 회전과 클럽의 움직임을</div>
      <div style="height:26px"></div>
      <div class="title" style="font-size:60px;${rise(l, 1.8)}">얼마나 <span class="g">효율적으로</span></div>
      <div style="height:26px"></div>
      <div class="title" style="font-size:84px;${pop(l, 2.5, .5)}"><span class="g">연결하느냐의 차이!</span></div>
    </div>
  </div>`;
});

/* ---------- 11. 핵심 정리 (1:58~2:05) ---------- */
S('summary', 5, (l) => {
  const rows = [
    '상체와 하체는 다른 양으로 회전한다',
    '다운스윙은 하체 → 상체 → 팔 → 클럽 순서',
    '팔과 클럽이 먼저 움직이면 에너지 손실 발생',
    '효율적인 연결이 비거리와 정확성을 만든다',
  ];
  const list = rows.map((s, i) =>
    `<div class="sumrow" style="${rise(l, 0.45 + i * 0.42)}"><span class="n">${i + 1}</span><span>${s}</span></div>`).join('');
  return `<div class="scene">
    <div class="title" style="text-align:center;${rise(l, 0)}">핵심 정리</div>
    <div style="height:64px"></div>
    <div style="display:flex;flex-direction:column;gap:26px">${list}</div>
    </div>`;
});

/* ---------- 12. 다음 편 예고 (2:05~2:15) ---------- */
S('next', 4.5, (l) => {
  const t = lerp(0.70, 0.95, easeOut(clamp01(l / 1.8)));
  return `<div class="scene">
    <div style="position:absolute;right:-40px;top:150px;width:620px;height:840px;opacity:.42">
      ${fig(PRO, t, { ball: false, ground: false })}
    </div>
    <div style="position:relative;z-index:2">
      <div class="kicker" style="color:${COL.gold};${rise(l, 0)}">NEXT</div>
      <div class="title" style="color:${COL.gold};${rise(l, 0.15)}">다음 편 예고</div>
      <div style="height:56px"></div>
      <div class="title sm" style="${rise(l, 0.7)}">그렇다면 프로는</div>
      <div style="height:20px"></div>
      <div class="title sm" style="${rise(l, 1.15)}"><span class="g">임팩트 순간 몸을</span></div>
      <div style="height:14px"></div>
      <div class="title sm" style="${rise(l, 1.5)}"><span class="g">정확히 얼마나</span></div>
      <div style="height:14px"></div>
      <div class="title" style="font-size:72px;${pop(l, 1.9, .5)}"><span class="g">열어놓을까?</span></div>
    </div>
    <div style="height:76px"></div>
    <div class="caption" style="text-align:left;${rise(l, 3.0)}">다음 편에서 자세히 분석합니다!</div>
  </div>`;
});

/* ---------- 13. 아웃트로 (2:15~2:22) ---------- */
S('outro', 3.5, (l) => {
  const thumb = `<svg width="76" height="76" viewBox="0 0 24 24" fill="${COL.gold}"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/></svg>`;
  const play = `<svg width="80" height="58" viewBox="0 0 40 28"><rect width="40" height="28" rx="8" fill="#ff2d34"/><polygon points="16,8 28,14 16,20" fill="#fff"/></svg>`;
  const bell = `<svg width="72" height="72" viewBox="0 0 24 24" fill="${COL.gold}"><path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/></svg>`;
  const it = (g, k, d) => `<div class="item" style="${pop(l, d)}"><div class="glyph">${g}</div>${k}</div>`;
  return `<div class="scene" style="justify-content:center;text-align:center">
    <div class="title" style="${rise(l, 0)}">오늘의 영상이<br/>도움이 되셨다면?</div>
    <div style="height:88px"></div>
    <div class="cta">${it(thumb, '좋아요', 0.5)}${it(play, '구독', 0.75)}${it(bell, '알림 설정', 1.0)}</div>
    <div style="height:80px"></div>
    <div class="caption" style="${rise(l, 1.5)}">더 좋은 골프 콘텐츠로 찾아뵙겠습니다</div>
  </div>`;
});

/* ================================================================
 *  타임라인 & 프레임 렌더러
 * ================================================================ */
let acc = 0;
SCENES.forEach((s) => { s.start = acc; acc += s.dur; });
const TOTAL = acc;
window.__total = TOTAL;
window.__scenes = SCENES.map((s) => ({ id: s.id, start: s.start, dur: s.dur }));

const XF = 0.22; // 크로스페이드 길이(초)

function renderFrame(t) {
  t = Math.max(0, Math.min(TOTAL - 0.0001, t));
  let i = 0;
  while (i < SCENES.length - 1 && t >= SCENES[i].start + SCENES[i].dur) i++;
  const cur = SCENES[i], l = t - cur.start;
  const zoom = (sc, lt) => 1 + 0.018 * clamp01(lt / sc.dur);   // 씬마다 아주 느린 줌인
  let html = '';
  if (i > 0 && l < XF) {
    const prev = SCENES[i - 1];
    html += `<div class="layer" style="opacity:1;transform:scale(${fix(zoom(prev, prev.dur + l))})">${prev.build(prev.dur + l)}</div>`;
  }
  const k = clamp01(l / XF), e = easeOut(k);
  html += `<div class="layer" style="opacity:${fix(e)};transform:translateY(${fix((1 - e) * 22)}px) scale(${fix((0.995 + 0.005 * e) * zoom(cur, l))})">${cur.build(l)}</div>`;
  html += `<div id="bar" style="width:${fix((t / TOTAL) * W)}px"></div>`;
  document.getElementById('stage').innerHTML = html;
}
window.__render = renderFrame;
