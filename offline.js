'use strict';
/* ===== Mapas offline: baixa os blocos do mapa da viagem para o cache do aparelho ===== */
const OFF_CACHE = 'pe-tiles';
const offRegions = () => { try { return JSON.parse(localStorage.getItem('mb-offline')) || []; } catch { return []; } };
const offTX = (lng, z) => Math.max(0, Math.min(2 ** z - 1, Math.floor((lng + 180) / 360 * 2 ** z)));
const offTY = (lat, z) => { const r = Math.max(-85, Math.min(85, lat)) * Math.PI / 180; return Math.max(0, Math.min(2 ** z - 1, Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z))); };
function addBox(set, [w, s, e, n], z0, z1) { for (let z = z0; z <= z1; z++) { const x0 = offTX(w, z), x1 = offTX(e, z), y0 = offTY(n, z), y1 = offTY(s, z); for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) set.add(`${z}/${x}/${y}`); } }
function addCorridor(set, coords, z0, z1) {
  const dense = densify(coords, 5);
  for (let z = z0; z <= z1; z++) { const r = z <= 7 ? 0 : 1, N = 2 ** z; for (const { p } of dense) { const x = offTX(p[0], z), y = offTY(p[1], z); for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (x + dx >= 0 && y + dy >= 0 && x + dx < N && y + dy < N) set.add(`${z}/${x + dx}/${y + dy}`); } }
}
const boxAround = (p, km) => { const d = km / 111, dl = d / Math.cos(p[1] * Math.PI / 180); return [p[0] - dl, p[1] - d, p[0] + dl, p[1] + d]; };
function tripTiles(t) {
  const set = new Set(), legs = legsOf(t);
  addBox(set, [-74, -34, -34, 6], 0, 6); // Brasil inteiro, bem de longe
  if (t.plan?.route) addCorridor(set, t.plan.route.coords, 7, 10);
  legs.forEach(l => addBox(set, boxAround([l.lng, l.lat], 12), 7, 14));
  if (t.from) addBox(set, boxAround([t.from.lng, t.from.lat], 8), 7, 13);
  return set;
}
async function vectorTemplates() {
  const st = map.getStyle(), out = [];
  for (const s of Object.values(st.sources)) {
    if (s.type !== 'vector') continue;
    if (s.tiles) { out.push(s.tiles[0]); continue; }
    if (s.url) { const r = await fetch(s.url); const j = await r.clone().json(); (await caches.open(OFF_CACHE)).put(s.url, r); out.push(j.tiles[0]); }
  }
  return out;
}
async function downloadTiles(name, set) {
  if (!('caches' in window)) return toast('Este navegador não guarda mapas offline.');
  const cache = await caches.open(OFF_CACHE), st = map.getStyle();
  // estilo, ícones e fontes (pequenos)
  const extra = [];
  try { const sty = map.style?.stylesheet; extra.push('https://tiles.openfreemap.org/styles/liberty'); } catch { }
  if (st.sprite) ['.json', '.png', '@2x.json', '@2x.png'].forEach(x => extra.push(st.sprite + x));
  if (st.glyphs) {
    const stacks = new Set(); st.layers.forEach(l => { let f = l.layout?.['text-font']; if (Array.isArray(f)) { if (f[0] === 'literal') f = f[1]; if (f.every?.(x => typeof x === 'string')) stacks.add(f.join(',')); } });
    stacks.forEach(s => ['0-255', '256-511'].forEach(r => extra.push(st.glyphs.replace('{fontstack}', s).replace('{range}', r))));
  }
  const tpls = await vectorTemplates();
  const urls = [...extra]; tpls.forEach(tp => set.forEach(k => { const [z, x, y] = k.split('/'); urls.push(tp.replace('{z}', z).replace('{x}', x).replace('{y}', y)); }));
  let done = 0, bytes = 0, fail = 0, i = 0, stop = false; act._offStop = () => { stop = true; };
  const upd = () => { const e = $('#offProg'); if (e) { e.textContent = `${done} / ${urls.length} blocos (${(bytes / 1048576).toFixed(1)} MB)${fail ? ' · ' + fail + ' falhas' : ''}`; const b = $('#offBar'); if (b) b.style.width = (done / urls.length * 100) + '%'; } };
  const worker = async () => {
    while (i < urls.length && !stop) {
      const u = urls[i++];
      try { if (!(await cache.match(u))) { const r = await fetch(u); if (r.ok) { bytes += (+r.headers.get('content-length')) || 30000; await cache.put(u, r); } else if (r.status !== 404) fail++; } } catch { fail++; }
      done++; if (done % 5 === 0) upd();
    }
  };
  await Promise.all([0, 1, 2, 3, 4, 5].map(worker)); upd();
  const regs = offRegions(); regs.push({ name, tiles: urls.length, at: Date.now() }); localStorage.setItem('mb-offline', JSON.stringify(regs.slice(-30)));
  return { stopped: stop, fail };
}
async function offlineFor(tid) {
  const t = S.trips.find(x => x.id === tid); if (!t) return;
  const set = tripTiles(t), est = Math.round(set.size * 0.03);
  if (set.size > 7000) return toast('Região grande demais. Escolha uma viagem menor.', 5000);
  if (!confirm(`Baixar o mapa de "${tripTitle(t)}" para usar sem internet?\n\n≈ ${set.size} blocos · ~${est} MB de armazenamento.\nUse Wi-Fi se possível.`)) return;
  sheet(`<h2>📴 Baixando o mapa…</h2><p class="muted">Deixe esta tela aberta.</p><div class="pbar"><i id="offBar" style="width:0%"></i><span id="offProg">Preparando…</span></div><button class="btn sec" data-act="offStop">⏹️ Parar</button>`);
  try { const r = await downloadTiles(tripTitle(t), set); toast(r?.stopped ? 'Download interrompido.' : '✅ Mapa offline salvo!', 5000); } catch (e) { toast('Falha no download. Verifique a internet.', 5000); }
  showTrip(tid);
}
async function offlineView() {
  const [w, s, e, n] = map.getBounds().toArray().flat(), set = new Set(), z = Math.min(12, Math.max(8, Math.floor(map.getZoom())));
  addBox(set, [w, s, e, n], Math.max(4, z - 3), Math.min(14, z + 2));
  if (set.size > 6000) return toast('Área grande demais: aproxime o mapa e tente de novo.', 5000);
  if (!confirm(`Baixar a área visível na tela (≈ ${set.size} blocos, ~${Math.round(set.size * 0.03)} MB)?`)) return;
  sheet(`<h2>📴 Baixando o mapa…</h2><div class="pbar"><i id="offBar" style="width:0%"></i><span id="offProg">Preparando…</span></div><button class="btn sec" data-act="offStop">⏹️ Parar</button>`);
  try { await downloadTiles('Área do mapa', set); toast('✅ Mapa offline salvo!'); } catch { toast('Falha no download.'); }
  viewOffline();
}
async function viewOffline() {
  let usage = ''; try { const e = await navigator.storage.estimate(); usage = `${(e.usage / 1048576).toFixed(0)} MB usados de ${(e.quota / 1048576).toFixed(0)} MB`; } catch { }
  const regs = offRegions();
  sheet(`<button class="btn sec sm" data-act="backMap">‹ Voltar</button><h2>📴 Mapas offline</h2>
  <p class="muted">Guarde o mapa antes de sair para onde não tem sinal. Dentro de uma viagem há o botão “Baixar mapa offline”. A busca de cidades, clima e igrejas continua precisando de internet — mas o que já foi montado no roteiro fica salvo.</p>
  ${regs.map(r => `<div class="item t-ok"><div class="ic">📴</div><div class="bd"><b>${esc(r.name)}</b><span class="muted">${r.tiles} blocos · ${new Date(r.at).toLocaleDateString('pt-BR')}</span></div></div>`).join('') || '<p class="muted">Nenhum mapa baixado ainda.</p>'}
  <p class="muted">${usage}</p>
  <div class="row"><button class="btn sec" data-act="offView">⬇️ Baixar área da tela</button><button class="btn sec" data-act="offClear">🗑️ Apagar tudo</button></div>
  ${navigator.serviceWorker?.controller ? '' : '<p class="muted">⚠️ O modo offline só funciona quando o app é aberto por https (GitHub Pages) ou localhost.</p>'}`);
}
Object.assign(act, {
  offline(d) { offlineFor(d.t); }, offView: offlineView, offlineMgr: viewOffline,
  offStop() { act._offStop?.(); },
  async offClear() { if (!confirm('Apagar todos os mapas offline deste aparelho?')) return; await caches.delete(OFF_CACHE); localStorage.removeItem('mb-offline'); toast('Mapas offline apagados'); viewOffline(); }
});
