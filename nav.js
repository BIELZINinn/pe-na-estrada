'use strict';
/* ===== Navegação: "Iniciar viagem" com o GPS preso à estrada ===== */
const NAV = { on: false, t: null, coords: [], cum: [], total: 0, sec: 0, stops: [], idx: 0, off: 0, follow: true, voice: true, head: 0, along: 0, lastRe: 0, lastDraw: 0, rerouting: false, ownTrack: false, spd: 0, lastT: 0, lastP: null, said: {} };
window.NAV = NAV;
const M_DEG = 111320;
const brg = (a, b) => { const k = Math.cos(a[1] * Math.PI / 180); return (Math.atan2((b[0] - a[0]) * k, b[1] - a[1]) * 180 / Math.PI + 360) % 360; };
function projSeg(p, a, b) { // distância (m) de p ao segmento a-b e posição t (0..1)
  const k = Math.cos(p[1] * Math.PI / 180), ax = (a[0] - p[0]) * k, ay = a[1] - p[1], bx = (b[0] - p[0]) * k, by = b[1] - p[1];
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t));
  return { d: Math.hypot(ax + dx * t, ay + dy * t) * M_DEG, t };
}
function snapRoute(p, from) {
  const c = NAV.coords; let best = null;
  const scan = (i0, i1) => { for (let i = i0; i < Math.min(i1, c.length - 1); i++) { const r = projSeg(p, c[i], c[i + 1]); if (!best || r.d < best.d) best = { d: r.d, i, t: r.t }; } };
  scan(Math.max(0, from - 10), from + 600);
  if (!best || best.d > 150) scan(0, c.length - 1);
  return best;
}
function speak(txt) { if (!NAV.voice || !('speechSynthesis' in window)) return; try { const u = new SpeechSynthesisUtterance(txt); u.lang = 'pt-BR'; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { } }

async function navFetch(wps) {
  const r = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${wps.map(x => x.join(',')).join(';')}?overview=full&geometries=geojson&continue_straight=false`)).json();
  if (!r.routes?.[0]) throw 0; return r.routes[0];
}
async function navBuild(wps, rem) { // rem = paradas que ainda faltam, na ordem
  const rt = await navFetch(wps), c = rt.geometry.coordinates, cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + hav(c[i - 1], c[i]));
  NAV.coords = c; NAV.cum = cum; NAV.total = cum[cum.length - 1] || 1; NAV.sec = rt.duration; NAV.idx = 0; NAV.off = 0; NAV.along = 0;
  const scale = NAV.total / Math.max(0.001, rt.distance / 1000); let acc = 0;
  rt.legs.forEach((l, i) => { acc += l.distance / 1000; if (rem[i]) rem[i].along = acc * scale; });
  if (ready) { map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: c } }); }
}

/* ---------- interface ---------- */
function navUI() {
  if ($('#navTop')) return;
  const d = document.createElement('div');
  d.innerHTML = `<div id="navTop" hidden><div class="nt-main"><small>PRÓXIMA PARADA</small><b id="ntName">…</b></div><div class="nt-side"><b id="ntKm">–</b><small id="ntEta"></small></div></div>
  <div id="navOff" hidden></div>
  <div id="navBot" hidden><div class="nb"><b id="nbSpd">0</b><small>km/h</small></div><div class="nb"><b id="nbRem">–</b><small>restam</small></div><div class="nb"><b id="nbArr">–</b><small>chegada</small></div>
  <button id="nbRec" title="Centralizar" hidden>🎯</button><button id="nbVoice" title="Voz">🔊</button><button id="nbEnd" title="Encerrar">⏹</button></div>`;
  [...d.children].forEach(x => document.body.appendChild(x));
  $('#nbEnd').onclick = () => { if (confirm('Encerrar a viagem agora?')) navStop(false); };
  $('#nbVoice').onclick = () => { NAV.voice = !NAV.voice; $('#nbVoice').textContent = NAV.voice ? '🔊' : '🔇'; if (!NAV.voice) try { speechSynthesis.cancel(); } catch { } };
  $('#nbRec').onclick = () => { NAV.follow = true; $('#nbRec').hidden = true; if (lastPos) navCam(lastPos, NAV.head, true); };
  map.on('dragstart', e => { if (NAV.on && e.originalEvent) { NAV.follow = false; $('#nbRec').hidden = false; } });
}
function navCam(pos, head, fast) {
  const z = NAV.spd > 22 ? 14.8 : NAV.spd > 10 ? 15.6 : 16.4;
  map.easeTo({ center: pos, bearing: head, pitch: 55, zoom: z, offset: [0, Math.round(innerHeight * 0.2)], duration: fast ? 600 : 1000, easing: x => x });
}
function navHud() {
  const next = NAV.stops.find(s => !s.arrived), remAll = Math.max(0, NAV.total - NAV.along);
  const remSec = NAV.sec * remAll / NAV.total, eta = new Date(Date.now() + remSec * 1000);
  $('#nbSpd').textContent = Math.round(NAV.spd * 3.6);
  $('#nbRem').textContent = fmtKm(remAll);
  $('#nbArr').textContent = eta.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (next) { const dn = Math.max(0, (next.along ?? NAV.total) - NAV.along); $('#ntName').textContent = next.name; $('#ntKm').textContent = dn < 1 ? Math.round(dn * 1000) + ' m' : fmtKm(dn); $('#ntEta').textContent = fmtDur(NAV.sec * dn / NAV.total); }
}

/* ---------- posição vinda do GPS: gruda na rota ---------- */
function navOnPos(raw, c) {
  const sn = snapRoute(raw, NAV.idx), lim = Math.max(45, Math.min(120, (c.accuracy || 20) * 1.5));
  let pos = raw, head = c.heading >= 0 && c.speed > 1.5 ? c.heading : NAV.head;
  if (sn && sn.d <= lim) {
    const a = NAV.coords[sn.i], b = NAV.coords[sn.i + 1] || a; NAV.idx = sn.i; NAV.off = 0;
    pos = [a[0] + (b[0] - a[0]) * sn.t, a[1] + (b[1] - a[1]) * sn.t, raw[2]];
    NAV.along = NAV.cum[sn.i] + (NAV.cum[sn.i + 1] - NAV.cum[sn.i]) * sn.t;
    let j = sn.i + 1; while (j < NAV.coords.length - 1 && j < sn.i + 12 && hav(pos, NAV.coords[j]) < 0.03) j++;
    head = brg(pos, NAV.coords[Math.min(j, NAV.coords.length - 1)]);
    $('#navOff').hidden = true;
  } else { NAV.off++; if (NAV.off >= 3 && sn && sn.d > 90) navOff(raw); }
  NAV.head = head;
  // velocidade
  const now = Date.now(); if (c.speed >= 0 && c.speed != null) NAV.spd = c.speed; else if (NAV.lastP && now > NAV.lastT) NAV.spd = hav(NAV.lastP, pos) * 1000 / ((now - NAV.lastT) / 1000);
  NAV.lastP = pos; NAV.lastT = now;
  try { meMarker?.setRotation(head); } catch { }
  navHud(); navChecks(pos);
  if (NAV.follow) navCam(pos, head);
  if (now - NAV.lastDraw > 6000 && ready) { NAV.lastDraw = now; const i = Math.min(NAV.idx + 1, NAV.coords.length - 1); map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[pos[0], pos[1]], ...NAV.coords.slice(i)] } }); }
  return pos;
}
function navChecks(pos) {
  const next = NAV.stops.find(s => !s.arrived); if (!next) return;
  const d = hav(pos, [next.lng, next.lat]), dn = (next.along ?? 0) - NAV.along;
  if (d < 0.15 || (dn < 0.05 && d < 0.4)) {
    next.arrived = true; toast(`📍 Você chegou: ${next.name}`, 5000); speak(`Você chegou em ${next.name}`);
    if (NAV.stops.every(s => s.arrived)) setTimeout(() => navStop(true), 2500);
  } else if (dn < 1 && !NAV.said[next.name + 'n']) { NAV.said[next.name + 'n'] = 1; speak(`Em um quilômetro, chegada em ${next.name}`); }
}
async function navOff(pos) {
  const now = Date.now(), el = $('#navOff'); el.hidden = false; el.textContent = '⚠️ Fora da rota — recalculando…';
  if (NAV.rerouting || now - NAV.lastRe < 20000) return;
  NAV.rerouting = true; NAV.lastRe = now;
  try {
    const rem = NAV.stops.filter(s => !s.arrived);
    await navBuild([[pos[0], pos[1]], ...rem.map(s => [s.lng, s.lat])], rem); speak('Rota recalculada'); el.hidden = true;
  } catch { el.textContent = '⚠️ Fora da rota — sem internet para recalcular'; }
  NAV.rerouting = false;
}

/* ---------- ponto da estrada mais próximo (fora do modo viagem) ---------- */
let nrLast = 0;
async function snapPoint(pt, c) {
  if (NAV.on) return navOnPos(pt, c);
  if (!(c.speed >= 2.5)) return pt; // só quando está em movimento
  const now = Date.now(); if (now - nrLast < 3000) return pt; nrLast = now;
  try {
    const ac = new AbortController(); setTimeout(() => ac.abort(), 3000);
    const r = await (await fetch(`https://router.project-osrm.org/nearest/v1/driving/${pt[0]},${pt[1]}?number=1`, { signal: ac.signal })).json(), w = r.waypoints?.[0];
    if (w && w.distance <= 35) return [+w.location[0].toFixed(5), +w.location[1].toFixed(5), pt[2]];
  } catch { }
  return pt;
}

