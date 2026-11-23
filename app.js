'use strict';
/* ===== Utilidades ===== */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const hav = (a, b) => { // [lng,lat] -> km
  const R = 6371, r = Math.PI / 180, dLa = (b[1] - a[1]) * r, dLo = (b[0] - a[0]) * r;
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
};
const fmtKm = n => n.toLocaleString('pt-BR', { maximumFractionDigits: n < 10 ? 1 : 0 }) + ' km';
const fmtDur = s => { const h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60); return h ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`; };
const pd = s => new Date(s + 'T12:00:00');
const fmtDate = d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
const wdName = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
function toast(t, ms = 2800) { const e = $('#toast'); e.textContent = t; e.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => e.hidden = true, ms); }

/* ===== Persistência ===== */
const S = Object.assign({ visits: [], tracks: [], trips: [], churches: [], times: {}, events: [], ufs: [] },
  (() => { try { return JSON.parse(localStorage.getItem('mb')) || {}; } catch { return {}; } })());
const save = () => {
  S.updated = Date.now();
  try { localStorage.setItem('mb', JSON.stringify(S)); } catch (e) { toast('Armazenamento cheio! Faça backup em Memórias.'); }
  if (typeof onSaved === 'function') onSaved();
};

const idb = new Promise((res, rej) => {
  const r = indexedDB.open('mb', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id', autoIncrement: true }).createIndex('v', 'vid');
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
const tx = async (mode, f) => { const db = await idb; return new Promise((res, rej) => { const t = db.transaction('photos', mode); const q = f(t.objectStore('photos')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
const putPhoto = (vid, blob) => tx('readwrite', s => s.add({ vid, blob }));
const photosOf = vid => tx('readonly', s => s.index('v').getAll(vid));
const countPhotos = () => tx('readonly', s => s.count());
const delPhotos = vid => tx('readwrite', s => { s.index('v').getAllKeys(vid).onsuccess = e => e.target.result.forEach(k => s.delete(k)); });

function compress(file, max = 1400) {
  return new Promise(res => {
    const img = new Image(), u = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = img.width * k; c.height = img.height * k;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      c.toBlob(b => { URL.revokeObjectURL(u); res(b); }, 'image/jpeg', .82);
    };
    img.onerror = () => res(file); img.src = u;
  });
}

/* ===== Mapa 3D ===== */
const BR = { center: [-52, -14.5], zoom: 3.5 };
const map = new maplibregl.Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty',
  center: BR.center, zoom: BR.zoom, pitch: 0, bearing: 0, maxPitch: 80, attributionControl: { compact: true }
});
new ResizeObserver(() => map.resize()).observe(document.body);
map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
let is3D = false, satOn = false, ready = false, ufGeo = null;
const empty = () => ({ type: 'FeatureCollection', features: [] });

map.on('load', () => {
  map.addSource('dem', { type: 'raster-dem', tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'], encoding: 'terrarium', tileSize: 256, maxzoom: 14, attribution: 'Terrain: Mapzen/AWS' });
  cartoonize();
  map.addSource('sat', { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18, attribution: 'Imagery © Esri' });
  map.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } });
  map.addSource('uf', { type: 'geojson', data: empty() });
  map.addLayer({ id: 'uf-fill', type: 'fill', source: 'uf', filter: ['==', ['get', 'v'], 1], paint: { 'fill-color': '#6fe05a', 'fill-opacity': .5 } });
  map.addLayer({ id: 'uf-line', type: 'line', source: 'uf', paint: { 'line-color': '#2b1a4a', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.5, 8, 3], 'line-dasharray': [3, 1.5], 'line-opacity': .8 } });
  map.addSource('route', { type: 'geojson', data: empty() });
  map.addLayer({ id: 'route', type: 'line', source: 'route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7b2ff7', 'line-width': 6, 'line-dasharray': [1.2, 1.4] } });
  map.addSource('tracks', { type: 'geojson', data: empty() });
  map.addLayer({ id: 'tracks-glow', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 8, 12, 16], 'line-opacity': .95 } });
  map.addLayer({ id: 'tracks', type: 'line', source: 'tracks', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#ff3d71', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 4, 12, 9], 'line-dasharray': [0.1, 1.6] } });
  ready = true;
  drawTracks(); renderVisitMarkers(); loadStates();
});

$('#btn3d').onclick = () => {
  is3D = !is3D; $('#btn3d').textContent = is3D ? '3D' : '2D';
  map.setTerrain(is3D ? { source: 'dem', exaggeration: 1.6 } : null);
  map.easeTo({ pitch: is3D ? 60 : 0, duration: 900 });
};
$('#btnLayers').onclick = () => {
  satOn = !satOn; map.setLayoutProperty('sat', 'visibility', satOn ? 'visible' : 'none');
  toast(satOn ? 'Satélite ligado' : 'Mapa padrão');
};

/* ===== Mapa cartoon ===== */
function cartoonize() {
  const P = (id, k, v) => { try { map.setPaintProperty(id, k, v); } catch { } };
  map.getStyle().layers.forEach(l => {
    const id = l.id.toLowerCase(), t = l.type;
    if (t === 'background') P(l.id, 'background-color', '#fff1c9');
    else if (t === 'fill') {
      if (/water/.test(id)) P(l.id, 'fill-color', '#4cc9f0');
      else if (/park|wood|forest|grass|green|nature|scrub|national/.test(id)) P(l.id, 'fill-color', '#9be564');
      else if (/building/.test(id)) P(l.id, 'fill-color', '#ffb4a2');
      else if (/sand|beach/.test(id)) P(l.id, 'fill-color', '#ffe08a');
      else if (/ice|glacier/.test(id)) P(l.id, 'fill-color', '#ffffff');
      else P(l.id, 'fill-color', '#ffe9a8');
    } else if (t === 'fill-extrusion') P(l.id, 'fill-extrusion-color', '#ffb4a2');
    else if (t === 'line') {
      if (/water/.test(id)) P(l.id, 'line-color', '#2fb4e0');
      else if (/casing/.test(id)) P(l.id, 'line-color', '#2b1a4a');
      else if (/motorway|trunk|primary/.test(id)) P(l.id, 'line-color', '#ffd23f');
      else if (/road|street|path|bridge|tunnel|service|track|secondary|tertiary|minor/.test(id)) P(l.id, 'line-color', '#ffffff');
      else if (/boundary|admin/.test(id)) P(l.id, 'line-color', '#ff4f87');
    } else if (t === 'symbol') { P(l.id, 'text-color', '#2b1a4a'); P(l.id, 'text-halo-color', '#fff7e0'); P(l.id, 'text-halo-width', 2); }
  });
}

/* ===== Estados (preencher o Brasil) ===== */
const UF = { 11: 'RO', 12: 'AC', 13: 'AM', 14: 'RR', 15: 'PA', 16: 'AP', 17: 'TO', 21: 'MA', 22: 'PI', 23: 'CE', 24: 'RN', 25: 'PB', 26: 'PE', 27: 'AL', 28: 'SE', 29: 'BA', 31: 'MG', 32: 'ES', 33: 'RJ', 35: 'SP', 41: 'PR', 42: 'SC', 43: 'RS', 50: 'MS', 51: 'MT', 52: 'GO', 53: 'DF' };
async function loadStates() {
  try {
    let g = null;
    try { g = JSON.parse(localStorage.getItem('mb-uf')); } catch { }
    if (!g) {
      const r = await fetch('https://servicodados.ibge.gov.br/api/v3/malhas/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF');
      g = await r.json();
      try { localStorage.setItem('mb-uf', JSON.stringify(g)); } catch { }
    }
    g.features.forEach(f => { f.properties.uf = UF[f.properties.codarea]; f.bbox = bbox(f.geometry); });
    ufGeo = g; recomputeStates();
  } catch (e) { console.warn('IBGE indisponível', e); }
}
function bbox(geom) {
  let a = 180, b = 90, c = -180, d = -90;
  const walk = x => typeof x[0] === 'number' ? (a = Math.min(a, x[0]), c = Math.max(c, x[0]), b = Math.min(b, x[1]), d = Math.max(d, x[1])) : x.forEach(walk);
  walk(geom.coordinates); return [a, b, c, d];
}
function inRing(p, ring) { let o = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) o = !o; } return o; }
function inGeom(p, g) { const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates; return polys.some(po => inRing(p, po[0]) && !po.slice(1).some(h => inRing(p, h))); }
function ufOf(p) { if (!ufGeo) return null; for (const f of ufGeo.features) { const b = f.bbox; if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue; if (inGeom(p, f.geometry)) return f.properties.uf; } return null; }
function recomputeStates() {
  if (!ufGeo) return;
  const set = new Set(S.ufs);
  S.visits.forEach(v => { const u = ufOf([v.lng, v.lat]); if (u) set.add(u); });
  S.tracks.forEach(t => t.pts.forEach((p, i) => { if (i % 6 === 0) { const u = ufOf(p); if (u) set.add(u); } }));
  S.ufs = [...set]; save(); paintStates();
}
function paintStates() {
  if (!ufGeo || !ready) return;
  ufGeo.features.forEach(f => f.properties.v = S.ufs.includes(f.properties.uf) ? 1 : 0);
  map.getSource('uf').setData(ufGeo);
}
function noteStateAt(p) { const u = ufOf(p); if (u && !S.ufs.includes(u)) { S.ufs.push(u); save(); paintStates(); toast(`🎉 Novo estado no seu mapa: ${u}! (${S.ufs.length}/27)`, 4500); } }

/* ===== Trajetos ===== */
let cur = null, watchId = null, wake = null, lastPos = null, meMarker = null;
function drawTracks() {
  if (!ready) return;
  const fs = S.tracks.filter(t => t.pts.length > 1).map(t => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: t.pts.map(p => [p[0], p[1]]) } }));
  map.getSource('tracks').setData({ type: 'FeatureCollection', features: fs });
}
const trackKm = t => t.pts.reduce((s, p, i) => i ? s + hav(t.pts[i - 1], p) : 0, 0);
const totalKm = () => S.tracks.reduce((s, t) => s + trackKm(t), 0);
const updKm = () => { $('#kmTotal').textContent = fmtKm(totalKm()); if (cur) $('#trackKm').textContent = fmtKm(trackKm(cur)); };

function setMe(lng, lat) {
  if (!meMarker) { const e = document.createElement('div'); e.style.cssText = 'width:18px;height:18px;border-radius:50%;background:#4cc9f0;border:3px solid #fff;box-shadow:0 0 0 8px #4cc9f044'; meMarker = new maplibregl.Marker({ element: e }).setLngLat([lng, lat]).addTo(map); }
  else meMarker.setLngLat([lng, lat]);
}
function geoErr(e) { toast(e.code === 1 ? 'Permita o acesso à localização (precisa de https ou localhost).' : 'Não consegui obter sua posição.'); }
$('#fabLocate').onclick = () => {
  if (!navigator.geolocation) return toast('Sem GPS neste aparelho.');
  navigator.geolocation.getCurrentPosition(p => { lastPos = [p.coords.longitude, p.coords.latitude]; setMe(...lastPos); map.flyTo({ center: lastPos, zoom: 13, pitch: is3D ? 60 : 0, duration: 1800 }); }, geoErr, { enableHighAccuracy: true, timeout: 15000 });
};
async function startTrack() {
  if (!navigator.geolocation) return toast('Sem GPS neste aparelho.');
  cur = { id: uid(), start: new Date().toISOString(), pts: [] }; S.tracks.push(cur);
  try { wake = await navigator.wakeLock?.request('screen'); } catch { }
  watchId = navigator.geolocation.watchPosition(p => {
    if (p.coords.accuracy > 80) return;
    const pt = [+p.coords.longitude.toFixed(5), +p.coords.latitude.toFixed(5), Math.round(Date.now() / 1000)];
    lastPos = pt; setMe(pt[0], pt[1]);
    const l = cur.pts[cur.pts.length - 1];
    if (!l || hav(l, pt) > 0.02) { cur.pts.push(pt); if (cur.pts.length % 8 === 0) { save(); noteStateAt(pt); } drawTracks(); updKm(); }
    if (cur.pts.length < 2) map.easeTo({ center: pt, zoom: 14 });
  }, geoErr, { enableHighAccuracy: true, maximumAge: 5000 });
  $('#fabTrack').classList.add('rec'); $('#trackBar').hidden = false; toast('Gravando seu trajeto. Mantenha o app aberto.');
}
function stopTrack() {
  navigator.geolocation.clearWatch(watchId); wake?.release?.(); wake = null;
  if (cur && cur.pts.length < 2) S.tracks = S.tracks.filter(t => t !== cur);
  cur = null; save(); drawTracks(); recomputeStates(); updKm();
  $('#fabTrack').classList.remove('rec'); $('#trackBar').hidden = true; toast('Trajeto salvo no seu mapa 🧡');
}
$('#fabTrack').onclick = () => cur ? stopTrack() : startTrack();
$('#trackStop').onclick = stopTrack;

/* ===== Marcações / fotos ===== */
const CATS = { visit: ['📍', 'Lugar visitado'], ccb: ['⛪', 'Igreja CCB'], food: ['🍽️', 'Comida'], sight: ['🏞️', 'Passeio'], stay: ['🛏️', 'Hospedagem'], event: ['🎺', 'Evento / reunião'] };
let vMarkers = [];
function renderVisitMarkers() {
  vMarkers.forEach(m => m.remove()); vMarkers = [];
  S.visits.forEach(v => {
    const e = document.createElement('div'); e.className = 'pin'; e.textContent = CATS[v.cat]?.[0] || '📍';
    e.onclick = ev => { ev.stopPropagation(); showVisit(v.id); };
    vMarkers.push(new maplibregl.Marker({ element: e, anchor: 'bottom' }).setLngLat([v.lng, v.lat]).addTo(map));
  });
}
let draft = null;
function currentPoint() { return new Promise(res => { if (lastPos) return res(lastPos); if (!navigator.geolocation) return res(null); navigator.geolocation.getCurrentPosition(p => { lastPos = [p.coords.longitude, p.coords.latitude]; res(lastPos); }, () => res(null), { enableHighAccuracy: true, timeout: 6000 }); }); }
async function openMark(pre = {}) {
  const p = pre.lng != null ? [pre.lng, pre.lat] : (await currentPoint() || [map.getCenter().lng, map.getCenter().lat]);
  draft = { lng: p[0], lat: p[1], photos: [], cat: pre.cat || 'visit', title: pre.title || '' };
  setTab(null);
  sheet(`<h2>Marcar lugar</h2>
  <label>Nome do lugar</label><input id="mTitle" value="${esc(draft.title)}" placeholder="Ex.: Casa de Oração de Gramado">
  <label>Tipo</label><select id="mCat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${k === draft.cat ? 'selected' : ''}>${v[0]} ${v[1]}</option>`).join('')}</select>
  <label>Anotação / memória</label><textarea id="mNote" placeholder="O que viveu aqui? Quem conheceu? O que pregaram?"></textarea>
  <label>Data</label><input id="mDate" type="date" value="${new Date().toISOString().slice(0, 10)}">
  <div class="row"><button class="btn sec" data-act="photo">📷 Foto</button><button class="btn sec" data-act="mCenter">🎯 Usar centro do mapa</button></div>
  <div id="mThumbs" class="photos"></div>
  <p class="muted" id="mPos">📌 ${p[1].toFixed(4)}, ${p[0].toFixed(4)}</p>
  <button class="btn" style="width:100%" data-act="mSave">Salvar na memória</button>`);
}
$('#fabMark').onclick = () => openMark();
$('#photoInput').onchange = async e => {
  for (const f of e.target.files) { const b = await compress(f); (draft ||= { photos: [] }).photos.push(b); }
  e.target.value = '';
  if (draft && $('#mThumbs')) $('#mThumbs').innerHTML = draft.photos.map(b => `<img src="${URL.createObjectURL(b)}">`).join('');
  if (draft?.addTo) { for (const b of draft.photos) await putPhoto(draft.addTo, b); const id = draft.addTo; draft = null; showVisit(id); }
};

async function showVisit(id) {
  const v = S.visits.find(x => x.id === id); if (!v) return;
  map.flyTo({ center: [v.lng, v.lat], zoom: Math.max(map.getZoom(), 12), pitch: is3D ? 60 : 0 });
  const ph = await photosOf(id);
  sheet(`<h2>${CATS[v.cat]?.[0] || '📍'} ${esc(v.title)}</h2>
  <p class="muted">${fmtDate(v.date)} · ${CATS[v.cat]?.[1] || ''}</p>
  ${v.note ? `<p>${esc(v.note).replace(/\n/g, '<br>')}</p>` : ''}
  <div class="photos">${ph.map(p => `<img src="${URL.createObjectURL(p.blob)}">`).join('')}</div>
  <div class="row"><button class="btn sec" data-act="addPhoto" data-id="${id}">📷 Add foto</button>
  <a class="btn sec" style="text-align:center;text-decoration:none;color:inherit" target="_blank" href="https://www.google.com/maps/dir/?api=1&destination=${v.lat},${v.lng}">🚗 Rota</a>
  <button class="btn sec" data-act="delVisit" data-id="${id}">🗑️</button></div>`);
}

/* ===== Sheet / abas ===== */
const sh = $('#sheet');
const ICT = { '⛪': 'ccb', '⭐': 'poi', '🎺': 'ev', '🧳': 'trip', '📍': 'visit', '✅': 'ok', '🍽️': 'food', '🏞️': 'poi', '🛏️': 'stay' };
function sheet(html) {
  const b = $('#sheetBody'); b.innerHTML = html; sh.classList.remove('hidden'); b.scrollTop = 0;
  b.querySelectorAll('.item').forEach(it => { it.classList.add('t-' + (ICT[it.querySelector('.ic')?.textContent.trim()] || 'visit')); });
  [...b.children].forEach((c, i) => c.style.setProperty('--i', Math.min(i, 12)));
}
function closeSheet() { sh.classList.add('hidden'); }
$('#sheetHandle').onclick = closeSheet;
let tabNow = 'explorar';
function setTab(t) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  if (t) tabNow = t;
}
document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => {
  const t = b.dataset.tab; if (t === tabNow && !sh.classList.contains('hidden')) { closeSheet(); return; }
  setTab(t); ({ explorar: viewMap, viagem: viewTrips, ccb: viewCCB, memorias: viewMem })[t]();
});

async function viewMap() {
  const n = await countPhotos();
  sheet(`<h2>Meu Brasil</h2>
  <div class="stats"><div class="stat"><b>${fmtKm(totalKm())}</b>percorridos</div><div class="stat"><b>${S.ufs.length}/27</b>estados</div><div class="stat"><b>${S.visits.length}</b>lugares</div>
  <div class="stat"><b>${n}</b>fotos</div><div class="stat"><b>${S.visits.filter(v => v.cat === 'ccb').length}</b>CCBs</div><div class="stat"><b>${S.trips.length}</b>viagens</div></div>
  ${typeof progressHtml === 'function' ? progressHtml() : ''}
  <p class="muted">As linhas rosa são os caminhos que você já percorreu; os estados ficam verdes quando você passa neles. Use ⏺ para gravar o trajeto durante a viagem.</p>
  <div class="row"><button class="btn sec" data-act="brasil">🇧🇷 Ver Brasil inteiro</button><button class="btn sec" data-act="tour">🎬 Tour 3D</button></div>
  <div class="row"><button class="btn sec" data-act="badges">🏆 Conquistas</button><button class="btn sec" data-act="timeline">📜 Linha do tempo</button></div>
  <div class="row"><button class="btn sec" data-act="cloud">☁️ Backup e nuvem</button><button class="btn sec" data-act="offlineMgr">📴 Mapas offline</button></div>`);
}

/* ===== Memórias ===== */
async function viewMem() {
  const vs = [...S.visits].sort((a, b) => b.date.localeCompare(a.date));
  const thumbs = {}; for (const v of vs.slice(0, 40)) { const p = await photosOf(v.id); thumbs[v.id] = p.slice(0, 3); }
  sheet(`<h2>Minhas memórias</h2>
  ${vs.length ? vs.map(v => `<div class="item" data-act="open" data-id="${v.id}"><div class="ic">${CATS[v.cat]?.[0] || '📍'}</div><div class="bd"><b>${esc(v.title)}</b><span class="muted">${fmtDate(v.date)}</span>${v.note ? `<div class="muted">${esc(v.note.slice(0, 90))}</div>` : ''}<div class="photos">${(thumbs[v.id] || []).map(p => `<img src="${URL.createObjectURL(p.blob)}">`).join('')}</div></div></div>`).join('') : '<p class="muted">Nada ainda. Toque no ＋ amarelo para marcar onde você está e tirar fotos.</p>'}
  <h3>Backup</h3><p class="muted">Seus dados e fotos ficam neste aparelho. Proteja-os com backup em arquivo ou no Google Drive.</p>
  <button class="btn sec" style="width:100%" data-act="cloud">☁️ Backup e nuvem</button>`);
}

/* ===== Geocodificação / Overpass / clima ===== */
async function geocode(q) {
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=br&accept-language=pt-BR&q=${encodeURIComponent(q)}`);
  return (await r.json()).map(x => ({ name: x.display_name.split(',').slice(0, 3).join(','), lat: +x.lat, lng: +x.lon }));
}
const OVP = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
async function overpass(q) {
  for (const u of OVP) {
    try {
      const r = await fetch(u, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: AbortSignal.timeout(20000) });
      if (r.ok) return (await r.json()).elements;
    } catch { }
  }
  throw new Error('overpass');
}
const around = (pts, rad) => pts.map(p => `(around:${rad},${p[1]},${p[0]})`);
async function findCCBnominatim(pts, rad) { // plano B se o Overpass estiver fora do ar
  const out = [], seen = new Set(), d = rad / 111000;
  for (const p of pts.slice(0, 4)) {
    const vb = `${p[0] - d * 1.2},${p[1] + d},${p[0] + d * 1.2},${p[1] - d}`;
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=40&bounded=1&viewbox=${vb}&accept-language=pt-BR&q=${encodeURIComponent('Congregação Cristã no Brasil')}`, { signal: AbortSignal.timeout(12000) });
      (await r.json()).forEach(x => { const id = `nom-${x.osm_type}-${x.osm_id}`; if (x.type === 'place_of_worship' && NOME_CCB.test(x.name || '') && !seen.has(id)) { seen.add(id); out.push({ id, name: x.name || 'Congregação Cristã no Brasil', lat: +x.lat, lng: +x.lon, times: '', addr: x.display_name.split(',').slice(1, 3).join(',').trim(), src: 'osm' }); } });
    } catch { }
    await sleep(1100); // limite do Nominatim: 1 req/s
  }
  return out;
}
const NOME_CCB = /congrega[cç][aã]o\s+crist[aã]|^\s*ccb(\s|$|-)/i;
async function findCCB(pts, rad = 10000) {
  let l; try { l = await findCCBoverpass(pts, rad); } catch { l = await findCCBnominatim(pts, rad); }
  S.hidden ||= []; // só igrejas de verdade da CCB, sem as que você marcou como "não é CCB"
  return l.filter(c => (NOME_CCB.test(c.name) || c.den) && !S.hidden.includes(c.id));
}
async function findCCBoverpass(pts, rad) {
  const a = around(pts, rad);
  const q = `[out:json][timeout:30];(${a.map(x => `nwr["amenity"="place_of_worship"]["name"~"Congrega[çc][ãa]o Crist|^CCB",i]${x};nwr["amenity"="place_of_worship"]["denomination"~"ccb|congregacao_crista",i]${x};`).join('')});out center tags 120;`;
  const els = await overpass(q), seen = new Set();
  return els.map(e => {
    const c = e.center || e, t = e.tags || {};
    return { id: `osm-${e.type}-${e.id}`, name: t.name || 'Congregação Cristã no Brasil', lat: c.lat, lng: c.lon, den: /ccb|congregacao/i.test(t.denomination || ''), times: t.service_times || t.opening_hours || '', addr: [t['addr:street'], t['addr:housenumber'], t['addr:suburb'] || t['addr:city']].filter(Boolean).join(', '), src: 'osm' };
  }).filter(c => c.lat && !seen.has(c.id) && seen.add(c.id));
}
async function findPOIs(p, rad = 20000) {
  const a = `(around:${rad},${p[1]},${p[0]})`;
  const q = `[out:json][timeout:30];(nwr["tourism"~"attraction|viewpoint|museum|zoo|theme_park"]["name"]${a};nwr["natural"~"waterfall|peak|beach"]["name"]${a};nwr["historic"~"monument|castle|fort|memorial"]["name"]${a};nwr["leisure"="park"]["name"]["wikidata"]${a};);out center tags 150;`;
  const els = await overpass(q), seen = new Set();
  return els.map(e => {
    const c = e.center || e, t = e.tags || {}, k = t.tourism || t.natural || t.historic || t.leisure;
    const score = (t.wikipedia ? 3 : 0) + (t.wikidata ? 2 : 0) + (t.website ? 1 : 0) + (t.tourism === 'attraction' ? 1 : 0);
    return {
      id: `p-${e.type}-${e.id}`, name: t.name, kind: k, lat: c.lat, lng: c.lon, score, km: hav(p, [c.lon, c.lat]),
      hours: t.opening_hours || '', web: t.website || t['contact:website'] || '', phone: t.phone || t['contact:phone'] || '', fee: t.fee || '',
      wiki: t.wikipedia || '', desc: t['description:pt'] || t.description || '',
      addr: [t['addr:street'], t['addr:housenumber'], t['addr:suburb'] || t['addr:city']].filter(Boolean).join(', ')
    };
  }).filter(x => x.lat && !seen.has(x.name) && seen.add(x.name)).sort((a, b) => b.score - a.score || a.km - b.km).slice(0, 40);
}
async function weather(p, a, b) {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${p[1]}&longitude=${p[0]}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&start_date=${a}&end_date=${b}`);
    const j = await r.json(); if (!j.daily) return {};
    return Object.fromEntries(j.daily.time.map((d, i) => [d, { c: j.daily.weathercode[i], max: j.daily.temperature_2m_max[i], min: j.daily.temperature_2m_min[i], rain: j.daily.precipitation_probability_max[i] }]));
  } catch { return {}; }
}
const wIcon = c => c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c < 50 ? '🌫️' : c < 70 ? '🌧️' : c < 80 ? '❄️' : c < 90 ? '🌦️' : '⛈️';

