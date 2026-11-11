
// ── 8. 계산 묶음 ──
let M = null, T = 0, P = null, DATALABEL = "예시 자료", SKIPPED = {};
function clearModel() {
  M = null; for (const id of ["k-res", "k-ton", "k-rec", "k-life", "k-prod", "k-npv"]) { $(id).textContent = "—"; $(id + "-d").textContent = ""; }
  const st = $("status"); st.innerHTML = ""; for (const m of DATAMSG) { const c = document.createElement("span"); c.className = "chip warn"; c.textContent = m; st.appendChild(c); }
  for (const id of ["derived", "capinfo", "portalinfo", "datainfo", "now", "legend"]) $(id).innerHTML = ""; for (const id of ["lvbody", "tbody", "chart"]) $(id).innerHTML = ""; $("when").textContent = "—";
  if (W3.ok) clearGroup(W3.dyn); drawPlan();
}
function recompute() {
  if (!ORE) return clearModel();
  P = readP(); const D = design(P), Sc = schedule(D, P); M = { ...D, ...Sc };
  M.tot = M.seq.reduce((a, L) => a + L.tot, 0); M.oreT = M.seq.reduce((a, L) => a + L.ore, 0);
  M.minSF = Infinity; M.minAt = null; M.nBad = 0; for (const L of M.seq) for (const p of L.panels) { if (p.sf < M.minSF) { M.minSF = p.sf; M.minAt = L.name; } if (p.sf < P.sfmin) M.nBad++; }
  M.driveTot = 0; M.haulTot = 0; M.nCC = 0; for (const L of M.seq) { for (const b of new Set(L.panels.map(p => p.blk))) if (b) M.driveTot += b.drive; for (const r of L.roots) M.haulTot += r.m; M.nCC += L.ccs.length; }
  const ext = 1 - (D.Pw * D.Pw) / (D.S * D.S), vert = D.H / P.lv, R = D.R, I = D.INC;
  $("derived").innerHTML = `필러 간격(중심) <b>${fmt(D.S, 1)} m</b> · 수평 필러 <b>${fmt(P.lv - D.H, 1)} m</b><br>판넬 안 회수 <b>${fmt(ext * 100)}%</b> × 수직 <b>${fmt(vert * 100)}%</b> = <b>${fmt(ext * vert * 100)}%</b><br>` +
    (isFinite(M.minSF) ? `필러 안전율 최저 <b style="color:${M.minSF < P.sfmin ? "var(--bad)" : "inherit"}">${fmt(M.minSF, 2)}</b> (${M.minAt}) · 기준 미달 <b>${fmt(M.nBad)}</b>판넬` : "판넬 없음");
  if (P.azauto && !I.miss) { $("p-az").value = Math.round((I.az % 360 + 360) % 360); showOutputs(); }
  const perBlast = P.w * D.H * P.adv * P.rho, perMonth = perBlast * P.nblast * P.rec / 100, capY = P.nface * perMonth * 12 / 1e4;
  const planMax = P.plan && P.plan.map.size ? Math.max(P.ann, ...P.plan.map.values()) : P.ann;
  $("capinfo").innerHTML = `1발파 ${fmt(P.w, 1)} × ${fmt(D.H, 1)} × ${fmt(P.adv, 1)}m × ${fmt(P.rho, 2)} = <b>${fmt(perBlast)} t</b><br>작업장 한 곳 <b>${fmt(perMonth / 1e3, 1)}천t/월</b> (월 ${fmt(P.nblast)}회 × 실수율 ${fmt(P.rec)}%)<br>작업장 능력 <b>${fmt(P.nface)}곳 × 12개월 = ${fmt(capY)}만t/년</b>${capY < planMax ? `<br><span style="color:var(--bad)">가장 큰 목표 ${fmt(planMax)}만t에 못 미칩니다</span>` : ""}`;
  $("planbox").hidden = !P.plan; const pm = $("planmsg");
  if (P.plan) { const ys = [...P.plan.map.keys()]; pm.hidden = !P.plan.bad.length; pm.textContent = P.plan.bad.length ? `읽지 못한 줄: ${P.plan.bad.slice(0, 3).join(" / ")}${P.plan.bad.length > 3 ? " …" : ""}` : ""; if (ys.length && Math.max(...ys) < P.y0) { pm.hidden = false; pm.textContent += " 입력한 연도가 모두 착공 연도보다 앞입니다."; } }
  $("portalinfo").innerHTML = `갱구 <b>${I.auto ? "자동 위치" : "직접 지정"}</b> · EL.<b>${fmt(I.zP, 1)}</b><br>E ${fmt(I.PORTAL.x, 1)} · N ${fmt(I.PORTAL.y, 1)}<br>굴진 <b>${bearing(I.azShow)}</b>${P.azauto ? " (자동)" : ""} · ${P.dip0 < 0.25 ? "수평갱" : `하향 ${fmt(P.dip0, 1)}°`} <b>${fmt(I.entryLen)} m</b>${I.miss ? ' <span style="color:var(--bad)">광체에 안 닿음</span>' : ""}<br>1편 바닥 EL.<b>${fmt(I.z1, 1)}</b> · 격자 방향 ${bearing(I.gAz * 180 / Math.PI)}<br>굴진 합계: 진입·사갱 <b>${fmt(M.devTot)} m</b> + 편 갱도 <b>${fmt(M.driveTot)} m</b>` + (P.bw > 0 ? `<br>운반갱도·크로스 갱도 <b>${fmt(M.haulTot)} m</b> (크로스 ${fmt(M.nCC)}곳)` : "");
  const dv = ORE.volSigned ? (R.volRaw / ORE.volSigned - 1) * 100 : 0;
  $("datainfo").innerHTML = `${DATALABEL}<br>광체 솔리드 <b>${ORE.solids.length}</b>개(합쳐서 계산) · 면 <b>${fmt(ORE.n)}</b>개` + (ORE.solids.length > 1 ? ORE.solids.map(sd => `<br>· ${sd.name.replace(/[<>&]/g, "")}: ${fmt(sd.vol)} m³`).join("") : "") + `<br>체적 합 <b>${fmt(ORE.volSigned)} m³</b><br>수직선 검산(합친 뒤) ${fmt(R.volRaw)} m³ (${dv >= 0 ? "+" : ""}${fmt(dv, 1)}%)<br>지형 격자 ${G.flat ? "없음(평지)" : `${fmt(G.d)}m · EL.${fmt(G.zmin)}~${fmt(G.zmax)}`}` + (Object.keys(SKIPPED).length ? `<br>안 읽은 도형: ${Object.entries(SKIPPED).map(([k, v]) => `${k} ${fmt(v)}`).join(", ")}` : "");
  const ex = { sf: [0, 0], cover: [0, 0], incline: [0, 0], econ: [0, 0], barrier: [0, 0] };
  for (const L of M.all) for (const p of L.rej) { ex[p.why][0]++; ex[p.why][1] += p.t; }
  const st = $("status"); st.innerHTML = "";
  const chip = (txt, cls = "") => { const s = document.createElement("span"); s.className = "chip " + cls; s.textContent = txt; st.appendChild(s); };
  for (const m of DATAMSG) chip(m, "warn");
  if (ORE.open) chip(`광체 솔리드에 열린 모서리 ${fmt(ORE.open)}개 — 닫힌 솔리드가 아니면 광량이 틀릴 수 있음`, "warn");
  if (dv < -3) chip(`솔리드끼리 겹친 부분이 있음: 체적 합보다 합친 체적이 ${fmt(-dv, 1)}% 작음 (겹친 곳은 한 번만 셈)`);
  else if (dv > 3 || R.odd > R.hit * 0.02) chip(`광체 솔리드 면에 틈이나 겹침이 있을 수 있음 (체적 차 ${fmt(dv, 1)}%, 짝 안 맞는 수직선 ${fmt(R.odd)}개)`, "warn");
  chip(`채굴 편 ${M.seq.length}개 · 판넬 ${fmt(M.seq.reduce((a, L) => a + L.panels.length, 0))}개`);
  if (M.aboveT > 0.01 * R.vol * P.rho) chip(`1편보다 높은 광체 ${fmt(M.aboveT / 1e4)}만t은 계획에 없음 — 갱구를 더 높은 곳에 놓으면 포함`, "warn");
  if (ex.cover[0]) chip(`지표 피복 부족 ${fmt(ex.cover[0])}판넬 (${fmt(ex.cover[1] / 1e4)}만t) 제외`);
  if (ex.barrier[0]) chip(`운반갱도 보안광주 ${fmt(P.bw)}m: ${fmt(ex.barrier[0])}판넬 (${fmt(ex.barrier[1] / 1e4)}만t) 남김`);
  if (ex.incline[0]) chip(`사갱 보호 광주 ${fmt(ex.incline[0])}판넬 (${fmt(ex.incline[1] / 1e4)}만t) 제외`);
  if (ex.econ[0]) chip(`수지 안 맞는 블록 ${fmt(ex.econ[0])}판넬 (${fmt(ex.econ[1] / 1e4)}만t) 제외`);
  if (ex.sf[0]) chip(`안전율 미달 ${fmt(ex.sf[0])}판넬 (${fmt(ex.sf[1] / 1e4)}만t) 제외`);
  const sr = (P.lv - D.H) / (D.S - D.Pw); if (sr < P.sill) chip(`수평 필러 ${fmt(P.lv - D.H, 1)}m ÷ 갱도 폭 ${fmt(D.S - D.Pw, 1)}m = ${fmt(sr, 2)} — 기준 ${fmt(P.sill, 2)} 미달`, "warn");
  for (const w of D.warn) chip(w, "warn");
  const short = M.years.filter((Y, i) => i > 0 && i < M.years.length - 1 && Y.target > 0 && Y.t < Y.target * 0.97).length;
  if (short) chip(`목표 미달 ${short}개 연도 — 작업장 수·편 개설 시점을 조정 (연차 계획 표의 빨간 숫자)`, "warn");
  if (M.mined < M.tot - 1) chip(`계획 기간 안에 못 캔 광량 ${fmt((M.tot - M.mined) / 1e4)}만t`, "warn");
  kpis(); buildLevels(); build3D(); drawLvTable();
  const sl = $("time"); sl.max = Math.max(1, Math.ceil(M.end) + 1);
  if (!recompute.did) { T = Math.round(M.start + 0.4 * (M.end - M.start)); recompute.did = true; }
  T = clamp(T, 0, +sl.max); sl.value = T; applyTime();
}
function kpis() {
  const lifeY = Math.max(0, (M.end - M.start) / 12), resT = M.R.vol * P.rho;
  $("k-res").textContent = fmt(resT / 1e4) + " 만t"; $("k-res-d").textContent = `지표 아래 ${fmt(M.R.vol / 1e4)}만 m³ × ${fmt(P.rho, 2)}`;
  $("k-ton").textContent = fmt(M.tot / 1e4) + " 만t"; $("k-ton-d").textContent = `광석 ${fmt(M.oreT / 1e4)}만t · 희석 ${fmt(M.tot ? (1 - M.oreT / M.tot) * 100 : 0, 1)}%`;
  $("k-rec").textContent = resT ? fmt(M.oreT / resT * 100, 1) + " %" : "—"; $("k-rec-d").textContent = "캐는 광석 ÷ 광체 광량";
  $("k-life").textContent = fmt(lifeY, 1) + " 년"; $("k-life-d").textContent = M.seq.length ? `${P.y0 + Math.floor(M.start / 12)} ~ ${P.y0 + Math.floor((M.end - 1e-6) / 12)}년` : "—";
  $("k-prod").textContent = lifeY ? fmt(M.mined / 1e4 / lifeY) + " 만t" : "—"; $("k-prod-d").textContent = P.plan && P.plan.map.size ? "목표: 연도별 계획" : `목표 ${fmt(P.ann)}만t`;
  $("k-npv").textContent = fmt(M.npv / 1e8) + " 억원"; $("k-npv").style.color = M.npv < 0 ? "var(--bad)" : "";
  $("k-npv-d").textContent = `할인율 ${fmt(P.disc, 1)}%` + (M.pay ? ` · 회수 ${M.pay}년` : " · 회수 못 함");
}

