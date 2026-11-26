// Peta ringan berbasis canvas (tanpa library) dengan tile OSM / citra satelit
class SurveyMap {
  constructor(canvas, opts = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.opts = opts;
    this.lat = 1.2833; this.lng = 97.6167; this.z = 13; // default: Gunungsitoli
    this.layer = 'osm';
    this.tiles = new Map();
    this.points = []; this.selected = null; this.gps = null; this.showCross = true;
    this.pointers = new Map();
    this._raf = 0;
    this._bind();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }
  static LAYERS = {
    osm: { url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, max: 19, attr: '© OpenStreetMap' },
    sat: { url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`, max: 19, attr: 'Citra © Esri' },
  };
  resize() {
    const r = this.cv.getBoundingClientRect(); const d = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.cv.width = Math.max(1, r.width * d); this.cv.height = Math.max(1, r.height * d);
    this.ctx.setTransform(d, 0, 0, d, 0, 0);
    this.draw();
  }
  project(lat, lng, z) {
    const s = 256 * 2 ** z; const sin = Math.sin(lat * Math.PI / 180);
    return { x: (lng + 180) / 360 * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
  }
  unproject(x, y, z) {
    const s = 256 * 2 ** z; const n = Math.PI - 2 * Math.PI * y / s;
    return { lat: 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lng: x / s * 360 - 180 };
  }
  toScreen(lat, lng) {
    const c = this.project(this.lat, this.lng, this.z), p = this.project(lat, lng, this.z);
    return { x: p.x - c.x + this.w / 2, y: p.y - c.y + this.h / 2 };
  }
  toLatLng(sx, sy) {
    const c = this.project(this.lat, this.lng, this.z);
    return this.unproject(c.x + sx - this.w / 2, c.y + sy - this.h / 2, this.z);
  }
  setView(lat, lng, z) { this.lat = lat; this.lng = lng; if (z != null) this.z = z; this.draw(); }
  setLayer(l) { this.layer = l; this.draw(); }
  setData(points, selected, gps) { this.points = points || []; this.selected = selected; this.gps = gps; this.draw(); }
  fit(points) {
    const pts = (points || this.points).filter(p => p.lat != null);
    if (!pts.length) return false;
    if (pts.length === 1) { this.setView(pts[0].lat, pts[0].lng, 18); return true; }
    let a = Math.min(...pts.map(p => p.lat)), b = Math.max(...pts.map(p => p.lat));
    let c = Math.min(...pts.map(p => p.lng)), d = Math.max(...pts.map(p => p.lng));
    let z = 20;
    while (z > 3) {
      const p1 = this.project(b, c, z), p2 = this.project(a, d, z);
      if (p2.x - p1.x < this.w * 0.75 && p2.y - p1.y < this.h * 0.7) break;
      z--;
    }
    this.setView((a + b) / 2, (c + d) / 2, Math.min(z, 19));
    return true;
  }
  zoomAt(factor, sx, sy) {
    const before = this.toLatLng(sx, sy);
    this.z = Math.max(3, Math.min(21, this.z + Math.log2(factor)));
    const after = this.toLatLng(sx, sy);
    this.lat += before.lat - after.lat; this.lng += before.lng - after.lng;
    this.draw();
  }
  panBy(dx, dy) {
    const c = this.project(this.lat, this.lng, this.z);
    const ll = this.unproject(c.x - dx, c.y - dy, this.z);
    this.lat = Math.max(-85, Math.min(85, ll.lat)); this.lng = ll.lng; this.draw();
  }
  _bind() {
    const cv = this.cv;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', e => {
      cv.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (this.pointers.size === 1) this._tap = { x: e.offsetX, y: e.offsetY, t: Date.now(), moved: false };
      else this._tap = null;
    });
    cv.addEventListener('pointermove', e => {
      const prev = this.pointers.get(e.pointerId); if (!prev) return;
      const cur = { x: e.offsetX, y: e.offsetY };
      if (this.pointers.size === 1) {
        if (this._tap && Math.hypot(cur.x - this._tap.x, cur.y - this._tap.y) > 8) this._tap.moved = true;
        if (!this._tap || this._tap.moved) this.panBy(cur.x - prev.x, cur.y - prev.y);
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.entries()];
        const other = a[0] === e.pointerId ? b[1] : a[1];
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
        if (d0 > 0) this.zoomAt(d1 / d0, (cur.x + other.x) / 2, (cur.y + other.y) / 2);
      }
      this.pointers.set(e.pointerId, cur);
    });
    const up = e => {
      if (this._tap && !this._tap.moved && Date.now() - this._tap.t < 500 && this.pointers.size === 1) {
        this._handleTap(this._tap.x, this._tap.y);
      }
      this.pointers.delete(e.pointerId); this._tap = null;
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', e => { this.pointers.delete(e.pointerId); this._tap = null; });
    cv.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.offsetX, e.offsetY); }, { passive: false });
  }
  _handleTap(x, y) {
    let best = null, bd = 24;
    for (const p of this.points) {
      if (p.lat == null) continue;
      const s = this.toScreen(p.lat, p.lng); const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    if (best) this.opts.onTapPoint && this.opts.onTapPoint(best.id);
    else this.opts.onTapEmpty && this.opts.onTapEmpty(this.toLatLng(x, y));
  }
  _tile(z, x, y) {
    const key = `${this.layer}/${z}/${x}/${y}`;
    let t = this.tiles.get(key);
    if (!t) {
      const img = new Image(); img.crossOrigin = 'anonymous';
      t = { img, ok: false, err: false };
      img.onload = () => { t.ok = true; this.draw(); };
      img.onerror = () => { t.err = true; };
      img.src = SurveyMap.LAYERS[this.layer].url(z, x, y);
      this.tiles.set(key, t);
      if (this.tiles.size > 600) { const k = this.tiles.keys().next().value; this.tiles.delete(k); }
    }
    return t;
  }
  draw() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._draw(); });
  }
  _draw() {
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.fillStyle = '#e8e6df'; ctx.fillRect(0, 0, w, h);
    const L = SurveyMap.LAYERS[this.layer];
    const tz = Math.max(0, Math.min(L.max, Math.round(this.z)));
    const sc = 2 ** (this.z - tz);
    const c = this.project(this.lat, this.lng, tz);
    const ts = 256 * sc, n = 2 ** tz;
    const x0 = Math.floor((c.x - w / 2 / sc) / 256), x1 = Math.floor((c.x + w / 2 / sc) / 256);
    const y0 = Math.floor((c.y - h / 2 / sc) / 256), y1 = Math.floor((c.y + h / 2 / sc) / 256);
    for (let tx = x0; tx <= x1; tx++) for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      const sx = (tx * 256 - c.x) * sc + w / 2, sy = (ty * 256 - c.y) * sc + h / 2;
      const t = this._tile(tz, wx, ty);
      if (t.ok) { ctx.drawImage(t.img, sx, sy, ts + 0.5, ts + 0.5); continue; }
      // fallback: pakai tile induk yang sudah tersimpan (berguna saat offline)
      for (let up = 1; up <= 4 && tz - up >= 0; up++) {
        const pz = tz - up, f = 2 ** up;
        const key = `${this.layer}/${pz}/${Math.floor(wx / f)}/${Math.floor(ty / f)}`;
        const pt = this.tiles.get(key);
        if (pt && pt.ok) {
          const sub = 256 / f;
          ctx.drawImage(pt.img, (wx % f) * sub, (ty % f) * sub, sub, sub, sx, sy, ts + 0.5, ts + 0.5);
          break;
        }
      }
    }
    this._overlay();
    ctx.font = '10px sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.8)';
    const at = L.attr; const tw = ctx.measureText(at).width;
    ctx.fillRect(w - tw - 8, h - 14, tw + 8, 14); ctx.fillStyle = '#333'; ctx.fillText(at, w - tw - 4, h - 4);
  }
  _overlay() {
    const ctx = this.ctx;
    const byId = Object.fromEntries(this.points.map(p => [p.id, p]));
    // garis
    for (const p of this.points) {
      const q = p.parent && byId[p.parent]; if (!q || p.lat == null || q.lat == null) continue;
      const a = this.toScreen(q.lat, q.lng), b = this.toScreen(p.lat, p.lng);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      if (p.type === 'jalan') { ctx.strokeStyle = 'rgba(90,90,90,.55)'; ctx.lineWidth = 8; ctx.setLineDash([]); }
      else {
        ctx.strokeStyle = p.jar === 'TM' ? '#d62828' : '#1d8fd6'; ctx.lineWidth = 3;
        ctx.setLineDash(p.segStatus === 'eks' ? [] : p.segStatus === 'bongkar' ? [2, 5] : [8, 6]);
      }
      ctx.stroke(); ctx.setLineDash([]);
      if (p.type !== 'jalan' && p.type !== 'label') {
        const d = haversine(q, p); const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const txt = d.toFixed(0) + ' m';
        ctx.font = 'bold 11px sans-serif'; const tw = ctx.measureText(txt).width;
        ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(mx - tw / 2 - 3, my - 8, tw + 6, 15);
        ctx.fillStyle = '#123'; ctx.fillText(txt, mx - tw / 2, my + 4);
      }
    }
    // titik
    for (const p of this.points) {
      if (p.lat == null) continue;
      const s = this.toScreen(p.lat, p.lng);
      if (p.id === this.selected) {
        ctx.beginPath(); ctx.arc(s.x, s.y, 16, 0, 7); ctx.fillStyle = 'rgba(255,200,0,.45)'; ctx.fill();
      }
      SurveyMap.symbol(ctx, p, s.x, s.y, 1);
      let lbl = p.type === 'tiang' ? 'T' + (p.no || '') : p.type === 'gardu' ? (p.kode || 'Gardu') :
        p.type === 'pelanggan' ? (p.nama || 'Pelanggan') : p.type === 'label' ? (p.teks || 'Label') : '';
      if (lbl) {
        ctx.font = 'bold 12px sans-serif';
        ctx.lineWidth = 3; ctx.strokeStyle = '#fff'; ctx.strokeText(lbl, s.x + 10, s.y - 9);
        ctx.fillStyle = '#111'; ctx.fillText(lbl, s.x + 10, s.y - 9);
      }
    }
    // GPS
    if (this.gps) {
      const s = this.toScreen(this.gps.lat, this.gps.lng);
      const mpp = 156543.03 * Math.cos(this.gps.lat * Math.PI / 180) / 2 ** this.z;
      const r = Math.max(6, this.gps.acc / mpp);
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, 7); ctx.fillStyle = 'rgba(30,120,255,.15)'; ctx.fill();
      ctx.strokeStyle = 'rgba(30,120,255,.5)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(s.x, s.y, 7, 0, 7); ctx.fillStyle = '#1e78ff'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    if (this.showCross) {
      const x = this.w / 2, y = this.h / 2;
      ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x - 4, y); ctx.moveTo(x + 4, y); ctx.lineTo(x + 12, y);
      ctx.moveTo(x, y - 12); ctx.lineTo(x, y - 4); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 12); ctx.stroke();
    }
  }
  // Simbol sesuai keterangan pada format gambar survei (dipakai juga di PDF)
  static symbol(ctx, p, x, y, k) {
    ctx.save(); ctx.setLineDash([]);
    if (p.type === 'tiang') {
      const r = 7 * k;
      if (p.status === 'rencana') {
        ctx.strokeStyle = '#e0141e'; ctx.lineWidth = 3.2 * k; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
        ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
        if (p.jenis === 'beton') { ctx.fillStyle = '#000'; ctx.fill(); }
        else if (p.jenis === 'besi') {
          ctx.beginPath(); ctx.moveTo(x, y - r); ctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, true);
          ctx.closePath(); ctx.fillStyle = '#000'; ctx.fill();
        }
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.6 * k; ctx.stroke();
        if (p.status === 'bongkar') {
          ctx.strokeStyle = '#e0141e'; ctx.lineWidth = 2 * k;
          ctx.beginPath(); ctx.moveTo(x - r * 1.5, y + r * 1.5); ctx.lineTo(x + r * 1.5, y - r * 1.5); ctx.stroke();
        }
      }
    } else if (p.type === 'gardu') {
      const r = 9 * k;
      ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.75); ctx.lineTo(x - r, y + r * 0.75); ctx.closePath();
      ctx.fillStyle = p.status === 'rencana' ? '#e0141e' : p.status === 'bongkar' ? '#9a9a9a' : '#1a2a9c'; ctx.fill();
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1 * k; ctx.stroke();
    } else if (p.type === 'pelanggan') {
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 8 * k, y - 6 * k, 16 * k, 12 * k);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.6 * k; ctx.strokeRect(x - 8 * k, y - 6 * k, 16 * k, 12 * k);
      ctx.beginPath(); ctx.moveTo(x - 8 * k, y - 6 * k); ctx.lineTo(x, y - 12 * k); ctx.lineTo(x + 8 * k, y - 6 * k); ctx.stroke();
    } else if (p.type === 'jalan') {
      ctx.fillStyle = '#777'; ctx.fillRect(x - 3 * k, y - 3 * k, 6 * k, 6 * k);
    } else if (p.type === 'label') {
      ctx.beginPath(); ctx.arc(x, y, 3 * k, 0, 7); ctx.fillStyle = '#555'; ctx.fill();
    }
    ctx.restore();
  }
}
