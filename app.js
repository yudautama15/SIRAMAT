// ===== Survei Material PLN – logika aplikasi =====
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const TYPES = { jaringan: 'Titik jaringan', pelanggan: 'Pelanggan', label: 'Teks/arah', jalan: 'Jalan' };

let G = loadSettings();
let S = null;              // survei aktif
let selected = null;       // id titik terpilih
let editing = null;        // id titik yang sedang diedit
let gpsFix = null, gpsHist = [], follow = false, watchId = null;
let map = null;

function loadSettings() {
  try { return Object.assign({ kop: 'PT PLN (PERSERO)\nUID SUMATERA UTARA\nUP3 NIAS', toleransi: 0, bulat: 1, surveyor: '', digambar: '', diketahui: '', disetujui: '', logo: '' }, JSON.parse(localStorage.getItem('survei-settings') || '{}')); }
  catch { return {}; }
}
function saveSettings() { localStorage.setItem('survei-settings', JSON.stringify(G)); }
function toast(m, ms = 2200) { const t = $('#toast'); t.textContent = m; t.style.display = 'block'; clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', ms); }
let saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => { S.updated = Date.now(); DB.putSurvey(S); }, 250); }
const P = id => S.points.find(p => p.id === id);

// ================= BERANDA =================
async function showHome() {
  stopGPS(); S = null;
  $('#scSurvey').classList.remove('on'); $('#scHome').classList.add('on');
  const list = (await DB.allSurveys()).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  $('#surveyList').innerHTML = list.length ? list.map(s => `
    <div class="card">
      <h3>${esc(s.judul || '(tanpa judul)')}</h3>
      <div class="mut">${s.points.length} titik · ${fmtTgl(s.tglSurvey)} · ${esc(s.surveyor || '')}</div>
      <div class="row" style="margin-top:8px">
        <button class="btn pri sm" data-open="${s.id}">Buka</button>
        <button class="btn sm" data-exp="${s.id}">Ekspor</button>
        <button class="btn sm" data-dup="${s.id}">Duplikat</button>
        <span class="grow"></span>
        <button class="btn sm red" data-del="${s.id}">Hapus</button>
      </div>
    </div>`).join('') : '<div class="empty">Belum ada survei.<br>Tekan <b>+ Survei baru</b> untuk mulai.</div>';
}
$('#surveyList').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.open) openSurvey(await DB.getSurvey(b.dataset.open));
  if (b.dataset.exp) exportSurvey(await DB.getSurvey(b.dataset.exp));
  if (b.dataset.dup) {
    const s = await DB.getSurvey(b.dataset.dup); const c = JSON.parse(JSON.stringify(s));
    c.id = uid(); c.judul = (c.judul || '') + ' (salinan)'; c.updated = Date.now();
    c.points.forEach(p => p.photos = []); await DB.putSurvey(c); showHome();
  }
  if (b.dataset.del) {
    const s = await DB.getSurvey(b.dataset.del);
    if (!confirm(`Hapus survei "${s.judul || '(tanpa judul)'}" beserta ${s.points.length} titik dan fotonya? Tindakan ini tidak bisa dibatalkan.`)) return;
    for (const p of s.points) for (const f of p.photos || []) await DB.delPhoto(f);
    await DB.delSurvey(s.id); showHome();
  }
});
$('#btnNew').onclick = async () => {
  const s = {
    id: uid(), created: Date.now(), updated: Date.now(), judul: 'GAMBAR RENCANA ', program: 'PENJEMPUTAN PELANGGAN', penyulang: '',
    surveyor: G.surveyor, digambar: G.digambar, diketahui: G.diketahui, disetujui: G.disetujui,
    tglSurvey: today(), tglGambar: today(), tglDiketahui: today(), tglDisetujui: today(),
    settings: { kop: G.kop, toleransi: G.toleransi, bulat: G.bulat }, points: [], material: {}, materialExtra: {}, uraian: {},
  };
  await DB.putSurvey(s); openSurvey(s); switchTab('tabData');
};
$('#btnImport').onclick = () => $('#fileImport').click();
$('#fileImport').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const sv = data.survey; if (!sv || !sv.points) throw new Error('format');
    const exists = await DB.getSurvey(sv.id);
    if (exists && !confirm('Survei ini sudah ada di HP. Timpa dengan data dari file?')) return;
    for (const [id, d] of Object.entries(data.photos || {})) await DB.putPhoto({ id, blob: dataURLToBlob(d) });
    await DB.putSurvey(sv); toast('Survei berhasil diimpor'); showHome();
  } catch { toast('File tidak dikenali sebagai cadangan survei'); }
};
async function exportSurvey(s) {
  const photos = {};
  for (const p of s.points) for (const f of p.photos || []) { const r = await DB.getPhoto(f); if (r) photos[f] = await blobToDataURL(r.blob); }
  const blob = new Blob([JSON.stringify({ app: 'survei-pln', v: 1, survey: s, photos })], { type: 'application/json' });
  shareOrDownload(blob, safeName(s.judul) + '.json');
}
const safeName = s => (s || 'survei').replace(/[^\w\- ]+/g, '').trim().slice(0, 60).replace(/\s+/g, '_') || 'survei';
async function shareOrDownload(blob, name, preferShare) {
  const file = new File([blob], name, { type: blob.type });
  if (preferShare && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}

// ================= PENGATURAN =================
$('#btnSettings').onclick = () => {
  $('#setSheet').innerHTML = `
    <h2>Pengaturan</h2>
    <label class="f">Kop unit (3 baris, tampil di kolom judul)</label>
    <textarea class="i" id="stKop" rows="3">${esc(G.kop)}</textarea>
    <label class="f">Logo (opsional, untuk kolom judul PDF)</label>
    <div class="row">${G.logo ? `<img src="${G.logo}" style="height:42px;border:1px solid #ddd;border-radius:6px">` : '<span class="mut">Belum ada logo</span>'}
      <button class="btn sm" id="stLogo">Pilih gambar</button>${G.logo ? '<button class="btn sm red" id="stLogoDel">Hapus</button>' : ''}</div>
    <div class="grid2">
      <div><label class="f">Toleransi panjang kabel (%)</label><input class="i" id="stTol" type="number" value="${G.toleransi}"></div>
      <div><label class="f">Pembulatan kabel (m)</label><input class="i" id="stBul" type="number" value="${G.bulat}"></div>
    </div>
    <p class="mut">Nilai di atas jadi bawaan untuk survei baru.</p>
    <div class="grid2">
      <div><label class="f">Nama surveyor</label><input class="i" id="stSur" value="${esc(G.surveyor)}"></div>
      <div><label class="f">Digambar oleh</label><input class="i" id="stGam" value="${esc(G.digambar)}"></div>
      <div><label class="f">Diketahui oleh</label><input class="i" id="stKet" value="${esc(G.diketahui)}"></div>
      <div><label class="f">Disetujui oleh</label><input class="i" id="stSet" value="${esc(G.disetujui)}"></div>
    </div>
    <div class="row" style="margin-top:14px"><span class="grow"></span><button class="btn pri" id="stSave">Simpan</button></div>`;
  $('#mdSettings').classList.add('on');
  $('#stLogo').onclick = () => $('#fileLogo').click();
  if ($('#stLogoDel')) $('#stLogoDel').onclick = () => { G.logo = ''; saveSettings(); $('#btnSettings').click(); };
  $('#stSave').onclick = () => {
    Object.assign(G, { kop: $('#stKop').value, toleransi: +$('#stTol').value || 0, bulat: +$('#stBul').value || 1,
      surveyor: $('#stSur').value, digambar: $('#stGam').value, diketahui: $('#stKet').value, disetujui: $('#stSet').value });
    saveSettings(); $('#mdSettings').classList.remove('on'); toast('Pengaturan disimpan');
  };
};
$('#fileLogo').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const bmp = await createImageBitmap(f); const s = Math.min(1, 300 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = bmp.width * s; c.height = bmp.height * s;
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); G.logo = c.toDataURL('image/png'); saveSettings(); $('#btnSettings').click();
};
document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('on'); }));