// ── 9. 색 ──
function hex2rgb(h) { const n = parseInt(h.replace("#", ""), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
let PAL = {};
function readPal() { for (const k of ["bg", "panel", "sunk", "ink", "muted", "line", "accent", "ore", "ramp", "scene", "ghost", "pillar", "bad", "ok", "y0", "y1", "y2", "y3", "lvA", "lvB"]) PAL[k] = cssv("--" + k) || "#888888"; }
function yearRGB(f) { const st = [PAL.y0, PAL.y1, PAL.y2, PAL.y3].map(hex2rgb), x = clamp(f, 0, 1) * 3, i = Math.min(2, Math.floor(x)), t = x - i; return st[i].map((v, k) => v + t * (st[i + 1][k] - v)); }
const rgbCss = c => `rgb(${c.map(v => Math.round(v * 255)).join(",")})`;
function lvRGB(k, n) { const a = hex2rgb(PAL.lvA), b = hex2rgb(PAL.lvB), t = n > 1 ? k / (n - 1) : 0.5; return a.map((v, i) => v + t * (b[i] - v)); }
const panelYearF = p => (p.s1 - M.start) / Math.max(1, M.end - M.start);
const sfMode = () => $("t-sf").checked;
const sfHex = p => p.sf < 1 ? PAL.bad : p.sf < P.sfmin ? PAL.accent : PAL.ok;

// ── 10. 3D ──
const W3 = { ok: false, O: { x: 0, y: 0, z: 0 }, E: 1000 };
const P3 = (x, y, z) => new THREE.Vector3(x - W3.O.x, z - W3.O.z, -(y - W3.O.y));
function init3D() {
  try {
    const cv = $("view"), renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(36, 1, 1, 100000), controls = new THREE.OrbitControls(camera, cv);
    controls.enableDamping = true; controls.dampingFactor = 0.12;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x5d665f, 0.8)); const sun = new THREE.DirectionalLight(0xffffff, 0.55); sun.position.set(-700, 900, 400); scene.add(sun);
    Object.assign(W3, { ok: true, renderer, scene, camera, controls, stat: new THREE.Group(), dyn: new THREE.Group() }); scene.add(W3.stat, W3.dyn);
    new ResizeObserver(resize3D).observe(cv); resize3D();
    (function loop() { requestAnimationFrame(loop); controls.update(); renderer.render(scene, camera); })();
  } catch (e) {
    $("view").hidden = true; const d = document.createElement("div"); d.className = "err"; d.textContent = "이 브라우저에서 3D 화면을 열 수 없습니다. 평면도·표·그래프는 그대로 쓸 수 있습니다."; $("view").parentElement.appendChild(d);
  }
}
function resize3D() { if (!W3.ok) return; const cv = W3.renderer.domElement, w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return; W3.renderer.setSize(w, h, false); W3.camera.aspect = w / h; W3.camera.updateProjectionMatrix(); }
function clearGroup(g) { while (g.children.length) { const o = g.children.pop(); if (o.geometry) o.geometry.dispose(); } }
function buildStatic() {                                                    // 자료가 바뀔 때만: 지형 · 광체 · 경계선
  if (!W3.ok) return; clearGroup(W3.stat); W3.terrain = W3.ore = W3.cadG = W3.terrainMat = null; if (!VB) return;
  if (!G) G = { x0: VB.x0, y0: VB.y0, d: Math.max(VB.x1 - VB.x0, VB.y1 - VB.y0), nx: 2, ny: 2, z: new Float32Array(4), zmin: 0, zmax: 0, flat: true };
  W3.O = { x: (VB.x0 + VB.x1) / 2, y: (VB.y0 + VB.y1) / 2, z: ORE ? (ORE.bbox.z0 + ORE.bbox.z1) / 2 : (G.zmin + G.zmax) / 2 }; W3.E = Math.max(VB.x1 - VB.x0, VB.y1 - VB.y0);
  const st = Math.max(1, Math.ceil(Math.max(G.nx, G.ny) / 150)), ix = [], jy = []; for (let i = 0; i < G.nx; i += st) ix.push(i); for (let j = 0; j < G.ny; j += st) jy.push(j);
  const pos = [], idx = []; for (const j of jy) for (const i of ix) { const p = P3(G.x0 + i * G.d, G.y0 + j * G.d, G.z[j * G.nx + i]); pos.push(p.x, p.y, p.z); }
  for (let b = 0; b < jy.length - 1; b++) for (let a = 0; a < ix.length - 1; a++) { const k = b * ix.length + a; idx.push(k, k + 1, k + ix.length, k + 1, k + ix.length + 1, k + ix.length); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); tg.setIndex(idx); tg.computeVertexNormals();
  W3.terrainMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false });
  W3.terrain = new THREE.Mesh(tg, W3.terrainMat); W3.terrain.renderOrder = 10;
  W3.terrainWire = new THREE.LineSegments(new THREE.WireframeGeometry(tg), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.1 })); W3.terrain.add(W3.terrainWire); W3.stat.add(W3.terrain);
  W3.oreMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
  W3.oreWireMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35 });
  if (ORE) {
    const T3 = ORE.tris, op = new Float32Array(T3.length); for (let t = 0; t < T3.length; t += 3) { op[t] = T3[t] - W3.O.x; op[t + 1] = T3[t + 2] - W3.O.z; op[t + 2] = -(T3[t + 1] - W3.O.y); }
    const og = new THREE.BufferGeometry(); og.setAttribute("position", new THREE.BufferAttribute(op, 3)); og.computeVertexNormals();
    W3.ore = new THREE.Mesh(og, W3.oreMat); W3.ore.renderOrder = 5; W3.ore.add(new THREE.LineSegments(new THREE.EdgesGeometry(og, 25), W3.oreWireMat)); W3.stat.add(W3.ore);
  }
  W3.cadG = new THREE.Group(); W3.stat.add(W3.cadG);
  W3.claimMat = new THREE.LineDashedMaterial({ dashSize: W3.E / 90, gapSize: W3.E / 140 }); W3.cadMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.55 });
  const drape = (pts, closed, mat, dashed) => {
    const o = [], n = pts.length; for (let q = 0; q < n - (closed ? 0 : 1); q++) { const a = pts[q], b = pts[(q + 1) % n], k = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (G.d * 2))); for (let s = 0; s < k; s++) { const x = a[0] + (b[0] - a[0]) * s / k, y = a[1] + (b[1] - a[1]) * s / k; o.push(P3(x, y, terrainZ(x, y) + 1.5)); } }
    const e = pts[closed ? 0 : n - 1]; o.push(P3(e[0], e[1], terrainZ(e[0], e[1]) + 1.5));
    const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(o), mat); if (dashed) ln.computeLineDistances(); W3.cadG.add(ln);
  };
  for (const pg of CLAIM) drape(pg, true, W3.claimMat, true);
  for (const c of CAD) drape(c.pts, c.closed, W3.cadMat, false);
  W3.terrain.visible = $("t-terrain").checked; if (W3.ore) W3.ore.visible = $("t-ore").checked; W3.cadG.visible = $("t-cad").checked;
  theme3D();
}
function theme3D() {
  if (!W3.ok) return; W3.renderer.setClearColor(new THREE.Color(PAL.scene));
  if (W3.terrainMat) { W3.terrainMat.color.set(PAL.pillar); W3.terrainWire.material.color.set(PAL.ink); W3.oreMat.color.set(PAL.ore); W3.oreWireMat.color.set(PAL.ore); W3.claimMat.color.set(PAL.accent); W3.cadMat.color.set(PAL.muted); }
  if (W3.rampMat) W3.rampMat.color.set(PAL.ramp); if (W3.driveMat) W3.driveMat.color.set(PAL.ore); if (W3.portal) W3.portal.material.color.set(PAL.accent);
}
function build3D() {
  if (!W3.ok || !M) return; clearGroup(W3.dyn);
  const list = []; for (const L of M.seq) for (const p of L.panels) list.push(p);
  W3.list = list; const n = list.length, S = M.S, Pw = M.Pw, H = M.H, g = Math.min(0.5, S * 0.03), wR = (S - Pw) / 2, off = Pw / 2 + wR / 2;
  const box = new THREE.BoxGeometry(1, 1, 1);
  W3.rooms = new THREE.InstancedMesh(box, new THREE.MeshLambertMaterial(), Math.max(1, 4 * n)); W3.pillars = new THREE.InstancedMesh(box.clone(), new THREE.MeshLambertMaterial(), Math.max(1, n));
  W3.roomM = new Float32Array(16 * 4 * n); W3.pilM = new Float32Array(16 * n);
  const F = M.INC.F, o = new THREE.Object3D(); o.rotation.y = Math.atan2(F.uy, F.ux);            // 상자의 X축 = 격자 u 방향
  const put = (arr, k, u, v, z, su, sy, sv) => { const w = toW(F, u, v); o.position.copy(P3(w[0], w[1], z)); o.scale.set(su, sy, sv); o.updateMatrix(); o.matrix.toArray(arr, k * 16); };
  list.forEach((p, k) => {
    const zc = p.zf + H / 2;
    put(W3.roomM, 4 * k, p.u, p.v + off, zc, S - g, H, wR - g); put(W3.roomM, 4 * k + 1, p.u, p.v - off, zc, S - g, H, wR - g);
    put(W3.roomM, 4 * k + 2, p.u + off, p.v, zc, wR - g, H, Pw); put(W3.roomM, 4 * k + 3, p.u - off, p.v, zc, wR - g, H, Pw);
    put(W3.pilM, k, p.u, p.v, zc, Pw, H, Pw);
  });
  const c = new THREE.Color(); for (let k = 0; k < Math.max(1, 4 * n); k++) W3.rooms.setColorAt(k, c); for (let k = 0; k < Math.max(1, n); k++) W3.pillars.setColorAt(k, c);
  if (!n) { W3.rooms.count = 0; W3.pillars.count = 0; }
  W3.dyn.add(W3.rooms, W3.pillars);
  const rr = Math.max(1.5, W3.E / 380); W3.rampMat = new THREE.MeshLambertMaterial(); W3.driveMat = new THREE.MeshLambertMaterial(); W3.jobMeshes = []; W3.drives = [];
  for (const j of M.jobs) { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.LineCurve3(P3(j.a.x, j.a.y, j.a.z + 2), P3(j.b.x, j.b.y, j.b.z + 2)), 40, rr, 6, false), W3.rampMat); W3.dyn.add(m); W3.jobMeshes.push({ m, j }); }
  const I = M.INC; W3.portal = new THREE.Mesh(new THREE.SphereGeometry(rr * 2.6, 16, 12), new THREE.MeshLambertMaterial()); W3.portal.position.copy(P3(I.PORTAL.x, I.PORTAL.y, I.PORTAL.z + 2)); W3.dyn.add(W3.portal);
  for (const L of M.seq) {                                                    // 편 주 운반 갱도 · 떨어진 블록 연결 갱도
    const lines = [[{ x: L.J.x, y: L.J.y }, ...L.trunk], ...L.drives, ...(L.haul ? [L.haul, ...L.ccs] : [])];
    for (const ln of lines) { if (ln.length < 2) continue; const cp = new THREE.CurvePath(); for (let q = 0; q < ln.length - 1; q++) { const a = P3(ln[q].x, ln[q].y, L.zf + 2), b = P3(ln[q + 1].x, ln[q + 1].y, L.zf + 2); if (a.distanceTo(b) > 0.01) cp.add(new THREE.LineCurve3(a, b)); } if (!cp.curves.length) continue;
      const m = new THREE.Mesh(new THREE.TubeGeometry(cp, Math.min(400, cp.curves.length * 2), rr * 0.6, 5, false), W3.driveMat); W3.dyn.add(m); W3.drives.push({ m, L }); }
  }
  theme3D();
}
function time3D() {
  if (!W3.ok || !W3.list || !M || !W3.rooms.parent) return;
  const showF = $("t-future").checked, sfm = sfMode(), R = W3.rooms, Pm = W3.pillars, rm = R.instanceMatrix.array, pm = Pm.instanceMatrix.array, rc = R.instanceColor.array, pc = Pm.instanceColor.array;
  const ac = hex2rgb(PAL.accent), gh = hex2rgb(PAL.ghost), pl = hex2rgb(PAL.pillar);
  W3.list.forEach((p, k) => {
    const mined = p.s1 !== null && p.s1 <= T, act = p.s0 !== null && p.s0 <= T && !mined, vis = sfm || mined || act || showF;
    const col = sfm ? hex2rgb(sfHex(p)) : mined ? yearRGB(panelYearF(p)) : act ? ac : gh;
    for (let q = 0; q < 4; q++) { const base = (4 * k + q) * 16; if (vis) rm.set(W3.roomM.subarray(base, base + 16), base); else rm.fill(0, base, base + 16); rc.set(col, (4 * k + q) * 3); }
    if (vis) pm.set(W3.pilM.subarray(16 * k, 16 * k + 16), 16 * k); else pm.fill(0, 16 * k, 16 * k + 16);
    pc.set(sfm || mined || act ? pl : gh, 3 * k);
  });
  R.instanceMatrix.needsUpdate = Pm.instanceMatrix.needsUpdate = true; R.instanceColor.needsUpdate = Pm.instanceColor.needsUpdate = true;
  for (const { m, j } of W3.jobMeshes) { const f = jobProg(j, T); m.visible = f > 0; m.geometry.setDrawRange(0, Math.ceil(f * 40) * 36); }
  for (const d of W3.drives) d.m.visible = d.L.access !== null && T >= d.L.access;
}
const VIEWS = { "v-iso": [-0.75, 0.62, 0.55, 1.2], "v-side": [-0.5, 0.06, 0.87, 1.15], "v-top": [0.001, 1, 0.0001, 1.1] };
function setView(id) {
  if (!W3.ok || !VB) return; const [x, y, z, k] = VIEWS[id], tgt = ORE ? P3((ORE.bbox.x0 + ORE.bbox.x1) / 2, (ORE.bbox.y0 + ORE.bbox.y1) / 2, (ORE.bbox.z0 + ORE.bbox.z1) / 2) : new THREE.Vector3(0, 0, 0);
  W3.controls.target.copy(tgt); W3.camera.position.copy(tgt).add(new THREE.Vector3(x, y, z).normalize().multiplyScalar(W3.E * 1.15 * k)); W3.camera.near = W3.E / 500; W3.camera.far = W3.E * 40; W3.camera.updateProjectionMatrix(); W3.controls.update();
  for (const b of Object.keys(VIEWS)) $(b).setAttribute("aria-pressed", String(b === id));
}

