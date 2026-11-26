# Survei Material PLN – Panduan Pemasangan & Pemakaian

## Isi folder
| File | Fungsi |
|---|---|
| index.html | Tampilan aplikasi |
| app.js | Logika aplikasi (tagging, form, material, PDF) |
| map.js | Peta + GPS (tanpa library luar) |
| sheet.js | Rumus material + penggambar format gambar survei UP3 Nias + pembuat PDF |
| db.js | Penyimpanan offline di HP (IndexedDB) |
| sw.js | Service worker: aplikasi tetap terbuka tanpa internet |
| manifest.json, icon-*.png | Agar bisa diinstal sebagai aplikasi Android |

## 1. Upload ke GitHub Pages (gratis, sekali saja)
GPS dan kamera di HP hanya diizinkan lewat alamat **https**, jadi aplikasi perlu di-hosting.
1. Buat akun di github.com → **New repository** (misal `survei-pln`), pilih **Public**.
2. **Add file → Upload files** → seret semua file di folder ini → **Commit changes**.
3. **Settings → Pages** → Source: *Deploy from a branch*, Branch: `main` / `(root)` → **Save**.
4. Tunggu 1–2 menit. Alamatnya: `https://<nama-akun>.github.io/survei-pln/`

## 2. Instal di HP Android
1. Buka alamat di atas dengan **Chrome** (saat ada internet).
2. Menu ⋮ → **Instal aplikasi** / **Tambahkan ke layar utama**.
3. Ikon "Survei PLN" muncul di layar HP. Setelah ini aplikasi bisa dibuka **tanpa internet**.
4. Izinkan **Lokasi** (pilih *akurat/tepat*) dan **Kamera** saat diminta.

## 3. (Opsional) Jadikan file APK
1. Buka **pwabuilder.com** → masukkan alamat GitHub Pages tadi → **Start**.
2. Pilih **Android → Generate Package** → unduh zip → di dalamnya ada file **.apk** untuk dipasang di HP
   (aktifkan "Instal dari sumber tidak dikenal") atau **.aab** bila ingin diunggah ke Play Store.

## 4. Alur pemakaian di lapangan
1. **Sebelum berangkat (ada sinyal):** buka survei, geser & zoom peta di lokasi kerja (mode peta jalan dan satelit) supaya tile peta tersimpan untuk offline.
2. **+ Survei baru** → isi tab **Data** (judul, program, penyulang, nama & tanggal).
3. Tab **Peta** → berdiri di titik → tekan **TAG TITIK**. Aplikasi mengunci GPS (±m tampil berwarna), titik langsung tersimpan dan tersambung ke titik sebelumnya.
4. Di jendela titik: pilih jenis (Tiang / Gardu / Pelanggan / Teks-arah / Jalan), status rencana/eksisting/dibongkar, beton/besi, tinggi, konstruksi TM (SC1–SC8) & TR (X1/X3/X4 TR) – boleh pilih lebih dari satu, skur/spunh guy/grounding, status ruas (rencana / ganti kabel / eksisting / bongkar) dan penghantar, catatan rencana, lalu **Ambil foto**. Pengaturan titik berikutnya otomatis mengikuti titik sebelumnya.
5. **Percabangan:** ketuk titik induk di peta dulu, baru tekan TAG.
6. GPS lemah / survei dari meja: geser peta, letakkan tanda + di tengah layar pada lokasi, tekan **+ Tengah peta**.
7. Tab **Material** (Material HUTM, Material HUTR, Gardu Distribusi, Pembongkaran): angka otomatis dari tiang & konstruksi rencana, skur/spunh guy/grounding, panjang kabel × toleransi, trafo rencana; tiang/konstruksi/kabel/trafo yang dibongkar atau diganti otomatis masuk Pembongkaran. Ketik di kolom *Pakai* untuk mengganti. Bisa tambah baris material lain.
8. Tab **PDF**: pratinjau format gambar survei. Geser simbol/label/catatan agar rapi (tombol **Perbesar** membantu di HP), lalu **Buat PDF** atau **Bagikan** (WhatsApp, Drive, dll.).
9. **Ekspor** di beranda = file cadangan (.json, termasuk foto) untuk dipindah ke HP lain lewat **Impor**.

## Catatan penting
- Data tersimpan di HP. Menghapus data Chrome/aplikasi akan menghapus survei → rutin **Ekspor** sebagai cadangan.
- Saat file aplikasi di GitHub diperbarui, HP mengambil versi baru otomatis saat dibuka dengan internet.