// ================= SURVEI =================
function openSurvey(s) {
  S = s; S.points ||= []; S.points.forEach(migratePoint); S.points.forEach(p => migrateMatKeys(p, S.materialExtra)); for (const k of Object.keys(S.material || {})) if (!CAT[k] && !(k in (S.materialExtra || {}))) delete S.material[k]; if (S.lastType === 'tiang' || S.lastType === 'gardu') S.lastType = 'jaringan'; S.material ||= {}; S.materialExtra ||= {}; S.uraian ||= {}; S.settings ||= {};
  selected = null;
  $('#scHome').classList.remove('on'); $('#scSurvey').classList.add('on');
  $('#svTitle').textContent = S.judul || 'Survei';
  if (!map) map = new SurveyMap($('#map'), { label: mapLabel, onTapPoint: id => { selected = id; refreshMap(); }, onTapEmpty: () => { selected = null; refreshMap(); } });
  switchTab('tabMap');
  setTimeout(() => { map.resize(); if (!map.fit(S.points) && gpsFix) map.setView(gpsFix.lat, gpsFix.lng, 18); refreshMap(); }, 50);
  startGPS();
}
$('#btnBack').onclick = () => showHome();
$('#tabs').onclick = e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.t); };
function switchTab(t) {
  document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  document.querySelectorAll('#scSurvey .tab').forEach(x => x.classList.toggle('on', x.id === t));
  if (t === 'tabMap') { map && map.resize(); refreshMap(); }
  if (t === 'tabPoints') renderPoints();
  if (t === 'tabMat') renderMaterial();
  if (t === 'tabData') renderData();
  if (t === 'tabPdf') renderPdfTab();
}

