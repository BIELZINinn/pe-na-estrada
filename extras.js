'use strict';
/* ===== Extras: lembretes de culto, pontos de apoio, progresso, conquistas, linha do tempo, mascote ===== */
S.badges ||= {}; S.remind ||= { lead: 60, trips: {}, done: {} };
S.remind.trips ||= {}; S.remind.done ||= {};
const pad2 = n => String(n).padStart(2, '0');
const isoToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

/* ---------- Horários de culto: texto -> [{wd,h,m}] ---------- */
const DAY3 = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'], DAYEN = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
function dayWord(w) {
  const n = w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (n.length === 2) return DAYEN.indexOf(n);
  return /^(dom|seg|ter|qua|qui|sex|sab)(ingo|unda|ca|rta|nta|ta|ado)?$/.test(n) ? DAY3.indexOf(n.slice(0, 3)) : -1;
}
function parseTimes(str) {
  if (!str) return [];
  const s = String(str).replace(/-?\s*feira/gi, '').replace(/([a-zà-ú]{2,9})(?:\s*[-–—]\s*|\s+(?:a|à|até)\s+)(?=[a-zà-ú]{2,})/gi, (m, a) => dayWord(a) >= 0 ? a + '~' : m);
  const groups = []; let grp = null, lastTime = false, from = -1;
  for (const m of s.matchAll(/(\d{1,2})[:h](\d{2})|([a-zà-ú]+)(~)?/gi)) {
    if (m[1] != null) {
      const h = +m[1], mi = +m[2]; if (!grp || h > 23 || mi > 59) continue;
      grp.times.push([h, mi]); lastTime = true; continue;
    }
    const d = dayWord(m[3]); if (d < 0) continue;
    if (!grp || lastTime) { grp = { days: [], times: [] }; groups.push(grp); }
    lastTime = false;
    if (from >= 0) { for (let k = from, n = 0; n < 8; k = (k + 1) % 7, n++) { grp.days.push(k); if (k === d) break; } from = -1; }
    else grp.days.push(d);
    if (m[4]) { from = d; grp.days.pop(); }
  }
  return groups.flatMap(g => g.days.flatMap(d => g.times.map(t => ({ wd: d, h: t[0], m: t[1] }))));
}