// ── 11. 편 평면도 ──
let PICK = false, CONT = null, CONTVER = -1;
function buildLevels() {
  const sel = $("lvsel"), keep = sel.value; sel.innerHTML = `<option value="auto">지금 캐는 편</option>`;
  for (const L of M.all) { const o = document.createElement("option"); o.value = L.zf.toFixed(2); o.textContent = L.no ? `${L.no}편 · EL.${fmt(L.zf)} · ${fmt(L.tot / 1e4)}만t` : `EL.${fmt(L.zf)} · 채굴 없음`; sel.appendChild(o); }
  sel.value = [...sel.options].some(o => o.value === keep) ? keep : "auto";
}
function planLevel() {
  const v = $("lvsel").value; if (v !== "auto") return M.all.find(L => L.zf.toFixed(2) === v);
  const act = M.seq.find(L => L.panels.some(p => p.s0 !== null && p.s0 <= T && (p.s1 === null || p.s1 > T))); if (act) return act;
  const done = M.seq.filter(L => L.panels.some(p => p.s1 !== null && p.s1 <= T)); return done.length ? done[done.length - 1] : M.seq[0];
}
function contours() {
  if (CONT && CONTVER === DATAVER) return CONT; CONTVER = DATAVER; const segs = []; if (G.flat) return CONT = { segs, ci: 0 };
  const raw = (G.zmax - G.zmin) / 12, ci = [1, 2, 5, 10, 20, 25, 50, 100, 200].find(v => v >= raw) || 500, d = G.d;
  for (let j = 0; j < G.ny - 1; j++) for (let i = 0; i < G.nx - 1; i++) {
    const c = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]], z = c.map(([a, b]) => G.z[b * G.nx + a]), lo = Math.min(...z), hi = Math.max(...z);
    for (let lv = Math.ceil(lo / ci) * ci; lv < hi; lv += ci) {
      const pts = []; for (let e = 0; e < 4; e++) { const a = e, b = (e + 1) % 4; if ((z[a] < lv) !== (z[b] < lv)) { const t = (lv - z[a]) / (z[b] - z[a]); pts.push([G.x0 + (c[a][0] + t * (c[b][0] - c[a][0])) * d, G.y0 + (c[a][1] + t * (c[b][1] - c[a][1])) * d]); } }
      if (pts.length >= 2) segs.push([lv, pts[0], pts[1]]); if (pts.length === 4) segs.push([lv, pts[2], pts[3]]);
    }
  }
  return CONT = { segs, ci };
}
function drawPlan() {
  const cv = $("plan"), W = cv.parentElement.clientWidth - 24; if (W <= 0 || !VB) return;
  const sc = W / (VB.x1 - VB.x0), H = Math.round((VB.y1 - VB.y0) * sc), dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.style.height = H + "px"; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); cv._sc = sc;
  const X = x => (x - VB.x0) * sc, Y = y => (VB.y1 - y) * sc, fb = cssv("--f-body"), fm = cssv("--f-mono");
  const line = (p, q) => { c.beginPath(); c.moveTo(X(p.x), Y(p.y)); c.lineTo(X(q.x), Y(q.y)); c.stroke(); };
  c.fillStyle = PAL.sunk; c.fillRect(0, 0, W, H);
  const ct = G ? contours() : { segs: [], ci: 1 }; c.strokeStyle = PAL.muted;
  for (const [lv, a, b] of ct.segs) { const idx = Math.round(lv / ct.ci) % 5 === 0; c.globalAlpha = idx ? 0.45 : 0.18; c.lineWidth = idx ? 1 : 0.7; c.beginPath(); c.moveTo(X(a[0]), Y(a[1])); c.lineTo(X(b[0]), Y(b[1])); c.stroke(); }
  c.globalAlpha = 0.8; c.lineWidth = 0.9; c.strokeStyle = PAL.muted;
  for (const q of CAD) { c.beginPath(); q.pts.forEach((p, k) => k ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))); if (q.closed) c.closePath(); c.stroke(); }
  c.globalAlpha = 1; c.setLineDash([6, 4]); c.strokeStyle = PAL.accent; c.lineWidth = 1.3;
  for (const pg of CLAIM) { c.beginPath(); pg.forEach((p, k) => k ? c.lineTo(X(p[0]), Y(p[1])) : c.moveTo(X(p[0]), Y(p[1]))); c.closePath(); c.stroke(); }
  c.setLineDash([]);
  if (!M) { c.fillStyle = PAL.ink; c.font = `600 12px ${fb}`; c.fillText("광체 레이어를 지정하면 설계가 표시됩니다", 8, 18); return; }
  const L = planLevel(), S = M.S, Pw = M.Pw, sfm = sfMode(), I = M.INC, F = I.F, px = 1 / sc;
  if (L) {                                                                    // 판넬은 격자 좌표(u, v)로 그린다: 캔버스 변환에 격자 회전을 넣음
    c.save(); c.setTransform(dpr * sc * F.ux, -dpr * sc * F.uy, -dpr * sc * F.uy, -dpr * sc * F.ux, dpr * X(F.ox), dpr * Y(F.oy));
    for (const p of L.rej) {
      if (p.why === "barrier") { c.fillStyle = PAL.pillar; c.globalAlpha = 0.45; c.fillRect(p.u - S / 2, p.v - S / 2, S, S); c.globalAlpha = 1; continue; }
      c.strokeStyle = p.why === "sf" ? PAL.bad : p.why === "econ" ? PAL.accent : PAL.muted; c.lineWidth = px; c.globalAlpha = p.why === "cover" ? 0.5 : 0.8;
      const u0 = p.u - S / 2 + px, v0 = p.v - S / 2 + px, w = S - 2 * px; if (p.why === "econ") c.setLineDash([2 * px, 2 * px]); c.strokeRect(u0, v0, w, w); c.setLineDash([]);
      if (p.why === "sf") { c.beginPath(); c.moveTo(u0, v0 + w); c.lineTo(u0 + w, v0); c.stroke(); }
    }
    c.globalAlpha = 1;
    for (const p of L.panels) {
      const mined = p.s1 !== null && p.s1 <= T, act = p.s0 !== null && p.s0 <= T && !mined;
      c.fillStyle = sfm ? sfHex(p) : mined ? rgbCss(yearRGB(panelYearF(p))) : act ? PAL.accent : PAL.ghost;
      c.fillRect(p.u - S / 2 + px / 2, p.v - S / 2 + px / 2, S - px, S - px);
      c.fillStyle = sfm || mined || act ? PAL.pillar : PAL.sunk; c.globalAlpha = sfm || mined || act ? 1 : 0.7;
      c.fillRect(p.u - Pw / 2, p.v - Pw / 2, Pw, Pw); c.globalAlpha = 1;
    }
    c.restore();
  }
  c.strokeStyle = PAL.ramp; c.lineWidth = 1; c.setLineDash([4, 3]); c.globalAlpha = 0.5;
  for (const g of I.segs) { const l = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y) || 1, nx = -(g.b.y - g.a.y) / l, ny = (g.b.x - g.a.x) / l; for (const sg of [-1, 1]) line({ x: g.a.x + nx * sg * P.iw, y: g.a.y + ny * sg * P.iw }, { x: g.b.x + nx * sg * P.iw, y: g.b.y + ny * sg * P.iw }); }
  c.setLineDash([]); c.globalAlpha = 1;
  for (const j of M.jobs) { const f = jobProg(j, T); c.strokeStyle = PAL.ramp; c.globalAlpha = 0.35; c.lineWidth = 1.4; line(j.a, j.b); c.globalAlpha = 1; if (f > 0) { c.lineWidth = 3.2; line(j.a, { x: j.a.x + (j.b.x - j.a.x) * f, y: j.a.y + (j.b.y - j.a.y) * f }); } }
  c.font = `500 9.5px ${fm}`;
  for (const Lv of M.seq) { const J = Lv.J, on = Lv.access !== null && T >= Lv.access; c.fillStyle = on ? PAL.ink : PAL.muted; c.beginPath(); c.arc(X(J.x), Y(J.y), 2.2, 0, Math.PI * 2); c.fill(); c.fillText(String(Lv.no), X(J.x) + 5, Y(J.y) - 4); }
  if (L && L.J && L.trunk) {                                                  // 편 주 운반 갱도(판넬을 따라) · 연결 갱도
    const on = L.access !== null && L.access !== undefined && T >= L.access; c.strokeStyle = PAL.ore; c.lineWidth = 2.2; c.globalAlpha = on ? 1 : 0.4;
    c.beginPath(); c.moveTo(X(L.J.x), Y(L.J.y)); for (const q of L.trunk) c.lineTo(X(q.x), Y(q.y)); c.stroke();
    if (L.haul) { c.lineWidth = 3; line(L.haul[0], L.haul[1]); c.lineWidth = 1.8; for (const q of L.ccs) line(q[0], q[1]); }
    c.setLineDash([5, 3]); for (const d of L.drives) line(d[0], d[1]); c.setLineDash([]); c.globalAlpha = 1;
    c.fillStyle = PAL.ore; c.beginPath(); c.arc(X(L.J.x), Y(L.J.y), 4, 0, Math.PI * 2); c.fill();
  }
  const gx = X(I.PORTAL.x), gy = Y(I.PORTAL.y); c.fillStyle = PAL.accent; c.beginPath(); c.moveTo(gx, gy - 8); c.lineTo(gx + 7, gy + 5); c.lineTo(gx - 7, gy + 5); c.closePath(); c.fill();
  c.fillStyle = PAL.ink; c.font = `600 11px ${fb}`; const lab = `갱구 EL.${fmt(I.zP)}`; c.fillText(lab, gx + 10 + c.measureText(lab).width > W ? gx - 12 - c.measureText(lab).width : gx + 10, gy + 2);
  const want = (VB.x1 - VB.x0) / 5, bl = [10, 20, 50, 100, 200, 500, 1000, 2000].reduce((a, v) => Math.abs(v - want) < Math.abs(a - want) ? v : a), bar = bl * sc, bx = W - bar - 14, by = H - 14;
  c.strokeStyle = PAL.ink; c.lineWidth = 1.5; c.beginPath(); c.moveTo(bx, by); c.lineTo(bx + bar, by); c.moveTo(bx, by - 4); c.lineTo(bx, by); c.moveTo(bx + bar, by - 4); c.lineTo(bx + bar, by); c.stroke();
  c.font = `500 10.5px ${fm}`; c.fillText(`${bl} m`, bx + bar / 2 - 14, by - 6);
  c.beginPath(); c.moveTo(W - 18, 10); c.lineTo(W - 23, 24); c.lineTo(W - 13, 24); c.closePath(); c.fill(); c.fillText("N", W - 22, 36);
  c.font = `600 12px ${fb}`;
  if (PICK) c.fillText("갱구로 쓸 지점을 누르세요", 8, 16);
  if (L) c.fillText(`${L.no ? L.no + "편 · " : ""}EL.${fmt(L.zf)}  ·  ${L.panels.length ? `판넬 ${L.panels.length}개 · ${fmt(L.tot / 1e4)}만t` : "채굴 판넬 없음"}`, 8, H - 10);
}
function planXY(e) { const cv = $("plan"), r = cv.getBoundingClientRect(), sc = cv._sc; return { x: VB.x0 + (e.clientX - r.left) / sc, y: VB.y1 - (e.clientY - r.top) / sc }; }
function planTip(e) {
  const cv = $("plan"), tip = $("tip"); if (!cv._sc || !M || !G) return; const { x, y } = planXY(e), L = planLevel(), R = M.R;
  const lc = toLoc(M.INC.F, x, y), p = L && L.map.get(Math.floor((lc[0] - R.gx0) / M.S) + "," + Math.floor((lc[1] - R.gy0) / M.S));
  const when = m => `${P.y0 + Math.floor(m / 12)}.${String(Math.floor(m % 12) + 1).padStart(2, "0")}`;
  let h = `E ${fmt(x)} · N ${fmt(y)} · 지표 EL.${fmt(terrainZ(x, y))}`;
  if (p && !PICK) {
    const why = { sf: `<b style="color:var(--bad)">제외 · 안전율 미달</b>`, cover: "<b>제외 · 지표 피복 부족</b>", incline: "<b>제외 · 사갱 보호 광주</b>", barrier: "<b>남김 · 운반갱도 보안광주</b>", econ: "<b>제외 · 수지 안 맞음</b>" }[p.why];
    h += "<br>" + (why ? why + "<br>" : "") + `광체 비율 <b>${fmt(p.frac * 100)}%</b> · ${fmt(p.t / 1e4, 2)}만t<br>깊이 ${fmt(p.depth)}m · 안전율 <b style="color:${p.sf < P.sfmin ? "var(--bad)" : "inherit"}">${fmt(Math.min(p.sf, 99), 2)}</b>` +
      (p.cost !== undefined ? `<br>진입점에서 경로 ${fmt(p.dist)}m · 원가 ${fmt(p.cost)}원/t` : "") +
      (p.blk ? `<br>블록 ${fmt(p.blk.n)}판넬 · 편 갱도 ${fmt(p.blk.drive)}m · 순이익 <b style="color:${p.blk.val < 0 ? "var(--bad)" : "inherit"}">${fmt(p.blk.val / 1e8, 1)}억원</b>` : "") +
      (p.s0 !== null && p.s0 !== undefined ? `<br>채굴 ${when(p.s0)} ~ ${p.s1 !== null ? when(p.s1) : "—"}` : (p.why ? "" : "<br>계획 기간 안에 채굴 안 됨"));
  }
  tip.innerHTML = h; tip.hidden = false;
  const wr = cv.parentElement.getBoundingClientRect(); let lx = e.clientX - wr.left + 14, ly = e.clientY - wr.top + 14;
  if (lx + tip.offsetWidth > wr.width - 4) lx = e.clientX - wr.left - tip.offsetWidth - 10; if (ly + tip.offsetHeight > wr.height - 4) ly = e.clientY - wr.top - tip.offsetHeight - 10;
  tip.style.left = lx + "px"; tip.style.top = ly + "px";
}
function setPick(on) { PICK = on; $("pick").setAttribute("aria-pressed", String(on)); $("pick").textContent = on ? "평면도를 누르세요 (취소)" : "평면도에서 갱구 놓기"; $("plan").classList.toggle("pick", on); drawPlan(); if (on) $("plan").scrollIntoView({ block: "center", behavior: "smooth" }); }

