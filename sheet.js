// Perhitungan material, penggambaran lembar gambar survei (format UP3 Nias), dan pembuat PDF
const PAGE = { w: 1190.55, h: 841.89 }; // A3 landscape (pt)
const FONT = 'Arial, Helvetica, "Liberation Sans", sans-serif';

// Daftar material sesuai format UP3 Nias: bagian → kelompok → baris
const KONS_TM = ['SC1', 'SC2', 'SC4', 'SC5', 'SC5 DP', 'SC7', 'SC8'];
const KONS_TR = ['X1', 'X3', 'X4'];
const TIANG_ROWS = [['Besi 12', 'Btg'], ['Besi 9', 'Btg'], ['Beton 12', 'Btg'], ['Beton 9', 'Btg']];
const HANTAR_TM = ['A3CS 70 mm', 'A3CS 150 mm'];
const HANTAR_TR = ['JTR 70 mm', 'JTR 35 mm', 'JTR 25 mm', 'SR / kabel lain (tidak dihitung)'];
const MAT_SECTIONS = [
  { key: 'HUTM', title: 'MATERIAL HUTM', color: '#c4d79b', groups: [
    { t: 'TIANG', rows: TIANG_ROWS },
    { t: 'KABEL', rows: HANTAR_TM.map(h => [h, 'Mtr']) },
    { t: 'KONSTRUKSI', rows: KONS_TM.map(k => [k, 'Set']) },
    { t: 'SKUR', rows: [['Skur TM', 'Set'], ['Spunh Guy TM', 'Set']] }] },
  { key: 'HUTR', title: 'MATERIAL HUTR', color: '#fabf8f', groups: [
    { t: 'TIANG', rows: TIANG_ROWS },
    { t: 'KABEL', rows: HANTAR_TR.slice(0, 3).map(h => [h, 'Mtr']) },
    { t: 'KONSTRUKSI', rows: [...KONS_TR.map(k => [k + ' TR', 'Set']), ['Grounding', 'Set']] },
    { t: 'SKUR', rows: [['Skur TR', 'Set'], ['Spunh Guy TR', 'Set']] }] },
  { key: 'GARDU', title: 'GARDU DISTRIBUSI', color: '#92cddc', groups: [
    { t: 'SINGLE POLE', rows: [['Trafo 25 KVa', 'Unit'], ['Trafo 50 KVa', 'Unit']] },
    { t: 'DOUBLE POLE', rows: [['Trafo 50 KVa', 'Unit'], ['Trafo 100 KVa', 'Unit'], ['Trafo 160 KVa', 'Unit'], ['Trafo 250 KVa', 'Unit']] }] },
  { key: 'BONGKAR', title: 'PEMBONGKARAN', color: '#d9d9d9', groups: [
    { t: 'TIANG', rows: TIANG_ROWS },
    { t: 'KABEL', rows: [...HANTAR_TM, ...HANTAR_TR.slice(0, 3)].map(h => [h, 'Mtr']) },
    { t: 'KONSTRUKSI', rows: [...KONS_TM.map(k => [k, 'Set']), ...KONS_TR.map(k => [k + ' TR', 'Set'])] },
    { t: 'GARDU DISTRIBUSI', rows: [['Trafo 50 KVa', 'Unit'], ['Trafo 100 KVa', 'Unit'], ['Trafo 160 KVa', 'Unit'], ['Trafo 250 KVa', 'Unit']] }] },
];
const asArr = v => Array.isArray(v) ? v : v ? String(v).split(/[\s,+]+/).filter(Boolean) : [];
const tipeGardu = g => g.tipe || (+g.dayaRencana <= 25 ? 'SINGLE POLE' : 'DOUBLE POLE');

const URAIAN_ROWS = [
  ['#', 'JTM'], ['kodePenyulang', 'Kode Penyulang'], ['hantarJTM', 'Penghantar (mm²)'], ['teganganJTM', 'Tegangan JTM'],
  ['#', 'GARDU'], ['daya', 'Daya (KVA)'], ['phasa', 'Phasa'], ['bebanA', 'Beban (A)'], ['bebanP', 'Beban (%)'], ['jurusan', 'Jumlah Jurusan'],
  ['#', 'JTR'], ['hantarJTR', 'Penghantar (mm²)'], ['panjangJTR', 'Panjang JTR (kms)'], ['tegPangkal', 'Teg. Pangkal (V)'], ['tegUjung', 'Teg. Ujung (V)'],
];

function segments(sv) {
  const byId = Object.fromEntries(sv.points.map(p => [p.id, p]));
  const out = [];
  for (const p of sv.points) {
    const q = p.parent && byId[p.parent];
    if (!q || p.type === 'jalan' || p.type === 'label' || q.type === 'label') continue;
    if (p.lat == null || q.lat == null) continue;
    out.push({ from: q, to: p, len: haversine(q, p), jar: p.jar || 'TR', status: p.segStatus || 'rencana', hantar: p.hantar, lama: p.hantarLama });
  }
  return out;
}