/* ---------- Cultos da viagem (por dia, por parada) ---------- */
function legIndexAt(legs, s) { let k = legs.findIndex(l => s >= l.start && s <= l.end); if (k < 0) { legs.forEach((l, i) => { if (l.end < s) k = i; }); if (k < 0) k = 0; } return k; }
function tripCultos(t) {
  const legs = legsOf(t), out = [], chs = legs.map(legChurches);
  for (const d of daysOf(t)) {
    const is = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`, wd = d.getDay(), k = legIndexAt(legs, is), l = legs[k], dp = [l.lng, l.lat];
    chs[k].filter(c => hasDay(c, wd)).sort((a, b) => hav(dp, [a.lng, a.lat]) - hav(dp, [b.lng, b.lat])).slice(0, 2).forEach(c => {
      parseTimes(chTimes(c)).filter(x => x.wd === wd).forEach(x => out.push({ date: is, h: x.h, m: x.m, church: c, stop: stopName(l.name), key: `${t.id}|${c.id}|${is}|${pad2(x.h)}:${pad2(x.m)}` }));
    });
  }
  return out.sort((a, b) => (a.date + pad2(a.h) + pad2(a.m)).localeCompare(b.date + pad2(b.h) + pad2(b.m)));
}
const cultoTime = e => new Date(`${e.date}T${pad2(e.h)}:${pad2(e.m)}:00`).getTime();

/* ---------- Notificações ---------- */
async function notify(title, body, tag) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg?.showNotification) { await reg.showNotification(title, { body, tag, icon: 'icon.svg', badge: 'icon.svg', vibrate: [120, 60, 120] }); return; }
      new Notification(title, { body, tag, icon: 'icon.svg' }); return;
    }
  } catch { }
  toast(`🔔 ${title} — ${body}`, 9000);
}
function tickReminders() {
  const R = S.remind, now = Date.now(); let dirty = false;
  for (const t of S.trips) {
    if (!R.trips[t.id]) continue;
    for (const e of tripCultos(t)) {
      const at = cultoTime(e);
      if (now >= at - R.lead * 60000 && now < at + 45 * 60000 && !R.done[e.key]) {
        R.done[e.key] = 1; dirty = true;
        const mins = Math.round((at - now) / 60000);
        notify(`⛪ Culto às ${pad2(e.h)}:${pad2(e.m)} — ${e.church.name}`, mins > 0 ? `Começa em ${mins >= 60 ? Math.round(mins / 60 * 10) / 10 + ' h' : mins + ' min'} · ${e.stop}` : `Está começando agora · ${e.stop}`, e.key);
      }
    }
  }
  if (dirty) { try { localStorage.setItem('mb', JSON.stringify(S)); } catch { } }
}
setInterval(tickReminders, 60000); setTimeout(tickReminders, 4000);

function icsText(t) {
  const R = S.remind, esc2 = s => String(s || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n'), stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pe na Estrada//PT', 'CALSCALE:GREGORIAN'];
  for (const e of tripCultos(t)) {
    const st = cultoTime(e), en = new Date(st + 2 * 3600000), f = d => `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}T${pad2(d.getHours())}${pad2(d.getMinutes())}00`;
    L.push('BEGIN:VEVENT', `UID:${e.key.replace(/[^\w]/g, '')}@penaestrada`, `DTSTAMP:${stamp}`, `DTSTART:${f(new Date(st))}`, `DTEND:${f(en)}`,
      `SUMMARY:${esc2('⛪ Culto — ' + e.church.name)}`, `LOCATION:${esc2(e.church.addr || e.stop)}`, `DESCRIPTION:${esc2('Pé na Estrada — ' + e.stop)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc2('Culto em ' + R.lead + ' min')}`, `TRIGGER:-PT${R.lead}M`, 'END:VALARM', 'END:VEVENT');
  }
  L.push('END:VCALENDAR'); return L.join('\r\n');
}
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }

function viewRemind(tid) {
  const t = S.trips.find(x => x.id === tid); if (!t) return;
  const R = S.remind, on = !!R.trips[tid], now = Date.now(), ev = tripCultos(t).filter(e => cultoTime(e) > now - 3600000).slice(0, 24);
  const perm = !('Notification' in window) ? 'sem suporte' : Notification.permission === 'granted' ? 'permitidas ✅' : Notification.permission === 'denied' ? 'bloqueadas 🚫 (libere nas configurações do navegador)' : 'ainda não permitidas';
  sheet(`<button class="btn sec sm" data-act="backTrip" data-t="${tid}">‹ Voltar ao roteiro</button>
  <h2>🔔 Lembretes de culto</h2>
  <p class="muted">${esc(tripTitle(t))} — o app avisa antes de cada culto das casas de oração que têm horário conhecido.</p>
  <div class="item ${on ? 't-ok' : 't-visit'}"><div class="ic">${on ? '✅' : '🔕'}</div><div class="bd"><b>${on ? 'Lembretes ligados' : 'Lembretes desligados'}</b>
  <div class="row" style="margin-top:6px"><button class="btn sm" data-act="remindToggle" data-t="${tid}">${on ? 'Desligar' : 'Ligar'}</button></div></div></div>
  <label>Avisar com antecedência de</label>
  <select id="rmLead">${[30, 60, 90, 120, 180].map(m => `<option value="${m}" ${R.lead === m ? 'selected' : ''}>${m >= 60 ? m / 60 + ' h' : m + ' min'}</option>`).join('')}</select>
  <p class="muted">Notificações: <b>${perm}</b></p>
  <div class="row"><button class="btn sec" data-act="remindPerm" data-t="${tid}">🔔 Permitir avisos</button><button class="btn sec" data-act="remindIcs" data-t="${tid}">📅 Para o calendário</button></div>
  <h3>Próximos cultos</h3>
  ${ev.map(e => `<div class="item t-ccb"><div class="ic">⛪</div><div class="bd"><b>${esc(e.church.name)}</b><span class="muted">${wdName[new Date(e.date + 'T12:00:00').getDay()]}, ${fmtDate(pd(e.date))} às <b>${pad2(e.h)}:${pad2(e.m)}</b> · ${esc(e.stop)}</span></div></div>`).join('') || '<p class="muted">Nenhum culto com dia e horário definidos nesta viagem. Importe os cultos do Relatório ou use ✏️ Horário numa casa de oração (ex.: "Qua 19:30, Dom 18:30").</p>'}
  <p class="muted">⚠️ Os avisos do app só chegam com o app aberto (ou em segundo plano, se o celular deixar). Para garantir o alerta com o app fechado, use <b>Para o calendário</b>: o calendário do celular avisa por conta própria.</p>`);
}
document.addEventListener('change', e => { if (e.target.id === 'rmLead') { S.remind.lead = +e.target.value; save(); } });
Object.assign(act, {
  remind(d) { viewRemind(d.t); },
  remindToggle(d) { S.remind.trips[d.t] = !S.remind.trips[d.t]; if (!S.remind.trips[d.t]) delete S.remind.trips[d.t]; save(); if (S.remind.trips[d.t] && 'Notification' in window && Notification.permission === 'default') act.remindPerm(d); else viewRemind(d.t); },
  async remindPerm(d) { try { await Notification.requestPermission(); } catch { } viewRemind(d.t); },
  remindIcs(d) {
    const t = S.trips.find(x => x.id === d.t); if (!t) return;
    if (!tripCultos(t).length) return toast('Ainda não há cultos com dia e horário nesta viagem.');
    download(`cultos-${stopName(legsOf(t)[0].name).toLowerCase().replace(/\W+/g, '-')}.ics`, new Blob([icsText(t)], { type: 'text/calendar' })); toast('Abra o arquivo para adicionar ao calendário 📅');
  }
});

/* ---------- Pontos de apoio na rota ---------- */
function densify(coords, step = 4) {
  const out = [{ p: coords[0], km: 0 }]; let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1], b = coords[i], d = hav(a, b), n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) out.push({ p: [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n], km: acc + d * k / n });
    acc += d;
  }
  return out;
}
const SUP = { fuel: ['⛽', 'Posto'], food: ['🍽️', 'Comer'], stay: ['🛏️', 'Dormir'] };
async function findSupport(coords) {
  const dense = densify(coords, 4), total = dense.at(-1).km, chunk = 250, nCh = Math.min(4, Math.ceil(total / chunk)), res = [], seen = new Set();
  const per = Math.ceil(dense.length / nCh);
  for (let c = 0; c < nCh; c++) {
    const seg = dense.slice(c * per, (c + 1) * per + 1).filter((_, i) => i % 2 === 0 || false);
    if (seg.length < 2) continue;
    const line = seg.map(x => `${x.p[1].toFixed(4)},${x.p[0].toFixed(4)}`).join(','), a = `(around:2500,${line})`;
    const q = `[out:json][timeout:40];(nwr["amenity"="fuel"]["name"]${a};nwr["amenity"~"^(restaurant|fast_food)$"]["name"]${a};nwr["tourism"~"^(hotel|motel|guest_house|hostel)$"]["name"]${a};);out center tags 260;`;
    let els = []; try { els = await overpass(q); } catch { if (!res.length && c === nCh - 1) throw new Error('overpass'); }
    for (const e of els) {
      const ct = e.center || e, t = e.tags || {}, id = `s-${e.type}-${e.id}`; if (!ct.lat || seen.has(id)) continue; seen.add(id);
      const cat = t.amenity === 'fuel' ? 'fuel' : t.tourism ? 'stay' : 'food', pt = [ct.lon, ct.lat];
      let best = 1e9, at = 0; for (const x of dense) { const d = Math.abs(x.p[0] - pt[0]) + Math.abs(x.p[1] - pt[1]); if (d < best) { best = d; at = x; } }
      res.push({ id, cat, name: t.name, lat: ct.lat, lng: ct.lon, at: Math.round(at.km), off: hav(at.p, pt), hours: t.opening_hours || '', phone: t.phone || t['contact:phone'] || '', brand: t.brand || '', cuisine: t.cuisine || '', web: t.website || '' });
    }
  }
  return res.filter(x => x.off < 3.5).sort((a, b) => a.at - b.at);
}
function supportCard(x) {
  const [em, kn] = SUP[x.cat], h = x.hours ? hoursPt(x.hours) : '';
  return `<div class="item t-${x.cat === 'fuel' ? 'poi' : x.cat === 'food' ? 'food' : 'stay'}"><div class="ic">${em}</div><div class="bd"><b>${esc(x.name)}</b>
  <span class="muted">${kn} · km ${x.at} da rota · ~${fmtKm(x.off)} da estrada${x.cuisine ? ' · ' + esc(x.cuisine.replace(/;/g, ', ')) : ''}</span>
  <div>${/24\/7/.test(x.hours) ? '<span class="chip ok">🕒 24h</span>' : h ? `<span class="chip">🕒 ${esc(h.slice(0, 60))}</span>` : '<span class="chip">horário não informado</span>'}</div>
  <div class="row" style="margin-top:6px"><a class="btn sm sec" style="text-align:center;text-decoration:none;color:inherit" target="_blank" href="https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lng}">🚗 Rota</a>
  ${x.phone ? `<a class="btn sm sec" style="text-align:center;text-decoration:none;color:inherit" href="tel:${esc(x.phone)}">📞</a>` : ''}
  <button class="btn sm sec" data-act="supGo" data-lat="${x.lat}" data-lng="${x.lng}">Ver</button></div></div></div>`;
}
let supMarkers = [];
function renderSupport(tid, cat = 'all') {
  const t = S.trips.find(x => x.id === tid), list = t.plan.support || [];
  const shown = list.filter(x => cat === 'all' || x.cat === cat).slice(0, 120);
  supMarkers.forEach(m => m.remove()); supMarkers = [];
  shown.forEach(x => { const e = document.createElement('div'); e.className = 'pin'; e.textContent = SUP[x.cat][0]; e.onclick = ev => { ev.stopPropagation(); new maplibregl.Popup({ offset: 24 }).setLngLat([x.lng, x.lat]).setHTML(`<b>${esc(x.name)}</b><br>km ${x.at}`).addTo(map); }; supMarkers.push(new maplibregl.Marker({ element: e, anchor: 'bottom' }).setLngLat([x.lng, x.lat]).addTo(map)); });
  const n = k => list.filter(x => x.cat === k).length;
  sheet(`<button class="btn sec sm" data-act="backTrip" data-t="${tid}">‹ Voltar ao roteiro</button>
  <h2>⛽ Pontos de apoio</h2><p class="muted">${esc(tripTitle(t))} · ao longo da rota (km contados a partir da saída).</p>
  <div>${[['all', '📍 Todos', list.length], ['fuel', '⛽ Postos', n('fuel')], ['food', '🍽️ Comer', n('food')], ['stay', '🛏️ Dormir', n('stay')]].map(([k, l, c]) => `<button class="chip ${cat === k ? 'ok' : ''}" style="cursor:pointer;font:inherit;font-size:13px" data-act="supF" data-t="${tid}" data-c="${k}">${l} (${c})</button>`).join('')}</div>
  ${shown.map(supportCard).join('') || '<p class="muted">Nada encontrado nessa categoria (o mapa aberto pode estar incompleto).</p>'}
  <button class="btn sec" data-act="support" data-t="${tid}" data-force="1">🔄 Buscar de novo</button>`);
}
Object.assign(act, {
  async support(d) {
    const t = S.trips.find(x => x.id === d.t); if (!t?.plan.route) return toast('Esta viagem não tem rota (informe a cidade de saída).');
    if (!t.plan.support || d.force) {
      sheet('<h2>⛽ Procurando pontos de apoio…</h2><p class="muted">Postos, restaurantes e hotéis ao longo da estrada. Pode levar até 1 minuto.</p>');
      try { t.plan.support = await findSupport(t.plan.route.coords); save(); } catch { toast('Busca indisponível agora. Tente de novo em instantes.', 4500); return showTrip(t.id); }
    }
    renderSupport(t.id);
  },
  supF(d) { renderSupport(d.t, d.c); },
  supGo(d) { map.flyTo({ center: [+d.lng, +d.lat], zoom: 15, duration: 1500 }); if (matchMedia('(max-width:800px)').matches) closeSheet(); }
});

/* ---------- Progresso do Brasil (bandeiras dos estados) ---------- */
const FLAGN = { AC: 'Bandeira do Acre', AL: 'Bandeira de Alagoas', AP: 'Bandeira do Amapá', AM: 'Bandeira do Amazonas', BA: 'Bandeira da Bahia', CE: 'Bandeira do Ceará', DF: 'Bandeira do Distrito Federal (Brasil)', ES: 'Bandeira do Espírito Santo', GO: 'Bandeira de Goiás', MA: 'Bandeira do Maranhão', MT: 'Bandeira de Mato Grosso', MS: 'Bandeira de Mato Grosso do Sul', MG: 'Bandeira de Minas Gerais', PA: 'Bandeira do Pará', PB: 'Bandeira da Paraíba', PR: 'Bandeira do Paraná', PE: 'Bandeira de Pernambuco', PI: 'Bandeira do Piauí', RJ: 'Bandeira do estado do Rio de Janeiro', RN: 'Bandeira do Rio Grande do Norte', RS: 'Bandeira do Rio Grande do Sul', RO: 'Bandeira de Rondônia', RR: 'Bandeira de Roraima', SC: 'Bandeira de Santa Catarina', SP: 'Bandeira do estado de São Paulo', SE: 'Bandeira de Sergipe', TO: 'Bandeira do Tocantins' };
const flagUrl = u => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(FLAGN[u].replace(/ /g, '_') + '.svg')}?width=64`;
function progressHtml() {
  const n = S.ufs.length, pct = Math.round(n / 27 * 100);
  return `<h3>🇧🇷 Meu Brasil: ${pct}%</h3>
  <div class="pbar"><i style="width:${Math.max(pct, 4)}%"></i><span>${n} de 27 estados</span></div>
  <div class="flags">${Object.values(UF).sort().map(u => `<div class="fl ${S.ufs.includes(u) ? 'on' : ''}" title="${u}"><img src="${flagUrl(u)}" alt="" loading="lazy" onerror="this.style.display='none'"><b>${u}</b></div>`).join('')}</div>`;
}

/* ---------- Conquistas ---------- */
function kmTotalAll() {
  const today = isoToday(); let km = totalKm();
  S.trips.forEach(t => { if (t.end < today && t.plan?.route && !S.tracks.some(k => (k.start || '').slice(0, 10) >= t.start && (k.start || '').slice(0, 10) <= t.end)) km += t.plan.route.km; });
  return km;
}
const BADGES = [
  ['first', '🐣', 'Primeiro passo', 'Marque um lugar ou planeje uma viagem', c => c.visits + c.trips >= 1],
  ['uf1', '🗺️', 'Primeiro estado', 'Preencha seu primeiro estado', c => c.ufs >= 1],
  ['uf5', '🧭', '5 estados', 'Preencha 5 estados no mapa', c => c.ufs >= 5],
  ['uf10', '🌎', '10 estados', 'Preencha 10 estados no mapa', c => c.ufs >= 10],
  ['uf20', '🏔️', '20 estados', 'Preencha 20 estados no mapa', c => c.ufs >= 20],
  ['uf27', '🇧🇷', 'Brasil completo', 'Todos os 27 estados!', c => c.ufs >= 27],
  ['km100', '🛣️', '100 km', 'Percorra 100 km', c => c.km >= 100],
  ['km1000', '🚗', '1.000 km', 'Percorra 1.000 km', c => c.km >= 1000],
  ['km5000', '🚚', '5.000 km', 'Percorra 5.000 km', c => c.km >= 5000],
  ['km10000', '🚀', '10.000 km', 'Percorra 10.000 km', c => c.km >= 10000],
  ['ccb1', '⛪', 'Primeira casa de oração', 'Marque uma visita em uma casa de oração', c => c.ccb >= 1],
  ['ccb10', '🙏', '10 casas de oração', 'Visite 10 casas de oração', c => c.ccb >= 10],
  ['ccb25', '🕊️', '25 casas de oração', 'Visite 25 casas de oração', c => c.ccb >= 25],
  ['ph10', '📸', '10 fotos', 'Guarde 10 fotos', c => c.photos >= 10],
  ['ph100', '🖼️', '100 fotos', 'Guarde 100 fotos', c => c.photos >= 100],
  ['mem10', '📝', '10 memórias', 'Marque 10 lugares', c => c.visits >= 10],
  ['trip1', '🧳', 'Primeira viagem', 'Planeje sua primeira viagem', c => c.trips >= 1],
  ['trip5', '🎒', '5 viagens', 'Planeje 5 viagens', c => c.trips >= 5],
  ['multi', '🔗', 'Missão em série', 'Planeje uma viagem com 3 ou mais paradas', c => c.maxStops >= 3]
];
async function badgeCtx() {
  return { km: kmTotalAll(), ufs: S.ufs.length, visits: S.visits.length, ccb: S.visits.filter(v => v.cat === 'ccb').length, photos: await countPhotos().catch(() => 0), trips: S.trips.length, maxStops: Math.max(0, ...S.trips.map(t => legsOf(t).length)) };
}
let celQ = [], celBusy = false;
async function checkBadges() {
  const c = await badgeCtx(), fresh = [];
  const init = !S.badgesInit; S.badgesInit = 1;
  BADGES.forEach(b => { if (!S.badges[b[0]] && b[4](c)) { S.badges[b[0]] = isoToday(); fresh.push(b); } });
  if (!fresh.length && !init) return;
  try { localStorage.setItem('mb', JSON.stringify(S)); } catch { }
  if (init) { if (fresh.length) toast(`🏆 Você já tem ${fresh.length} conquista(s)! Veja em Mapa → Conquistas.`, 5000); return; }
  celQ.push(...fresh); runCelebrate();
}
function runCelebrate() {
  if (celBusy || !celQ.length) return; celBusy = true;
  const b = celQ.shift(), el = document.createElement('div'); el.id = 'celebrate';
  const conf = Array.from({ length: 26 }, (_, i) => `<i style="--x:${Math.random() * 100}vw;--d:${(Math.random() * .8).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg">${['🎉', '⭐', '🎊', '✨', '💛', '🧡'][i % 6]}</i>`).join('');
  el.innerHTML = `${conf}<div class="card"><img src="logo.svg" alt=""><small>Nova conquista!</small><div class="big">${b[1]}</div><b>${esc(b[2])}</b><span>${esc(b[3])}</span></div>`;
  document.body.appendChild(el); mascotParty();
  const end = () => { el.classList.add('out'); setTimeout(() => { el.remove(); celBusy = false; runCelebrate(); }, 350); };
  el.onclick = end; setTimeout(end, 3800);
}
function viewBadges() {
  const got = BADGES.filter(b => S.badges[b[0]]).length;
  badgeCtx().then(c => sheet(`<button class="btn sec sm" data-act="backMap">‹ Voltar</button>
  <h2>🏆 Conquistas</h2><p class="muted">${got} de ${BADGES.length} · ${fmtKm(c.km)} de estrada (GPS + viagens já concluídas)</p>
  <div class="badges">${BADGES.map(b => `<div class="bdg ${S.badges[b[0]] ? 'on' : ''}"><div class="e">${S.badges[b[0]] ? b[1] : '🔒'}</div><b>${esc(b[2])}</b><small>${S.badges[b[0]] ? fmtDate(pd(S.badges[b[0]])) : esc(b[3])}</small></div>`).join('')}</div>`));
}
Object.assign(act, { badges: viewBadges, backMap() { viewMap(); } });

/* ---------- Linha do tempo ---------- */
let tlY = 'all', tlU = 'all';
function tlEntries() {
  const E = [];
  S.visits.forEach(v => E.push({ date: v.date, em: CATS[v.cat]?.[0] || '📍', title: v.title, sub: CATS[v.cat]?.[1] || '', ufs: [ufOf([v.lng, v.lat])].filter(Boolean), a: `data-act="open" data-id="${v.id}"` }));
  S.trips.forEach(t => E.push({ date: t.start, em: '🧳', title: tripTitle(t), sub: `${fmtDate(pd(t.start))} → ${fmtDate(pd(t.end))}${t.plan?.route ? ' · ' + fmtKm(t.plan.route.km) : ''}`, ufs: [...new Set(legsOf(t).map(l => ufOf([l.lng, l.lat])).filter(Boolean))], a: `data-act="openTrip" data-id="${t.id}"` }));
  S.tracks.filter(k => k.pts.length > 1).forEach(k => E.push({ date: (k.start || '').slice(0, 10), em: '🛣️', title: `Trajeto de ${fmtKm(trackKm(k))}`, sub: 'gravado pelo GPS', ufs: [ufOf(k.pts[0])].filter(Boolean), a: `data-act="goTo" data-lat="${k.pts[0][1]}" data-lng="${k.pts[0][0]}"` }));
  BADGES.forEach(b => { if (S.badges[b[0]]) E.push({ date: S.badges[b[0]], em: b[1], title: 'Conquista: ' + b[2], sub: b[3], ufs: [], a: '' , badge: 1 }); });
  return E.filter(e => e.date).sort((a, b) => b.date.localeCompare(a.date));
}
function renderTimeline() {
  const all = tlEntries(), years = [...new Set(all.map(e => e.date.slice(0, 4)))], ufs = [...new Set(all.flatMap(e => e.ufs))].sort();
  const list = all.filter(e => (tlY === 'all' || e.date.startsWith(tlY)) && (tlU === 'all' || e.ufs.includes(tlU)));
  const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  let last = '', html = '';
  list.forEach(e => { const k = e.date.slice(0, 7); if (k !== last) { last = k; html += `<h3>${MES[+k.slice(5) - 1]} de ${k.slice(0, 4)}</h3>`; } html += `<div class="item" ${e.a}><div class="ic">${e.em}</div><div class="bd"><b>${esc(e.title)}</b><span class="muted">${fmtDate(pd(e.date))}${e.ufs.length ? ' · ' + e.ufs.join(', ') : ''}${e.sub ? ' · ' + esc(e.sub) : ''}</span></div></div>`; });
  $('#tlBody').innerHTML = html || '<p class="muted">Nada por aqui com esses filtros.</p>';
  $('#tlY').innerHTML = '<option value="all">Todos os anos</option>' + years.map(y => `<option ${y === tlY ? 'selected' : ''}>${y}</option>`).join('');
  $('#tlU').innerHTML = '<option value="all">Todos os estados</option>' + ufs.map(u => `<option ${u === tlU ? 'selected' : ''}>${u}</option>`).join('');
  [...$('#tlBody').querySelectorAll('.item')].forEach((c, i) => { c.classList.add('t-' + (ICT[c.querySelector('.ic').textContent.trim()] || 'visit')); c.style.setProperty('--i', Math.min(i, 12)); });
}
function viewTimeline() {
  tlY = 'all'; tlU = 'all';
  sheet(`<button class="btn sec sm" data-act="backMap">‹ Voltar</button><h2>📜 Linha do tempo</h2>
  <div class="row"><select id="tlY"></select><select id="tlU"></select></div><div id="tlBody"></div>`);
  renderTimeline();
}
document.addEventListener('change', e => { if (e.target.id === 'tlY') { tlY = e.target.value; renderTimeline(); } if (e.target.id === 'tlU') { tlU = e.target.value; renderTimeline(); } });
Object.assign(act, { timeline: viewTimeline });
ICT['🛣️'] = 'visit';

/* ---------- Mascote que reage ao clima e ao lugar ---------- */
const mw = document.createElement('span'); mw.className = 'mwrap'; mw.title = 'Toque no papagaio!';
const mimg = document.querySelector('.brand .mascot'); mimg.replaceWith(mw); mw.appendChild(mimg);
const macc = document.createElement('i'); macc.className = 'acc'; mw.appendChild(macc);
let mood = { say: 'Bora pra estrada! 🚗' };
function mascotParty() { mw.classList.add('party'); setTimeout(() => mw.classList.remove('party'), 3500); }
async function mascotPlace() {
  if (lastPos) return { p: lastPos, name: 'aqui' };
  try { const st = await navigator.permissions?.query({ name: 'geolocation' }); if (st?.state === 'granted') { const p = await currentPoint(); if (p) return { p, name: 'aqui' }; } } catch { }
  const today = isoToday(), tr = S.trips.find(t => t.start <= today && t.end >= today);
  if (tr) { const l = legsOf(tr)[legIndexAt(legsOf(tr), today)]; return { p: [l.lng, l.lat], name: stopName(l.name) }; }
  const nx = [...S.trips].filter(t => t.end >= today).sort((a, b) => a.start.localeCompare(b.start))[0];
  if (nx) { const l = legsOf(nx)[0]; return { p: [l.lng, l.lat], name: stopName(l.name) }; }
  const v = [...S.visits].sort((a, b) => b.date.localeCompare(a.date))[0];
  return v ? { p: [v.lng, v.lat], name: v.title } : { p: BR.center, name: 'o Brasil' };
}
function culturalLine() {
  const today = isoToday(), now = Date.now();
  for (const t of S.trips) { if (t.start > today || t.end < today) continue; const e = tripCultos(t).filter(x => x.date === today && cultoTime(x) > now - 3600000)[0]; if (e) return `Hoje tem culto às ${pad2(e.h)}:${pad2(e.m)} — ${e.church.name}! ⛪`; }
  return '';
}
async function updateMascot() {
  try {
    const { p, name } = await mascotPlace();
    const j = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p[1]}&longitude=${p[0]}&current=temperature_2m,weather_code,is_day&timezone=auto`, { signal: AbortSignal.timeout(9000) })).json();
    const c = j.current, w = c.weather_code, T = Math.round(c.temperature_2m), day = c.is_day;
    const near = [...S.churches, ...Object.values(known)].some(x => lastPos && hav(lastPos, [x.lng, x.lat]) < 0.3);
    const lbl = name === 'aqui' ? 'aqui' : `em ${name}`;
    if (near) mood = { acc: '⛪', cls: 'top', say: 'Estamos numa casa de oração! Paz de Deus 🙏' };
    else if ((w >= 51 && w <= 67) || (w >= 80 && w <= 82) || w >= 95) mood = { acc: '☂️', cls: 'top', say: `Chovendo ${lbl} (${T}°). Pega o guarda-chuva! ☔` };
    else if (!day) mood = { acc: '😴', cls: 'top', say: `Já é noite ${lbl} (${T}°). Descansa que amanhã tem estrada! 🌙` };
    else if (T >= 30) mood = { acc: '🕶️', cls: 'eyes', say: `Calorão ${lbl}: ${T}°! Água e protetor solar ☀️` };
    else if (T <= 14) mood = { acc: '🧣', cls: 'neck', say: `Friozinho ${lbl}: ${T}°. Leva um casaco! 🧥` };
    else mood = { acc: '🧢', cls: 'top', say: `Tempo bom ${lbl}: ${T}° ${wIcon(w)} Bora pra estrada!` };
    const cl = culturalLine(); if (cl) mood.say = cl + ' ' + mood.say;
    macc.textContent = mood.acc; macc.className = 'acc ' + mood.cls;
  } catch { }
}
mw.onclick = e => { e.stopPropagation(); mw.classList.add('hop'); setTimeout(() => mw.classList.remove('hop'), 700); toast(mood.say, 6000); };
setTimeout(updateMascot, 2500); setInterval(updateMascot, 25 * 60000);

/* ---------- Gancho de salvamento (conquistas + sincronização) ---------- */
function onSaved() { clearTimeout(onSaved.t); onSaved.t = setTimeout(() => { checkBadges(); window.dispatchEvent(new Event('mb-saved')); }, 900); }
setTimeout(checkBadges, 3000);
function afterTripSaved() { setTimeout(checkBadges, 500); }
