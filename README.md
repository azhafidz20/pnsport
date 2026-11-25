# PNS — Pegawai Negeri Strava

Mengabdi untuk Pace dan Speed.

Website statis dengan halaman beranda dan generator simulasi aktivitas lari berbasis GPX. Profil ekspor menggunakan Amazfit Active Edge.

## Jalankan secara lokal

Tidak memerlukan instalasi paket, backend, database, atau akun. Dari direktori proyek, jalankan:

```sh
python3 -m http.server 8080 --directory dist
```

Buka http://localhost:8080. Alternatif: buka `dist/index.html` langsung di browser. Peta online memerlukan internet; gambar rute offline digunakan jika Leaflet tidak tersedia.

## Deploy ke hosting statis

Gunakan `dist` sebagai direktori publik atau publish directory. Tidak ada perintah build. Unggah seluruh isi `dist`, termasuk subdirektori `assets`, ke hosting.

### Vercel

Konfigurasi `vercel.json` di root repo mengarahkan deployment ke folder `dist`. Gunakan Root Directory `.` (root repo) dan Framework Preset **Other**. Build Command dan Install Command dikosongkan karena berkas statis sudah tersedia. Output Directory ditetapkan ke `dist` oleh konfigurasi repo. Push ke branch `main` akan memicu deployment baru jika integrasi Git Vercel diaktifkan.

Jika seluruh halaman menampilkan 404, pastikan deployment terbaru menggunakan commit yang memuat `vercel.json`. Beranda berada di `dist/index.html`, bukan di root repo. Jangan menambahkan rewrite semua URL ke satu halaman: aplikasi ini memiliki dua halaman HTML beserta aset statisnya.

## Fitur

- Beranda PNS, panduan penggunaan, dan FAQ dengan tautan membuat rute di On The Go Map.
- Tema terang/gelap dan tata letak responsif.
- Unggah GPX; atur tanggal, waktu mulai WIB, pace, variasi, dan split.
- Estimasi kalori menggunakan berat badan, usia, dan pilihan jenis kelamin; tetap dihitung tanpa HR.
- HR dan cadence opsional, dengan variasi sintetis yang mengikuti perubahan pace dan gradien. Saat dimatikan, data tidak disertakan dalam TCX.
- Detail Aktivitas di atas Strava Preview yang ringkas dan dapat ditutup.
- Peta, split, serta grafik pace, elevasi, HR, dan cadence dengan tooltip mengikuti kursor.
- Ekspor TCX dengan kalori dan elevasi dari GPX jika tersedia.

Kalori memakai MET berdasarkan pace, berat, dan durasi jika HR dimatikan atau jenis kelamin tidak dipilih. Jika HR aktif dan jenis kelamin dipilih, estimasi memakai formula HR Keytel dengan profil pengguna. Semua angka merupakan estimasi untuk data simulasi.

Elevasi mengikuti GPX; data yang hilang tidak dibuat-buat. Nilai di antara titik GPX diinterpolasi. Total tanjakan dan turunan tidak menjembatani segmen yang terpisah.

## Struktur

```text
dist/
  index.html          # Beranda
  pelayanan.html      # Generator simulasi
  app.js              # Parser GPX, simulasi, grafik, dan ekspor TCX
  site.js             # Tema beranda dan navigasi
  site.css            # Identitas visual dan beranda
  tool.css            # Formulir generator
  preview.css         # Preview dan tooltip
  assets/             # Identitas visual PNS
tests/                # Pengujian logika dan rute sintetis
```

## Pemeriksaan

```sh
node --check dist/app.js
node --check dist/site.js
node tests/smoke.cjs
```

Pengujian mencakup semua kombinasi sensor, estimasi kalori, elevasi lengkap/hilang, endpoint dan split parsial, variasi HR/cadence, serta metadata TCX. Fixture GPX bersifat sintetis. Ekspor juga telah diperiksa terhadap skema resmi TrainingCenterDatabase v2 dan ActivityExtension v2.

## Catatan

File GPX diproses di browser tanpa diunggah ke backend. Leaflet dan OpenStreetMap digunakan untuk peta online. Hasil TCX berupa simulasi, bukan rekaman perangkat nyata. Tampilan dan perhitungan setelah diimpor ke layanan lain dapat berbeda; impor langsung ke Strava atau Zepp belum diuji. Namespace `garmin.com/xmlschemas` adalah bagian standar TCX, bukan pilihan perangkat Garmin.

## Referensi estimasi

- https://pacompendium.com/running/
- https://pubmed.ncbi.nlm.nih.gov/15966347/