// ── 12. 그래프 · 표 · 범례 ──
function drawChart() {
  const svg = $("chart"), Wd = svg.clientWidth || 600, Hd = 220, pad = { l: 44, r: 10, t: 20, b: 24 }, ys = M.years, n = ys.length;
  if (!n) { svg.innerHTML = ""; return; }
  const maxV = Math.max(P.ann * 1.1, ...ys.map(Y => Y.t / 1e4)) * 1.08, fm = cssv("--f-mono");
  const x = i => pad.l + (Wd - pad.l - pad.r) * (i + 0.5) / n, y = v => pad.t + (Hd - pad.t - pad.b) * (1 - v / maxV), bw = Math.max(2, (Wd - pad.l - pad.r) / n * 0.72);
  const step = [5, 10, 25, 50, 100].find(v => maxV / v <= 6) || 200; let s = "";
  for (let v = 0; v <= maxV; v += step) s += `<line x1="${pad.l}" x2="${Wd - pad.r}" y1="${y(v)}" y2="${y(v)}" stroke="${PAL.line}" stroke-width="1"/><text x="${pad.l - 6}" y="${y(v) + 3.5}" text-anchor="end" font-size="10.5" fill="${PAL.muted}" font-family="${fm}">${v}</text>`;
  s += `<text x="${pad.l}" y="10" text-anchor="start" font-size="10" fill="${PAL.muted}">단위 만t</text>`;
  const cy = Math.floor(T / 12), nl = M.seq.length;
  ys.forEach((Y, i) => {
    let acc = 0;
    for (let k = 0; k < nl; k++) { const v = Y.lv[k] / 1e4; if (v <= 0) continue; s += `<rect x="${x(i) - bw / 2}" y="${y(acc + v)}" width="${bw}" height="${Math.max(0.5, y(acc) - y(acc + v))}" fill="${rgbCss(lvRGB(k, nl))}"><title>${Y.cal}년 · ${M.seq[k].name} ${fmt(v, 1)}만t</title></rect>`; acc += v; }
    if (i === cy) s += `<rect x="${x(i) - bw / 2 - 2}" y="${y(acc) - 2}" width="${bw + 4}" height="${y(0) - y(acc) + 2}" fill="none" stroke="${PAL.accent}" stroke-width="1.5"/>`;
    if (n <= 12 || i % Math.ceil(n / 10) === 0) s += `<text x="${x(i)}" y="${Hd - 6}" text-anchor="middle" font-size="10.5" fill="${PAL.muted}" font-family="${fm}">${Y.cal}</text>`;
    if (Y.target > 0) s += `<polyline points="${x(i) - bw / 2},${y(Y.target / 1e4)} ${x(i) + bw / 2},${y(Y.target / 1e4)}" fill="none" stroke="${PAL.ink}" stroke-width="1.2" stroke-dasharray="3 2"/>`;
  });
  svg.setAttribute("viewBox", `0 0 ${Wd} ${Hd}`); svg.innerHTML = s;
}
const ym = m => `${P.y0 + Math.floor(m / 12)}.${String(Math.floor(m % 12) + 1).padStart(2, "0")}`;
function drawLvTable() {
  let h = ""; const cur = planLevel();
  for (const L of M.seq) {
    const j = M.jobs[L.seq];
    const inp = (k, v, own, mn, mx, st, lab) => `<td><input class="lvin${own ? " own" : ""}" type="number" id="lv-${k}-${L.no}" data-no="${L.no}" data-k="${k}" min="${mn}" max="${mx}" step="${st}" value="${v}" aria-label="${L.no}편 ${lab}"></td>`;
    h += `<tr data-z="${L.zf.toFixed(2)}" class="${L === cur ? "cur" : ""}"><td>${L.no}편</td><td>${fmt(L.zf, 1)}</td><td>${fmt(L.panels.length)}</td>${inp("rec", Math.round(L.rec * 1000) / 10, L.own.rec, 10, 100, 1, "채광 실수율 %")}${inp("adv", L.adv, L.own.adv, 0.5, 8, 0.1, "굴진장 m")}<td>${fmt(L.tot / 1e4, 1)}</td><td>${fmt(L.ore / 1e4, 1)}</td><td>${fmt((1 - L.ore / L.tot) * 100, 1)}</td><td class="${L.minSF < P.sfmin ? "neg" : ""}">${fmt(Math.min(L.minSF, 99), 2)}</td><td>${fmt(j.len)}</td><td>${L.opened !== null ? ym(L.opened) : "—"}</td><td>${L.first !== null ? ym(L.first) + " ~ " + (L.rem <= 1 && L.last !== null ? ym(L.last) : "") : "—"}</td></tr>`;
  }
  h += `<tr><td><b>합계</b></td><td></td><td>${fmt(M.seq.reduce((a, L) => a + L.panels.length, 0))}</td><td></td><td></td><td>${fmt(M.tot / 1e4, 1)}</td><td>${fmt(M.oreT / 1e4, 1)}</td><td>${fmt(M.tot ? (1 - M.oreT / M.tot) * 100 : 0, 1)}</td><td>${isFinite(M.minSF) ? fmt(M.minSF, 2) : "—"}</td><td>${fmt(M.devTot)}</td><td></td><td></td></tr>`;
  $("lvbody").innerHTML = h;
}
function drawTable() {
  const cy = Math.floor(T / 12); let cum = 0, h = "";
  M.years.forEach((Y, i) => {
    cum += Y.t; const nos = M.seq.filter((L, k) => Y.lv[k] > 0).map(L => L.no), lv = (nos.length ? nos.join("·") + "편" : "") + (Y.opened.length ? ` <span style="color:var(--accent)">+${Y.opened.join("·")}편 개설</span>` : "");
    h += `<tr data-y="${i}" class="${i === cy ? "cur" : ""}"><td>${Y.cal}</td><td>${Y.target ? fmt(Y.target / 1e4, 1) : "—"}</td><td class="${Y.target && Y.t < Y.target * 0.97 && i < M.years.length - 1 ? "neg" : ""}">${fmt(Y.t / 1e4, 1)}</td><td class="lvls">${lv || (Y.dev ? "진입 굴진" : "—")}</td><td>${Y.months ? fmt(Y.faces / Y.months, 1) : "—"}</td><td>${Y.t ? fmt((1 - Y.ore / Y.t) * 100, 1) : "—"}</td><td>${fmt(cum / 1e4)}</td><td>${fmt(Y.dev)}</td><td class="${Y.cf < 0 ? "neg" : ""}">${fmt(Y.cf / 1e8, 1)}</td></tr>`;
  });
  $("tbody").innerHTML = h;
}
function drawLegend() {
  const el = $("legend"), cat = (c, t) => `<span><i style="background:${c}"></i>${t}</span>`;
  if (sfMode()) { el.innerHTML = `<div>필러 안전율</div><div class="cats">${cat(PAL.ok, `${fmt(P.sfmin, 1)} 이상`)}${cat(PAL.accent, `1.0 ~ ${fmt(P.sfmin, 1)}`)}${cat(PAL.bad, "1.0 미만")}</div>`; return; }
  const y0 = P.y0 + Math.floor(M.start / 12), y1 = P.y0 + Math.floor((M.end - 1e-6) / 12), grad = `linear-gradient(90deg,${[0, 1 / 3, 2 / 3, 1].map(f => rgbCss(yearRGB(f))).join(",")})`;
  el.innerHTML = `<div>캔 연도</div><div class="bar" style="background:${grad}"></div><div class="ends"><span>${y0}</span><span>${y1}</span></div><div class="cats">${cat(PAL.accent, "채굴 중")}${cat(PAL.pillar, "필러")}${cat(PAL.ghost, "남은 판넬")}${cat(PAL.ore, "광체")}</div>`;
}

