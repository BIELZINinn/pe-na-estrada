'use strict';
/* ===== Backup em arquivo + nuvem (Google Drive, pasta privada do app) ===== */
const blobToB64 = blob => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
const allPhotos = () => tx('readonly', s => s.getAll());
async function buildPhotos() { return Promise.all((await allPhotos()).map(async p => ({ vid: p.vid, d: await blobToB64(p.blob) }))); }
async function restorePhotos(list) {
  const blobs = await Promise.all((list || []).map(async p => ({ vid: p.vid, blob: await (await fetch(p.d)).blob() })));
  await tx('readwrite', s => { s.clear(); blobs.forEach(b => s.add(b)); });
}
async function applyData(data) {
  for (const k of Object.keys(S)) delete S[k];
  Object.assign(S, { visits: [], tracks: [], trips: [], churches: [], times: {}, events: [], ufs: [], badges: {}, remind: { lead: 60, trips: {}, done: {} } }, data);
  S.badges ||= {}; S.remind ||= { lead: 60, trips: {}, done: {} };
  try { localStorage.setItem('mb', JSON.stringify(S)); } catch { }
  drawTracks(); renderVisitMarkers(); recomputeStates(); updKm();
}

/* ---------- Arquivo ---------- */
const markBackup = () => { try { localStorage.setItem('mb-lastbackup', Date.now()); } catch { } };
async function makeBackup() {
  const o = { app: 'pe-na-estrada', v: 2, at: Date.now(), S, photos: await buildPhotos() };
  return new File([JSON.stringify(o)], `pe-na-estrada-backup-${isoToday()}.json`, { type: 'application/json' });
}
async function exportFile() {
  toast('Preparando o arquivo…');
  const f = await makeBackup(); download(f.name, f); markBackup();
  toast('Backup salvo ✅ (guarde o arquivo em local seguro)');
}
async function shareBackup() {
  toast('Preparando o backup…');
  const f = await makeBackup();
  try {
    if (navigator.canShare?.({ files: [f] })) { await navigator.share({ files: [f], title: 'Backup Pé na Estrada', text: 'Backup do app Pé na Estrada' }); markBackup(); toast('Backup enviado ✅'); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  download(f.name, f); markBackup(); toast('Seu navegador não abre o compartilhar. O arquivo foi baixado ✅', 5000);
}
function backupNag() {
  try {
    if (!(S.visits.length || S.trips.length)) return;
    const last = +localStorage.getItem('mb-lastbackup') || 0, snooze = +localStorage.getItem('mb-nagsnooze') || 0, now = Date.now();
    if (!last) { localStorage.setItem('mb-lastbackup', now); return; } // primeira vez: começa a contar hoje
    if (now - last < 7 * 864e5 || now < snooze) return;
    const b = document.createElement('div'); b.id = 'nag';
    b.style.cssText = 'position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top,0px) + 64px);z-index:50;background:#fff7dc;border:3px solid #3a2a1a;border-radius:16px;padding:10px 12px;box-shadow:0 4px 0 #3a2a1a;font:600 14px Fredoka,sans-serif;color:#3a2a1a;display:flex;gap:8px;align-items:center';
    b.innerHTML = '<span style="flex:1">💾 Faz mais de 7 dias sem backup. Quer enviar agora?</span><button class="btn sm" id="nagY">Enviar</button><button class="btn sec sm" id="nagN">Depois</button>';
    document.body.appendChild(b);
    $('#nagY').onclick = () => { b.remove(); shareBackup(); };
    $('#nagN').onclick = () => { localStorage.setItem('mb-nagsnooze', Date.now() + 864e5); b.remove(); };
  } catch { }
}
setTimeout(backupNag, 6000);
function importFile() {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'application/json,.json';
  i.onchange = async () => {
    try {
      const o = JSON.parse(await i.files[0].text()), data = o.S || o;
      if (!data || !Array.isArray(data.visits)) throw 0;
      if (!confirm(`Substituir os dados deste aparelho pelo backup (${data.visits.length} lugares, ${(data.trips || []).length} viagens, ${(o.photos || []).length} fotos)?`)) return;
      await applyData(data); if (o.photos) await restorePhotos(o.photos);
      toast('Backup restaurado ✅'); viewCloud();
    } catch { toast('Arquivo inválido.'); }
  };
  i.click();
}

/* ---------- Google Drive ---------- */
const SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.appdata';
const drv = (() => { try { return JSON.parse(localStorage.getItem('mb-drive')) || {}; } catch { return {}; } })();
const drvSave = () => { try { localStorage.setItem('mb-drive', JSON.stringify(drv)); } catch { } };
const gClientId = () => (localStorage.getItem('mb-gcid') || window.PNE_GOOGLE_CLIENT_ID || '').trim();
let gTok = null, gExp = 0, gsiP = null, syncing = false;
const loadGsi = () => gsiP ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.onload = res; s.onerror = () => { gsiP = null; rej(new Error('gsi')); }; document.head.appendChild(s); });
async function getToken(interactive) {
  if (gTok && Date.now() < gExp - 60000) return gTok;
  await loadGsi();
  return new Promise((res, rej) => {
    const tc = google.accounts.oauth2.initTokenClient({
      client_id: gClientId(), scope: SCOPE, hint: drv.email || undefined,
      callback: r => { if (r.error) return rej(new Error(r.error)); gTok = r.access_token; gExp = Date.now() + (+r.expires_in || 3600) * 1000; res(gTok); },
      error_callback: e => rej(new Error(e.type || 'popup'))
    });
    tc.requestAccessToken({ prompt: interactive ? (drv.email ? '' : 'select_account') : 'none' });
  });
}
async function gfetch(url, opts = {}, retry = true) {
  const tk = await getToken(false), r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + tk } });
  if (r.status === 401 && retry) { gTok = null; return gfetch(url, opts, false); }
  if (!r.ok) throw new Error('drive ' + r.status);
  return r;
}
const dFind = async name => (await (await gfetch(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name,modifiedTime)&q=${encodeURIComponent(`name='${name}'`)}`)).json()).files[0];
async function dPut(name, obj) {
  const f = await dFind(name), body = JSON.stringify(obj);
  if (f) return gfetch(`https://www.googleapis.com/upload/drive/v3/files/${f.id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
  const bd = 'pne' + uid(), meta = { name, parents: ['appDataFolder'], mimeType: 'application/json' };
  return gfetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${bd}` }, body: `--${bd}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${bd}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${bd}--` });
}
const dGet = async name => { const f = await dFind(name); return f ? (await gfetch(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`)).json() : null; };