function computeMaterial(sv) {
  const st = sv.settings || {};
  const tol = +(st.toleransi ?? 3), bulat = +(st.bulat ?? 1) || 1;
  const auto = {}; const warn = [];
  const add = (sec, grp, name, q) => { const k = `${sec}|${grp}|${name}`; auto[k] = (auto[k] || 0) + q; };
  const tiangName = p => `${p.jenis === 'besi' ? 'Besi' : 'Beton'} ${p.tinggi || 9}`;
  for (const p of sv.points) {
    if (p.type === 'tiang') {
      const sec = p.jar === 'TM' ? 'HUTM' : 'HUTR';
      const kons = [...asArr(p.konsTM).map(k => ['HUTM', k]), ...asArr(p.konsTR).map(k => ['HUTR', k + ' TR'])];
      if (p.status === 'rencana') {
        if (p.jenis === 'kayu') warn.push(`Tiang ${p.no}: tiang kayu tidak ada di daftar material`);
        else add(sec, 'TIANG', tiangName(p), 1);
        kons.forEach(([s, k]) => add(s, 'KONSTRUKSI', k, 1));
      }
      if (p.status === 'bongkar') {
        if (p.jenis !== 'kayu') add('BONGKAR', 'TIANG', tiangName(p), 1);
        kons.forEach(([, k]) => add('BONGKAR', 'KONSTRUKSI', k, 1));
      }
      if (p.status !== 'bongkar') {
        if (p.skur) add(sec, 'SKUR', 'Skur ' + p.jar, 1);
        if (p.spanGuy) add(sec, 'SKUR', 'Spunh Guy ' + p.jar, 1);
        if (p.grounding) add('HUTR', 'KONSTRUKSI', 'Grounding', 1);
      }
    }
    if (p.type === 'gardu') {
      const baru = p.dayaRencana && (p.status === 'rencana' || +p.dayaRencana !== +p.dayaEks);
      if (baru && p.status !== 'bongkar') add('GARDU', tipeGardu(p), `Trafo ${p.dayaRencana} KVa`, 1);
      if (p.dayaEks && (p.status === 'bongkar' || (baru && p.status === 'eks'))) add('BONGKAR', 'GARDU DISTRIBUSI', `Trafo ${p.dayaEks} KVa`, 1);
    }
  }
  const len = {}, lenB = {};
  const counted = h => h && !/tidak dihitung/.test(h);
  for (const s of segments(sv)) {
    if ((s.status === 'rencana' || s.status === 'ganti') && counted(s.hantar)) len[s.hantar] = (len[s.hantar] || 0) + s.len;
    const old = s.status === 'ganti' ? s.lama : s.status === 'bongkar' ? s.hantar : null;
    if (counted(old)) lenB[old] = (lenB[old] || 0) + s.len;
  }
  const kab = m => Math.ceil(m * (1 + tol / 100) / bulat) * bulat;
  for (const [h, m] of Object.entries(len)) add(h.startsWith('A3CS') ? 'HUTM' : 'HUTR', 'KABEL', h, kab(m));
  for (const [h, m] of Object.entries(lenB)) add('BONGKAR', 'KABEL', h, Math.round(m));
  // baris baku + baris tambahan (kombinasi di luar format / tambahan manual)
  const sections = MAT_SECTIONS.map(s => ({ key: s.key, title: s.title, color: s.color,
    groups: s.groups.map(g => ({ t: g.t, rows: g.rows.map(r => ({ name: r[0], unit: r[1], key: `${s.key}|${g.t}|${r[0]}` })) })) }));
  const ensure = (k, unit) => {
    const [sec, grp, name] = k.split('|'); const s = sections.find(x => x.key === sec); if (!s) return;
    let g = s.groups.find(x => x.t === grp); if (!g) { g = { t: grp, rows: [] }; s.groups.push(g); }
    if (!g.rows.find(r => r.key === k)) g.rows.push({ name, unit: unit || (grp === 'KABEL' ? 'Mtr' : grp === 'TIANG' ? 'Btg' : /Trafo/.test(name) ? 'Unit' : 'Set'), key: k, extra: true });
  };
  Object.keys(auto).forEach(k => ensure(k));
  Object.entries(sv.materialExtra || {}).forEach(([k, u]) => ensure(k, u));
  const ov = sv.material || {};
  for (const s of sections) for (const g of s.groups) for (const r of g.rows) {
    r.auto = auto[r.key] || 0;
    r.qty = ov[r.key] !== undefined && ov[r.key] !== '' ? ov[r.key] : (r.auto || '');
  }
  return { sections, warn, len };
}