// ── 13. 시간 · 조작 ──
function applyTime() {
  if (!M) return;
  const py = Math.floor((T - M.start) / 12) + 1, phase = T < M.start ? "1편 진입 굴진" : T >= M.end ? "채굴 종료" : `생산 ${py}년차`;
  $("when").innerHTML = `${P.y0 + Math.floor(T / 12)}년 ${Math.floor(T % 12) + 1}월<small>${phase}</small>`;
  let cum = 0, nact = 0; const act = new Set();
  for (const L of M.seq) for (const p of L.panels) { if (p.s1 !== null && p.s1 <= T) cum += p.t; else if (p.s0 !== null && p.s0 <= T) { cum += p.t * (p.s1 !== null ? clamp((T - p.s0) / Math.max(1e-6, p.s1 - p.s0), 0, 1) : 0.5); act.add(L.no); nact++; } }
  const dev = M.jobs.reduce((a, j) => a + jobProg(j, T) * j.len, 0), opened = M.seq.filter(L => L.access !== null && L.access <= T).length;
  $("now").innerHTML = `누적 생산 <b>${fmt(cum / 1e4)}만t</b> · 남은 광량 <b>${fmt((M.tot - cum) / 1e4)}만t</b> · 작업 편 <b>${act.size ? [...act].sort((a, b) => a - b).join("·") + "편" : "—"}</b> · 작업장 <b>${nact}곳</b> · 열린 편 <b>${opened} / ${M.seq.length}</b> · 굴진 <b>${fmt(dev)} / ${fmt(M.devTot)}m</b>`;
  time3D(); drawPlan(); drawChart(); drawTable(); drawLegend();
}
const slider = $("time"), playBtn = $("play"); let timer = null;
slider.addEventListener("input", () => { T = +slider.value; applyTime(); });
function stop() { clearInterval(timer); timer = null; playBtn.textContent = "▶ 재생"; }
playBtn.addEventListener("click", () => {
  if (timer) return stop(); if (T >= +slider.max) T = 0; playBtn.textContent = "❚❚ 멈춤";
  timer = setInterval(() => { T = Math.min(+slider.max, T + 1); slider.value = T; applyTime(); if (T >= +slider.max) stop(); }, 70);
});
$("tbody").addEventListener("click", e => { const tr = e.target.closest("tr"); if (!tr) return; T = clamp(+tr.dataset.y * 12 + 11.99, 0, +slider.max); slider.value = Math.round(T); applyTime(); });
$("lvbody").addEventListener("change", e => {                                 // 편별 실수율·굴진장: 비우면 기본값으로 돌아감
  const el = e.target; if (!el.classList.contains("lvin")) return; const no = el.dataset.no, k = el.dataset.k, v = parseFloat(el.value), o = LVSET[no] || (LVSET[no] = {});
  if (el.value.trim() === "" || !isFinite(v)) delete o[k]; else o[k] = k === "rec" ? clamp(v, 10, 100) : clamp(v, 0.5, 8);
  if (!Object.keys(o).length) delete LVSET[no]; recompute();
});
$("lvreset").addEventListener("click", () => { for (const k of Object.keys(LVSET)) delete LVSET[k]; recompute(); });
$("lvbody").addEventListener("click", e => { if (e.target.closest("input")) return; const tr = e.target.closest("tr"); if (!tr || !tr.dataset.z) return; $("lvsel").value = tr.dataset.z; drawPlan(); drawLvTable(); $("plan").scrollIntoView({ block: "center", behavior: "smooth" }); });
$("lvsel").addEventListener("change", () => { drawPlan(); drawLvTable(); });
$("copycsv").addEventListener("click", () => {
  let cum = 0; const rows = [["연도", "목표_t", "생산_t", "광석_t", "작업편", "개설편", "평균작업장", "누계_t", "굴진_m", "현금흐름_원"]];
  for (const Y of M.years) { cum += Y.t; rows.push([Y.cal, Math.round(Y.target), Math.round(Y.t), Math.round(Y.ore), M.seq.filter((L, k) => Y.lv[k] > 0).map(L => L.no).join("/"), Y.opened.join("/"), Y.months ? (Y.faces / Y.months).toFixed(1) : "", Math.round(cum), Math.round(Y.dev), Math.round(Y.cf)]); }
  const csv = rows.map(r => r.join(",")).join("\n"), btn = $("copycsv"), ta = $("csvout");
  const fallback = () => { ta.value = csv; ta.hidden = false; ta.select(); btn.textContent = "아래 내용을 복사하세요"; };
  try { navigator.clipboard.writeText(csv).then(() => { btn.textContent = "복사됨"; setTimeout(() => { btn.textContent = "표 복사 (CSV)"; }, 1500); }, fallback); } catch (e) { fallback(); }
});
$("plan").addEventListener("mousemove", planTip); $("plan").addEventListener("mouseleave", () => { $("tip").hidden = true; });
$("plan").addEventListener("click", e => { if (!PICK || !M) return; USERPORTAL = planXY(e); setPick(false); recompute(); });
$("pick").addEventListener("click", () => setPick(!PICK));
$("autoportal").addEventListener("click", () => { USERPORTAL = null; setPick(false); recompute(); });
for (const id of Object.keys(VIEWS)) $(id).addEventListener("click", () => setView(id));
$("t-terrain").addEventListener("change", e => { if (W3.terrain) W3.terrain.visible = e.target.checked; });
$("t-ore").addEventListener("change", e => { if (W3.ore) W3.ore.visible = e.target.checked; });
$("t-cad").addEventListener("change", e => { if (W3.cadG) W3.cadG.visible = e.target.checked; });
$("t-future").addEventListener("change", time3D);
$("t-sf").addEventListener("change", applyTime);
let pend = null;
form.addEventListener("input", e => { if (e.target.id === "p-az") $("p-azauto").checked = false; showOutputs(); clearTimeout(pend); pend = setTimeout(recompute, 90); });
form.addEventListener("change", () => { clearTimeout(pend); pend = setTimeout(recompute, 30); });
new ResizeObserver(() => { drawPlan(); if (M) drawChart(); }).observe(document.querySelector("main.work"));
function onTheme() { readPal(); theme3D(); if (M) applyTime(); }
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", onTheme);
new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