async function driveConnect() {
  if (!gClientId()) return toast('Cole primeiro o ID do cliente Google.');
  try {
    await getToken(true);
    const u = await (await gfetch('https://www.googleapis.com/oauth2/v3/userinfo')).json();
    drv.email = u.email; drv.name = u.name; drv.auto = drv.auto ?? true; drvSave();
    toast(`Conectado como ${u.email} ✅`); await driveReconcile(); viewCloud();
  } catch (e) { toast('Não consegui entrar no Google (' + (e.message || 'erro') + '). Confira o ID do cliente e a origem autorizada.', 6000); }
}
async function driveReconcile() { // compara a nuvem com este aparelho
  const remote = await dGet('pe-dados.json'), localAt = S.updated || 0;
  if (!remote) { await driveUpload(true); return; }
  if (remote.at > localAt + 2000) {
    if (confirm(`Há um backup MAIS NOVO no seu Google Drive (${new Date(remote.at).toLocaleString('pt-BR')}). Restaurar neste aparelho?\n\nOK = restaurar do Drive\nCancelar = manter este aparelho (nada é sobrescrito até você escolher)`)) await driveRestore(remote);
    else { drv.hold = true; drvSave(); }
  } else { drv.hold = false; await driveUpload(false); }
}
async function driveUpload(withPhotos) {
  if (syncing) return; syncing = true;
  try {
    await dPut('pe-dados.json', { app: 'pe-na-estrada', at: S.updated || Date.now(), S });
    const n = await countPhotos();
    if (withPhotos || n !== drv.ph) { await dPut('pe-fotos.json', { photos: await buildPhotos() }); drv.ph = n; }
    drv.last = Date.now(); drv.hold = false; drvSave();
  } finally { syncing = false; }
}
async function driveRestore(remote) {
  remote ||= await dGet('pe-dados.json'); if (!remote) return toast('Nenhum backup no Drive ainda.');
  await applyData(remote.S);
  const ph = await dGet('pe-fotos.json'); if (ph?.photos) await restorePhotos(ph.photos);
  drv.ph = await countPhotos(); drv.last = Date.now(); drv.hold = false; drvSave(); toast('Restaurado do Google Drive ✅');
}
let syncT = null;
window.addEventListener('mb-saved', () => {
  if (!drv.email || drv.auto === false || drv.hold || !gTok) return;
  clearTimeout(syncT); syncT = setTimeout(() => driveUpload(false).catch(() => { }), 20000);
});
if (drv.email && gClientId()) setTimeout(async () => { try { await getToken(false); await driveReconcile(); } catch { /* precisa tocar em Entrar */ } }, 3500);

