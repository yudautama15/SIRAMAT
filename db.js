// Penyimpanan lokal (IndexedDB): survei dan foto
const DB = (() => {
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('survei-pln', 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('surveys')) db.createObjectStore('surveys', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(store, mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      const out = fn(s);
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
    });
  }
  return {
    allSurveys: () => tx('surveys', 'readonly', s => s.getAll()),
    getSurvey: id => tx('surveys', 'readonly', s => s.get(id)),
    putSurvey: sv => tx('surveys', 'readwrite', s => s.put(sv)),
    delSurvey: id => tx('surveys', 'readwrite', s => s.delete(id)),
    getPhoto: id => tx('photos', 'readonly', s => s.get(id)),
    putPhoto: p => tx('photos', 'readwrite', s => s.put(p)),
    delPhoto: id => tx('photos', 'readwrite', s => s.delete(id)),
  };
})();

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Jarak dua koordinat (meter)
function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function blobToDataURL(blob) {
  return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
}
function dataURLToBlob(d) {
  const [h, b] = d.split(','); const mime = h.match(/:(.*?);/)[1];
  const bin = atob(b); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return new Blob([u], { type: mime });
}