function uraianAuto(sv) {
  const g = sv.points.find(p => p.type === 'gardu') || {};
  const seg = segments(sv);
  const sum = f => seg.filter(f).reduce((a, s) => a + s.len, 0) / 1000;
  const fmt = v => v ? v.toFixed(3).replace('.', ',') : '';
  const lamaTR = seg.find(s => s.jar === 'TR' && s.status === 'ganti' && s.lama);
  const baruTR = seg.find(s => s.jar === 'TR' && (s.status === 'rencana' || s.status === 'ganti') && s.hantar && !/tidak/.test(s.hantar));
  const eksTM = seg.find(s => s.jar === 'TM' && s.hantar);
  return {
    kodePenyulang: { seb: sv.penyulang || '' },
    hantarJTM: { seb: eksTM ? eksTM.hantar : '' },
    daya: { seb: g.dayaEks || '', baru: g.dayaRencana && +g.dayaRencana !== +g.dayaEks ? g.dayaRencana : '' },
    phasa: { seb: g.phasa ? g.phasa : '' },
    hantarJTR: { seb: lamaTR ? lamaTR.lama : '', baru: baruTR ? baruTR.hantar : '' },
    panjangJTR: { seb: fmt(sum(s => s.jar === 'TR' && s.status !== 'rencana')), baru: fmt(sum(s => s.jar === 'TR' && (s.status === 'rencana' || s.status === 'ganti'))) },
  };
}
function uraianValue(sv, key, col) {
  const m = (sv.uraian || {})[key] || {};
  if (m[col] !== undefined && m[col] !== '') return m[col];
  return ((uraianAuto(sv)[key] || {})[col]) || '';
}

// ---------- utilitas gambar ----------
function wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const w of para.split(' ')) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t;
    }
    out.push(line);
  }
  return out;
}
function cellText(ctx, t, x, y, w, h, o = {}) {
  ctx.font = `${o.bold ? 'bold ' : ''}${o.size || 7.5}px ${FONT}`;
  ctx.fillStyle = o.color || '#000'; ctx.textBaseline = 'middle';
  let s = String(t ?? ''); let size = o.size || 7.5;
  while (ctx.measureText(s).width > w - 4 && size > 4) { size -= 0.5; ctx.font = `${o.bold ? 'bold ' : ''}${size}px ${FONT}`; }
  const tw = ctx.measureText(s).width;
  const tx = o.align === 'center' ? x + (w - tw) / 2 : o.align === 'right' ? x + w - tw - 3 : x + 2.5;
  ctx.fillText(s, tx, y + h / 2 + 0.5);
}
function rect(ctx, x, y, w, h, fill, lw = 0.6) {
  if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
  ctx.strokeStyle = '#000'; ctx.lineWidth = lw; ctx.strokeRect(x, y, w, h);
}
function arrowHead(ctx, x, y, ang, s = 5) {
  ctx.beginPath(); ctx.moveTo(x, y);
  ctx.lineTo(x - s * Math.cos(ang - 0.45), y - s * Math.sin(ang - 0.45));
  ctx.moveTo(x, y); ctx.lineTo(x - s * Math.cos(ang + 0.45), y - s * Math.sin(ang + 0.45));
  ctx.stroke();
}

// ---------- lembar gambar survei ----------
const L = {
  border: { x: 22, y: 22, w: PAGE.w - 44, h: PAGE.h - 44 },
  left: 252, titleTop: 700, uraianX: 905,
};
L.right = L.border.x + L.border.w; L.bottom = L.border.y + L.border.h;
L.draw = { x: L.left + 6, y: L.border.y + 6, w: L.right - L.left - 12, h: 0 };