/* ===== CCB: horários e igrejas ===== */
const chTimes = c => S.times[c.id] ?? c.times ?? '';
const WD_PT = [/\bdom/i, /\bseg/i, /\bter/i, /\bqua/i, /\bqui/i, /\bsex/i, /\bs[aá]b/i], WD_EN = [/\bSu\b/, /\bMo\b/, /\bTu\b/, /\bWe\b/, /\bTh\b/, /\bFr\b/, /\bSa\b/];
const hasDay = (c, d) => { const t = chTimes(c); return !!t && (WD_PT[d].test(t) || WD_EN[d].test(t)); };
const allCustom = () => S.churches.map(c => ({ ...c, src: 'user' }));
function churchCard(c, from, withDay) {
  const t = chTimes(c), d = from ? hav(from, [c.lng, c.lat]) : null;
  return `<div class="item"><div class="ic">⛪</div><div class="bd"><b>${esc(c.name)}</b>
  <span class="muted">${d != null ? fmtKm(d) + ' · ' : ''}${esc(c.addr || '')}</span>
  <div>${t ? `<span class="chip ok">🕖 ${esc(t)}</span>` : '<span class="chip">Horário não informado</span>'}${withDay ? '<span class="chip ccb">culto neste dia</span>' : ''}</div>
  <div class="row" style="margin-top:6px"><button class="btn sm sec" data-act="editTimes" data-id="${esc(c.id)}">✏️ Horário</button>
  <button class="btn sm sec" data-act="goTo" data-lat="${c.lat}" data-lng="${c.lng}">Ver</button>
  <button class="btn sm sec" data-act="visitCh" data-id="${esc(c.id)}">✔ Estive</button>
  ${c.src === 'user' || c.rel ? '' : `<button class="btn sm sec" data-act="notCcb" data-id="${esc(c.id)}">🚫 Não é CCB</button>`}
  <a class="btn sm sec" style="text-align:center;text-decoration:none;color:inherit" target="_blank" href="https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}">🚗</a></div></div></div>`;
}
let known = {}; // id -> church (cache de sessão)
let chMarkers = [];
function showChurchMarkers(list) {
  chMarkers.forEach(m => m.remove()); chMarkers = [];
  list.slice(0, 80).forEach(c => {
    known[c.id] = c;
    const e = document.createElement('div'); e.className = 'pin ccbpin'; e.textContent = '⛪';
    e.onclick = ev => { ev.stopPropagation(); new maplibregl.Popup({ offset: 24 }).setLngLat([c.lng, c.lat]).setHTML(`<b>${esc(c.name)}</b><br><span class="muted">${esc(chTimes(c) || 'horário não informado')}</span>`).addTo(map); };
    chMarkers.push(new maplibregl.Marker({ element: e, anchor: 'bottom' }).setLngLat([c.lng, c.lat]).addTo(map));
  });
}
async function viewCCB() {
  const upcoming = S.events.filter(e => e.date >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.date.localeCompare(b.date));
  sheet(`<h2>⛪ Congregação Cristã</h2>
  ${relCard('', null)}
  <button class="btn" style="width:100%" data-act="ccbNear">🔎 Buscar casas de oração aqui</button>
  <div id="ccbList"></div>
  <p class="muted">A busca usa o OpenStreetMap, que pode não ter todas as casas de oração. Horários de culto variam por local: cadastre/edite o que você confirmar (ficam salvos no app).</p>
  <h3>Minhas casas de oração</h3>
  ${allCustom().map(c => churchCard(c, lastPos)).join('') || '<p class="muted">Nenhuma cadastrada.</p>'}
  <button class="btn sec" data-act="addChurch">＋ Cadastrar casa de oração (no centro do mapa)</button>
  <h3>Agenda de eventos CCB</h3>
  ${upcoming.map(e => `<div class="item"><div class="ic">🎺</div><div class="bd"><b>${esc(e.title)}</b><span class="muted">${fmtDate(pd(e.date))} ${esc(e.time || '')} · ${esc(e.place || '')}</span><div class="row" style="margin-top:6px"><button class="btn sm sec" data-act="goTo" data-lat="${e.lat}" data-lng="${e.lng}">Ver</button><button class="btn sm sec" data-act="delEvent" data-id="${e.id}">🗑️</button></div></div></div>`).join('') || '<p class="muted">Nenhum evento. Cadastre reuniões, batismos, ensaios regionais…</p>'}
  <label>Evento</label><input id="evT" placeholder="Ex.: Reunião de jovens e menores">
  <div class="row"><input id="evD" type="date"><input id="evH" type="time"></div>
  <label>Local</label><input id="evP" placeholder="Cidade / casa de oração">
  <button class="btn sec" data-act="addEvent">＋ Adicionar evento (no centro do mapa)</button>`);
}

