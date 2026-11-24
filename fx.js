'use strict';
/* ===== Sons, vibração, animações, modo noturno, álbum, compartilhar e atualização ===== */
const inNav = () => !!window.NAV?.on;

/* ---------- Sons (sintetizados, sem arquivos) ---------- */
const SND = { on: (() => { try { return localStorage.getItem('mb-snd') !== '0'; } catch { return true; } })() };
let actx;
function play(notes, type = 'triangle', vol = .16) {
  if (!SND.on || inNav()) return;
  try {
    actx ||= new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume();
    notes.forEach(([f, t, d]) => { const o = actx.createOscillator(), g = actx.createGain(), t0 = actx.currentTime + t; o.type = type; o.frequency.value = f; g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(vol, t0 + .02); g.gain.exponentialRampToValueAtTime(.001, t0 + d); o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + d + .05); });
  } catch { }
}
const vibe = p => { if (SND.on && !inNav()) try { navigator.vibrate?.(p); } catch { } };
const sfx = {
  tap: () => play([[620, 0, .07]]),
  pop: () => { play([[523, 0, .1], [784, .09, .18]]); vibe(30); },
  chirp: () => play([[1400, 0, .06], [1900, .07, .08], [1500, .15, .07], [2100, .22, .1]], 'sine', .1),
  fanfare: () => { play([[523, 0, .14], [659, .13, .14], [784, .26, .14], [1047, .39, .4]], 'square', .1); vibe([80, 40, 80, 40, 160]); },
  horn: () => { play([[330, 0, .35], [330, .4, .5]], 'sawtooth', .07); vibe(120); },
  start: () => { }
};
window.sfx = sfx;
function sndBtn() {
  const box = $('.top-actions'); if (!box) return;
  const b = document.createElement('button'); b.id = 'btnSnd'; b.title = 'Sons'; b.textContent = SND.on ? '🔊' : '🔇';
  b.onclick = () => { SND.on = !SND.on; try { localStorage.setItem('mb-snd', SND.on ? '1' : '0'); } catch { } b.textContent = SND.on ? '🔊' : '🔇'; if (SND.on) sfx.pop(); };
  box.prepend(b);
  const n = document.createElement('button'); n.id = 'btnNight'; n.title = 'Modo noturno';
  const modes = ['auto', 'on', 'off']; let m = 'auto'; try { m = localStorage.getItem('mb-night') || 'auto'; } catch { }
  const apply = () => { const h = new Date().getHours(), on = m === 'on' || (m === 'auto' && (h >= 18 || h < 6)); document.body.classList.toggle('night', on); n.textContent = m === 'auto' ? '🌗' : m === 'on' ? '🌙' : '☀️'; };
  n.onclick = () => { m = modes[(modes.indexOf(m) + 1) % 3]; try { localStorage.setItem('mb-night', m); } catch { } apply(); toast({ auto: 'Mapa noturno: automático (18h–6h)', on: 'Mapa noturno: sempre', off: 'Mapa noturno: desligado' }[m]); };
  box.prepend(n); apply(); setInterval(apply, 5 * 60000);
}
sndBtn();

/* ---------- Sem avisos durante a viagem ---------- */
const _toast = toast; toast = function (...a) { if (inNav()) return; return _toast.apply(this, a); };
const _rc = runCelebrate; runCelebrate = function () { if (inNav()) return; if (celQ.length && !celBusy) sfx.fanfare(); return _rc.apply(this, arguments); };

/* ---------- Sons e festa nos eventos ---------- */
document.addEventListener('click', e => { if (e.target.closest('#tabs button,.btn,.fab')) sfx.tap(); }, true);
mw?.addEventListener('click', () => sfx.chirp());
const _mSave = act.mSave; if (_mSave) act.mSave = function () { sfx.pop(); return _mSave.apply(this, arguments); };
const _ns = noteStateAt; noteStateAt = function (p) { const n = S.ufs.length; _ns(p); if (S.ufs.length > n && !inNav()) flagPop(S.ufs[S.ufs.length - 1]); };
function flagPop(u) {
  const el = document.createElement('div'); el.id = 'flagpop';
  el.innerHTML = `<div class="card"><img src="${flagUrl(u)}" alt="" onerror="this.style.display='none'"><small>Novo estado no mapa!</small><b>${u}</b><span>${S.ufs.length}/27</span></div>`;
  document.body.appendChild(el); sfx.fanfare(); try { mascotParty(); } catch { }
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 2600);
}