// ---------- GPS ----------
function startGPS() {
  if (!navigator.geolocation) { setGpsChip(null, 'GPS tidak tersedia'); return; }
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(pos => {
    gpsFix = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy, t: Date.now() };
    gpsHist.push(gpsFix); gpsHist = gpsHist.filter(f => Date.now() - f.t < 15000);
    setGpsChip(gpsFix.acc);
    if (follow && map) map.setView(gpsFix.lat, gpsFix.lng);
    if (map) map.gps = gpsFix, map.draw();
    if (lockState) updateLock();
  }, err => setGpsChip(null, err.code === 1 ? 'Izin lokasi ditolak' : 'Mencari GPS…'),
  { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
}
function stopGPS() { if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null; }
function accColor(a) { return a == null ? '#999' : a <= 5 ? '#1f9d55' : a <= 15 ? '#d08a00' : '#d62828'; }
function setGpsChip(acc, msg) {
  $('#gpsChip').innerHTML = `<span class="dot" style="background:${accColor(acc)}"></span>${acc != null ? 'GPS ±' + Math.round(acc) + ' m' : esc(msg || 'GPS…')}`;
}

// ---------- peta ----------
function refreshMap() {
  if (!map || !S) return;
  map.setData(S.points, selected, gpsFix);
  const par = defaultParent(S.lastType === 'jalan' ? 'jalan' : 'jaringan');
  $('#parentChip').style.display = S.points.length ? 'block' : 'none';
  $('#parentChip').textContent = par ? `Titik berikutnya tersambung ke: ${pointName(P(par))}` : 'Titik berikutnya: titik awal (tanpa induk)';
  const sc = $('#selCard'); const p = selected && P(selected);
  if (!p) { sc.classList.remove('on'); return; }
  const par2 = p.parent && P(p.parent);
  sc.innerHTML = `<div class="row"><b class="grow">${esc(pointName(p))} · ${esc(describe(p))}</b><button class="btn sm" id="scClose">✕</button></div>
    <div class="mut">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} (±${Math.round(p.acc || 0)} m)${par2 ? ` · dari ${esc(pointName(par2))}: ${haversine(par2, p).toFixed(1)} m` : ''} · ${(p.photos || []).length} foto</div>
    <div class="row" style="margin-top:8px"><button class="btn pri sm" id="scEdit">Ubah / foto</button>
    <span class="mut grow">Titik berikutnya akan tersambung ke titik ini</span></div>`;
  sc.classList.add('on');
  $('#scClose').onclick = () => { selected = null; refreshMap(); };
  $('#scEdit').onclick = () => openEditor(p.id);
}
function pointName(p) {
  if (!p) return '';
  if (p.type === 'jaringan') { const i = pointInfo(p); return hasTiang(i) ? 'Tiang ' + (p.no || '') : hasGardu(i) ? (p.kode || 'Gardu ' + (p.no || '')) : 'Titik ' + (p.no || ''); }
  return p.type === 'pelanggan' ? (p.nama || 'Pelanggan') : p.type === 'label' ? '"' + (p.teks || '').split('\n')[0] + '"' : 'Titik jalan';
}
function describe(p) {
  if (!isNet(p)) return TYPES[p.type] || '';
  const i = pointInfo(p), e = [];
  if (i.tiangEks) e.push('tiang eks ' + i.tiangEks);
  if (i.garduEks) e.push('gardu eks ' + (i.garduEks.daya || '') + ' kVA');
  const m = Object.keys(p.mat || {}).map(k => (k.startsWith('BONGKAR') ? 'bongkar ' : '') + keyName(k));
  return [...m, ...e].join(', ') || 'belum ada material';
}
function mapLabel(p) {
  if (p.type === 'jaringan') { const i = pointInfo(p); return hasTiang(i) ? 'T' + (p.no || '') : hasGardu(i) ? (p.kode || 'G') : ''; }
  return p.type === 'pelanggan' ? (p.nama || 'Pelanggan') : p.type === 'label' ? (p.teks || '').split('\n')[0] : '';
}
$('#fabFollow').onclick = () => { follow = !follow; $('#fabFollow').classList.toggle('on', follow); if (follow && gpsFix) map.setView(gpsFix.lat, gpsFix.lng, Math.max(map.z, 18)); };
$('#fabFit').onclick = () => { if (!map.fit(S.points)) toast('Belum ada titik'); };
$('#fabLayer').onclick = () => { map.setLayer(map.layer === 'osm' ? 'sat' : 'osm'); toast(map.layer === 'osm' ? 'Peta jalan (OSM)' : 'Citra satelit'); };

// ---------- TAG ----------
let lockState = null;
$('#btnTag').onclick = () => {
  if (!gpsFix || Date.now() - gpsFix.t > 30000) { toast('GPS belum siap. Tunggu sebentar, atau pakai "+ Tengah peta".', 3500); return; }
  lockState = { start: Date.now() }; $('#lockOv').classList.add('on'); updateLock();
  lockState.timer = setInterval(updateLock, 400);
};
function bestFix() {
  const win = gpsHist.filter(f => f.t >= (lockState ? lockState.start - 1500 : 0));
  return (win.length ? win : [gpsFix]).reduce((a, b) => (b.acc < a.acc ? b : a));
}
function updateLock() {
  if (!lockState) return;
  const b = bestFix(); $('#lockAcc').textContent = '±' + Math.round(b.acc) + ' m'; $('#lockAcc').style.color = accColor(b.acc);
  const el = (Date.now() - lockState.start) / 1000;
  $('#lockHint').textContent = b.acc <= 5 ? 'Akurasi bagus' : b.acc <= 15 ? 'Akurasi cukup – tunggu atau simpan' : 'Akurasi rendah (bawah pohon/bangunan?)';
  if ((b.acc <= 4 && el > 1.2) || (el > 4 && b.acc <= 10)) finishLock();
}
function finishLock() {
  if (!lockState) return; const b = bestFix(); clearInterval(lockState.timer); lockState = null;
  $('#lockOv').classList.remove('on'); addPoint(b.lat, b.lng, b.acc, 'gps');
}
$('#lockNow').onclick = finishLock;
$('#lockCancel').onclick = () => { clearInterval(lockState.timer); lockState = null; $('#lockOv').classList.remove('on'); };
$('#btnTagCenter').onclick = () => { const c = map.toLatLng(map.w / 2, map.h / 2); addPoint(c.lat, c.lng, null, 'manual'); };

function defaultParent(type, exclude) {
  if (type === 'label') return null;
  const ok = q => q.id !== exclude && (type === 'jalan' ? q.type === 'jalan' : q.type === 'jaringan');
  if (selected && P(selected) && selected !== exclude) {
    const s = P(selected);
    if (type === 'jalan' ? s.type === 'jalan' : isNet(s)) return s.id;
  }
  for (let i = S.points.length - 1; i >= 0; i--) if (ok(S.points[i])) return S.points[i].id;
  return null;
}
function nextNo() { const ns = S.points.filter(p => p.type === 'jaringan').map(p => parseInt(p.no) || 0); return String(ns.length ? Math.max(...ns) + 1 : 1); }
const COPY_GROUPS = ['TIANG', 'KABEL', 'KONSTRUKSI'];
function addPoint(lat, lng, acc, src) {
  const type = S.lastType || 'jaringan';
  const p = { id: uid(), type, lat, lng, acc, src, time: Date.now(), photos: [], mat: {}, eks: { jar: [], hantar: {} } };
  let copied = false;
  if (type === 'jaringan') {
    p.no = nextNo();
    const last = [...S.points].reverse().find(q => q.type === 'jaringan');
    if (last) {
      for (const [k, v] of Object.entries(last.mat || {})) {
        const [sec, grp] = k.split('|');
        if ((sec === 'HUTM' || sec === 'HUTR') && COPY_GROUPS.includes(grp)) { p.mat[k] = grp === 'KABEL' ? 'auto' : v; copied = true; }
      }
      p.eks.jar = asArr((last.eks || {}).jar);
    }
  }
  if (type === 'label') p.teks = 'ARAH ';
  p.parent = defaultParent(type);
  S.points.push(p); selected = p.id; save(); refreshMap();
  toast(`${pointName(p)} tersimpan${acc != null ? ' (±' + Math.round(acc) + ' m)' : ' (posisi tengah peta)'}${copied ? ' · material disalin dari titik sebelumnya' : ''}`, 3000);
  openEditor(p.id, true);
}

// ---------- EDITOR TITIK ----------
function opt(list, v) { return list.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(lab)}</option>`; }).join(''); }
function multiChips(name, list, v, suf = '') { const a = asArr(v); return `<div class="chips" data-multi="${name}">${list.map(x => `<button type="button" class="chip ${a.includes(x) ? 'on' : ''}" data-v="${esc(x)}">${esc(x + suf)}</button>`).join('')}</div>`; }
function chips(name, list, v) { return `<div class="chips" data-chips="${name}">${list.map(([val, lab]) => `<button type="button" class="chip ${String(v) === String(val) ? 'on' : ''}" data-v="${esc(val)}">${esc(lab)}</button>`).join('')}</div>`; }
const edOpen = new Set();
function autoLenText(p, key) {
  const L = segLen(S, p); if (!L) return 'butuh induk';
  if (key.startsWith('BONGKAR')) return Math.round(L) + ' m';
  const st = S.settings || {}, tol = +(st.toleransi ?? 0), b = +(st.bulat ?? 1) || 1;
  return Math.ceil(L * (1 + tol / 100) / b) * b + ' m';
}
function materialPicker(p) {
  const m = p.mat || {}; const cat = catalog(S);
  const sel = Object.entries(m);
  let h = `<div class="selbox">${sel.length ? sel.map(([k, v]) => `<span class="selchip">${k.startsWith('BONGKAR') ? 'Bongkar ' : ''}${esc(keyName(k))}${isKabel(k) ? ' · ' + (v === 'auto' ? autoLenText(p, k) : v + ' m') : +v > 1 ? ' ×' + v : ''}<button data-unsel="${esc(k)}">✕</button></span>`).join('')
    : '<span class="mut">Belum ada material. Ketuk kelompok di bawah untuk memilih (boleh lebih dari satu).</span>'}</div>`;
  h += '<div class="acc">';
  for (const s of cat) {
    const nS = sel.filter(([k]) => k.startsWith(s.key + '|')).length, oS = edOpen.has(s.key);
    h += `<div class="acch" data-ed="${s.key}" style="background:${s.color}">${oS ? '▾' : '▸'} ${s.title}<span>${nS ? nS + ' dipilih' : ''}</span></div>`;
    if (!oS) continue;
    s.groups.forEach((g, gi) => {
      const gk = s.key + '|' + g.t, nG = sel.filter(([k]) => k.startsWith(gk + '|')).length, oG = edOpen.has(gk);
      h += `<div class="accg" data-ed="${esc(gk)}">${oG ? '▾' : '▸'} ${gi + 1}. ${esc(g.t)}<span>${nG ? nG + ' dipilih' : ''}</span></div>`;
      if (!oG) return;
      for (const r of g.rows) {
        const on = r.key in m, v = m[r.key];
        const kab = g.t === 'KABEL';
        const q = !on ? `<span class="mut">${r.unit}</span>` : kab
          ? `<input class="q" data-q="${esc(r.key)}" inputmode="decimal" value="${v === 'auto' ? '' : esc(v)}" placeholder="${esc(autoLenText(p, r.key))}"><span class="mut">m</span>`
          : `<input class="q" data-q="${esc(r.key)}" inputmode="decimal" value="${esc(v)}"><span class="mut">${r.unit}</span>`;
        h += `<div class="mi ${on ? 'on' : ''}" data-mi="${esc(r.key)}"><span class="ck">${on ? '✓' : ''}</span><span class="grow">${esc(r.name)}${r.note ? `<br><small class="mut">${esc(r.note)}</small>` : ''}</span>${q}</div>`;
      }
    });
  }
  return h + '</div>';
}
function section(key, title, body) {
  const o = edOpen.has(key);
  return `<div class="acch plain" data-ed="${key}">${o ? '▾' : '▸'} ${title}</div>${o ? `<div class="accbody">${body}</div>` : ''}`;
}
async function openEditor(id, fresh) {
  editing = id; const p = P(id); if (!p) return;
  const sc = $('#ptSheet').scrollTop;
  p.mat ||= {}; p.eks ||= { jar: [], hantar: {} };
  const others = S.points.filter(q => q.id !== id && (p.type === 'jalan' ? q.type === 'jalan' : isNet(q)));
  const q = p.parent && P(p.parent);
  const info = pointInfo(p);
  let h = `<div class="row"><h2 class="grow">${fresh ? 'Titik baru: ' : ''}${esc(pointName(p))}</h2>
    ${p.type !== 'label' && p.type !== 'jalan' ? `<button class="btn sm" data-act="photo">📷 Foto${(p.photos || []).length ? ' (' + p.photos.length + ')' : ''}</button>` : ''}
    <button class="btn pri sm" data-act="close">Selesai</button></div>
    <div class="mut">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} ${p.acc != null ? '(±' + Math.round(p.acc) + ' m)' : '(manual)'}${q ? ` · ${haversine(q, p).toFixed(1)} m dari ${esc(pointName(q))}` : ''}</div>
    <div style="margin:8px 0">${chips('type', Object.entries(TYPES), p.type)}</div>`;
  if (isNet(p)) {
    h += `<label class="f" style="font-weight:700;color:var(--tx)">Material di titik ini</label>` + materialPicker(p);
    let eks = '';
    if (p.type === 'jaringan') {
      eks += `<label class="f">Tiang eksisting</label>${chips('eks.tiang', [['', 'Tidak ada'], ['beton', 'Beton'], ['besi', 'Besi'], ['kayu', 'Kayu']], p.eks.tiang || '')}
        <label style="display:block;margin-top:8px"><input type="checkbox" data-k="eks.gardu" ${p.eks.gardu ? 'checked' : ''}> Ada gardu eksisting</label>
        ${p.eks.gardu ? `<label class="f">Daya gardu eksisting (kVA)</label>${chips('eks.dayaGardu', [25, 50, 100, 160, 200, 250].map(d => [String(d), d]), p.eks.dayaGardu || '')}` : ''}`;
    }
    eks += `<label class="f">Jaringan eksisting dari ${q ? esc(pointName(q)) : 'induk'}</label>${multiChips('eks.jar', ['TM', 'TR'], p.eks.jar)}
      <p class="mut">Jika ruas ini dipilih kabel baru, garis tergambar sebagai rencana. Kabel lama yang diganti, pilih di Pembongkaran › Kabel.</p>`;
    h += section('ed.eks', 'Kondisi eksisting', eks);
    let det = '';
    if (p.type === 'jaringan') det += `<div class="grid2"><div><label class="f">No. tiang / titik</label><input class="i" data-k="no" value="${esc(p.no)}"></div>
      ${hasGardu(info) ? `<div><label class="f">Kode gardu</label><input class="i" data-k="kode" value="${esc(p.kode)}" placeholder="TH 10"></div>` : '<div></div>'}</div>
      ${hasTiang(info) && !info.tiangBaru ? `<label style="display:block;margin-top:8px"><input type="checkbox" data-k="showBubble" ${p.showBubble ? 'checked' : ''}> Tampilkan label nomor tiang di gambar</label>` : ''}`;
    if (p.type === 'pelanggan') det += `<div class="grid2"><div><label class="f">Nama / ID pelanggan</label><input class="i" data-k="nama" value="${esc(p.nama)}"></div>
      <div><label class="f">Daya mohon (VA)</label><input class="i" data-k="dayaMohon" value="${esc(p.dayaMohon)}"></div></div>`;
    det += `<label class="f">Tersambung dari (induk)</label><select class="i" data-k="parent">${opt([['', '– titik awal / tidak tersambung –'], ...others.map(o => [o.id, pointName(o)])], p.parent || '')}</select>
      <label class="f">Catatan rencana (tampil di gambar dengan panah)</label>
      <textarea class="i" data-k="ket" placeholder="mis. RENCANA UPRATING TRAFO 50 KVA MENJADI 100 KVA">${esc(p.ket)}</textarea>
      <label style="display:block;margin-top:8px"><input type="checkbox" data-k="showKoord" ${p.showKoord ? 'checked' : ''}> Tampilkan titik koordinat di gambar</label>`;
    h += section('ed.det', `Detail titik${p.ket ? ' · ada catatan' : ''}`, det);
    h += `<div class="thumbs" id="thumbs"></div>`;
  } else if (p.type === 'label') {
    h += `<label class="f">Teks pada gambar (contoh: ARAH GUNUNGSITOLI)</label><textarea class="i" data-k="teks">${esc(p.teks)}</textarea>`;
  } else {
    h += `<p class="mut">Titik jalan disambung jadi garis jalan pada gambar. Tag di ujung-ujung dan belokan jalan. Untuk jalan dari peta otomatis, pakai tombol di tab PDF.</p>
      <label class="f">Nama jalan</label><input class="i" data-k="nama" value="${esc(p.nama)}" placeholder="mis. JL. DIPONEGORO">
      <label class="f">Tersambung dari</label><select class="i" data-k="parent">${opt([['', '– awal jalan –'], ...others.map(o => [o.id, pointName(o)])], p.parent || '')}</select>`;
  }
  h += `<div class="row" style="margin-top:14px"><button class="btn red" data-act="del">Hapus titik</button><span class="grow"></span>
    <button class="btn" data-act="move">Pindah ke posisi GPS</button><button class="btn pri" data-act="close">Selesai</button></div>`;
  $('#ptSheet').innerHTML = h; $('#mdPoint').classList.add('on'); $('#ptSheet').scrollTop = sc;
  const th = $('#thumbs');
  if (th) for (const f of p.photos || []) {
    const r = await DB.getPhoto(f); if (!r) continue;
    const d = document.createElement('div'); d.className = 't';
    d.innerHTML = `<img src="${URL.createObjectURL(r.blob)}"><button class="x" data-delphoto="${f}">✕</button>`;
    th.appendChild(d);
  }
}
function setK(p, k, v) { if (k.startsWith('eks.')) p.eks[k.slice(4)] = v; else p[k] = v; }
function changed(p) { save(); refreshMap(); openEditor(p.id); }
$('#ptSheet').addEventListener('click', async e => {
  const p = P(editing); if (!p) return;
  if (e.target.closest('input,select,textarea')) return;
  const ed = e.target.closest('[data-ed]');
  if (ed) { const k = ed.dataset.ed; edOpen.has(k) ? edOpen.delete(k) : edOpen.add(k); openEditor(p.id); return; }
  const un = e.target.closest('[data-unsel]');
  if (un) { delete p.mat[un.dataset.unsel]; changed(p); return; }
  const mi = e.target.closest('[data-mi]');
  if (mi) {
    const k = mi.dataset.mi;
    if (k in p.mat) delete p.mat[k];
    else {
      p.mat[k] = isKabel(k) ? 'auto' : 1;
      if (k.startsWith('GARDU|') && !p.kode) edOpen.add('ed.det');
    }
    changed(p); return;
  }
  const mc = e.target.closest('[data-multi] .chip');
  if (mc) {
    const k = mc.parentElement.dataset.multi, v = mc.dataset.v;
    const arr = asArr(k.startsWith('eks.') ? p.eks[k.slice(4)] : p[k]);
    setK(p, k, arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]); changed(p); return;
  }
  const chip = e.target.closest('[data-chips] .chip');
  if (chip) {
    const k = chip.parentElement.dataset.chips, v = chip.dataset.v;
    if (k === 'type') {
      if (v === p.type) return;
      p.type = v; S.lastType = v;
      if (v === 'jaringan' && !p.no) p.no = nextNo();
      if (v === 'label') { p.parent = null; p.teks ||= 'ARAH '; }
      else if (!p.parent || (v === 'jalan') !== ((P(p.parent) || {}).type === 'jalan')) p.parent = defaultParent(v, p.id);
    } else setK(p, k, v);
    changed(p); return;
  }
  const b = e.target.closest('[data-act],[data-delphoto]'); if (!b) return;
  if (b.dataset.delphoto) {
    if (!confirm('Hapus foto ini?')) return;
    p.photos = p.photos.filter(x => x !== b.dataset.delphoto); await DB.delPhoto(b.dataset.delphoto); save(); openEditor(p.id); return;
  }
  const act = b.dataset.act;
  if (act === 'close') { $('#mdPoint').classList.remove('on'); refreshMap(); if ($('#tabPoints').classList.contains('on')) renderPoints(); }
  if (act === 'photo') $('#filePhoto').click();
  if (act === 'move') {
    if (!gpsFix) return toast('GPS belum siap');
    if (!confirm(`Pindahkan ${pointName(p)} ke posisi GPS sekarang (±${Math.round(gpsFix.acc)} m)?`)) return;
    Object.assign(p, { lat: gpsFix.lat, lng: gpsFix.lng, acc: gpsFix.acc, src: 'gps' }); changed(p);
  }
  if (act === 'del') {
    const kids = S.points.filter(q => q.parent === p.id);
    if (!confirm(`Hapus ${pointName(p)}?${kids.length ? ` ${kids.length} titik yang tersambung ke titik ini akan disambungkan ke induknya.` : ''}`)) return;
    kids.forEach(q => q.parent = p.parent || null);
    for (const f of p.photos || []) await DB.delPhoto(f);
    S.points = S.points.filter(q => q.id !== p.id); selected = null; save();
    $('#mdPoint').classList.remove('on'); refreshMap(); if ($('#tabPoints').classList.contains('on')) renderPoints();
  }
});
$('#ptSheet').addEventListener('change', e => {
  const p = P(editing); if (!p) return; const t = e.target;
  if (t.dataset.q) {
    const k = t.dataset.q, v = t.value.trim().replace(',', '.');
    p.mat[k] = isKabel(k) ? (v === '' ? 'auto' : +v || 'auto') : (+v > 0 ? +v : 1);
    changed(p); return;
  }
  const k = t.dataset.k; if (!k) return;
  let v = t.type === 'checkbox' ? t.checked : t.value;
  if (k === 'parent') { v = v || null; if (v && createsCycle(p.id, v)) { toast('Tidak bisa: sambungan melingkar'); openEditor(p.id); return; } }
  setK(p, k, v); save(); refreshMap();
  if (['parent', 'eks.gardu', 'showBubble'].includes(k)) openEditor(p.id);
});
function createsCycle(id, parent) { let c = parent, n = 0; while (c && n++ < 999) { if (c === id) return true; c = (P(c) || {}).parent; } return false; }

// ---------- foto: kompres + cap teks ----------
$('#filePhoto').onchange = async e => {
  const f = e.target.files[0]; e.target.value = ''; const p = P(editing); if (!f || !p) return;
  toast('Memproses foto…');
  try {
    const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
    const s = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    const x = c.getContext('2d'); x.drawImage(bmp, 0, 0, c.width, c.height);
    const fs = Math.max(16, Math.round(c.width / 42));
    const lines = [`${pointName(p)} – ${describe(p)}`, `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}${p.acc != null ? ' (±' + Math.round(p.acc) + ' m)' : ''}`,
      new Date().toLocaleString('id-ID'), (S.judul || '').slice(0, 70)];
    const bh = lines.length * fs * 1.3 + fs * 0.6;
    x.fillStyle = 'rgba(0,0,0,.55)'; x.fillRect(0, c.height - bh, c.width, bh);
    x.fillStyle = '#fff'; x.font = `bold ${fs}px sans-serif`; x.textBaseline = 'top';
    lines.forEach((l, i) => x.fillText(l, fs * 0.5, c.height - bh + fs * 0.3 + i * fs * 1.3));
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8));
    const id = uid(); await DB.putPhoto({ id, blob, point: p.id });
    p.photos = [...(p.photos || []), id]; save(); openEditor(p.id); toast('Foto tersimpan');
  } catch (err) { toast('Gagal memproses foto'); }
};

// ================= DAFTAR TITIK =================
function renderPoints() {
  const pts = S.points;
  $('#pointList').innerHTML = pts.length ? pts.map(p => {
    const q = p.parent && P(p.parent);
    const nM = Object.keys(p.mat || {}).length;
    const pill = isNet(p) ? (nM ? `<span class="pill ren">${nM} material</span>` : '<span class="pill eks">eksisting</span>') : '';
    const sp = q && isNet(p) ? netLines(p).filter(l => l.net !== '-').map(l => `<span class="pill ${l.status === 'eks' ? 'eks' : l.status === 'rencana' ? 'ren' : 'gan'}">${l.net === 'TM' ? 'JTM' : 'JTR'} ${l.status}</span>`).join(' ') + ` ${haversine(q, p).toFixed(1)} m dari ${esc(pointName(q))}` : '';
    const code = p.type === 'jaringan' ? (mapLabel(p) || 'T' + (p.no || '')) : (TYPES[p.type] || '').slice(0, 4);
    return `<div class="card listpt" data-id="${p.id}"><div class="no">${esc(code)}</div>
      <div class="grow"><b>${esc(pointName(p))}</b> ${pill}<div class="mut">${esc(describe(p))} · ${(p.photos || []).length} foto</div><div class="mut">${sp}</div></div>
      <button class="btn sm" data-loc="${p.id}">Peta</button></div>`;
  }).join('') : '<div class="empty">Belum ada titik. Buka tab Peta lalu tekan TAG TITIK.</div>';
}
$('#pointList').addEventListener('click', e => {
  const loc = e.target.closest('[data-loc]');
  if (loc) { const p = P(loc.dataset.loc); selected = p.id; switchTab('tabMap'); map.setView(p.lat, p.lng, Math.max(map.z, 18)); refreshMap(); return; }
  const c = e.target.closest('[data-id]'); if (c) openEditor(c.dataset.id);
});

// ================= MATERIAL =================
const matOpen = new Set();
function renderMaterial() {
  const m = computeMaterial(S); const st = S.settings;
  let h = `<div class="card"><div class="grid2">
      <div><label class="f">Tambahan kabel (%)</label><input class="i" id="mTol" type="number" value="${st.toleransi ?? 0}"></div>
      <div><label class="f">Pembulatan kabel (m)</label><input class="i" id="mBul" type="number" value="${st.bulat ?? 1}"></div></div>
      <p class="mut">Total dari material yang dipilih di setiap titik. Nama dan susunan mengikuti FORMAT RAB UNTUK KR. Kabel otomatis = panjang jalur dari titik induk (andongan & ×3 phasa AAAC sudah dihitung di RAB); isi Tambahan kabel bila perlu cadangan. Ketik angka di kolom <b>Pakai</b> untuk mengganti; kosongkan untuk kembali ke otomatis.</p>
      ${Object.entries(m.len).map(([k, v]) => `<div class="mut">Ukur ${esc(k)}: ${v.toFixed(1)} m</div>`).join('')}
      ${m.warn.map(w => `<div style="color:var(--warn);font-size:13px">⚠ ${esc(w)}</div>`).join('')}</div>
    <div class="card" style="padding:0;overflow:hidden"><table class="m"><tr><th>Material <span class="mut" style="font-weight:400">(ketuk untuk buka)</span></th><th>Otomatis</th><th>Pakai</th><th></th></tr>`;
  const filled = rows => rows.filter(r => r.qty !== '' && r.qty != null && +r.qty !== 0).length;
  for (const s of m.sections) {
    const allRows = s.groups.flatMap(g => g.rows), nS = filled(allRows), openS = matOpen.has(s.key);
    h += `<tr data-tog="${s.key}" style="cursor:pointer"><th class="sec" colspan="4" style="background:${s.color};padding:11px 8px">
      ${openS ? '▾' : '▸'} ${s.title}<span style="float:right;font-weight:600">${nS ? nS + ' terisi' : ''}</span></th></tr>`;
    if (!openS) continue;
    s.groups.forEach((g, gi) => {
      const gk = s.key + '|' + g.t, nG = filled(g.rows), openG = matOpen.has(gk);
      h += `<tr data-tog="${esc(gk)}" style="cursor:pointer"><td colspan="4" style="background:#f4f5f7;font-weight:700;font-size:13px;padding:10px 8px 10px 18px">
        ${openG ? '▾' : '▸'} ${gi + 1}. ${esc(g.t)}<span style="float:right;color:var(--pri)">${nG ? nG + ' terisi' : ''}</span></td></tr>`;
      if (!openG) return;
      for (const r of g.rows) h += `<tr><td style="padding-left:30px">${esc(r.name)}${r.extra ? ' <span class="pill gan">tambahan</span>' : ''}</td><td class="mut">${r.auto || '–'} ${r.auto ? r.unit : ''}</td>
        <td><input inputmode="decimal" data-mat="${esc(r.key)}" value="${esc((S.material || {})[r.key] ?? '')}" placeholder="${r.auto || ''}"></td><td class="mut">${r.unit}</td></tr>`;
    });
  }
  const grpOpts = MAT_SECTIONS.flatMap(s => s.groups.map(g => [`${s.key}|${g.t}`, `${s.title} › ${g.t}`]));
  h += `</table></div>
    <div class="card"><b>Tambah baris material lain</b>
      <label class="f">Masuk ke</label><select class="i" id="exSec">${opt(grpOpts, 'HUTR|KONSTRUKSI')}</select>
      <div class="grid2"><div><label class="f">Nama material</label><input class="i" id="exName" placeholder="nama persis seperti di RAB"></div>
      <div><label class="f">Satuan</label><select class="i" id="exUnit">${opt(['Unit', 'Btg', 'Mtr', 'Set', 'Bh', 'Tiang', 'Plgn'], 'Unit')}</select></div></div>
      <button class="btn" id="exAdd" style="margin-top:8px">Tambah</button></div>`;
  $('#matView').innerHTML = h;
  $('#mTol').onchange = e => { S.settings.toleransi = +e.target.value || 0; save(); renderMaterial(); };
  $('#mBul').onchange = e => { S.settings.bulat = +e.target.value || 1; save(); renderMaterial(); };
  $('#exAdd').onclick = () => {
    const n = $('#exName').value.trim(); if (!n) return toast('Isi nama material');
    S.materialExtra[$('#exSec').value + '|' + n] = $('#exUnit').value; save(); renderMaterial();
  };
  $('#matView').querySelectorAll('[data-tog]').forEach(tr => tr.onclick = () => {
    const k = tr.dataset.tog; matOpen.has(k) ? matOpen.delete(k) : matOpen.add(k); renderMaterial();
  });
  $('#matView').querySelectorAll('[data-mat]').forEach(inp => inp.onchange = () => {
    const k = inp.dataset.mat; if (inp.value === '') delete S.material[k]; else S.material[k] = inp.value;
    if (inp.value === '' && S.materialExtra[k] && !computeMaterial(S).sections.some(s => s.groups.some(g => g.rows.some(r => r.key === k && r.auto)))) {
      if (confirm('Hapus baris tambahan ini?')) delete S.materialExtra[k];
    }
    save(); renderMaterial();
  });
}

// ================= DATA SURVEI =================
function renderData() {
  const f = (k, lab, type = 'text') => `<div><label class="f">${lab}</label><input class="i" data-sv="${k}" type="${type}" value="${esc(S[k] ?? '')}"></div>`;
  const auto = uraianAuto(S);
  let h = `<div class="card"><label class="f">Judul gambar</label><textarea class="i" data-sv="judul" rows="3">${esc(S.judul)}</textarea>
    <div class="grid2">${f('program', 'Program / basket')}${f('penyulang', 'Kode penyulang')}</div></div>
    <div class="card"><div class="grid2">
      ${f('surveyor', 'Disurvey')}${f('tglSurvey', 'Tanggal', 'date')}
      ${f('digambar', 'Digambar')}${f('tglGambar', 'Tanggal', 'date')}
      ${f('diketahui', 'Diketahui')}${f('tglDiketahui', 'Tanggal', 'date')}
      ${f('disetujui', 'Disetujui')}${f('tglDisetujui', 'Tanggal', 'date')}</div></div>
    <div class="card" style="padding:8px"><b style="padding:4px">Tabel uraian (sebelum / sesudah)</b>
    <p class="mut" style="margin:4px">Kolom abu-abu terisi otomatis dari tagging. Ketik untuk mengganti.</p>
    <table class="m u"><tr><th>Uraian</th><th>Sebelum<br>eks</th><th>Sesudah<br>eks</th><th>Sesudah<br>baru</th></tr>`;
  for (const [k, lab] of URAIAN_ROWS) {
    if (k === '#') { h += `<tr><th class="sec" colspan="4" style="background:#dce6f1">${lab}</th></tr>`; continue; }
    const v = S.uraian[k] || {}, a = auto[k] || {};
    h += `<tr><td>${lab}</td>${['seb', 'eks', 'baru'].map(c => `<td><input data-ur="${k}|${c}" value="${esc(v[c] ?? '')}" placeholder="${esc(a[c] ?? '')}"></td>`).join('')}</tr>`;
  }
  h += `</table></div>`;
  $('#dataView').innerHTML = h;
}
$('#dataView').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.sv) { S[t.dataset.sv] = t.value; if (t.dataset.sv === 'judul') $('#svTitle').textContent = t.value || 'Survei'; save(); }
  if (t.dataset.ur) { const [k, c] = t.dataset.ur.split('|'); S.uraian[k] ||= {}; S.uraian[k][c] = t.value; save(); }
});

// ================= PDF =================
let pv = null, pvHits = [], drag = null, logoImg = null;
function loadLogo() {
  return new Promise(r => { if (!G.logo) return r(null); const im = new Image(); im.onload = () => r(im); im.onerror = () => r(null); im.src = G.logo; });
}
async function renderPdfTab() {
  const nPhoto = S.points.reduce((a, p) => a + (p.photos || []).length, 0);
  $('#pdfView').innerHTML = `
    <div class="row" style="margin-bottom:8px">
      <button class="btn pri" id="pdfMake">Buat PDF</button>
      <button class="btn" id="pdfShare">Bagikan</button>
      <label class="mut"><input type="checkbox" id="pdfPhotos" ${nPhoto ? 'checked' : ''}> Lampiran foto (${nPhoto})</label>
      <span class="grow"></span><button class="btn sm" id="pdfZoom">Perbesar</button><button class="btn sm" id="pdfReset">Reset posisi</button>
    </div>
    <div class="card" style="padding:10px">
      <div class="row"><b class="grow">Jalan pada gambar</b>
        <label class="mut"><input type="checkbox" id="rdShow" ${S.showRoads !== false ? 'checked' : ''}> Tampilkan</label></div>
      <div class="mut" id="rdInfo">${roadInfo()}</div>
      <div class="row" style="margin-top:8px"><button class="btn sm pri" id="rdFetch">Ambil jalan dari peta</button>
        ${(S.roads || []).length ? '<button class="btn sm red" id="rdClear">Hapus jalan peta</button>' : ''}</div>
      <div id="rdNames"></div>
    </div>
    <div id="pvWrap" style="overflow:auto;max-height:70vh;border-radius:6px"><canvas id="pv"></canvas></div>
    <p class="mut">Pratinjau. Geser tiang, trafo, skur, grounding, label, teks koordinat, atau catatan dengan jari. Garis kabel tetap di tempatnya; posisi GPS asli tidak berubah.</p>
    <div id="pvWarn"></div>`;
  pv = $('#pv'); logoImg = await loadLogo();
  drawPreview();
  pv.onpointerdown = e => {
    const r = pv.getBoundingClientRect(), k = PAGE.w / r.width;
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const order = ['lbl', 'glbl', 'koord', 'note', 'skur', 'span', 'ground', 'gardu', 'sym'];
    const hit = [...pvHits].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
      .find(h => x >= h.x - 4 && x <= h.x + h.w + 4 && y >= h.y - 4 && y <= h.y + h.h + 4);
    if (!hit || !hit.f) return;
    pv.setPointerCapture(e.pointerId);
    drag = { p: P(hit.id), f: hit.f, v0: [...hit.v], x0: x, y0: y, k };
  };
  pv.onpointermove = e => {
    if (!drag) return; const r = pv.getBoundingClientRect();
    const x = (e.clientX - r.left) * drag.k, y = (e.clientY - r.top) * drag.k;
    drag.p[drag.f[0]] = drag.v0[0] + (x - drag.x0); drag.p[drag.f[1]] = drag.v0[1] + (y - drag.y0);
    drawPreview();
  };
  pv.onpointerup = pv.onpointercancel = () => { if (drag) { drag = null; save(); } };
  $('#pdfReset').onclick = () => {
    if (!confirm('Kembalikan semua posisi simbol, label dan catatan ke posisi otomatis?')) return;
    S.points.forEach(p => ['ox', 'oy', 'lx', 'ly', 'gx', 'gy', 'gdx', 'gdy', 'skx', 'sky', 'spx', 'spy', 'grx', 'gry', 'kx', 'ky', 'nx', 'ny'].forEach(k => delete p[k])); save(); drawPreview();
  };
  $('#pdfZoom').onclick = () => {
    const big = pv.style.width !== '280%'; pv.style.width = big ? '280%' : '100%';
    $('#pdfZoom').textContent = big ? 'Perkecil' : 'Perbesar'; drawPreview();
    if (big) { const w = $('#pvWrap'); w.scrollLeft = w.scrollWidth * 0.3; }
  };
  $('#rdShow').onchange = e => { S.showRoads = e.target.checked; save(); drawPreview(); };
  $('#rdFetch').onclick = fetchRoads;
  if ($('#rdClear')) $('#rdClear').onclick = () => { if (!confirm('Hapus semua jalan hasil ambil dari peta?')) return; S.roads = []; save(); renderPdfTab(); };
  renderRoadNames();
  $('#pdfMake').onclick = () => makePdf(false);
  $('#pdfShare').onclick = () => makePdf(true);
}
function roadInfo() {
  const r = S.roads || [], man = S.points.filter(p => p.type === 'jalan').length;
  const names = [...new Set(r.map(x => x.name).filter(Boolean))];
  return (r.length ? `${r.length} ruas jalan dari peta OpenStreetMap${names.length ? ' · ' + names.length + ' bernama' : ''}. ` : 'Belum ada jalan dari peta. ')
    + (man ? `${man} titik jalan manual.` : 'Bisa juga tag titik jenis "Jalan" untuk jalan yang tidak ada di peta.');
}
function renderRoadNames() {
  const names = [...new Set((S.roads || []).map(x => x.name).filter(Boolean))];
  $('#rdNames').innerHTML = names.length ? `<label class="f">Nama jalan (bisa diubah)</label>` + names.map(n =>
    `<input class="i" style="margin-bottom:6px" data-road="${esc(n)}" value="${esc(n)}">`).join('') : '';
  $('#rdNames').querySelectorAll('[data-road]').forEach(inp => inp.onchange = () => {
    const old = inp.dataset.road; S.roads.forEach(r => { if (r.name === old) r.name = inp.value.trim(); });
    save(); renderRoadNames(); drawPreview();
  });
}
async function fetchRoads() {
  const pts = S.points.filter(p => p.lat != null && p.type !== 'label');
  if (!pts.length) return toast('Belum ada titik survei');
  if (!navigator.onLine) return toast('Perlu internet untuk mengambil jalan dari peta');
  const m = 0.003;
  const s = Math.min(...pts.map(p => p.lat)) - m, n = Math.max(...pts.map(p => p.lat)) + m;
  const w = Math.min(...pts.map(p => p.lng)) - m, e = Math.max(...pts.map(p => p.lng)) + m;
  const q = `[out:json][timeout:25];way["highway"]["highway"!~"footway|path|steps|cycleway|pedestrian|corridor|bridleway|proposed|construction|elevator"](${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)});out geom tags;`;
  toast('Mengambil jalan dari peta…', 15000);
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    S.roads = (j.elements || []).filter(x => x.type === 'way' && x.geometry).map(x => ({
      name: (x.tags && x.tags.name) || '', type: x.tags && x.tags.highway,
      major: /trunk|primary|secondary|tertiary/.test((x.tags && x.tags.highway) || ''),
      pts: x.geometry.map(g => [+g.lat.toFixed(6), +g.lon.toFixed(6)]) }));
    S.showRoads = true; save();
    toast(S.roads.length ? `${S.roads.length} ruas jalan ditambahkan` : 'Tidak ada data jalan di sekitar lokasi – pakai titik Jalan manual', 4000);
    renderPdfTab();
  } catch (err) { toast('Gagal mengambil jalan (server peta sibuk/tidak ada internet). Coba lagi.', 4000); }
}
function drawPreview() {
  const r = pv.getBoundingClientRect(); const d = window.devicePixelRatio || 1;
  const w = Math.max(300, r.width); const k = w / PAGE.w * d;
  pv.width = PAGE.w * k; pv.height = PAGE.h * k; pv.style.height = (PAGE.h * w / PAGE.w) + 'px';
  const ctx = pv.getContext('2d'); ctx.setTransform(k, 0, 0, k, 0, 0);
  const res = renderSheet(ctx, S, { logo: logoImg }); pvHits = res.hits;
  $('#pvWarn').innerHTML = res.warn.map(w => `<div style="color:var(--warn);font-size:13px">⚠ ${esc(w)}</div>`).join('');
}
async function makePdf(share) {
  toast('Membuat PDF…', 6000);
  await new Promise(r => setTimeout(r, 30));
  const K = 2.6; const cv = document.createElement('canvas'); cv.width = Math.round(PAGE.w * K); cv.height = Math.round(PAGE.h * K);
  const ctx = cv.getContext('2d'); ctx.setTransform(K, 0, 0, K, 0, 0);
  renderSheet(ctx, S, { logo: logoImg });
  const pages = [await canvasToJpeg(cv, 0.92)];
  if ($('#pdfPhotos') && $('#pdfPhotos').checked) {
    const items = [];
    for (const p of S.points) for (const f of p.photos || []) {
      const r = await DB.getPhoto(f); if (!r) continue;
      const img = await createImageBitmap(r.blob);
      items.push({ img, title: `${pointName(p)} – ${describe(p)}`, sub: `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} · ${new Date(p.time).toLocaleDateString('id-ID')}` });
    }
    const total = Math.ceil(items.length / 6);
    for (let i = 0; i < total; i++) {
      ctx.setTransform(K, 0, 0, K, 0, 0); renderPhotoPage(ctx, S, items.slice(i * 6, i * 6 + 6), i + 1, total);
      pages.push(await canvasToJpeg(cv, 0.85));
    }
  }
  const pdf = buildPDF(pages);
  await shareOrDownload(pdf, safeName(S.judul) + '.pdf', share);
  toast(`PDF siap (${pages.length} halaman)`);
}

// ================= mulai =================
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
showHome();