/* ===== Viagens (com várias paradas) ===== */
let tripMarkers = [];
function clearTripLayer() { tripMarkers.forEach(m => m.remove()); tripMarkers = []; if (ready) map.getSource('route').setData(empty()); }
const stopName = n => (n || '').split(',')[0].trim();
function legsOf(t) { // paradas da viagem (viagens antigas têm só 1 destino)
  const p = t.plan || {};
  if (t.stops?.length) return t.stops.map((s, i) => ({ ...s, ...(p.legs?.[i] || {}) }));
  return [{ name: t.dest.name, lng: t.dest.lng, lat: t.dest.lat, start: t.start, end: t.end, churches: p.churches || [], pois: p.pois || [], weather: p.weather, err: p.err }];
}
const legChurches = l => [...(l.churches || []).filter(c => (NOME_CCB.test(c.name) || c.den) && !(S.hidden || []).includes(c.id)), ...allCustom().filter(c => hav([l.lng, l.lat], [c.lng, c.lat]) < 40)];
const tripTitle = t => legsOf(t).map(s => stopName(s.name)).join(' → ');
const allPois = t => legsOf(t).flatMap(l => l.pois || []);
let pickedDest = null, pickedFrom = null, draftStops = [];
const stopsHtml = () => draftStops.map((s, i) => `<div class="item t-trip"><div class="ic">🧳</div><div class="bd"><b>${i + 1}. ${esc(stopName(s.name))}</b><span class="muted">${fmtDate(pd(s.start))} → ${fmtDate(pd(s.end))}</span><div class="row" style="margin-top:6px"><button class="btn sm sec" data-act="tDelStop" data-i="${i}">🗑️ Tirar</button></div></div></div>`).join('');
function viewTrips() {
  const today = new Date().toISOString().slice(0, 10);
  draftStops = []; pickedDest = null; pickedFrom = null;
  sheet(`<h2>🧳 Viagens</h2>
  ${S.trips.length ? S.trips.sort((a, b) => b.start.localeCompare(a.start)).map(t => `<div class="item" data-act="openTrip" data-id="${t.id}"><div class="ic">🧳</div><div class="bd"><b>${esc(tripTitle(t))}</b><span class="muted">${fmtDate(pd(t.start))} → ${fmtDate(pd(t.end))}${t.plan?.route ? ' · ' + fmtKm(t.plan.route.km) : ''}</span></div></div>`).join('') : '<p class="muted">Programe sua primeira viagem de missão abaixo.</p>'}
  <h3>Nova viagem</h3>
  <p class="muted">Vai passar por várias cidades? Escolha a cidade e as datas, toque em ＋ Adicionar parada e repita. A última você só deixa preenchida.</p>
  <div id="tStops"></div>
  <label>Destino</label><div class="row"><input id="tDest" placeholder="Cidade (ex.: Maringá)"><button class="btn sm" style="flex:none" data-act="tSearch">Buscar</button></div>
  <div id="tPick"></div>
  <div class="row"><div><label>Chegada</label><input id="tA" type="date" value="${today}"></div><div><label>Saída</label><input id="tB" type="date" value="${today}"></div></div>
  <button class="btn sm sec" style="margin-top:6px" data-act="tAddStop">＋ Adicionar parada</button>
  <label>Saindo de</label><div class="row"><input id="tFrom" placeholder="Cidade de saída (ex.: Campinas)"><button class="btn sm" style="flex:none" data-act="tSearch" data-k="from">Buscar</button></div>
  <button class="btn sm sec" style="margin-top:6px" data-act="tGps">📡 Usar minha posição (GPS)</button>
  <div id="tPickFrom"></div>
  <button class="btn" style="width:100%" data-act="tPlan">✨ Montar roteiro</button>`);
}
async function viaCities(coords, n) { // cidades por onde a rota passa
  const out = [];
  for (let i = 1; i <= n; i++) {
    const c = coords[Math.floor(coords.length * i / (n + 1))];
    try {
      const j = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=10&accept-language=pt-BR&lat=${c[1]}&lon=${c[0]}`, { signal: AbortSignal.timeout(8000) })).json();
      const a = j.address || {}, nm = a.city || a.town || a.village || a.municipality || a.county;
      if (nm) { const s = (a['ISO3166-2-lvl4'] || '').split('-')[1] || ''; const lbl = s ? `${nm}/${s}` : nm; if (!out.includes(lbl)) out.push(lbl); }
    } catch { }
    await sleep(1100);
  }
  return out;
}
async function planTrip() {
  const a = $('#tA').value, b = $('#tB').value, stops = draftStops.map(s => ({ ...s }));
  if (pickedDest) {
    if (!a || !b || b < a) return toast('Confira as datas.');
    stops.push({ name: pickedDest.name, lng: pickedDest.lng, lat: pickedDest.lat, start: a, end: b });
  }
  if (!stops.length) return toast('Busque e escolha o destino primeiro.');
  stops.sort((x, y) => x.start.localeCompare(y.start));
  const trip = { id: uid(), dest: { name: stops[0].name, lng: stops[0].lng, lat: stops[0].lat }, stops, start: stops[0].start, end: stops.reduce((m, s) => s.end > m ? s.end : m, stops[0].end), plan: { legs: [] } };
  sheet('<h2>Montando seu roteiro…</h2><p class="muted" id="prog">Procurando origem…</p>');
  const prog = t => { const e = $('#prog'); if (e) e.textContent = t; };
  try {
    let from = pickedFrom ? { name: pickedFrom.name, lng: pickedFrom.lng, lat: pickedFrom.lat } : null; const ft = $('#tFrom')?.value?.trim();
    if (!from && ft) { const g = (await geocode(ft))[0]; if (g) from = { name: g.name, lng: g.lng, lat: g.lat }; }
    if (!from && !ft) { const p = await currentPoint(); if (p) from = { name: 'Minha posição', lng: p[0], lat: p[1] }; }
    trip.from = from;
    const wp = [...(from ? [from] : []), ...stops].map(s => [s.lng, s.lat]);
    if (wp.length > 1) {
      prog('Calculando rota e distância…');
      try {
        const r = await (await fetch(`https://router.project-osrm.org/route/v1/driving/${wp.map(x => x.join(',')).join(';')}?overview=simplified&geometries=geojson`)).json();
        const rt = r.routes[0]; trip.plan.route = { km: rt.distance / 1000, sec: rt.duration, coords: rt.geometry.coordinates, legs: rt.legs.map(l => ({ km: l.distance / 1000, sec: l.duration })) };
        if (rt.distance > 60000) { prog('Descobrindo as cidades do caminho…'); trip.plan.route.via = await viaCities(rt.geometry.coordinates, Math.min(6, Math.max(2, Math.round(rt.distance / 1000 / 120)))); }
      } catch { trip.plan.route = { km: wp.reduce((s, x, i) => i ? s + hav(wp[i - 1], x) : 0, 0), sec: 0, coords: wp, straight: true, legs: wp.slice(1).map((x, i) => ({ km: hav(wp[i], x), sec: 0 })) }; }
    }
    for (const s of stops) {
      const dp = [s.lng, s.lat], nm = stopName(s.name), lg = {};
      prog(`${nm}: previsão do tempo…`); lg.weather = await weather(dp, s.start, s.end);
      prog(`${nm}: igrejas da CCB…`); try { lg.churches = await findCCB([dp], 10000); } catch { lg.churches = []; lg.err = 'Busca de igrejas indisponível agora.'; }
      prog(`${nm}: o que visitar…`); try { lg.pois = await findPOIs(dp); } catch { lg.pois = []; }
      trip.plan.legs.push(lg);
    }
  } catch (e) { toast('Falha ao montar o roteiro. Verifique a internet.'); return viewTrips(); }
  S.trips.push(trip); save(); showTrip(trip.id);
  if (typeof afterTripSaved === 'function') afterTripSaved(trip);
}
function showTrip(id) {
  const t = S.trips.find(x => x.id === id); if (!t) return; const p = t.plan || {};
  clearTripLayer();
  const legs = legsOf(t), hid = S.hidden || [], multi = legs.length > 1;
  const chs = legs.map(legChurches), all = [...new Map(chs.flat().map(c => [c.id, c])).values()];
  all.forEach(c => known[c.id] = c);
  const bounds = new maplibregl.LngLatBounds([legs[0].lng, legs[0].lat], [legs[0].lng, legs[0].lat]);
  legs.forEach(l => bounds.extend([l.lng, l.lat]));
  if (p.route) { if (ready) map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: p.route.coords } }); p.route.coords.forEach(c => bounds.extend(c)); }
  showChurchMarkers(all);
  if (multi) legs.forEach((l, i) => { const e = document.createElement('div'); e.className = 'pin'; e.textContent = i + 1; e.style.fontFamily = 'var(--f1, inherit)'; tripMarkers.push(new maplibregl.Marker({ element: e, anchor: 'bottom' }).setLngLat([l.lng, l.lat]).addTo(map)); });
  legs.flatMap(l => l.pois || []).slice(0, 40).forEach(x => { const e = document.createElement('div'); e.className = 'pin'; e.textContent = '⭐'; e.onclick = () => new maplibregl.Popup({ offset: 24 }).setLngLat([x.lng, x.lat]).setHTML(`<b>${esc(x.name)}</b>`).addTo(map); tripMarkers.push(new maplibregl.Marker({ element: e, anchor: 'bottom' }).setLngLat([x.lng, x.lat]).addTo(map)); });
  map.fitBounds(bounds, { padding: { top: 90, bottom: 360, left: 40, right: 40 }, pitch: is3D ? 50 : 0, duration: 1600, maxZoom: 11 });
  const days = daysOf(t), iso = d => d.toISOString().slice(0, 10);
  const legIdx = s => { let k = legs.findIndex(l => s >= l.start && s <= l.end); if (k < 0) { legs.forEach((l, i) => { if (l.end < s) k = i; }); if (k < 0) k = 0; } return k; };
  const legDays = legs.map(() => []); days.forEach(d => legDays[legIdx(iso(d))].push(iso(d)));
  const evs = S.events, enrich = [];
  sheet(`<h2>🧳 ${esc(tripTitle(t))}</h2>
  <p class="muted">${fmtDate(pd(t.start))} → ${fmtDate(pd(t.end))} · ${days.length} dia(s)${multi ? ` · ${legs.length} paradas` : ''}</p>
  <div class="stats"><div class="stat"><b>${p.route ? fmtKm(p.route.km) : '—'}</b>${p.route?.straight ? 'em linha reta' : 'de distância'}</div><div class="stat"><b>${p.route?.sec ? fmtDur(p.route.sec) : '—'}</b>de carro</div><div class="stat"><b>${all.length}</b>CCBs achadas</div></div>
  ${t.from ? `<p class="muted">🚩 Saindo de: <b>${esc(stopName(t.from.name))}</b></p>` : '<p class="muted">Sem saída informada — escolha a cidade de saída em Viagem para ver distância e caminho.</p>'}
  ${p.route?.via?.length ? `<p class="muted">🛣️ Passa por: ${p.route.via.map(esc).join(' → ')}</p>` : ''}
  ${t.from ? `<p class="muted">💰 Pedágios: o app não calcula valores. <a style="color:var(--ac)" target="_blank" href="${gmapsDir(t)}">Veja no Google Maps</a> (mostra pedágios na rota).</p>` : ''}
  ${legs.map(l => l.err ? `<p class="muted">⚠️ ${esc(stopName(l.name))}: ${l.err}</p>` : '').join('')}
  ${p.route ? `<button class="btn sec" style="width:100%;margin:6px 0" data-act="support" data-t="${t.id}">⛽ Pontos de apoio na rota (postos, comida, hotéis)</button>` : ''}
  <button class="btn sec" style="width:100%;margin:0 0 6px" data-act="remind" data-t="${t.id}">🔔 Lembretes de culto nesta viagem</button>
  <button class="btn sec" style="width:100%;margin:0 0 6px" data-act="offline" data-t="${t.id}">📴 Baixar mapa offline desta viagem</button>
  ${relCard(t.id, legs[0], 0)}
  ${days.map(d => {
    const is = iso(d), wd = d.getDay(), k = legIdx(is), l = legs[k], dp = [l.lng, l.lat], w = l.weather?.[is], ds = legDays[k], i2 = ds.indexOf(is), pois = l.pois || [];
    const per = Math.max(1, Math.min(3, Math.ceil(pois.length / Math.max(1, ds.length)))), c = chs[k];
    const match = c.filter(x => hasDay(x, wd)).sort((a, b) => hav(dp, [a.lng, a.lat]) - hav(dp, [b.lng, b.lat])).slice(0, 2);
    const near = c.filter(x => !match.includes(x)).sort((a, b) => hav(dp, [a.lng, a.lat]) - hav(dp, [b.lng, b.lat])).slice(0, match.length ? 0 : 2);
    const day = pois.slice(i2 * per, i2 * per + per), ev = evs.filter(e => e.date === is); enrich.push(...day);
    const li = k + (t.from ? 1 : 0) - 1, lg = p.route?.legs?.[li];
    const head = multi && i2 === 0 ? `<div class="item t-trip"><div class="ic">📍</div><div class="bd"><b>${k + 1}ª parada: ${esc(stopName(l.name))}</b>${lg ? `<span class="muted">🚗 ${fmtKm(lg.km)}${lg.sec ? ' · ' + fmtDur(lg.sec) : ''} desde a parada anterior</span>` : ''}</div></div>${k ? relCard(t.id, l, k) : ''}` : '';
    return `<div class="day">${head}<b>Dia ${days.indexOf(d) + 1} · ${wdName[wd]}, ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}${multi ? ' · ' + esc(stopName(l.name)) : ''}</b>
    ${w ? `<div class="muted">${wIcon(w.c)} ${Math.round(w.min)}°–${Math.round(w.max)}° · chuva ${w.rain ?? 0}%</div>` : '<div class="muted">Previsão disponível só até ~16 dias antes.</div>'}
    ${ev.map(e => `<div class="item"><div class="ic">🎺</div><div class="bd"><b>${esc(e.title)}</b><span class="muted">${esc(e.time || '')} ${esc(e.place || '')}</span></div></div>`).join('')}
    ${day.map(x => poiCard(x, t.id, wd)).join('')}
    ${match.map(x => churchCard(x, dp, true)).join('')}${near.map(x => churchCard(x, dp, false)).join('')}
    ${!match.length && !near.length ? '<p class="muted">Nenhuma CCB conhecida aqui — cadastre na aba CCB se souber de uma.</p>' : ''}
    </div>`;
  }).join('')}
  <button class="btn sec" data-act="delTrip" data-id="${t.id}">🗑️ Apagar viagem</button>`);
  enrichCards(enrich, t.id);
}
function gmapsDir(t) {
  const legs = legsOf(t), last = legs.at(-1), mid = legs.slice(0, -1).map(l => `${l.lat},${l.lng}`).join('|');
  return `https://www.google.com/maps/dir/?api=1&origin=${t.from.lat},${t.from.lng}&destination=${last.lat},${last.lng}${mid ? '&waypoints=' + mid : ''}&travelmode=driving`;
}