/* ---------- Carrinho percorrendo a rota ---------- */
const _showTrip = showTrip;
showTrip = function (id) {
  const r = _showTrip.apply(this, arguments);
  try {
    const t = S.trips.find(x => x.id === id), co = t?.plan?.route?.coords;
    if (co?.length > 1 && ready && !inNav() && !matchMedia('(prefers-reduced-motion: reduce)').matches) carRide(co);
  } catch { }
  return r;
};
let carMk = null;
function carRide(co) {
  carMk?.remove(); const step = Math.max(1, Math.floor(co.length / 240)), pts = co.filter((_, i) => i % step === 0), e = document.createElement('div');
  e.textContent = '🚗'; e.style.cssText = 'font-size:26px;filter:drop-shadow(0 2px 0 #3a2a1a)';
  carMk = new maplibregl.Marker({ element: e }).setLngLat(pts[0]).addTo(map);
  const T = 3500, t0 = performance.now(), mk = carMk;
  const f = now => { const k = Math.min(1, (now - t0) / T), i = Math.min(pts.length - 1, Math.floor(k * (pts.length - 1))); if (carMk !== mk) return; mk.setLngLat(pts[i]); if (k < 1) requestAnimationFrame(f); else setTimeout(() => { mk.remove(); sfx.horn(); }, 400); };
  requestAnimationFrame(f);
}

/* ---------- Mapa mais leve: só desenha marcações visíveis ---------- */
const _rvm = renderVisitMarkers;
renderVisitMarkers = function () {
  if (S.visits.length <= 120) return _rvm();
  vMarkers.forEach(m => m.remove()); vMarkers = [];
  const b = map.getBounds(), dw = (b.getEast() - b.getWest()) * .3, dh = (b.getNorth() - b.getSouth()) * .3;
  S.visits.filter(v => v.lng > b.getWest() - dw && v.lng < b.getEast() + dw && v.lat > b.getSouth() - dh && v.lat < b.getNorth() + dh).slice(0, 150).forEach(v => {
    const e = document.createElement('div'); e.className = 'pin'; e.textContent = CATS[v.cat]?.[0] || '📍'; e.style.animation = 'none';
    e.onclick = ev => { ev.stopPropagation(); showVisit(v.id); };
    vMarkers.push(new maplibregl.Marker({ element: e, anchor: 'bottom' }).setLngLat([v.lng, v.lat]).addTo(map));
  });
};
let rvT; map.on('moveend', () => { if (S.visits.length > 120) { clearTimeout(rvT); rvT = setTimeout(renderVisitMarkers, 300); } });

/* ---------- Pedidos de oração (salva sozinho) ---------- */
let prT; document.addEventListener('input', e => {
  if (e.target.id !== 'prayer') return; const t = S.trips.find(x => x.id === e.target.dataset.t); if (!t) return;
  t.prayer = e.target.value; clearTimeout(prT); prT = setTimeout(save, 700);
});

/* ---------- Agenda de cultos da semana ---------- */
function agendaChurches() {
  const m = new Map(); [...S.churches, ...Object.values(known), ...S.trips.flatMap(t => legsOf(t).flatMap(legChurches))].forEach(c => { if (c?.id && !m.has(c.id) && chTimes(c)) m.set(c.id, c); });
  return [...m.values()];
}
function viewAgenda() {
  const list = agendaChurches(), ref = lastPos || [map.getCenter().lng, map.getCenter().lat], out = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i); const wd = d.getDay();
    const cs = list.filter(c => hasDay(c, wd)).sort((a, b) => hav(ref, [a.lng, a.lat]) - hav(ref, [b.lng, b.lat])).slice(0, 8);
    out.push(`<h3>${i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : wdName[wd]} · ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</h3>${cs.map(c => churchCard(c, ref, false)).join('') || '<p class="muted">Nenhum culto conhecido neste dia.</p>'}`);
  }
  sheet(`<button class="btn sec sm" data-act="tabCcb">‹ Voltar</button><h2>📅 Cultos da semana</h2><p class="muted">Só aparecem igrejas com horário conhecido (as das suas viagens, as que você buscou ou cadastrou), da mais perto para a mais longe.</p>${out.join('')}`);
}

/* ---------- Álbum da viagem ---------- */
async function viewAlbum(tid) {
  const t = S.trips.find(x => x.id === tid); if (!t) return;
  const vs = S.visits.filter(v => v.date >= t.start && v.date <= t.end), ids = new Set(vs.map(v => v.id));
  const ph = (await allPhotos()).filter(p => ids.has(p.vid)), byId = Object.fromEntries(vs.map(v => [v.id, v]));
  sheet(`<button class="btn sec sm" data-act="openTrip" data-id="${t.id}">‹ Voltar</button><h2>📸 Álbum: ${esc(tripTitle(t))}</h2>
  <p class="muted">${ph.length} foto(s) dos lugares que você marcou entre ${fmtDate(pd(t.start))} e ${fmtDate(pd(t.end))}.</p>
  <div class="album">${ph.map(p => `<figure data-act="open" data-id="${p.vid}"><img src="${URL.createObjectURL(p.blob)}" loading="lazy"><figcaption>${esc(byId[p.vid]?.title || '')}</figcaption></figure>`).join('') || '<p class="muted">Nenhuma foto ainda. Marque lugares com foto durante a viagem e elas aparecem aqui.</p>'}</div>`);
}

