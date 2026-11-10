
// ── 4. 입력 ──
const GROUPS = [["design", "<span class=\"step\">2</span>설계", false], ["open", "<span class=\"step\">3</span>갱구 · 편 개설", false], ["sched", "<span class=\"step\">4</span>생산 일정", false], ["econ", "<span class=\"step\">5</span>경제성", false],
  ["a-sf", "필러 안전율 (확인용)", true], ["a-lim", "채굴 범위", true], ["a-dev", "굴진", true], ["a-cost", "원가 세부", true]];
const PARAMS = [
  { id: "p", g: "design", label: "필러 폭", min: 6, max: 30, step: 0.5, v: 12, u: "m" },
  { id: "h", g: "design", label: "갱도 높이", min: 4, max: 20, step: 0.5, v: 12, u: "m" },
  { id: "w", g: "design", label: "갱도 폭", min: 4, max: 25, step: 0.5, v: 13, u: "m" },
  { id: "lv", g: "design", label: "편 간격", min: 8, max: 40, step: 1, v: 20, u: "m" },
  { id: "ia", g: "open", label: "연층 사갱 경사", min: 5, max: 25, step: 0.5, v: 16, u: "°", d: 1 },
  { id: "trig", g: "open", label: "다음 편 개설 (윗편 채굴률)", min: 0, max: 100, step: 5, v: 50, u: "%" },
  { id: "ann", g: "sched", label: "연간 생산 목표", min: 10, max: 300, step: 5, v: 80, u: "만t" },
  { id: "nface", g: "sched", label: "동시 작업장 수", min: 1, max: 20, step: 1, v: 6, u: "곳" },
  { id: "frate", g: "sched", label: "작업장당 월 생산", min: 2, max: 40, step: 1, v: 12, u: "천t" },
  { id: "y0", g: "sched", label: "착공 연도", min: 2026, max: 2040, step: 1, v: 2027, u: "", raw: true },
  { id: "price", g: "econ", label: "판매가", min: 5000, max: 30000, step: 500, v: 14000, u: "원/t" },
  { id: "opex", g: "econ", label: "운영비", min: 3000, max: 20000, step: 250, v: 8500, u: "원/t" },
  { id: "disc", g: "econ", label: "할인율", min: 3, max: 15, step: 0.5, v: 8, u: "%", d: 1 },
  { id: "ucs", g: "a-sf", label: "일축압축강도", min: 30, max: 200, step: 5, v: 80, u: "MPa" },
  { id: "kf", g: "a-sf", label: "규모 효과 계수", min: 0.3, max: 0.8, step: 0.05, v: 0.5, u: "", d: 2 },
  { id: "sfmin", g: "a-sf", label: "기준 안전율", min: 1.2, max: 3, step: 0.1, v: 2.0, u: "", d: 1 },
  { id: "sill", g: "a-sf", label: "수평 필러 기준 (두께÷갱도 폭)", min: 0.2, max: 1.5, step: 0.05, v: 0.5, u: "", d: 2 },
  { id: "rho", g: "a-lim", label: "비중", min: 2.0, max: 4.5, step: 0.01, v: 2.7, u: "", d: 2 },
  { id: "minfrac", g: "a-lim", label: "최소 광체 비율", min: 50, max: 100, step: 5, v: 80, u: "%" },
  { id: "cover", g: "a-lim", label: "최소 지표 피복", min: 0, max: 100, step: 5, v: 30, u: "m" },
  { id: "bnd", g: "a-lim", label: "광구 경계 이격", min: 0, max: 50, step: 5, v: 20, u: "m" },
  { id: "iw", g: "a-lim", label: "사갱 보호 폭 (한쪽)", min: 5, max: 50, step: 5, v: 20, u: "m" },
  { id: "minblk", g: "a-lim", label: "떨어진 블록 최소 크기", min: 1, max: 30, step: 1, v: 6, u: "판넬" },
  { id: "minval", g: "a-lim", label: "떨어진 블록 최소 순이익", min: 0, max: 20, step: 0.5, v: 3, u: "억원", d: 1 },
  { id: "rate", g: "a-dev", label: "굴진 속도 (수평갱·사갱)", min: 20, max: 150, step: 5, v: 60, u: "m/월" },
  { id: "lead", g: "a-dev", label: "편 개발 선행", min: 0, max: 12, step: 1, v: 4, u: "개월" },
  { id: "hinc", g: "a-cost", label: "편당 운반비 증가", min: 0, max: 1500, step: 50, v: 300, u: "원/t" },
  { id: "hcost", g: "a-cost", label: "편 내 운반비", min: 0, max: 300, step: 10, v: 60, u: "원/t·100m" },
  { id: "devc", g: "a-cost", label: "굴진비 (수평갱·사갱)", min: 100, max: 600, step: 10, v: 250, u: "만원/m" },
  { id: "dcost", g: "a-cost", label: "편 갱도 굴진비", min: 50, max: 400, step: 10, v: 150, u: "만원/m" },
  { id: "capex", g: "a-cost", label: "초기 투자", min: 0, max: 500, step: 10, v: 150, u: "억원" },
];
const form = $("params"), adv = document.createElement("details"); adv.className = "adv"; adv.id = "adv"; adv.innerHTML = "<summary>고급 옵션 (기본값으로 두어도 됩니다)</summary>";
for (const [g, title, isAdv] of GROUPS) {
  const fs = document.createElement("fieldset"); fs.innerHTML = `<legend>${title}</legend>`;
  if (g === "open") fs.insertAdjacentHTML("beforeend", `<div class="portalbar"><button type="button" id="pick" aria-pressed="false">평면도에서 갱구 놓기</button><button type="button" id="autoportal">자동 위치</button></div><div class="derived" id="portalinfo"></div>`);
  for (const p of PARAMS.filter(q => q.g === g)) {
    const row = document.createElement("div"); row.className = "sl";
    row.innerHTML = `<label for="p-${p.id}">${p.label}</label><output id="o-${p.id}" for="p-${p.id}"></output><input type="range" id="p-${p.id}" min="${p.min}" max="${p.max}" step="${p.step}" value="${p.v}">`;
    fs.appendChild(row);
  }
  if (g === "design") fs.insertAdjacentHTML("beforeend", `<div class="derived" id="derived"></div>`);
  if (g === "sched") fs.insertAdjacentHTML("beforeend", `<div class="derived" id="capinfo"></div>`);
  if (g === "a-sf") fs.insertAdjacentHTML("beforeend", `<div class="derived" id="sfinfo"></div><label class="opt"><input type="checkbox" id="p-sfx">기준 미달 판넬은 설계에서 제외</label>`);
  if (g === "a-lim") fs.insertAdjacentHTML("beforeend", `<label class="opt"><input type="checkbox" id="p-econ" checked>수지 안 맞는 떨어진 블록은 캐지 않음</label>`);
  (isAdv ? adv : form).appendChild(fs);
}
form.appendChild(adv);
function readP() { const o = {}; for (const p of PARAMS) o[p.id] = +$("p-" + p.id).value; o.sfx = $("p-sfx").checked; o.econ = $("p-econ").checked; return o; }
function showOutputs() { for (const p of PARAMS) { const v = +$("p-" + p.id).value; $("o-" + p.id).textContent = (p.raw ? String(v) : fmt(v, p.d || 0)) + (p.u ? " " + p.u : ""); } }