function renderSheet(ctx, sv, opts = {}) {
  const hits = [];
  ctx.save();
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE.w, PAGE.h);
  ctx.lineJoin = 'round';
  rect(ctx, L.border.x, L.border.y, L.border.w, L.border.h, null, 1.6);
  ctx.beginPath(); ctx.moveTo(L.left, L.border.y); ctx.lineTo(L.left, L.bottom); ctx.lineWidth = 1.2; ctx.stroke();

  // --- tabel kebutuhan material (2 kolom: HUTM+HUTR | Gardu+Pembongkaran) ---
  const mat = computeMaterial(sv);
  const mx = L.border.x, mw = L.left - L.border.x;
  const nRows = secs => secs.reduce((a, s) => a + 1 + s.groups.reduce((b, g) => b + 1 + g.rows.length, 0), 0);
  const colA = mat.sections.filter(s => s.key === 'HUTM' || s.key === 'HUTR');
  const colB = mat.sections.filter(s => s.key === 'GARDU' || s.key === 'BONGKAR');
  const y0 = L.border.y + 8, rh = Math.min(10.5, 400 / (Math.max(nRows(colA), nRows(colB)) + 1));
  rect(ctx, mx, y0, mw, rh + 2, '#fff'); cellText(ctx, 'KEBUTUHAN MATERIAL', mx, y0, mw, rh + 2, { bold: true, align: 'center', size: 7.5 });
  let yEnd = y0;
  const fs = Math.min(6.6, rh * 0.68);
  [colA, colB].forEach((secs, ci) => {
    const cw = mw / 2, x = mx + ci * cw, cn = 9, cq = 22, cu = 17, cname = cw - cn - cq - cu;
    let y = y0 + rh + 2;
    for (const s of secs) {
      rect(ctx, x, y, cw, rh, s.color); cellText(ctx, s.title, x, y, cw, rh, { bold: true, align: 'center', size: fs }); y += rh;
      s.groups.forEach((g, gi) => {
        rect(ctx, x, y, cn, rh); rect(ctx, x + cn, y, cw - cn, rh, '#f2f2f2');
        cellText(ctx, gi + 1, x, y, cn, rh, { bold: true, align: 'center', size: fs });
        cellText(ctx, g.t, x + cn, y, cw - cn, rh, { bold: true, size: fs }); y += rh;
        for (const r of g.rows) {
          rect(ctx, x, y, cn, rh); rect(ctx, x + cn, y, cname, rh); rect(ctx, x + cn + cname, y, cq, rh); rect(ctx, x + cn + cname + cq, y, cu, rh);
          cellText(ctx, r.name, x + cn, y, cname, rh, { size: fs });
          cellText(ctx, r.qty, x + cn + cname, y, cq, rh, { align: 'center', bold: true, size: fs });
          cellText(ctx, r.unit, x + cn + cname + cq, y, cu, rh, { align: 'center', size: fs * 0.9 });
          y += rh;
        }
      });
    }
    yEnd = Math.max(yEnd, y);
  });
  const y = yEnd;
  // --- keterangan (legenda) ---
  const ky = y + 6, kh = L.bottom - ky;
  ctx.beginPath(); ctx.moveTo(mx, ky); ctx.lineTo(L.left, ky); ctx.lineWidth = 1.2; ctx.stroke();
  rect(ctx, mx + 8, ky + 8, mw - 16, 24, '#c4d79b', 0.8);
  ctx.font = `15px ${FONT}`; ctx.fillStyle = '#000'; ctx.textBaseline = 'middle';
  ctx.fillText('Keterangan', mx + mw / 2 - ctx.measureText('Keterangan').width / 2, ky + 21);
  const items = [
    ['jalan', 'Jalan'], ['beton', 'Tiang Beton Eksisting'], ['besi', 'Tiang Besi Eksisting'], ['kayu', 'Tiang Kayu Eksisting'],
    ['gardueks', 'Gardu Distribusi Eksisting'], ['jareks', '1. HUTM Eksisting|2. HUTR Eksisting'], ['tiangren', 'Rencana Tiang'],
    ['gardurem', 'Rencana Gardu Distribusi'], ['jarren', '1. Rencana HUTM|2. Rencana HUTR'], ['skur', 'Rencana Skur'],
    ['ground', 'Rencana Grounding'], ['bongkar', 'Rencana Bongkar Tiang'], ['bulat', 'a. Nomor Tiang|b. Tinggi Tiang|c. Konstruksi TM|d. Konstruksi TR'],
  ];
  const ih = Math.min(26, (kh - 44) / (items.length + 0.6));
  let iy = ky + 40;
  for (const [k, t] of items) {
    const cx = mx + 48, cy = iy + ih / 2, tx = mx + 92;
    legendIcon(ctx, k, cx, cy, ih);
    const lines = t.split('|'); ctx.font = `6.6px ${FONT}`; ctx.fillStyle = '#000';
    lines.forEach((ln, i) => ctx.fillText(': ' + ln, tx, cy + (i - (lines.length - 1) / 2) * 7.4));
    iy += k === 'bulat' ? ih * 1.6 : ih;
  }

  // --- tabel uraian ---
  const ux = L.uraianX, uw = L.right - ux, ucol = [ux, ux + 108, ux + 160, ux + 213, L.right];
  const urh = 15.2; const uy0 = L.bottom - urh * (URAIAN_ROWS.length + 2);
  L.draw.h = uy0 - L.draw.y - 8;
  rect(ctx, ux, uy0, ucol[1] - ux, urh * 2, '#95b3d7'); cellText(ctx, 'URAIAN', ux, uy0, ucol[1] - ux, urh * 2, { bold: true, align: 'center' });
  rect(ctx, ucol[1], uy0, ucol[2] - ucol[1], urh, '#95b3d7'); cellText(ctx, 'SEBELUM', ucol[1], uy0, ucol[2] - ucol[1], urh, { bold: true, align: 'center', size: 7 });
  rect(ctx, ucol[2], uy0, L.right - ucol[2], urh, '#95b3d7'); cellText(ctx, 'SESUDAH', ucol[2], uy0, L.right - ucol[2], urh, { bold: true, align: 'center', size: 7 });
  [['EKS', 1], ['EKS', 2], ['BARU', 3]].forEach(([t, i]) => {
    rect(ctx, ucol[i], uy0 + urh, ucol[i + 1] - ucol[i], urh, '#95b3d7');
    cellText(ctx, t, ucol[i], uy0 + urh, ucol[i + 1] - ucol[i], urh, { bold: true, align: 'center', size: 7 });
  });
  let uy = uy0 + urh * 2;
  for (const [key, label] of URAIAN_ROWS) {
    const head = key === '#';
    for (let i = 0; i < 4; i++) rect(ctx, ucol[i], uy, ucol[i + 1] - ucol[i], urh, head ? '#dce6f1' : '#fff');
    cellText(ctx, label, ux, uy, ucol[1] - ux, urh, { bold: head, size: 7.3 });
    if (!head) ['seb', 'eks', 'baru'].forEach((c, i) =>
      cellText(ctx, uraianValue(sv, key, c), ucol[i + 1], uy, ucol[i + 2] - ucol[i + 1], urh, { bold: true, align: 'center', size: 7.3 }));
    uy += urh;
  }

  // --- kolom judul ---
  const tx0 = L.left, tx1 = ux, ty = L.titleTop, tr = (L.bottom - ty - 34) / 5;
  ctx.beginPath(); ctx.moveTo(tx0, ty); ctx.lineTo(tx1, ty); ctx.lineWidth = 1.2; ctx.stroke();
  rect(ctx, tx0, ty, 26, 34); rect(ctx, tx0 + 26, ty, 120, 34); rect(ctx, tx0 + 146, ty, tx1 - tx0 - 146, 34);
  if (opts.logo) { const im = opts.logo; const s = Math.min(22 / im.width, 30 / im.height); ctx.drawImage(im, tx0 + 13 - im.width * s / 2, ty + 17 - im.height * s / 2, im.width * s, im.height * s); }
  ctx.font = `6.6px ${FONT}`; ctx.fillStyle = '#000';
  String((sv.settings || {}).kop || 'PT PLN (PERSERO)\nUID SUMATERA UTARA\nUP3 NIAS').split('\n').slice(0, 3)
    .forEach((ln, i) => ctx.fillText(ln, tx0 + 29, ty + 8 + i * 9));
  ctx.font = `7.6px ${FONT}`;
  const jl = wrapText(ctx, (sv.judul || '').toUpperCase(), tx1 - tx0 - 156).slice(0, 3);
  jl.forEach((ln, i) => ctx.fillText(ln, tx0 + 146 + (tx1 - tx0 - 146 - ctx.measureText(ln).width) / 2, ty + 17 + (i - (jl.length - 1) / 2) * 10));
  const tc = [tx0, tx0 + 335, tx0 + 425, tx0 + 485, tx1];
  const ry = i => ty + 34 + tr * i;
  const rows = [['Skala      : NTS', 'Tanggal', 'Paraf'], ['Disurvey   : ' + (sv.surveyor || ''), sv.tglSurvey], ['Digambar  : ' + (sv.digambar || ''), sv.tglGambar],
    ['Diketahui  : ' + (sv.diketahui || ''), sv.tglDiketahui], ['Disetujui   : ' + (sv.disetujui || ''), sv.tglDisetujui]];
  rows.forEach((r, i) => {
    for (let c = 0; c < 3; c++) rect(ctx, tc[c], ry(i), tc[c + 1] - tc[c], tr);
    cellText(ctx, r[0], tc[0], ry(i), tc[1] - tc[0], tr, { size: 9.5 });
    cellText(ctx, i === 0 ? r[1] : fmtTgl(r[1]), tc[1], ry(i), tc[2] - tc[1], tr, { size: 9.5, align: 'center' });
    if (i === 0) cellText(ctx, r[2], tc[2], ry(i), tc[3] - tc[2], tr, { size: 9.5, align: 'center' });
  });
  rect(ctx, tc[3], ry(0), tc[4] - tc[3], tr); cellText(ctx, 'Program / Basket', tc[3], ry(0), tc[4] - tc[3], tr, { size: 9.5, align: 'center' });
  rect(ctx, tc[3], ry(1), tc[4] - tc[3], tr * 4); cellText(ctx, (sv.program || '').toUpperCase(), tc[3], ry(1), tc[4] - tc[3], tr * 4, { size: 9.5, align: 'center' });

  // --- gambar jaringan ---
  drawNetwork(ctx, sv, hits, opts);
  ctx.restore();
  return { hits, warn: mat.warn };
}
function fmtTgl(s) { if (!s) return ''; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : s; }