/* ---------- Compartilhar a viagem como imagem ---------- */
async function tripImage(t) {
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#bfe9ff'); bg.addColorStop(1, '#fff1c9'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const F = '"Lilita One","Fredoka",sans-serif', ink = '#3a2a1a';
  g.fillStyle = ink; g.textAlign = 'center'; g.font = `64px ${F}`; g.fillText('Pé na Estrada', W / 2, 120);
  g.font = `28px ${F}`; g.fillStyle = '#7b2ff7'; g.fillText('MISSÕES CCB', W / 2, 160);
  g.fillStyle = ink; g.font = `78px ${F}`; const title = tripTitle(t); g.fillText(title.length > 26 ? title.slice(0, 25) + '…' : title, W / 2, 290);
  g.font = `40px ${F}`; g.fillText(`${fmtDate(pd(t.start))} → ${fmtDate(pd(t.end))}`, W / 2, 350);
  const co = t.plan?.route?.coords;
  if (co?.length > 1) {
    const xs = co.map(p => p[0]), ys = co.map(p => p[1]), k = Math.cos(((Math.min(...ys) + Math.max(...ys)) / 2) * Math.PI / 180);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = (Math.max(...xs) - x0) * k || .001, h = (Math.max(...ys) - y0) || .001;
    const bx = 110, by = 420, bw = W - 220, bh = 600, s = Math.min(bw / w, bh / h), ox = bx + (bw - w * s) / 2, oy = by + (bh - h * s) / 2;
    const P = p => [ox + (p[0] - x0) * k * s, oy + (Math.max(...ys) - p[1]) * s];
    g.lineCap = g.lineJoin = 'round';
    [[ink, 22], ['#ff5a8a', 12]].forEach(([col, lw]) => { g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); co.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); });
    const dot = (p, col, r) => { const [x, y] = P(p); g.fillStyle = ink; g.beginPath(); g.arc(x, y, r + 5, 0, 7); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
    dot(co[0], '#4cc9f0', 16); legsOf(t).forEach(l => dot([l.lng, l.lat], '#ffd23f', 16));
  }
  const r = t.plan?.route, ufs = [...new Set(legsOf(t).map(l => ufOf([l.lng, l.lat])).filter(Boolean))];
  g.fillStyle = ink; g.font = `54px ${F}`; g.fillText([r ? fmtKm(r.km) : '', r?.sec ? fmtDur(r.sec) : '', `${legsOf(t).length} parada(s)`].filter(Boolean).join('  ·  '), W / 2, 1110);
  if (ufs.length) { g.font = `40px ${F}`; g.fillText(ufs.join(' · '), W / 2, 1170); }
  g.font = `32px ${F}`; g.fillStyle = '#7b2ff7'; g.fillText('Deus abençoe a viagem! 🙏', W / 2, 1290);
  try { const im = new Image(); im.src = 'logo.svg'; await im.decode(); g.drawImage(im, W / 2 - 55, 1190, 110, 110); } catch { }
  return new Promise(res => c.toBlob(res, 'image/png'));
}
async function shareTrip(tid) {
  const t = S.trips.find(x => x.id === tid); if (!t) return; toast('Montando a imagem…');
  const f = new File([await tripImage(t)], 'minha-viagem.png', { type: 'image/png' });
  try { if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: tripTitle(t) }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  download(f.name, f); toast('Imagem baixada ✅');
}

/* ---------- Atualização do app (APK) ---------- */
async function checkUpdate(manual) {
  const cur = window.APP_BUILD | 0;
  if (!cur) { if (manual) toast('Você está usando a versão do site, que já se atualiza sozinha. ✅', 5000); return; }
  try {
    const j = await (await fetch('https://api.github.com/repos/BIELZINinn/pe-na-estrada/releases/latest', { signal: AbortSignal.timeout(8000) })).json();
    const n = +String(j.tag_name || '').split('.').pop(), a = j.assets?.find(x => /\.apk$/.test(x.name));
    if (n > cur && a) { if (manual || confirm(`Há uma versão nova do Pé na Estrada (${j.tag_name}). Baixar agora?`)) window.open(a.browser_download_url, '_blank'); }
    else if (manual) toast('Você já está na versão mais nova ✅');
    localStorage.setItem('mb-updchk', Date.now());
  } catch { if (manual) toast('Não consegui verificar agora.'); }
}
setTimeout(() => { try { if (window.APP_BUILD && Date.now() - (+localStorage.getItem('mb-updchk') || 0) > 864e5 && !inNav()) checkUpdate(false); } catch { } }, 9000);

Object.assign(act, {
  agenda: viewAgenda, tabCcb() { viewCCB(); }, tripAlbum(d) { viewAlbum(d.t); }, tripShare(d) { shareTrip(d.t); }, upd() { checkUpdate(true); }
});