/* ===== Detalhes dos passeios ===== */
const KIND = { attraction: ['🎡', 'Atração turística', '1–2h'], viewpoint: ['🔭', 'Mirante', '30–60 min'], museum: ['🏛️', 'Museu', '1–2h'], zoo: ['🦁', 'Zoológico', '3–4h'], theme_park: ['🎢', 'Parque temático', 'dia todo'], waterfall: ['💦', 'Cachoeira', '1–2h'], peak: ['⛰️', 'Pico / morro', '2–4h'], beach: ['🏖️', 'Praia', '2–4h'], monument: ['🗿', 'Monumento', '30 min'], castle: ['🏰', 'Castelo', '1h'], fort: ['🏯', 'Forte', '1h'], memorial: ['🕊️', 'Memorial', '30 min'], park: ['🌳', 'Parque', '1–2h'] };
Object.values(KIND).forEach(k => ICT[k[0]] = 'poi');
const kindOf = x => KIND[x.kind] || ['⭐', 'Ponto de interesse', '1h'];
const hoursPt = h => !h ? '' : h.replace(/24\/7/g, '24h todos os dias').replace(/\bMo\b/g, 'Seg').replace(/\bTu\b/g, 'Ter').replace(/\bWe\b/g, 'Qua').replace(/\bTh\b/g, 'Qui').replace(/\bFr\b/g, 'Sex').replace(/\bSa\b/g, 'Sáb').replace(/\bSu\b/g, 'Dom').replace(/\boff\b/g, 'fechado').replace(/\bPH\b/g, 'feriados').replace(/;/g, ' · ');
function hoursOn(h, wd) { // horário do OSM para um dia da semana (0=dom); null se não der para saber
  if (!h) return null; if (/24\/7/.test(h)) return '24h';
  const E = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']; let res = null;
  for (const rule of h.split(';')) {
    const m = rule.trim().match(/^([A-Za-z,\- ]+?)\s+(\d.*|off|closed)$/);
    if (!m) { const m2 = rule.trim().match(/^(\d.*)$/); if (m2) res = m2[1]; continue; }
    const set = new Set();
    for (const part of m[1].split(',')) { const [a, b] = part.trim().split('-'), i = E.indexOf(a); if (i < 0) continue; if (!b) set.add(i); else { const j = E.indexOf(b); for (let k = i, n = 0; n < 8; k = (k + 1) % 7, n++) { set.add(k); if (k === j) break; } } }
    if (set.has(wd)) res = /off|closed/.test(m[2]) ? 'fechado' : m[2];
  }
  return res;
}
async function wikiInfo(x) {
  if (x.info !== undefined) return x.info;
  let info = null;
  try {
    const tok = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\W+/).filter(w => w.length > 3);
    if (x.wiki && x.wiki.includes(':')) {
      const [lang, ...r] = x.wiki.split(':'), r2 = await (await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(r.join(':').replace(/ /g, '_'))}`)).json();
      if (r2.extract) info = { title: r2.title, extract: r2.extract, img: r2.thumbnail?.source, url: r2.content_urls?.desktop?.page };
    }
    if (!info) {
      const u = `https://pt.wikipedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggscoord=${x.lat}|${x.lng}&ggsradius=1500&ggslimit=10&prop=pageimages|extracts&exintro=1&explaintext=1&exchars=700&piprop=thumbnail&pithumbsize=700`;
      const pages = Object.values((await (await fetch(u)).json()).query?.pages || {}), nt = tok(x.name);
      const need = Math.min(2, nt.length), best = pages.find(p => tok(p.title).filter(w => nt.includes(w)).length >= need);
      if (best) info = { title: best.title, extract: best.extract, img: best.thumbnail?.source, url: 'https://pt.wikipedia.org/wiki/' + encodeURIComponent(best.title.replace(/ /g, '_')) };
    }
    if (!info?.img) { // foto real tirada perto do local (Wikimedia Commons)
      const u = `https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=geosearch&ggsnamespace=6&ggscoord=${x.lat}|${x.lng}&ggsradius=250&ggslimit=6&prop=imageinfo&iiprop=url|mime&iiurlwidth=700`;
      const im = Object.values((await (await fetch(u)).json()).query?.pages || {}).map(p => p.imageinfo?.[0]).find(i => i && /^image\/(jpeg|png)/.test(i.mime) && i.thumburl);
      if (im) info = { ...(info || {}), img: im.thumburl, credit: 'Wikimedia Commons' };
    }
  } catch { return null; } // erro de rede: não guarda, tenta de novo depois
  x.info = info; return info;
}
function poiCard(x, tid, wd) {
  const [em, kn, dur] = kindOf(x), h = hoursOn(x.hours, wd);
  const hc = h == null ? '<span class="chip">🕒 horário não informado — confira antes</span>' : h === 'fechado' ? `<span class="chip" style="background:#c0392b">🚫 fecha ${wdName[wd].toLowerCase()}</span>` : `<span class="chip ok">🕒 ${wdName[wd].slice(0, 3)}: ${esc(h)}</span>`;
  return `<div class="item poi" data-act="poi" data-t="${tid}" data-id="${x.id}" data-wd="${wd}"><div class="ic">${em}</div><div class="bd">
  <div class="ph" id="ph-${x.id}" ${x.info?.img ? `style="background-image:url('${esc(x.info.img)}')"` : 'hidden'}></div>
  <b>${esc(x.name)}</b><span class="muted">${kn} · 📏 ${fmtKm(x.km)} do centro</span>
  <div>${hc}<span class="chip">⏱️ ~${dur}</span>${/^yes$/i.test(x.fee) ? '<span class="chip">💲 pago</span>' : /^no$/i.test(x.fee) ? '<span class="chip ok">🆓 grátis</span>' : ''}</div>
  <div class="muted" style="margin-top:3px">Toque para ver detalhes ›</div></div></div>`;
}
async function enrichCards(list, tid) {
  const q = [...list]; let dirty = false;
  await Promise.all([0, 1, 2].map(async () => {
    while (q.length) {
      const x = q.shift(), had = x.info !== undefined, info = await wikiInfo(x);
      if (!had && x.info !== undefined) dirty = true;
      const el = document.getElementById('ph-' + x.id);
      if (el && info?.img) { el.style.backgroundImage = `url('${info.img}')`; el.hidden = false; }
    }
  }));
  if (dirty) save();
}
async function showPoi(tid, id, wd) {
  const t = S.trips.find(x => x.id === tid), x = t && allPois(t).find(p => p.id === id); if (!x) return;
  const [em, kn, dur] = kindOf(x), back = `<button class="btn sec sm" data-act="backTrip" data-t="${tid}">‹ Voltar ao roteiro</button>`;
  map.flyTo({ center: [x.lng, x.lat], zoom: 14, pitch: is3D ? 62 : 0, duration: 1500 });
  sheet(`${back}<h2>${em} ${esc(x.name)}</h2><p class="muted">${kn}</p><p class="muted">Carregando fotos e descrição…</p>`);
  const info = await wikiInfo(x); save();
  const hrs = x.hours ? hoursPt(x.hours) : '', today = wd != null ? hoursOn(x.hours, +wd) : null;
  const line = (ic, label, v) => v ? `<div class="item t-visit" style="--c:#3a86ff"><div class="ic">${ic}</div><div class="bd"><span class="muted">${label}</span><b>${v}</b></div></div>` : '';
  sheet(`${back}
  ${info?.img ? `<img class="hero" src="${esc(info.img)}" alt="">` : ''}
  <h2>${em} ${esc(x.name)}</h2><p class="muted">${kn} · ⏱️ visita de ~${dur}</p>
  <p>${esc(x.desc || info?.extract || 'Sem descrição disponível no mapa. Use o botão de rota e pergunte na recepção do local!')}</p>
  ${info?.credit ? '<p class="muted">📷 Foto tirada perto do local (Wikimedia Commons) — pode não ser exatamente do lugar.</p>' : ''}
  ${info?.url ? `<p class="muted">Fonte: <a style="color:var(--ac)" target="_blank" href="${esc(info.url)}">Wikipédia</a></p>` : ''}
  <div class="stats"><div class="stat"><b>${fmtKm(x.km)}</b>do centro (reta)</div><div class="stat"><b>~${Math.max(5, Math.round(x.km * 2.2))}'</b>de carro</div><div class="stat"><b>${x.fee === 'no' ? '🆓' : x.fee === 'yes' ? '💲' : '❔'}</b>entrada</div></div>
  ${today && wd != null ? line('📅', 'No dia da sua visita (' + wdName[+wd] + ')', esc(today)) : ''}
  ${line('🕒', 'Horário de funcionamento', esc(hrs) || '')}${!hrs ? '<p class="muted">🕒 Horário não informado no mapa — confirme por telefone/site antes de ir.</p>' : ''}
  ${line('📍', 'Endereço', esc(x.addr))}${line('📞', 'Telefone', x.phone ? `<a style="color:var(--ac)" href="tel:${esc(x.phone)}">${esc(x.phone)}</a>` : '')}
  ${line('🌐', 'Site', x.web ? `<a style="color:var(--ac)" target="_blank" href="${esc(x.web)}">${esc(x.web.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40))}</a>` : '')}
  <div class="row"><a class="btn sec" style="text-align:center;text-decoration:none;color:inherit" target="_blank" href="https://www.google.com/maps/dir/?api=1&destination=${x.lat},${x.lng}">🚗 Rota</a>
  <button class="btn sec" data-act="visitPoi" data-t="${tid}" data-id="${x.id}">✔ Estive aqui</button></div>`);
}