// ── 14. 자료 불러오기 ──
function renderLayers() {
  const tb = $("layers"); tb.innerHTML = "";
  LAYERS.forEach((l, k) => {
    const tr = document.createElement("tr"), what = [l.nf ? `면 ${fmt(l.nf)}` : "", l.nl ? `선 ${fmt(l.nl)}` : "", l.np ? `점 ${fmt(l.np)}` : ""].filter(Boolean).join(" · ");
    tr.innerHTML = `<td>${l.name.replace(/[<>&]/g, "")}</td><td class="n">${what}<br>Z ${fmt(l.bbox.z0)}~${fmt(l.bbox.z1)}</td><td><select id="role-${k}" aria-label="${l.name.replace(/["<>&]/g, "")} 쓰임">${ROLES.map(([v, t]) => `<option value="${v}"${l.role === v ? " selected" : ""}>${t}</option>`).join("")}</select></td>`;
    tr.querySelector("select").addEventListener("change", e => { l.role = e.target.value; refreshData(); });
    tb.appendChild(tr);
  });
}
function renderFiles() {
  const el = $("files"), names = [...new Set(LAYERS.map(l => l.file))]; el.innerHTML = "";
  if (ISDEMO) { el.textContent = "예시 자료를 보는 중입니다. DXF를 올리면 그 자료로 바뀝니다."; return; }
  for (const n of names) { const s = document.createElement("span"); s.className = "chip"; s.textContent = n + " "; const b = document.createElement("button"); b.type = "button"; b.textContent = "빼기"; b.style.cssText = "padding:0 5px;font-size:11px"; b.setAttribute("aria-label", n + " 빼기"); b.addEventListener("click", () => { LAYERS = LAYERS.filter(l => l.file !== n); if (!LAYERS.length) return loadDemo(); renderLayers(); renderFiles(); refreshData(); }); s.appendChild(b); el.appendChild(s); }
}
function refreshData() {
  const ok = applyData(), msg = $("filemsg"); if (!ok) USERPORTAL = null; RAY = null;
  msg.textContent = ok ? "" : DATAMSG.join(" "); msg.hidden = ok;
  buildStatic(); recompute.did = false; recompute(); setView("v-iso");
}
let ISDEMO = true;
function loadDemo() { const r = parseDXF(demoDXF(), "예시 자료"); for (const l of r.layers) layerStats(l); guessRoles(r.layers); LAYERS = r.layers; ISDEMO = true; SKIPPED = {}; USERPORTAL = null; DATALABEL = "예시 자료"; $("datatag").textContent = "예시 자료"; renderLayers(); renderFiles(); refreshData(); }
// 파일을 올릴 때마다 레이어를 더한다(같은 이름의 파일은 바꿔 넣음). 지형과 광체를 따로 올려도 된다.
$("dxf").addEventListener("change", async e => {
  const files = [...e.target.files], msg = $("filemsg"); if (!files.length) return; msg.hidden = true;
  try {
    let keep = ISDEMO ? [] : LAYERS; const fresh = [];
    for (const f of files) {
      const buf = await f.arrayBuffer(), h6 = new TextDecoder("latin1").decode(buf.slice(0, 6));
      if (/\.dwg$/i.test(f.name) || /^AC10\d\d/.test(h6)) throw new Error(`${f.name}: DWG 파일은 읽을 수 없습니다. 캐드에서 「다른 이름으로 저장 → DXF」(명령 DXFOUT)로 저장해 올려 주세요. 저장 옵션에서 바이너리(Binary)는 끄고, 버전은 2000 이후를 권합니다.`);
      const r = parseDXF(decodeBuf(buf), f.name); if (!r.nEnt) throw new Error(`${f.name}: 읽을 수 있는 도형(3DFACE·POLYLINE·LWPOLYLINE·LINE·POINT)이 없습니다.`);
      keep = keep.filter(l => l.file !== f.name);
      for (const l of r.layers) { layerStats(l); if (!(l.nf || l.nl || l.np)) continue; l.name = f.name.replace(/\.dxf$/i, "") + " / " + l.name; fresh.push(l); }
      if (ISDEMO) SKIPPED = {}; for (const [k, v] of Object.entries(r.skipped)) SKIPPED[k] = (SKIPPED[k] || 0) + v;
    }
    guessRoles(fresh, keep); LAYERS = [...keep, ...fresh]; ISDEMO = false; USERPORTAL = null; DATALABEL = [...new Set(LAYERS.map(l => l.file))].join(", "); $("datatag").textContent = "불러온 자료";
    renderLayers(); renderFiles(); refreshData();
  } catch (err) { msg.textContent = err.message || String(err); msg.hidden = false; }
  e.target.value = "";
});
$("demo").addEventListener("click", loadDemo);

readPal(); showOutputs(); init3D(); loadDemo();