/* ---------- iniciar / encerrar ---------- */
async function navStart(tid) {
  if (NAV.on) return;
  const t = S.trips.find(x => x.id === tid); if (!t) return;
  if (!t.plan?.route || t.plan.route.straight) return toast('Esta viagem ainda não tem rota por estrada. Refaça o roteiro com internet e informe a cidade de saída.', 6000);
  if (!navigator.geolocation) return toast('Sem GPS neste aparelho.');
  navUI(); toast('Procurando seu GPS…', 8000);
  let me = null;
  try { me = await new Promise((ok, no) => navigator.geolocation.getCurrentPosition(p => ok([p.coords.longitude, p.coords.latitude]), no, { enableHighAccuracy: true, timeout: 12000 })); } catch { }
  let origin = t.from ? [t.from.lng, t.from.lat] : null;
  if (me && (!origin || hav(me, origin) > 3)) { if (!origin || confirm(`Você está a ${fmtKm(hav(me, origin))} da cidade de saída.\n\nTraçar a rota a partir da sua posição atual?`)) origin = me; }
  if (!origin) return toast('Não consegui sua posição (permita o GPS) e a viagem não tem cidade de saída.', 6000);
  const stops = legsOf(t).map(l => ({ name: stopName(l.name), lng: l.lng, lat: l.lat, arrived: false }));
  toast('Traçando a rota…');
  try { await navBuild([origin, ...stops.map(s => [s.lng, s.lat])], stops); } catch { return toast('Não consegui traçar a rota agora. Verifique a internet.', 6000); }
  Object.assign(NAV, { on: true, t: tid, stops, follow: true, said: {}, lastDraw: 0, lastRe: 0, spd: 0, lastP: null, head: brg(origin, NAV.coords[Math.min(5, NAV.coords.length - 1)]) });
  document.body.classList.add('navmode'); closeSheet();
  ['#navTop', '#navBot'].forEach(s => $(s).hidden = false); $('#nbRec').hidden = true; $('#nbVoice').textContent = NAV.voice ? '🔊' : '🔇';
  setMe(origin[0], origin[1]); const el = meMarker.getElement(); el.classList.add('navme'); el.innerHTML = '<div class="navarrow"></div>'; meMarker.setRotationAlignment('map'); meMarker.setPitchAlignment('map');
  lastPos = origin; navHud(); navCam(origin, NAV.head, true);
  if (!cur) { NAV.ownTrack = true; await startTrack(); } else NAV.ownTrack = false;
  speak(`Viagem iniciada. Próxima parada: ${stops[0].name}`);
  toast('🚗 Viagem iniciada! Boa estrada!', 4000);
}
function navStop(done) {
  if (!NAV.on) return;
  NAV.on = false; document.body.classList.remove('navmode');
  ['#navTop', '#navBot', '#navOff'].forEach(s => { const e = $(s); if (e) e.hidden = true; });
  try { const e = meMarker.getElement(); e.classList.remove('navme'); e.innerHTML = ''; meMarker.setRotation(0); } catch { }
  try { speechSynthesis.cancel(); } catch { }
  if (NAV.ownTrack && cur) stopTrack(); NAV.ownTrack = false;
  const tid = NAV.t; map.easeTo({ pitch: 0, bearing: 0, duration: 800 });
  if (done) { speak('Viagem concluída. Deus abençoe!'); try { mascotParty?.(); } catch { } toast('🎉 Viagem concluída! Deus abençoe!', 6000); }
  showTrip(tid);
}
document.addEventListener('visibilitychange', async () => { if (document.visibilityState === 'visible' && NAV.on) { try { wake = await navigator.wakeLock?.request('screen'); } catch { } } });
Object.assign(act, { navStart(d) { navStart(d.t); } });
