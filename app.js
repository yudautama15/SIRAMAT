// ===== Survei Material PLN – logika aplikasi =====
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const TYPES = { tiang: 'Tiang', gardu: 'Gardu', pelanggan: 'Pelanggan', label: 'Teks/arah', jalan: 'Jalan' };

let G = loadSettings();
let S = null;              // survei aktif
let selected = null;       // id titik terpilih
let editing = null;        // id titik yang sedang diedit
let gpsFix = null, gpsHist = [], follow = false, watchId = null;
let map = null;

function loadSettings() {
  try { return Object.assign({ kop: 'PT PLN (PERSERO)\nUID SUMATERA UTARA\nUP3 NIAS', toleransi: 3, bulat: 1, surveyor: '', digambar: '', diketahui: '', disetujui: '', logo: '' }, JSON.parse(localStorage.getItem('survei-settings') || '{}')); }
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
  S = s; S.points ||= []; S.material ||= {}; S.materialExtra ||= {}; S.uraian ||= {}; S.settings ||= {};
  selected = null;
  $('#scHome').classList.remove('on'); $('#scSurvey').classList.add('on');
  $('#svTitle').textContent = S.judul || 'Survei';
  if (!map) map = new SurveyMap($('#map'), { onTapPoint: id => { selected = id; refreshMap(); }, onTapEmpty: () => { selected = null; refreshMap(); } });
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
  const par = defaultParent('tiang');
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
  return p.type === 'tiang' ? 'Tiang ' + (p.no || '') : p.type === 'gardu' ? (p.kode || 'Gardu') :
    p.type === 'pelanggan' ? (p.nama || 'Pelanggan') : p.type === 'label' ? '"' + (p.teks || '').split('\n')[0] + '"' : 'Titik jalan';
}
function describe(p) {
  const st = { rencana: 'Rencana', eks: 'Eksisting', bongkar: 'Bongkar' }[p.status] || '';
  if (p.type === 'tiang') return `${st} ${p.jenis || ''} ${p.tinggi || ''}m ${p.jar || ''} ${[...asArr(p.konsTM), ...asArr(p.konsTR)].join(' ')}`;
  if (p.type === 'gardu') return `${st} ${p.dayaEks || ''}${p.dayaRencana ? '→' + p.dayaRencana : ''} kVA`;
  return TYPES[p.type];
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

function lastOf(type) { for (let i = S.points.length - 1; i >= 0; i--) if (!type || S.points[i].type === type) return S.points[i]; return null; }
function defaultParent(type) {
  if (type === 'label') return null;
  if (selected && P(selected)) {
    const s = P(selected);
    if (type === 'jalan' ? s.type === 'jalan' : s.type !== 'jalan' && s.type !== 'label') return s.id;
  }
  for (let i = S.points.length - 1; i >= 0; i--) {
    const q = S.points[i];
    if (type === 'jalan' ? q.type === 'jalan' : q.type !== 'jalan' && q.type !== 'label' && q.type !== 'pelanggan') return q.id;
  }
  return null;
}
function nextNo() { const ns = S.points.filter(p => p.type === 'tiang').map(p => parseInt(p.no) || 0); return String(ns.length ? Math.max(...ns) + 1 : 1); }
function addPoint(lat, lng, acc, src) {
  const lastT = S.lastType || 'tiang';
  const tmpl = lastOf(lastT) || {};
  const lastNet = [...S.points].reverse().find(p => p.type !== 'jalan' && p.type !== 'label') || {};
  const p = {
    id: uid(), type: lastT, lat, lng, acc, src, time: Date.now(), photos: [],
    status: tmpl.status || 'rencana', jenis: tmpl.jenis || 'beton', tinggi: tmpl.tinggi || 9,
    jar: tmpl.jar || lastNet.jar || 'TR', konsTM: asArr(tmpl.konsTM), konsTR: asArr(tmpl.konsTR), tipe: tmpl.tipe,
    segStatus: tmpl.segStatus || lastNet.segStatus || 'rencana', hantar: tmpl.hantar || lastNet.hantar || 'JTR 70 mm', hantarLama: tmpl.hantarLama || lastNet.hantarLama || '',
    phasa: tmpl.phasa || '3',
  };
  if (p.type === 'tiang') p.no = nextNo();
  if (p.type === 'label') p.teks = tmpl.teks || 'ARAH ';
  p.parent = defaultParent(p.type);
  S.points.push(p); selected = p.id; save(); refreshMap();
  toast(`${pointName(p)} tersimpan${acc != null ? ' (±' + Math.round(acc) + ' m)' : ' (posisi tengah peta)'}`);
  openEditor(p.id, true);
}

// ---------- EDITOR TITIK ----------
function opt(list, v) { return list.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(lab)}</option>`; }).join(''); }
function multiChips(name, list, v, suf = '') { const a = asArr(v); return `<div class="chips" data-multi="${name}">${list.map(x => `<button type="button" class="chip ${a.includes(x) ? 'on' : ''}" data-v="${esc(x)}">${esc(x + suf)}</button>`).join('')}</div>`; }
function chips(name, list, v) { return `<div class="chips" data-chips="${name}">${list.map(([val, lab]) => `<button type="button" class="chip ${String(v) === String(val) ? 'on' : ''}" data-v="${esc(val)}">${esc(lab)}</button>`).join('')}</div>`; }
async function openEditor(id, fresh) {
  editing = id; const p = P(id); if (!p) return;
  const others = S.points.filter(q => q.id !== id && (p.type === 'jalan' ? q.type === 'jalan' : q.type !== 'jalan' && q.type !== 'label'));
  const isNet = p.type !== 'jalan' && p.type !== 'label';
  const seg = isNet && p.parent;
  let h = `<div class="row"><h2 class="grow">${fresh ? 'Titik baru: ' : ''}${esc(pointName(p))}</h2><button class="btn sm" data-act="close">Selesai</button></div>
    <div class="mut">${p.lat.toFixed(6)}, ${p.lng.toFixed(6)} ${p.acc != null ? '(±' + Math.round(p.acc) + ' m)' : '(posisi manual)'}</div>
    <label class="f">Jenis titik</label>${chips('type', Object.entries(TYPES), p.type)}`;
  if (p.type === 'tiang') {
    h += `<label class="f">Status</label>${chips('status', [['rencana', 'Rencana (baru)'], ['eks', 'Eksisting'], ['bongkar', 'Dibongkar']], p.status)}
      <div class="grid2">
        <div><label class="f">No. tiang</label><input class="i" data-k="no" value="${esc(p.no)}"></div>
        <div><label class="f">Jaringan</label><select class="i" data-k="jar">${opt([['TR', 'TR (HUTR)'], ['TM', 'TM (HUTM)']], p.jar)}</select></div>
        <div><label class="f">Jenis tiang</label>${chips('jenis', [['beton', 'Beton'], ['besi', 'Besi'], ['kayu', 'Kayu']], p.jenis)}</div>
        <div><label class="f">Tinggi (m)</label>${chips('tinggi', [['9', '9'], ['12', '12'], ['11', '11'], ['13', '13']], p.tinggi)}</div>
      </div>
      ${p.status === 'eks' ? '' : `<label class="f">Konstruksi TM ${p.status === 'bongkar' ? '(dibongkar)' : ''} – boleh lebih dari satu</label>${multiChips('konsTM', KONS_TM, p.konsTM)}
      <label class="f">Konstruksi TR ${p.status === 'bongkar' ? '(dibongkar)' : ''}</label>${multiChips('konsTR', KONS_TR, p.konsTR, ' TR')}`}
      ${p.status === 'bongkar' ? '' : `<div class="row" style="margin-top:10px;gap:14px">
        <label><input type="checkbox" data-k="skur" ${p.skur ? 'checked' : ''}> Skur ${esc(p.jar)}</label>
        <label><input type="checkbox" data-k="spanGuy" ${p.spanGuy ? 'checked' : ''}> Spunh Guy ${esc(p.jar)}</label>
        <label><input type="checkbox" data-k="grounding" ${p.grounding ? 'checked' : ''}> Grounding</label></div>`}
      ${p.status !== 'rencana' ? `<label style="display:block;margin-top:8px"><input type="checkbox" data-k="showBubble" ${p.showBubble ? 'checked' : ''}> Tampilkan label nomor di gambar</label>` : ''}`;
  } else if (p.type === 'gardu') {
    h += `<label class="f">Status</label>${chips('status', [['eks', 'Eksisting'], ['rencana', 'Rencana gardu baru'], ['bongkar', 'Dibongkar']], p.status)}
      <div class="grid2">
        <div><label class="f">Kode gardu</label><input class="i" data-k="kode" value="${esc(p.kode)}" placeholder="TH 10"></div>
        <div><label class="f">Phasa</label><select class="i" data-k="phasa">${opt([['3', '3 phasa'], ['1', '1 phasa']], p.phasa)}</select></div>
        <div><label class="f">Daya eksisting (kVA)</label><select class="i" data-k="dayaEks">${opt([['', '–'], 25, 50, 100, 160, 200, 250], p.dayaEks || '')}</select></div>
        ${p.status === 'bongkar' ? '' : `<div><label class="f">Daya rencana (kVA)</label><select class="i" data-k="dayaRencana">${opt([['', '– tidak ada –'], 25, 50, 100, 160, 250], p.dayaRencana || '')}</select></div>`}
      </div>
      ${p.dayaRencana && p.status !== 'bongkar' ? `<label class="f">Konstruksi gardu rencana</label>${chips('tipe', [['SINGLE POLE', 'Single pole'], ['DOUBLE POLE', 'Double pole']], tipeGardu(p))}` : ''}
      <p class="mut">Daya rencana diisi bila uprating / gardu baru → trafo masuk Gardu Distribusi; trafo lama (uprating/bongkar) otomatis masuk Pembongkaran.</p>`;
  } else if (p.type === 'pelanggan') {
    h += `<div class="grid2"><div><label class="f">Nama / ID pelanggan</label><input class="i" data-k="nama" value="${esc(p.nama)}"></div>
      <div><label class="f">Daya mohon (VA)</label><input class="i" data-k="dayaMohon" value="${esc(p.dayaMohon)}"></div></div>`;
  } else if (p.type === 'label') {
    h += `<label class="f">Teks pada gambar (contoh: ARAH GUNUNGSITOLI)</label><textarea class="i" data-k="teks">${esc(p.teks)}</textarea>`;
  } else if (p.type === 'jalan') {
    h += `<p class="mut">Titik jalan disambung jadi garis jalan pada gambar. Tag sepanjang tepi jalan.</p>`;
  }
  if (p.type !== 'label') {
    h += `<label class="f">Tersambung dari (induk)</label><select class="i" data-k="parent">${opt([['', '– titik awal / tidak tersambung –'], ...others.map(q => [q.id, pointName(q)])], p.parent || '')}</select>`;
  }
  if (seg) {
    const hl = p.jar === 'TM' ? HANTAR_TM : HANTAR_TR;
    const q = P(p.parent);
    h += `<div class="card" style="margin-top:10px;background:#f8fafc">
      <b>Ruas ${esc(pointName(q))} → ${esc(pointName(p))}: ${haversine(q, p).toFixed(1)} m</b>
      ${p.type !== 'tiang' ? `<label class="f">Jaringan</label><select class="i" data-k="jar">${opt([['TR', 'TR (HUTR)'], ['TM', 'TM (HUTM)']], p.jar)}</select>` : ''}
      <label class="f">Status ruas</label>${chips('segStatus', [['rencana', 'Rencana baru'], ['ganti', 'Ganti kabel'], ['eks', 'Eksisting'], ['bongkar', 'Bongkar']], p.segStatus)}
      ${p.segStatus === 'rencana' || p.segStatus === 'ganti' ? `<label class="f">Penghantar ${p.segStatus === 'ganti' ? 'baru' : ''}</label><select class="i" data-k="hantar">${opt(hl, p.hantar)}</select>` : `<label class="f">Penghantar ${p.segStatus === 'bongkar' ? 'yang dibongkar' : 'eksisting'}</label><select class="i" data-k="hantar">${opt(['', ...hl], p.hantar)}</select>`}
      ${p.segStatus === 'ganti' ? `<label class="f">Penghantar lama</label><select class="i" data-k="hantarLama">${opt(['', ...hl], p.hantarLama)}</select>` : ''}
    </div>`;
  }
  if (p.type !== 'jalan' && p.type !== 'label') {
    h += `<label class="f">Catatan rencana (tampil di gambar dengan panah)</label>
      <textarea class="i" data-k="ket" placeholder="mis. RENCANA UPRATING TRAFO 50 KVA MENJADI 100 KVA">${esc(p.ket)}</textarea>
      <label style="display:block;margin-top:8px"><input type="checkbox" data-k="showKoord" ${p.showKoord ? 'checked' : ''}> Tampilkan titik koordinat di gambar</label>
      <label class="f">Foto (${(p.photos || []).length})</label>
      <button class="btn pri" data-act="photo" style="width:100%">📷 Ambil foto</button>
      <div class="thumbs" id="thumbs"></div>`;
  }
  h += `<div class="row" style="margin-top:14px"><button class="btn red" data-act="del">Hapus titik</button><span class="grow"></span>
    <button class="btn" data-act="move">Pindah ke posisi GPS</button><button class="btn pri" data-act="close">Selesai</button></div>`;
  $('#ptSheet').innerHTML = h; $('#mdPoint').classList.add('on');
  const th = $('#thumbs');
  if (th) for (const f of p.photos || []) {
    const r = await DB.getPhoto(f); if (!r) continue;
    const d = document.createElement('div'); d.className = 't';
    d.innerHTML = `<img src="${URL.createObjectURL(r.blob)}"><button class="x" data-delphoto="${f}">✕</button>`;
    th.appendChild(d);
  }
}
const rerenderKeys = new Set(['type', 'status', 'segStatus', 'jar', 'parent', 'dayaRencana']);
$('#ptSheet').addEventListener('click', async e => {
  const p = P(editing); if (!p) return;
  const mc = e.target.closest('[data-multi] .chip');
  if (mc) {
    const k = mc.parentElement.dataset.multi, v = mc.dataset.v; const arr = asArr(p[k]);
    p[k] = arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v];
    S.lastType = p.type; save(); refreshMap(); openEditor(p.id); return;
  }
  const chip = e.target.closest('[data-chips] .chip');
  if (chip) {
    const k = chip.parentElement.dataset.chips, v = chip.dataset.v;
    if (k === 'type' && v !== p.type) {
      p.type = v; S.lastType = v;
      if (v === 'tiang' && !p.no) p.no = nextNo();
      if (v === 'gardu' && !p.status) p.status = 'eks';
      if (v === 'gardu' && p.status === 'rencana' && !p.kode) p.status = 'eks';
      if (v === 'label') { p.parent = null; p.teks ||= 'ARAH '; }
      else if (v === 'jalan' || (p.parent && P(p.parent) && P(p.parent).type === 'jalan')) p.parent = defaultParentExcluding(v, p.id);
    } else if (k !== 'type') p[k] = k === 'tinggi' ? +v : v;
    if (k === 'segStatus' && v === 'ganti' && !p.hantarLama) p.hantarLama = 'JTR 35 mm';
    save(); refreshMap(); openEditor(p.id); return;
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
    Object.assign(p, { lat: gpsFix.lat, lng: gpsFix.lng, acc: gpsFix.acc, src: 'gps' }); save(); refreshMap(); openEditor(p.id);
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
function defaultParentExcluding(type, id) {
  for (let i = S.points.length - 1; i >= 0; i--) { const q = S.points[i]; if (q.id === id) continue;
    if (type === 'jalan' ? q.type === 'jalan' : q.type !== 'jalan' && q.type !== 'label') return q.id; }
  return null;
}
$('#ptSheet').addEventListener('change', e => {
  const k = e.target.dataset.k; if (!k) return; const p = P(editing);
  let v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
  if (k === 'parent') { v = v || null; if (v && createsCycle(p.id, v)) { toast('Tidak bisa: sambungan melingkar'); openEditor(p.id); return; } }
  if (k === 'jar') { const hl = v === 'TM' ? HANTAR_TM : HANTAR_TR; if (!hl.includes(p.hantar)) p.hantar = hl[0]; }
  p[k] = v;
  save(); refreshMap();
  if (rerenderKeys.has(k)) openEditor(p.id);
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
    const pill = p.status === 'bongkar' ? '<span class="pill gan">bongkar</span>' : p.status === 'rencana' ? '<span class="pill ren">rencana</span>' : p.type === 'tiang' || p.type === 'gardu' ? '<span class="pill eks">eksisting</span>' : '';
    const sp = q ? `<span class="pill ${p.segStatus === 'eks' ? 'eks' : p.segStatus === 'rencana' ? 'ren' : 'gan'}">${p.segStatus}</span> ${haversine(q, p).toFixed(1)} m dari ${esc(pointName(q))}` : '';
    return `<div class="card listpt" data-id="${p.id}"><div class="no">${p.type === 'tiang' ? 'T' + esc(p.no) : esc(TYPES[p.type].slice(0, 4))}</div>
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
      <div><label class="f">Toleransi kabel (%)</label><input class="i" id="mTol" type="number" value="${st.toleransi ?? 3}"></div>
      <div><label class="f">Pembulatan kabel (m)</label><input class="i" id="mBul" type="number" value="${st.bulat ?? 1}"></div></div>
      <p class="mut">Angka otomatis dihitung dari tagging: tiang, konstruksi, skur/spunh guy/grounding pada tiang rencana; kabel = panjang ruas rencana/ganti × toleransi; trafo rencana. Tiang/konstruksi/trafo/kabel lama yang dibongkar atau diganti masuk <b>Pembongkaran</b>. Ketik angka di kolom <b>Pakai</b> untuk mengganti; kosongkan untuk kembali ke otomatis.</p>
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
      <div class="grid2"><div><label class="f">Nama material</label><input class="i" id="exName" placeholder="mis. X2 TR"></div>
      <div><label class="f">Satuan</label><select class="i" id="exUnit">${opt(['Btg', 'Mtr', 'Set', 'Unit', 'Bh'], 'Set')}</select></div></div>
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
    <div id="pvWrap" style="overflow:auto;max-height:70vh;border-radius:6px"><canvas id="pv"></canvas></div>
    <p class="mut">Pratinjau. Geser simbol, label tiang, teks koordinat, atau catatan dengan jari untuk merapikan gambar. Posisi GPS asli tidak berubah.</p>
    <div id="pvWarn"></div>`;
  pv = $('#pv'); logoImg = await loadLogo();
  drawPreview();
  pv.onpointerdown = e => {
    const r = pv.getBoundingClientRect(), k = PAGE.w / r.width;
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const order = ['lbl', 'koord', 'note', 'sym'];
    const hit = [...pvHits].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
      .find(h => x >= h.x - 4 && x <= h.x + h.w + 4 && y >= h.y - 4 && y <= h.y + h.h + 4);
    if (!hit) return;
    pv.setPointerCapture(e.pointerId); const p = P(hit.id);
    if (hit.kind === 'note' && p.nx == null) { p.nx = hit.x + hit.w / 2; p.ny = hit.y + hit.h / 2; }
    drag = { hit, p, x, y, k };
  };
  pv.onpointermove = e => {
    if (!drag) return; const r = pv.getBoundingClientRect();
    const x = (e.clientX - r.left) * drag.k, y = (e.clientY - r.top) * drag.k, dx = x - drag.x, dy = y - drag.y;
    drag.x = x; drag.y = y; const p = drag.p;
    if (drag.hit.kind === 'sym') { p.ox = (p.ox || 0) + dx; p.oy = (p.oy || 0) + dy; }
    if (drag.hit.kind === 'lbl') { p.lx = (p.lx ?? (p.type === 'gardu' ? 14 : 0)) + dx; p.ly = (p.ly ?? (p.type === 'gardu' ? 0 : -34)) + dy; }
    if (drag.hit.kind === 'koord') { p.kx = (p.kx ?? 0) + dx; p.ky = (p.ky ?? 30) + dy; }
    if (drag.hit.kind === 'note') { p.nx += dx; p.ny += dy; }
    drawPreview();
  };
  pv.onpointerup = pv.onpointercancel = () => { if (drag) { drag = null; save(); } };
  $('#pdfReset').onclick = () => {
    if (!confirm('Kembalikan semua posisi simbol, label dan catatan ke posisi otomatis?')) return;
    S.points.forEach(p => ['ox', 'oy', 'lx', 'ly', 'kx', 'ky', 'nx', 'ny'].forEach(k => delete p[k])); save(); drawPreview();
  };
  $('#pdfZoom').onclick = () => {
    const big = pv.style.width !== '280%'; pv.style.width = big ? '280%' : '100%';
    $('#pdfZoom').textContent = big ? 'Perkecil' : 'Perbesar'; drawPreview();
    if (big) { const w = $('#pvWrap'); w.scrollLeft = w.scrollWidth * 0.3; }
  };
  $('#pdfMake').onclick = () => makePdf(false);
  $('#pdfShare').onclick = () => makePdf(true);
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
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
showHome();