function legendIcon(ctx, k, x, y, h) {
  ctx.save(); ctx.lineWidth = 1;
  const P = (o) => SurveyMap.symbol(ctx, o, x, y, 0.85);
  if (k === 'jalan') { ctx.fillStyle = '#9a9a9a'; ctx.fillRect(x - 22, y - 3.5, 40, 7); }
  else if (k === 'beton' || k === 'besi' || k === 'kayu') P({ type: 'tiang', status: 'eks', jenis: k });
  else if (k === 'gardueks') P({ type: 'gardu', status: 'eks' });
  else if (k === 'gardurem') P({ type: 'gardu', status: 'rencana' });
  else if (k === 'tiangren') P({ type: 'tiang', status: 'rencana' });
  else if (k === 'bongkar') P({ type: 'tiang', status: 'bongkar', jenis: 'beton' });
  else if (k === 'jareks' || k === 'jarren') {
    const dash = k === 'jarren' ? [4, 3] : [];
    ctx.setLineDash(dash); ctx.lineWidth = 1.6;
    ctx.strokeStyle = '#d62828'; ctx.beginPath(); ctx.moveTo(x - 28, y - 3); ctx.lineTo(x + 18, y - 3); ctx.stroke();
    ctx.strokeStyle = '#1d8fd6'; ctx.beginPath(); ctx.moveTo(x - 28, y + 3); ctx.lineTo(x + 18, y + 3); ctx.stroke();
    ctx.setLineDash([]);
    const sym = k === 'jarren' ? { type: 'tiang', status: 'rencana' } : { type: 'tiang', status: 'eks', jenis: 'kayu' };
    SurveyMap.symbol(ctx, sym, x - 5, y, 0.7);
    ctx.font = `6px ${FONT}`; ctx.fillStyle = '#000'; ctx.fillText('1', x + 21, y - 4); ctx.fillText('2', x + 21, y + 4);
  } else if (k === 'skur') skurIcon(ctx, x - 20, y, 34);
  else if (k === 'ground') groundIcon(ctx, x - 20, y, 34);
  else if (k === 'bulat') poleBubble(ctx, x, y + 2, 15, 'a', 'b', 'c', 'd', true);
  ctx.restore();
}
function skurIcon(ctx, x, y, len) {
  ctx.save(); ctx.strokeStyle = '#000'; ctx.lineWidth = 0.9;
  ctx.beginPath(); ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4); ctx.stroke();
  ctx.setLineDash([1.5, 1.5]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len, y); ctx.stroke(); ctx.restore();
}
function groundIcon(ctx, x, y, len) {
  ctx.save(); ctx.strokeStyle = '#000'; ctx.lineWidth = 0.9;
  for (let i = 0; i < 3; i++) { const h = 4 - i * 1.2; ctx.beginPath(); ctx.moveTo(x + i * 2.2, y - h); ctx.lineTo(x + i * 2.2, y + h); ctx.stroke(); }
  ctx.setLineDash([1.5, 1.5]); ctx.beginPath(); ctx.moveTo(x + 5, y); ctx.lineTo(x + len, y); ctx.stroke(); ctx.restore();
}
function poleBubble(ctx, x, y, r, a, b, c, d, thin) {
  ctx.save();
  ctx.beginPath(); ctx.ellipse(x, y, r * 1.08, r, 0, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.strokeStyle = '#000'; ctx.lineWidth = 0.9; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x - r * 1.08, y); ctx.lineTo(x + r * 1.08, y);
  ctx.moveTo(x, y - r); ctx.lineTo(x, y);
  if (c && d || thin) { ctx.moveTo(x, y); ctx.lineTo(x, y + r); }
  ctx.lineWidth = 0.7; ctx.stroke();
  const txt = (t, cx, cy, mw, sz) => {
    if (!t) return; let s = sz; ctx.font = `bold ${s}px ${FONT}`;
    while (ctx.measureText(t).width > mw && s > 3.5) { s -= 0.4; ctx.font = `bold ${s}px ${FONT}`; }
    ctx.fillStyle = '#000'; ctx.textBaseline = 'middle'; ctx.fillText(t, cx - ctx.measureText(t).width / 2, cy);
  };
  const fs = thin ? 6 : 8.5;
  txt(a, x - r * 0.45, y - r * 0.45, r * 0.85, fs); txt(b, x + r * 0.45, y - r * 0.45, r * 0.85, fs);
  if (c && d || thin) { txt(c, x - r * 0.48, y + r * 0.42, r * 0.85, fs * 0.8); txt(d, x + r * 0.48, y + r * 0.42, r * 0.85, fs * 0.8); }
  else txt(c || d, x, y + r * 0.42, r * 1.5, fs * 0.8);
  ctx.restore();
}