// ── 5. 광체 수직선 교차 → 판넬 ──
let RAY = null, USERPORTAL = null;
function buildRays(S) {
  if (RAY && RAY.S === S && RAY.ver === DATAVER) return RAY;
  const s = S / 3, b = ORE.bbox, gx0 = Math.floor(b.x0 / S) * S, gy0 = Math.floor(b.y0 / S) * S, nx = Math.max(1, Math.ceil((b.x1 - gx0) / S)), ny = Math.max(1, Math.ceil((b.y1 - gy0) / S)), rx = nx * 3, ry = ny * 3;
  const cr = new Array(rx * ry), jx = 0.0137 * s, jy = 0.0071 * s, T = ORE.tris;
  for (let t = 0; t < T.length; t += 9) {
    const ax = T[t], ay = T[t + 1], az = T[t + 2], bx = T[t + 3], by = T[t + 4], bz = T[t + 5], cx = T[t + 6], cy = T[t + 7], cz = T[t + 8];
    const i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - gx0 - jx) / s - 0.5)), i1 = Math.min(rx - 1, Math.floor((Math.max(ax, bx, cx) - gx0 - jx) / s - 0.5));
    const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - gy0 - jy) / s - 0.5)), j1 = Math.min(ry - 1, Math.floor((Math.max(ay, by, cy) - gy0 - jy) / s - 0.5));
    if (i0 > i1 || j0 > j1) continue; const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(det) < 1e-12) continue;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = gx0 + (i + 0.5) * s + jx, py = gy0 + (j + 0.5) * s + jy, l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / det, l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / det, l3 = 1 - l1 - l2;
      if (l1 < 0 || l2 < 0 || l3 < 0) continue; const k = j * rx + i; (cr[k] || (cr[k] = [])).push(l1 * az + l2 * bz + l3 * cz);
    }
  }
  const iv = new Array(rx * ry); let odd = 0, vol = 0, volRaw = 0, hit = 0, zTop = -Infinity;
  for (let k = 0; k < cr.length; k++) {
    const a = cr[k]; if (!a) continue; a.sort((p, q) => p - q); hit++;
    const u = [a[0]]; for (let q = 1; q < a.length; q++) if (a[q] - u[u.length - 1] > 1e-6) u.push(a[q]);
    if (u.length % 2) { odd++; u.pop(); }
    const px = gx0 + (k % rx + 0.5) * s + jx, py = gy0 + (Math.floor(k / rx) + 0.5) * s + jy, tz = terrainZ(px, py), o = [];
    for (let q = 0; q < u.length; q += 2) { volRaw += (u[q + 1] - u[q]) * s * s; const hi = Math.min(u[q + 1], tz); if (hi > u[q]) { o.push(u[q], hi); vol += (hi - u[q]) * s * s; if (hi > zTop) zTop = hi; } }
    if (o.length) iv[k] = o;
  }
  return RAY = { S, s, gx0, gy0, nx, ny, rx, ry, iv, odd, hit, vol, volRaw, zTop, ver: DATAVER };
}
const inPoly = (x, y, pg) => { let c = false; for (let i = 0, j = pg.length - 1; i < pg.length; j = i++) { const a = pg[i], b = pg[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const edgeDist = (x, y, pg) => { let m = Infinity; for (let i = 0, j = pg.length - 1; i < pg.length; j = i++) { const a = pg[i], b = pg[j], dx = b[0] - a[0], dy = b[1] - a[1], t = clamp(((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy || 1), 0, 1); m = Math.min(m, Math.hypot(x - a[0] - dx * t, y - a[1] - dy * t)); } return m; };
const allowed = (x, y, m) => { if (!CLAIM.length) return true; for (const pg of CLAIM) if (inPoly(x, y, pg) && edgeDist(x, y, pg) >= m) return true; return false; };
function autoPortal(R, P, H) {
  // 광체 꼭대기에서 한 편 아래 높이의 사면 중, 그 높이대 광체에 가장 가까운 곳. 없으면 광체 근처에서 가장 낮은 지표.
  const zt = R.zTop - H - 2, band = [];
  for (let k = 0; k < R.iv.length; k += 5) { const o = R.iv[k]; if (!o) continue; for (let q = 0; q < o.length; q += 2) if (o[q + 1] > zt - P.lv && o[q] < zt + H) { band.push([R.gx0 + (k % R.rx + 0.5) * R.s, R.gy0 + (Math.floor(k / R.rx) + 0.5) * R.s]); break; } }
  let best = null, bd = Infinity;
  for (const strict of [true, false]) {
    for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) {
      const tz = G.z[j * G.nx + i]; if (tz < zt - P.lv || tz > zt) continue; const x = G.x0 + i * G.d, y = G.y0 + j * G.d;
      if (strict && !allowed(x, y, 0)) continue;
      for (const b of band) { const d = Math.hypot(b[0] - x, b[1] - y); if (d < bd) { bd = d; best = { x, y }; } }
    }
    if (best) break;
  }
  if (!best) { let lo = Infinity; const ob = ORE.bbox, m = 300; for (let j = 0; j < G.ny; j++) for (let i = 0; i < G.nx; i++) { const x = G.x0 + i * G.d, y = G.y0 + j * G.d; if (x < ob.x0 - m || x > ob.x1 + m || y < ob.y0 - m || y > ob.y1 + m) continue; const tz = G.z[j * G.nx + i]; if (tz < lo) { lo = tz; best = { x, y }; } } }
  if (!best) best = { x: (ORE.bbox.x0 + ORE.bbox.x1) / 2, y: (ORE.bbox.y0 + ORE.bbox.y1) / 2 };
  return best;
}

// ── 6. 설계: 갱구 · 편 · 판넬 · 연층 사갱 · 블록 ──
function design(P) {
  const warn = []; let H = P.h; const Pw = P.p, S = P.p + P.w;
  if (H > P.lv - 2) { H = P.lv - 2; warn.push(`갱도 높이를 ${fmt(H, 1)}m로 줄여 계산 (수평 필러 최소 2m)`); }
  const R = buildRays(S), auto = !USERPORTAL, pp = USERPORTAL || autoPortal(R, P, H), PORTAL = { x: pp.x, y: pp.y, z: terrainZ(pp.x, pp.y) }, zP = PORTAL.z;
  // 판넬 기둥(같은 평면 위치): 경계·지표
  const cols = [];
  for (let j = 0; j < R.ny; j++) for (let i = 0; i < R.nx; i++) {
    const rays = []; for (let b = 0; b < 3; b++) for (let a = 0; a < 3; a++) { const o = R.iv[(j * 3 + b) * R.rx + i * 3 + a]; if (o) rays.push(o); }
    if (!rays.length) continue; const x = R.gx0 + (i + 0.5) * S, y = R.gy0 + (j + 0.5) * S;
    if (!allowed(x, y, P.bnd + S / 2)) continue;
    const tzc = terrainZ(x, y), tzm = Math.min(tzc, terrainZ(x - S / 2, y - S / 2), terrainZ(x + S / 2, y - S / 2), terrainZ(x - S / 2, y + S / 2), terrainZ(x + S / 2, y + S / 2));
    cols.push({ i, j, x, y, rays, tzc, tzm });
  }
  let aboveV = 0; for (const o of R.iv) if (o) for (let q = 0; q < o.length; q += 2) aboveV += Math.max(0, o[q + 1] - Math.max(o[q], zP + H)) * R.s * R.s;
  const all = [], st = P.kf * P.ucs * (0.778 + 0.222 * Pw / H);
  for (let k = 0; k < 500; k++) {
    const zf = zP - k * P.lv; if (zf + H < ORE.bbox.z0) break; const cand = [], rej = [];
    if (zf > R.zTop) continue;
    for (const c of cols) {
      let ov = 0; for (const o of c.rays) for (let q = 0; q < o.length; q += 2) ov += Math.max(0, Math.min(o[q + 1], zf + H) - Math.max(o[q], zf));
      const frac = ov / (9 * H); if (frac < P.minfrac / 100) continue;
      const depth = c.tzc - (zf + H / 2), p = { i: c.i, j: c.j, x: c.x, y: c.y, zf, frac, depth, t: (S * S - Pw * Pw) * H * P.rho };
      p.sf = depth > 0 ? st / (P.rho * 9.81 * depth / 1000 * S * S / (Pw * Pw)) : 99;
      if (c.tzm - (zf + H) < P.cover) { p.why = "cover"; rej.push(p); } else cand.push(p);
    }
    if (cand.length || rej.length) all.push({ zf, cand, rej });
  }
  const used = all.filter(L => L.cand.length), iaR = P.ia * Math.PI / 180, ti = Math.tan(iaR);
  for (const L of all) { L.J = null; L.xc = 0; let w = 0; L.cx = L.cy = 0; for (const p of L.cand) { L.cx += p.x; L.cy += p.y; w++; } if (w) { L.cx /= w; L.cy /= w; } }
  // 1편 진입: 갱구에서 가장 가까운 1편 광체까지
  let E1 = { x: PORTAL.x, y: PORTAL.y, z: zP }, len0 = 10, dz0 = 0;
  if (used.length) {
    let bd = Infinity; for (const p of used[0].cand) { const d = Math.hypot(p.x - PORTAL.x, p.y - PORTAL.y); if (d < bd) { bd = d; E1 = { x: p.x, y: p.y, z: used[0].zf }; } }
    dz0 = zP - used[0].zf; len0 = dz0 < 1 ? Math.max(10, bd) : Math.max(Math.hypot(bd, dz0), dz0 / Math.sin(iaR));
    if (dz0 >= 1) warn.push(`갱구 표고(EL.${fmt(zP)})에는 광체가 없어 ${fmt(dz0)}m 아래 1편까지 사갱으로 진입`);
  }
  // 편마다 연층 사갱 한 구간: 수평 거리 = 높이차 ÷ tan(경사). 그 원 위에서 아랫편 광체에 닿고 갱구·그 편 중심에 가까운 곳으로
  let prev = E1;
  used.forEach((L, k) => {
    if (!k) { L.J = { ...E1 }; return; }
    const r = (prev.z - L.zf) / ti; let bj = null, bs = Infinity;
    for (let q = 0; q < 72; q++) {
      const th = q * Math.PI / 36, x = prev.x + r * Math.sin(th), y = prev.y + r * Math.cos(th);
      let dOre = Infinity; for (const p of L.cand) dOre = Math.min(dOre, Math.hypot(p.x - x, p.y - y));
      const sc = Math.max(0, dOre - S / 2) * 4 + 0.5 * Math.hypot(x - PORTAL.x, y - PORTAL.y) + 0.5 * Math.hypot(x - L.cx, y - L.cy);
      if (sc < bs) { bs = sc; bj = { x, y, dOre }; }
    }
    L.J = { x: bj.x, y: bj.y, z: L.zf }; L.xc = Math.max(0, bj.dOre - S / 2); prev = L.J;
  });
  const segs = used.slice(1).map((L, k) => ({ a: used[k].J, b: L.J }));
  const INC = { E1, PORTAL, zP, auto, ia: P.ia, iaR, ti, segs, len0, dz0 };
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (const L of all) {
    L.panels = []; L.map = new Map();
    for (const p of L.cand) {
      p.L = L; let inc = false;
      for (const g of segs) {                                             // 사갱 보호 광주
        const ax = g.b.x - g.a.x, ay = g.b.y - g.a.y, u = ((p.x - g.a.x) * ax + (p.y - g.a.y) * ay) / (ax * ax + ay * ay || 1);
        if (u < -0.15 || u > 1.15) continue;
        const cu = clamp(u, 0, 1), d = Math.hypot(p.x - g.a.x - ax * cu, p.y - g.a.y - ay * cu), zi = g.a.z + (g.b.z - g.a.z) * cu;
        if (d < P.iw + S / 2 && Math.abs(p.zf + H / 2 - zi) < H / 2 + 6) { inc = true; break; }
      }
      if (inc) { p.why = "incline"; L.rej.push(p); }
      else if (P.sfx && p.sf < P.sfmin) { p.why = "sf"; L.rej.push(p); }
      else L.panels.push(p);
    }
    // 블록(상하좌우로 붙은 판넬)을 진입점에서 가까운 것부터 잇고, 경로 거리순으로 캔다. 떨어진 블록은 가장 가까운 연결점에서 편 갱도.
    const base = P.opex + Math.max(0, used.indexOf(L)) * P.hinc, cost = d => base + P.hcost * d / 100;
    if (L.J) {
      const idx = new Map(L.panels.map(p => [p.i + "," + p.j, p])), seen = new Set(); let rest = [];
      for (const p0 of L.panels) {
        if (seen.has(p0)) continue; const blk = [], stk = [p0]; seen.add(p0);
        while (stk.length) { const p = stk.pop(); p.bid = rest.length; blk.push(p); for (const [di, dj] of NB) { const q = idx.get((p.i + di) + "," + (p.j + dj)); if (q && !seen.has(q)) { seen.add(q); stk.push(q); } } }
        rest.push(blk);
      }
      const root = { x: L.J.x, y: L.J.y, path: 0 }, conn = [root], out = [];
      while (rest.length) {
        const cs = rest.map(blk => { let d = Infinity, src = null, ent = null; for (const c of conn) for (const p of blk) { const e = Math.hypot(p.x - c.x, p.y - c.y); if (e < d) { d = e; src = c; ent = p; } } return { blk, d, src, ent }; }).sort((a, b) => a.d - b.d);
        let took = null;
        for (const c of cs) {
          const path = new Map([[c.ent, c.src.path + c.d]]), pre = new Map([[c.ent, c.src === root ? null : c.src]]), q = [c.ent];
          for (let h = 0; h < q.length; h++) for (const [di, dj] of NB) { const n = idx.get((q[h].i + di) + "," + (q[h].j + dj)); if (n && n.bid === c.ent.bid && !path.has(n)) { path.set(n, path.get(q[h]) + S); pre.set(n, q[h]); q.push(n); } }
          const drive = Math.max(0, c.d - S), att = c.src === root && c.d < S * 1.5;
          let val = -drive * P.dcost * 1e4, t = 0; for (const p of c.blk) { val += p.t * (p.frac * P.price - cost(path.get(p))); t += p.t; }
          c.info = { n: c.blk.length, t, drive, val, paid: false }; c.path = path; c.pre = pre;
          if (!P.econ || (att ? val > 0 : val >= P.minval * 1e8 && c.blk.length >= P.minblk)) { took = c; break; }
        }
        if (!took) { for (const c of cs) for (const p of c.blk) { p.blk = c.info; p.dist = c.path.get(p); p.cost = cost(p.dist); p.why = "econ"; L.rej.push(p); } break; }
        for (const p of took.blk) { p.blk = took.info; p.dist = p.path = took.path.get(p); p.pre = took.pre.get(p); p.cost = cost(p.dist); out.push(p); conn.push(p); }
        rest = rest.filter(b => b !== took.blk);
      }
      L.panels = out;
    } else L.panels = [];
    L.panels.sort((a, b) => a.dist - b.dist);
    // 편 갱도 방향 = 판넬 분포의 긴 축
    let a0 = 0, a1 = 0, vx = 1, vy = 0;
    if (L.J && L.panels.length > 1) {
      let mx = 0, my = 0; for (const p of L.panels) { mx += p.x; my += p.y; } mx /= L.panels.length; my /= L.panels.length;
      let cxx = 0, cyy = 0, cxy = 0; for (const p of L.panels) { cxx += (p.x - mx) ** 2; cyy += (p.y - my) ** 2; cxy += (p.x - mx) * (p.y - my); }
      const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy); vx = Math.cos(th); vy = Math.sin(th);
      for (const p of L.panels) { const a = (p.x - L.J.x) * vx + (p.y - L.J.y) * vy; a0 = Math.min(a0, a); a1 = Math.max(a1, a); }
    }
    L.span = [a0, a1]; L.vx = vx; L.vy = vy;
    for (const p of [...L.panels, ...L.rej]) L.map.set(p.i + "," + p.j, p);
    L.tot = L.panels.reduce((a, p) => a + p.t, 0); L.ore = L.panels.reduce((a, p) => a + p.t * p.frac, 0);
    L.minSF = L.panels.reduce((a, p) => Math.min(a, p.sf), Infinity);
  }
  for (let t = 0.15; t <= 1 && dz0 < 1; t += 0.05) { const x = PORTAL.x + (E1.x - PORTAL.x) * t, y = PORTAL.y + (E1.y - PORTAL.y) * t; if (terrainZ(x, y) < zP) { warn.push("1편 수평갱이 지표 밖으로 드러나는 구간이 있음 (계곡 횡단)"); break; } }
  return { S, H, Pw, all, levels: all.filter(L => L.panels.length), INC, PORTAL, warn, R, aboveT: aboveV * P.rho };
}

// ── 7. 일정: 월 단위, 작업장 배정 ──
const jobProg = (j, t) => j.start === null ? 0 : clamp((t - j.start) * P.rate / j.len, 0, 1);
function schedule(D, P) {
  const seq = D.levels, I = D.INC, trig = P.trig / 100, years = [], rate = P.frate * 1e3;
  const yr = y => years[y] || (years[y] = { y, cal: P.y0 + y, t: 0, ore: 0, lv: new Float64Array(seq.length), dev: 0, cf: 0, target: 0, opened: [], faces: 0, months: 0 });
  for (const L of D.all) L.no = null;
  seq.forEach((L, k) => {
    L.seq = k; L.no = k + 1; L.name = `${k + 1}편(EL.${Math.round(L.zf)})`; L.rem = L.tot; L.ptr = 0; L.access = null; L.ready = Infinity; L.first = null; L.last = null; L.opened = null;
    for (const p of L.panels) { p.s0 = null; p.s1 = null; p.done = 0; if (p.blk) p.blk.paid = false; }
  });
  const jobs = seq.map((L, k) => k ? { kind: "incline", k, a: seq[k - 1].J, b: L.J, len: Math.hypot(Math.hypot(L.J.x - seq[k - 1].J.x, L.J.y - seq[k - 1].J.y), seq[k - 1].zf - L.zf) + L.xc, start: null }
                                   : { kind: I.dz0 >= 1 ? "incline" : "adit", k, a: I.PORTAL, b: I.E1, len: I.len0, start: null });
  const open = (k, m) => { const j = jobs[k]; j.start = m; seq[k].opened = m; seq[k].access = m + j.len / P.rate; seq[k].ready = seq[k].access + P.lead; if (k) yr(Math.floor(m / 12)).opened.push(k + 1); };
  if (seq.length) open(0, 0);
  const devTot = jobs.reduce((a, j) => a + j.len, 0), start = seq.length ? Math.ceil(seq[0].ready) : 0, r = P.disc / 100;
  let npv = -P.capex * 1e8, left = seq.reduce((a, L) => a + L.tot, 0), idle = 0;
  for (let m = 0; m < 12 * 100; m++) {
    const Y = yr(Math.floor(m / 12));
    let devM = 0; for (const j of jobs) if (j.start !== null) devM += Math.max(0, Math.min(m + 1, j.start + j.len / P.rate) - Math.max(m, j.start)) * P.rate;
    Y.dev += devM; let cf = -devM * P.devc * 1e4, got = 0;
    if (m >= start && left > 1) {
      let target = P.ann * 1e4 / 12; Y.target += target;
      const openL = seq.filter(L => L.ready <= m && L.rem > 1), busy = new Set();
      for (const L of openL) while (L.ptr < L.panels.length && L.panels[L.ptr].s1 !== null) L.ptr++;
      // 작업장 하나 = 판넬 하나. 캐던 판넬은 그 작업장이 이어서 캐고, 끝나면 위 편부터 진입점 쪽 옆 판넬이 끝난 새 판넬로 옮긴다
      const partial = []; for (const L of openL) for (let q = L.ptr; q < L.panels.length; q++) { const p = L.panels[q]; if (p.s1 === null && p.done > 0) partial.push(p); }
      // 지금 열려 있는 판넬이 없으면, 이번 달 안에 옆 판넬이 끝나는 가장 이른 판넬을 그 시각부터 캔다
      const next = tn => { let late = null; for (const L of openL) for (let q = L.ptr; q < L.panels.length; q++) { const p = L.panels[q]; if (p.s1 !== null || p.done > 0 || busy.has(p) || (p.pre && p.pre.s1 === null)) continue; const ta = p.pre ? p.pre.s1 : 0; if (ta <= tn + 1e-9) return p; if (!late || ta < late.pre.s1) late = p; } return late; };
      let nf = 0;
      for (let f = 0; f < P.nface && target > 1; f++) {
        let cap = rate, worked = false, cur = partial[f] || null;
        while (cap > 1 && target > 1) {
          const p = cur || next(m + (rate - cap) / rate); cur = null; if (!p) break; busy.add(p);
          if (p.done === 0 && p.pre && p.pre.s1 > m + (rate - cap) / rate) cap = rate * (m + 1 - p.pre.s1);
          if (cap <= 1) break; const L = p.L, d = Math.min(cap, p.t - p.done, target);
          if (p.s0 === null) { p.s0 = m + (rate - cap) / rate; if (L.first === null) L.first = p.s0; if (p.blk && !p.blk.paid) { p.blk.paid = true; cf -= p.blk.drive * P.dcost * 1e4; Y.dev += p.blk.drive; } }
          p.done += d; cap -= d; target -= d; got += d; worked = true;
          Y.t += d; Y.ore += d * p.frac; Y.lv[L.seq] += d; L.rem -= d; left -= d; cf += d * (p.frac * P.price - p.cost);
          if (p.done >= p.t - 1e-6) { p.s1 = m + (rate - cap) / rate; L.last = p.s1; } else break;
        }
        if (worked) nf++;
      }
      if (got > 0) { Y.faces += nf; Y.months++; }
    }
    idle = got > 0 ? 0 : idle + 1;
    Y.cf += cf; npv += cf / Math.pow(1 + r, (m + 0.5) / 12);
    const kl = jobs.reduce((a, j) => j.start !== null ? j.k : a, -1), Lk = seq[kl];
    if (Lk && kl + 1 < seq.length && Lk.access <= m + 1 && Lk.tot - Lk.rem >= trig * Lk.tot - 1) open(kl + 1, m + 1);
    if (left <= 1 && jobs.every(j => j.start !== null && j.start + j.len / P.rate <= m + 1)) break;
    if (idle > 240 && m > start) break;
  }
  let lastP = start; for (const L of seq) for (const p of L.panels) if (p.s1 !== null) lastP = Math.max(lastP, p.s1);
  const ys = []; for (let i = 0; i <= Math.floor((lastP - 1e-6) / 12); i++) ys.push(yr(i));
  if (ys.length) ys[0].cf -= P.capex * 1e8;
  let c = 0, pay = null; ys.forEach(Y => { const prev = c; c += Y.cf; Y.cum = c; if (pay === null && prev < 0 && c >= 0) pay = Y.cal; });
  return { seq, years: ys, start, end: lastP, devTot, npv, pay, jobs, mined: seq.reduce((a, L) => a + L.tot - Math.max(0, L.rem), 0) };
}