/* ===== Cultos oficiais: Relatório CCB (você consulta; o app só lê o que você leva) ===== */
const REL_URL = 'https://congregacaocristanobrasil.org.br/relatorio';
const BOOKMARKLET = "javascript:(function(){var a=[].slice.call(document.querySelectorAll('.prox-item')).map(function(e){var q=function(s){var x=e.querySelector(s);return x?x.innerText.trim():''};var end=q('.prox-item-endereco').split('\\n');return{nome:q('.prox-item-nome'),endereco:(end[0]||'').trim(),cidade:(end[1]||'').trim(),central:!!e.querySelector('.prox-tag-central'),tel:((e.querySelector('a[href^=\"tel:\"]')||{}).innerText||'').trim(),cultos:[].slice.call(e.querySelectorAll('.prox-cultos li')).map(function(l){return{desc:l.querySelector('span').innerText.trim(),hora:l.querySelector('b').innerText.trim()}})}});if(!a.length){alert('Faça a busca primeiro e depois toque neste atalho.');return}var t=JSON.stringify({pne:1,itens:a});(navigator.clipboard?navigator.clipboard.writeText(t):Promise.reject()).then(function(){alert(a.length+' casas copiadas! Volte ao Pe na Estrada e toque em Colar.')},function(){prompt('Copie este texto:',t)})})();";
const hash = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
function parseRelText(t) { // plano B: texto copiado da página (selecionar tudo + copiar)
  const L = t.split(/\r?\n/).map(s => s.trim()).filter(Boolean), out = []; let cur = null;
  const isKm = s => /^~?\s*[\d.,]+\s*(km|m)$/i.test(s), isCity = s => /\/[A-Z]{2}(\s*·\s*[\d-]+)?$/.test(s), isHora = s => /^\d{1,2}[:h]\d{2}$/.test(s);
  for (let i = 0; i < L.length; i++) {
    const s = L[i];
    if (i + 1 < L.length && isKm(L[i + 1]) && !isKm(s)) { cur = { nome: s, endereco: '', cidade: '', cultos: [], central: false, tel: '' }; out.push(cur); i++; continue; }
    if (!cur) continue;
    if (isCity(s)) cur.cidade = s;
    else if (!cur.cidade && !cur.endereco) cur.endereco = s;
    else if (/^CENTRAL$/i.test(s)) cur.central = true;
    else if (isHora(s) && i > 0) cur.cultos.push({ desc: L[i - 1], hora: s.replace('h', ':') });
  }
  return out.filter(x => x.cidade || x.endereco);
}
async function importRel(raw, tid) {
  let itens = null; try { const j = JSON.parse(raw); if (j && j.pne) itens = j.itens; } catch { }
  if (!itens) itens = parseRelText(raw);
  itens = (itens || []).filter(x => x.nome);
  if (!itens.length) return toast('Não reconheci cultos nesse texto. Use o atalho ou copie a lista de resultados.', 4500);
  sheet(`<h2>📥 Importando cultos…</h2><p class="muted" id="prog">0 / ${Math.min(itens.length, 40)}</p>`);
  let ok = 0, city0 = null;
  for (const [n, it] of itens.slice(0, 40).entries()) {
    const city = (it.cidade || '').replace(/\s*·.*$/, ''), id = 'rel-' + hash(it.nome + it.endereco + city);
    let c = S.churches.find(x => x.id === id);
    const times = (it.cultos || []).map(k => `${k.desc}: ${k.hora}`).join(' · ');
    if (!c) {
      let g = null;
      try { g = (await geocode(`${it.endereco}, ${city.replace('/', ', ')}`))[0]; await sleep(1100); if (!g) { g = (await geocode(city.replace('/', ', '))).at(0); g && (g.approx = true); await sleep(1100); } } catch { }
      if (!g) continue;
      c = { id, name: it.nome + (it.central ? ' (Central)' : ''), lat: g.lat, lng: g.lng, addr: [it.endereco, city].filter(Boolean).join(' — '), tel: it.tel || '', approx: !!g.approx, rel: true };
      S.churches.push(c);
    }
    c.times = times; delete S.times[id]; ok++; city0 ||= city;
    const e = $('#prog'); if (e) e.textContent = `${n + 1} / ${Math.min(itens.length, 40)}`;
  }
  save(); toast(`✅ ${ok} casa(s) de oração com cultos oficiais salvas`);
  if (tid) showTrip(tid); else viewCCB();
}
function viewRel(tid) {
  sheet(`<h2>📥 Colar cultos do Relatório</h2>
  <p class="muted">Depois de pesquisar no site oficial, use o <b>atalho</b> (PC) ou <b>selecione tudo e copie</b> (celular), e cole aqui.</p>
  <button class="btn" style="width:100%" data-act="relClip" data-t="${tid || ''}">📋 Colar da área de transferência</button>
  <label>…ou cole o texto aqui</label><textarea id="relTxt" placeholder="Cole aqui o que você copiou do Relatório"></textarea>
  <button class="btn sec" data-act="relImport" data-t="${tid || ''}">Importar</button>
  <h3>Atalho de 1 toque (computador)</h3>
  <p class="muted">Arraste este botão para a barra de favoritos do navegador. Na página do Relatório, depois da busca, clique nele: ele copia as casas que estão na tela.</p>
  <a id="bmk" class="btn sec" style="display:block;text-align:center" href="#">🔖 Levar p/ Pé na Estrada</a>
  <p class="muted">Dica: toque em "Mostrar mais" na página antes de usar, senão só vão as 20 primeiras.</p>
  <h3>Celular</h3><p class="muted">Na página do Relatório, após a busca: menu do navegador → "Selecionar tudo" → "Copiar". Volte aqui e cole.</p>`);
  const a = $('#bmk'); if (a) a.setAttribute('href', BOOKMARKLET);
}
function relCard(tid, t, i = 0) {
  const dias = t ? [...new Set(daysOf(t).map(d => wdName[d.getDay()].slice(0, 3)))].join(', ') : '';
  return `<div class="item t-ccb"><div class="ic">⛪</div><div class="bd"><b>Cultos oficiais da CCB</b>
  <span class="muted">${t ? `Na busca do Relatório, marque os dias: <b>${dias}</b>` : 'Consulte o Relatório oficial e traga os cultos para o app.'}</span>
  <div class="row" style="margin-top:6px"><button class="btn sm sec" data-act="relOpen" data-t="${tid || ''}" data-i="${i}">🌐 Abrir Relatório</button><button class="btn sm sec" data-act="relPaste" data-t="${tid || ''}">📥 Colar cultos</button></div></div></div>`;
}
function daysOf(t) { const r = []; for (let d = pd(t.start); d <= pd(t.end) && r.length < 31; d.setDate(d.getDate() + 1)) r.push(new Date(d)); return r; }