function drawNetwork(ctx, sv, hits, opts) {
  const D = L.draw;
  const pts = sv.points.filter(p => p.lat != null);
  if (!pts.length) {
    ctx.font = `12px ${FONT}`; ctx.fillStyle = '#999'; ctx.fillText('(belum ada titik survei)', D.x + D.w / 2 - 60, D.y + D.h / 2);
    return;
  }
  const hasNotes = pts.some(p => p.ket);
  const net = hasNotes ? { x: D.x + D.w * 0.36, y: D.y + 40, w: D.w * 0.6, h: D.h - 90 } : { x: D.x + 60, y: D.y + 40, w: D.w - 120, h: D.h - 90 };
  const lat0 = pts.reduce((a, p) => a + p.lat, 0) / pts.length;
  const kx = 111320 * Math.cos(lat0 * Math.PI / 180), ky = 110540;
  const xs = pts.map(p => p.lng * kx), ys = pts.map(p => -p.lat * ky);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const sx = (maxX - minX) || 1, sy = (maxY - minY) || 1;
  const s = Math.min(net.w / sx, net.h / sy);
  const ox = net.x + (net.w - sx * s) / 2, oy = net.y + (net.h - sy * s) / 2;
  const pos = {};
  for (const p of pts) {
    const bx = pts.length === 1 ? net.x + net.w / 2 : ox + (p.lng * kx - minX) * s;
    const by = pts.length === 1 ? net.y + net.h / 2 : oy + (-p.lat * ky - minY) * s;
    pos[p.id] = { x: bx + (p.ox || 0), y: by + (p.oy || 0) };
  }
  const byId = Object.fromEntries(pts.map(p => [p.id, p]));
  // jalan
  ctx.save(); ctx.lineCap = 'round';
  for (const p of pts) if (p.type === 'jalan' && p.parent && pos[p.parent]) {
    const a = pos[p.parent], b = pos[p.id];
    ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }
  ctx.restore();
  // jaringan (TM merah, TR biru; eksisting garis penuh, rencana/ganti putus-putus)
  for (const p of pts) {
    const q = p.parent && byId[p.parent];
    if (!q || p.type === 'jalan' || p.type === 'label' || q.type === 'label' || q.type === 'jalan') continue;
    const a = pos[q.id], b = pos[p.id];
    ctx.save(); ctx.strokeStyle = p.jar === 'TM' ? '#e0141e' : '#1d9be0'; ctx.lineWidth = 2.2;
    ctx.setLineDash(p.segStatus === 'eks' ? [] : p.segStatus === 'bongkar' ? [1.5, 3] : [5, 4]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore();
  }
  const reg = (kind, p, x, y, w, h) => hits.push({ kind, id: p.id, x, y, w, h });
  for (const p of pts) {
    const P = pos[p.id];
    if (p.type === 'jalan') continue;
    if (p.type === 'label') {
      ctx.save(); ctx.font = `bold 11px ${FONT}`; ctx.fillStyle = '#000'; ctx.textBaseline = 'middle';
      const lines = String(p.teks || '').toUpperCase().split('\n');
      const w = Math.max(...lines.map(l => ctx.measureText(l).width));
      lines.forEach((ln, i) => ctx.fillText(ln, P.x - ctx.measureText(ln).width / 2, P.y + (i - (lines.length - 1) / 2) * 12));
      ctx.restore(); reg('sym', p, P.x - w / 2 - 4, P.y - lines.length * 6 - 4, w + 8, lines.length * 12 + 8);
      continue;
    }
    if (p.type === 'pelanggan') {
      ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(P.x - 38, P.y - 18, 76, 36);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(P.x - 38, P.y - 18, 76, 36);
      cellText(ctx, 'PELANGGAN', P.x - 38, P.y - 16, 76, 18, { align: 'center', size: 9 });
      if (p.nama) cellText(ctx, p.nama, P.x - 38, P.y + 1, 76, 14, { align: 'center', size: 6.5 });
      ctx.restore(); reg('sym', p, P.x - 38, P.y - 18, 76, 36);
    } else {
      SurveyMap.symbol(ctx, p, P.x, P.y, 1.05); reg('sym', p, P.x - 10, P.y - 10, 20, 20);
    }
    if (p.type === 'tiang') {
      if (p.skur) skurIcon(ctx, P.x - 6, P.y + 12, 18);
      if (p.grounding) groundIcon(ctx, P.x + 2, P.y + 12, 18);
      if (p.status === 'rencana' || p.showBubble) {
        const bx = P.x + (p.lx ?? 0), by = P.y + (p.ly ?? -34);
        poleBubble(ctx, bx, by, 17, String(p.no || ''), String(p.tinggi || ''), asArr(p.konsTM).join(' '), asArr(p.konsTR).join(' '));
        reg('lbl', p, bx - 18, by - 17, 36, 34);
      }
    }
    if (p.type === 'gardu') {
      ctx.save(); ctx.font = `bold 9.5px ${FONT}`; ctx.fillStyle = '#000'; ctx.textBaseline = 'middle';
      const gx = P.x + (p.lx ?? 14), gy = P.y + (p.ly ?? 0);
      const l1 = (p.kode || '').toUpperCase(), l2 = (p.dayaEks || p.dayaRencana) ? `${p.dayaEks || p.dayaRencana} KVA` : '';
      ctx.fillText(l1, gx, gy - 6); ctx.fillText(l2, gx, gy + 6);
      const w = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width);
      ctx.restore(); reg('lbl', p, gx, gy - 12, w, 24);
    }
    if (p.showKoord) {
      ctx.save(); ctx.font = `bold 8.5px ${FONT}`; ctx.fillStyle = '#000'; ctx.textBaseline = 'middle';
      const cx = P.x + (p.kx ?? 0), cy = P.y + (p.ky ?? 30);
      const t2 = `${p.lat.toFixed(6)} ${p.lng.toFixed(6)}`;
      const w = Math.max(ctx.measureText('TITIK KOORDINAT').width, ctx.measureText(t2).width);
      ctx.fillText('TITIK KOORDINAT', cx - ctx.measureText('TITIK KOORDINAT').width / 2, cy - 5);
      ctx.fillText(t2, cx - ctx.measureText(t2).width / 2, cy + 6);
      ctx.restore(); reg('koord', p, cx - w / 2, cy - 11, w, 22);
    }
  }
  // catatan rencana: kolom kiri, garis titik-titik + panah menuju teks
  const notes = pts.filter(p => p.ket).sort((a, b) => pos[a.id].y - pos[b.id].y);
  let lastBottom = D.y + 10;
  const colW = D.w * 0.33;
  for (const p of notes) {
    ctx.save(); ctx.font = `bold 8.5px ${FONT}`;
    const lines = wrapText(ctx, String(p.ket).toUpperCase(), colW - 16);
    const h = lines.length * 10.5;
    let nx, ny;
    if (p.nx != null) { nx = p.nx; ny = p.ny; }
    else { nx = D.x + 8 + colW / 2; ny = Math.max(pos[p.id].y, lastBottom + h / 2 + 6); ny = Math.min(ny, D.y + D.h - h / 2); }
    lastBottom = ny + h / 2;
    const w = Math.max(...lines.map(l => ctx.measureText(l).width));
    ctx.fillStyle = '#000'; ctx.textBaseline = 'middle';
    lines.forEach((ln, i) => ctx.fillText(ln, nx - ctx.measureText(ln).width / 2, ny + (i - (lines.length - 1) / 2) * 10.5));
    const P = pos[p.id];
    const ex = P.x > nx ? nx + w / 2 + 4 : nx - w / 2 - 4;
    ctx.strokeStyle = '#000'; ctx.lineWidth = 0.8; ctx.setLineDash([1.6, 1.6]);
    ctx.beginPath(); ctx.moveTo(P.x, P.y); ctx.lineTo(ex, ny); ctx.stroke(); ctx.setLineDash([]);
    arrowHead(ctx, ex, ny, Math.atan2(ny - P.y, ex - P.x), 5);
    ctx.restore();
    reg('note', p, nx - w / 2, ny - h / 2, w, h);
  }
}