function viewCloud() {
  const cid = gClientId(), on = !!drv.email;
  sheet(`<button class="btn sec sm" data-act="backMap">‹ Voltar</button><h2>☁️ Backup e nuvem</h2>
  <h3>💾 Backup simples</h3><p class="muted">Salva tudo (lugares, viagens e fotos) em um arquivo. Toque em <b>Enviar backup</b> e escolha WhatsApp, Drive, Telegram ou e-mail: mande para você mesmo. Para trocar de celular, abra o arquivo aqui em <b>Restaurar</b>.</p>
  <button class="btn" style="width:100%" data-act="shareBk">📤 Enviar backup</button>
  <div class="row"><button class="btn sec" data-act="export">⬇️ Baixar arquivo</button><button class="btn sec" data-act="import">⬆️ Restaurar arquivo</button></div>
  <p class="muted">Último backup: ${+localStorage.getItem('mb-lastbackup') ? new Date(+localStorage.getItem('mb-lastbackup')).toLocaleString('pt-BR') : 'nenhum ainda'}. O app avisa a cada 7 dias.</p>
  <button class="btn sec" style="width:100%;margin:8px 0" data-act="upd">🔄 Procurar atualização do app</button>
  <details${on || cid ? ' open' : ''}><summary><b>⚙️ Avançado: login automático com Google Drive</b></summary>
  ${on ? `<div class="item t-ok"><div class="ic">✅</div><div class="bd"><b>${esc(drv.email)}</b><span class="muted">${drv.last ? 'Último envio: ' + new Date(drv.last).toLocaleString('pt-BR') : 'Ainda sem envio'}${drv.hold ? ' · ⏸️ envio pausado: há um backup mais novo na nuvem' : ''}</span></div></div>
  <div class="row"><button class="btn" data-act="gdUp">⬆️ Salvar agora</button><button class="btn sec" data-act="gdDown">⬇️ Restaurar</button></div>
  <div class="row"><button class="btn sec" data-act="gdAuto">${drv.auto === false ? '🔕 Auto: desligado' : '🔄 Auto: ligado'}</button><button class="btn sec" data-act="gdIn">🔑 Entrar de novo</button></div>
  <button class="btn sec" style="width:100%" data-act="gdOut">Sair da conta</button>
  <p class="muted">Seus dados ficam numa pasta privada do app no seu Drive (ninguém mais vê, nem aparece nos seus arquivos). Fotos só são reenviadas quando você adiciona novas.</p>`
      : cid ? `<p class="muted">Entre com sua conta Google para guardar tudo na nuvem e recuperar em qualquer celular.</p><button class="btn" style="width:100%" data-act="gdIn">🔑 Entrar com Google</button>
  <button class="btn sec sm" style="margin-top:8px" data-act="gdId">Trocar ID do cliente</button>`
        : `<p class="muted">Falta uma configuração única (leva ~5 min), porque o Google exige um <b>ID de cliente</b> do seu próprio projeto:</p>
  <ol class="muted" style="padding-left:18px;margin:6px 0">
  <li>Abra <b>console.cloud.google.com</b> e crie um projeto.</li>
  <li>Em <b>APIs e serviços → Biblioteca</b>, ative a <b>Google Drive API</b>.</li>
  <li>Em <b>Tela de permissão OAuth</b>: tipo Externo; adicione seu e-mail como usuário de teste.</li>
  <li>Em <b>Credenciais → Criar → ID do cliente OAuth → Aplicativo da Web</b>. Em <b>Origens JavaScript autorizadas</b> coloque:<br><b>${esc(location.origin)}</b></li>
  <li>Copie o ID (termina em .apps.googleusercontent.com) e cole abaixo.</li></ol>
  <input id="gcid" placeholder="123456-abc.apps.googleusercontent.com"><button class="btn" style="width:100%" data-act="gdId">Salvar ID</button>`}
  ${location.protocol === 'file:' ? '<p class="muted">⚠️ Abra o app por https (GitHub Pages) para o login do Google funcionar.</p>' : ''}</details>`);
}
Object.assign(act, {
  cloud: viewCloud, export: exportFile, import: importFile, shareBk: shareBackup,
  gdId() { const v = ($('#gcid')?.value || prompt('Cole o ID do cliente Google:') || '').trim(); if (!v) return; if (!/\.apps\.googleusercontent\.com$/.test(v)) return toast('Esse ID não parece certo (termina em .apps.googleusercontent.com).', 5000); localStorage.setItem('mb-gcid', v); toast('ID salvo ✅'); viewCloud(); },
  gdIn: driveConnect,
  async gdUp() { toast('Enviando…'); try { await getToken(true); await driveUpload(true); toast('Salvo no Google Drive ✅'); viewCloud(); } catch (e) { toast('Falha ao enviar: ' + (e.message || 'erro'), 5000); } },
  async gdDown() { if (!confirm('Substituir os dados deste aparelho pelo backup do Drive?')) return; try { await getToken(true); await driveRestore(); viewCloud(); } catch (e) { toast('Falha ao restaurar: ' + (e.message || 'erro'), 5000); } },
  gdAuto() { drv.auto = drv.auto === false; drvSave(); viewCloud(); },
  gdOut() { try { if (gTok) google.accounts.oauth2.revoke(gTok); } catch { } gTok = null; localStorage.removeItem('mb-drive'); for (const k of Object.keys(drv)) delete drv[k]; toast('Desconectado do Google'); viewCloud(); }
});