/* ===== Ações (delegação) ===== */
const act = {
  async photo() { $('#photoInput').click(); },
  addPhoto(d) { draft = { photos: [], addTo: d.id }; $('#photoInput').click(); },
  mCenter() { const c = map.getCenter(); draft.lng = c.lng; draft.lat = c.lat; $('#mPos').textContent = `📌 ${c.lat.toFixed(4)}, ${c.lng.toFixed(4)} (centro do mapa)`; },
  async mSave() {
    const title = $('#mTitle').value.trim() || 'Lugar sem nome';
    const v = { id: uid(), lng: draft.lng, lat: draft.lat, title, cat: $('#mCat').value, note: $('#mNote').value.trim(), date: $('#mDate').value || new Date().toISOString().slice(0, 10) };
    S.visits.push(v); for (const b of draft.photos) await putPhoto(v.id, b);
    draft = null; save(); renderVisitMarkers(); noteStateAt([v.lng, v.lat]); recomputeStates(); toast('Memória salva ✔'); showVisit(v.id);
  },
  open(d) { showVisit(d.id); },
  async delVisit(d) { if (!confirm('Apagar esta memória e as fotos?')) return; S.visits = S.visits.filter(v => v.id !== d.id); await delPhotos(d.id); save(); renderVisitMarkers(); closeSheet(); },
  brasil() { map.flyTo({ ...BR, pitch: 40, bearing: 0, duration: 2200 }); closeSheet(); },
  async tour() {
    closeSheet(); const pts = S.visits.map(v => [v.lng, v.lat]); if (!pts.length) pts.push(BR.center);
    for (const p of pts.slice(-6)) { map.flyTo({ center: p, zoom: 11, pitch: 70, bearing: Math.random() * 120 - 60, duration: 4500 }); await sleep(5200); }
    map.flyTo({ ...BR, pitch: 40, bearing: 0, duration: 3000 });
  },
  goTo(d) { map.flyTo({ center: [+d.lng, +d.lat], zoom: 15, pitch: is3D ? 62 : 0, duration: 1800 }); if (matchMedia('(max-width:800px)').matches) closeSheet(); },
  async ccbNear(d, btn) {
    btn.textContent = 'Buscando…'; const c = lastPos || [map.getCenter().lng, map.getCenter().lat];
    try {
      const list = (await findCCB([c], 12000)).concat(allCustom()).sort((a, b) => hav(c, [a.lng, a.lat]) - hav(c, [b.lng, b.lat]));
      showChurchMarkers(list); $('#ccbList').innerHTML = list.length ? list.slice(0, 25).map(x => churchCard(x, c)).join('') : '<p class="muted">Nenhuma encontrada em 12 km (o mapa pode estar incompleto).</p>';
      list.forEach(x => known[x.id] = x);
    } catch { toast('Busca indisponível. Tente de novo.'); }
    btn.textContent = '🔎 Buscar casas de oração aqui';
  },
  editTimes(d) {
    const c = known[d.id] || S.churches.find(x => x.id === d.id); if (!c) return;
    const v = prompt(`Horários de culto — ${c.name}\nEx.: Seg 19:30, Qua 19:30, Sáb 19:30, Dom 09:00 e 18:30`, chTimes(c));
    if (v === null) return; S.times[c.id] = v.trim(); save(); toast('Horário salvo'); (tabNow === 'ccb' ? viewCCB : () => { })();
  },
  notCcb(d) {
    (S.hidden ||= []).push(d.id); const t = S.trips.find(x => [x.plan?.churches, ...(x.plan?.legs || []).map(l => l.churches)].some(a => a?.some(c => c.id === d.id)));
    if (t) { if (t.plan.churches) t.plan.churches = t.plan.churches.filter(c => c.id !== d.id); (t.plan.legs || []).forEach(l => l.churches = (l.churches || []).filter(c => c.id !== d.id)); }
    save(); toast('Removido da lista 👍'); chMarkers.forEach(m => m.remove()); chMarkers = [];
    if (t && tabNow === 'viagem') showTrip(t.id); else if (tabNow === 'ccb') viewCCB(); else closeSheet();
  },
  visitCh(d) { const c = known[d.id]; if (c) openMark({ lng: c.lng, lat: c.lat, title: c.name, cat: 'ccb' }); },
  visitPoi(d) { const t = S.trips.find(x => x.id === d.t), p = t && allPois(t).find(x => x.id === d.id); if (p) openMark({ lng: p.lng, lat: p.lat, title: p.name, cat: 'sight' }); },
  addChurch() {
    const n = prompt('Nome da casa de oração (ex.: CCB Centro — Gramado/RS):'); if (!n) return;
    const c = map.getCenter(), t = prompt('Horários de culto (opcional):') || '';
    S.churches.push({ id: 'u-' + uid(), name: n, lat: c.lat, lng: c.lng, times: t, addr: '' }); save(); viewCCB();
  },
  addEvent() {
    const t = $('#evT').value.trim(), d = $('#evD').value; if (!t || !d) return toast('Informe nome e data.');
    const c = map.getCenter(); S.events.push({ id: uid(), title: t, date: d, time: $('#evH').value, place: $('#evP').value, lat: c.lat, lng: c.lng }); save(); viewCCB();
  },
  delEvent(d) { S.events = S.events.filter(e => e.id !== d.id); save(); viewCCB(); },
  async tSearch(d) {
    const k = d.k === 'from' ? 'from' : 'dest', box = $(k === 'from' ? '#tPickFrom' : '#tPick');
    const q = $(k === 'from' ? '#tFrom' : '#tDest').value.trim(); if (!q) return; box.innerHTML = '<p class="muted">Buscando…</p>';
    try { const r = await geocode(q); (act._r ||= {})[k] = r; box.innerHTML = r.map((x, i) => `<div class="item" data-act="tPick" data-k="${k}" data-i="${i}"><div class="ic">📍</div><div class="bd">${esc(x.name)}</div></div>`).join('') || '<p class="muted">Nada encontrado.</p>'; }
    catch { box.innerHTML = '<p class="muted">Sem conexão.</p>'; }
  },
  tPick(d) {
    const x = act._r[d.k][+d.i], box = $(d.k === 'from' ? '#tPickFrom' : '#tPick');
    if (d.k === 'from') pickedFrom = x; else pickedDest = x;
    box.innerHTML = `<div class="item t-ok"><div class="ic">✅</div><div class="bd"><b>${esc(x.name)}</b></div></div>`;
  },
  async tGps() {
    toast('Pedindo sua posição…'); const p = await currentPoint();
    if (!p) return toast('GPS não permitido. Busque a cidade de saída pelo nome.', 4500);
    pickedFrom = { name: 'Minha posição', lng: p[0], lat: p[1] }; $('#tPickFrom').innerHTML = '<div class="item t-ok"><div class="ic">✅</div><div class="bd"><b>Minha posição</b></div></div>';
  },
  tAddStop() {
    if (!pickedDest) return toast('Busque e escolha a cidade primeiro.');
    const a = $('#tA').value, b = $('#tB').value; if (!a || !b || b < a) return toast('Confira as datas.');
    draftStops.push({ name: pickedDest.name, lng: pickedDest.lng, lat: pickedDest.lat, start: a, end: b });
    pickedDest = null; $('#tDest').value = ''; $('#tPick').innerHTML = ''; $('#tA').value = b; $('#tB').value = b;
    $('#tStops').innerHTML = stopsHtml(); toast('Parada adicionada. Escolha a próxima cidade.');
  },
  tDelStop(d) { draftStops.splice(+d.i, 1); $('#tStops').innerHTML = stopsHtml(); },
  tPlan: planTrip,
  openTrip(d) { showTrip(d.id); },
  relOpen(d) {
    const t = S.trips.find(x => x.id === d.t), city = t ? (legsOf(t)[+d.i || 0] || legsOf(t)[0]).name.split(',').slice(0, 2).join(',').trim() : '';
    if (city) navigator.clipboard?.writeText(city).then(() => toast(`Cidade copiada: ${city}. Cole no campo de endereço.`, 5000), () => { });
    window.open(REL_URL, '_blank', 'noopener');
  },
  relPaste(d) { viewRel(d.t); },
  async relClip(d) { try { importRel(await navigator.clipboard.readText(), d.t); } catch { toast('Não consegui ler a área de transferência. Cole no campo abaixo.'); } },
  relImport(d) { importRel($('#relTxt').value, d.t); },
  poi(d) { showPoi(d.t, d.id, d.wd); },
  backTrip(d) { showTrip(d.t); },
  delTrip(d) { if (!confirm('Apagar esta viagem?')) return; S.trips = S.trips.filter(t => t.id !== d.id); save(); clearTripLayer(); chMarkers.forEach(m => m.remove()); viewTrips(); },
  export() {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(S)], { type: 'application/json' }));
    a.download = `meu-brasil-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
  },
  import() {
    const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/json';
    i.onchange = async () => { try { Object.assign(S, JSON.parse(await i.files[0].text())); save(); drawTracks(); renderVisitMarkers(); recomputeStates(); updKm(); viewMem(); toast('Backup importado'); } catch { toast('Arquivo inválido'); } }; i.click();
  }
};
document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && act[b.dataset.act]) { e.preventDefault(); act[b.dataset.act](b.dataset, b); } });

/* ===== Início ===== */
updKm();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => { });
setTimeout(viewMap, 600);

/* ===== Tela de entrada ===== */
(() => {
  const t = $('#splTitle'); 'Pé na Estrada'.split('').forEach((ch, i) => { const s = document.createElement('span'); s.textContent = ch === ' ' ? ' ' : ch; s.style.setProperty('--d', (0.9 + i * 0.07) + 's'); t.appendChild(s); });
  const sp = $('#splash'); let gone = false;
  const bye = () => { if (gone) return; gone = true; sp.classList.add('out'); setTimeout(() => sp.remove(), 900); };
  sp.onclick = bye; setTimeout(bye, 3600);
})();