// ---------- lampiran foto ----------
function renderPhotoPage(ctx, sv, items, pageNo, total, opts = {}) {
  ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, PAGE.w, PAGE.h);
  rect(ctx, L.border.x, L.border.y, L.border.w, L.border.h, null, 1.6);
  ctx.font = `bold 13px ${FONT}`; ctx.fillStyle = '#000'; ctx.textBaseline = 'middle';
  ctx.fillText(`LAMPIRAN FOTO SURVEI (${pageNo}/${total})`, L.border.x + 14, L.border.y + 18);
  ctx.font = `9px ${FONT}`;
  ctx.fillText((sv.judul || '').toUpperCase().slice(0, 190), L.border.x + 14, L.border.y + 34);
  const gx = L.border.x + 14, gy = L.border.y + 48, gw = L.border.w - 28, gh = L.border.h - 62;
  const cw = gw / 3, ch = gh / 2;
  items.forEach((it, i) => {
    const cx = gx + (i % 3) * cw, cy = gy + Math.floor(i / 3) * ch;
    rect(ctx, cx + 4, cy + 4, cw - 8, ch - 8, '#fafafa', 0.6);
    const im = it.img, aw = cw - 20, ah = ch - 48;
    if (im) { const s = Math.min(aw / im.width, ah / im.height); ctx.drawImage(im, cx + 10 + (aw - im.width * s) / 2, cy + 10 + (ah - im.height * s) / 2, im.width * s, im.height * s); }
    cellText(ctx, it.title, cx + 6, cy + ch - 38, cw - 12, 14, { bold: true, size: 9 });
    cellText(ctx, it.sub, cx + 6, cy + ch - 24, cw - 12, 14, { size: 8 });
  });
  ctx.restore();
}

// ---------- pembuat PDF (gambar JPEG per halaman) ----------
function buildPDF(pages) {
  const enc = new TextEncoder(); const parts = []; const offs = []; let len = 0;
  const push = d => { const b = typeof d === 'string' ? enc.encode(d) : d; parts.push(b); len += b.length; };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length; const obj = id => { offs[id] = len; };
  obj(1); push('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n');
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(2); push(`2 0 obj<</Type/Pages/Count ${n}/Kids[${kids}]>>endobj\n`);
  pages.forEach((p, i) => {
    const pid = 3 + i * 3, cid = pid + 1, iid = pid + 2;
    const W = PAGE.w.toFixed(2), H = PAGE.h.toFixed(2);
    obj(pid); push(`${pid} 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Resources<</XObject<</Im${i} ${iid} 0 R>>>>/Contents ${cid} 0 R>>endobj\n`);
    const cs = `q ${W} 0 0 ${H} 0 0 cm /Im${i} Do Q`;
    obj(cid); push(`${cid} 0 obj<</Length ${cs.length}>>stream\n${cs}\nendstream endobj\n`);
    obj(iid); push(`${iid} 0 obj<</Type/XObject/Subtype/Image/Width ${p.w}/Height ${p.h}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${p.jpeg.length}>>stream\n`);
    push(p.jpeg); push('\nendstream endobj\n');
  });
  const total = 3 + n * 3; const xref = len;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer<</Size ${total}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}
async function canvasToJpeg(cv, q = 0.9) {
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', q));
  return { jpeg: new Uint8Array(await blob.arrayBuffer()), w: cv.width, h: cv.height };
}
