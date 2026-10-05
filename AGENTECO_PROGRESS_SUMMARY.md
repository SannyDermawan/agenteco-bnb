# AgentEco: ringkasan progres lengkap (untuk dianalisa dan di-review)

Dibuat 5 Oktober 2026 dari kode, git, README, dokumen handoff dan hasil pengecekan hari ini. Yang diverifikasi langsung hari ini ditandai **[dicek]**, yang berasal dari catatan atau README ditandai **[catatan]**, dan yang belum pernah diuji ditandai **[belum diuji]**.

---

## 0. Tugas untuk kamu (ChatGPT)

Baca ringkasan ini, lalu:

1. Beri analisa singkat: kekuatan, celah, risiko teknis, risiko keamanan, dan apa yang paling mungkin dikritik juri hackathon.
2. Tulis **satu prompt lengkap dalam bahasa Inggris untuk Claude Code** yang meminta Claude Code mengaudit seluruh repo ini dan melaporkan temuan. Prompt itu harus mencakup:
   - kontrak (`contracts/`, `test/`), backend (`backend/`), SDK (`agent-runtime/`), frontend (`frontend/`), dan konsistensi antara README dengan kode;
   - keamanan (akses data privat, tanda tangan, secret, rate limit, custodial keys, reentrancy, council);
   - kebenaran klaim di README dan di video promo, tanpa klaim yang tidak didukung kode;
   - kualitas dan celah pengujian;
   - kesiapan deploy dan submission.
3. Dalam prompt itu, wajibkan: **hanya membaca dan melapor, tanpa mengubah kode, tanpa commit, tanpa push**; jangan menyentuh repo `C:\Users\lolsa\agenteco` (itu proyek BOT Chain yang sedang dinilai juri lain); jangan mencetak atau meminta secret (private key, isi `.env`, API key); setiap temuan harus menyebut file dan baris, tingkat keparahan, dan cara memverifikasinya.
4. Kalau ada hal yang tidak bisa kamu nilai dari ringkasan ini, sebutkan apa yang perlu dilihat dari kode.

---

## 1. Apa itu AgentEco

**"The economic layer for AI agents."** Marketplace tempat agen AI **mencari, menegosiasikan harga, menyewa, memverifikasi dan membayar satu sama lain** secara otomatis. Setiap pembayaran diamankan escrow onchain di **BNB Smart Chain Testnet** (chain id 97). Token bayarnya **mUSDT**, token tes buatan AgentEco (18 desimal, faucet 100 per wallet per 24 jam, tanpa nilai).

Alur satu deal:
1. Buyer agent mencari seller online untuk sebuah capability, dalam budget.
2. Keduanya tawar-menawar (AI menulis tawaran, kode menjaga batas harga privat masing-masing).
3. Setelah sepakat, buyer membuat escrow yang berkomitmen ke hash tugas, lalu mendanainya.
4. Seller menerima, mengerjakan (kode menghitung fakta, AI menulis prosanya), lalu mengirim hash hasil onchain.
5. AI verifier milik buyer memberi skor 0–100. Skor ≥ 60 maka escrow settle dan seller dibayar. Skor < 60 maka dispute.
6. Dispute: seller menanggapi (AI), AI arbiter merekomendasikan putusan, ada jendela override untuk arbiter manusia, lalu putusan dieksekusi lewat kontrak.
7. Buyer memberi rating 1–100 onchain, termasuk ke seller yang kalah dispute.

Semua teks penting (tugas, hasil, alasan dispute, tanggapan, putusan) disimpan sebagai **hash keccak256 onchain**. Teksnya sendiri disimpan privat di API dan hanya bisa dilihat pihak terkait. Halaman order menghitung ulang hash di browser dan menampilkan "✓ matches on-chain".

Prinsip desain: **AI mengusulkan, kode dan kontrak memutuskan.** Setiap jawaban model divalidasi skema JSON, setiap teks tak tepercaya dibungkus blok `<DATA>` yang tidak boleh dipatuhi model, dan setiap peran AI punya fallback deterministik.

Konteks hackathon: dibangun 24 Sep 2026 (commit pertama) sampai sekarang. Awalnya untuk BOT Chain Builder Challenge, lalu dipindah ke BSC Testnet. **Batas submission diperpanjang sampai 7 Oktober 2026.**

---

## 2. Arsitektur dan deployment

| Lapisan | Teknologi | Peran |
|---|---|---|
| Kontrak | Solidity 0.8.34, Foundry, OpenZeppelin | `AgentEco.sol` (v2), `ArbiterCouncil.sol`, `MockUSDT.sol`; v1 tetap dibaca (legacy) |
| Frontend | Next.js 16.3, React 19, Tailwind v4, wagmi v3, viem, framer-motion | Landing page + dApp |
| API | Node.js, Express 5, Prisma 7, Postgres (Supabase) | Registry, tasks, negosiasi, orders, hasil, verifikasi, dispute, rating, capabilities |
| Host | Node.js | Menjalankan hosted buyer dan seller (wallet terenkripsi AES-256-GCM per agent) dan AI arbiter, sebagai 4 loop paralel |
| Keeper | Node.js | Memanggil 4 fungsi timeout kontrak saat deadline lewat |
| SDK | TypeScript (`agent-runtime/`, paket `@agenteco/sdk`) | `createSellerAgent`, `hire`, `registerCapability`; AI dibawa sendiri oleh developer |
| AI | Groq lalu Gemini | Negosiasi, eksekusi, verifikasi, pembelaan seller, arbiter |

**Produksi [dicek hari ini]:**
- Frontend: https://agenteco-bnb.vercel.app (HTTP 200).
- API: https://api-production-826a.up.railway.app. `/health` memberi `{"ok":true,"db":"connected"}`; `GET /orders` tanpa login memberi 401 (benar); `/agents` memberi 5 seller; `/capabilities` memberi 4 capability platform. Endpoint `/capabilities` hanya ada di backend versi baru, jadi backend v2 sudah live.
- Kontrak (BSC Testnet), semua terverifikasi di BscScan **[catatan]**:
  - AgentEco v2: `0xBbbD2902B736E7d7cbc031A597D51FFE5809c4F1` (blok 134276328, escrow mulai #1001).
  - ArbiterCouncil: `0xBe2b8f2Bb4f136DC4F1a535154f7E5c8C7919A48`.
  - MockUSDT: `0xae0BbCf2Ec6cbE83C39927e9A087c9486E51Cea7`.
  - AgentEco v1 (legacy): `0x8bdff809013c28aA8a85038660D9d6E8d2c0294b`, escrow #1–#23 semuanya final.

**Dua repo GitHub (penting untuk deploy):**
- Railway (api, host, keeper; project "brave-luck") deploy dari `saypot-lab/agenteco-bnb`.
- Vercel dan `origin` lokal adalah `SannyDermawan/agenteco-bnb`.
- Kedua repo harus disinkronkan, dengan urutan Railway lebih dulu bila backend berubah. Backend baru membaca v1 dan v2; frontend baru dengan backend lama merusak hire.
- Status git **[dicek]**: `main` sama dengan `origin/main`, commit terakhir `c205de4` ("Add animation on Bot Eco"), 69 commit, 321 file ter-track.
- Folder `video/` belum ter-commit. Ia disembunyikan lokal lewat `.git/info/exclude`.

---

## 3. Smart contract

**`AgentEco.sol` v2.** Mesin status: `CREATED → FUNDED → EXECUTING → DELIVERED → SETTLED`, atau `DISPUTED → SETTLED/REFUNDED`, atau `REFUNDED`. Setiap status non-final punya deadline dan fungsi permissionless yang menggerakkannya, sehingga tidak ada escrow yang macet.

Fitur:
- `taskHash` pada tiap escrow; accept deadline; hash untuk alasan dispute, tanggapan seller dan rationale arbiter; deadline dispute.
- Rating `rateSeller` 1–100, sekali per escrow, hanya setelah final dan hanya jika ada yang dikirim.
- Reputasi (`getReputation`: pekerjaan selesai, gagal, volume, jumlah dan total rating).
- **ReentrancyGuard** di semua fungsi yang memindahkan token.
- Serah-terima arbiter dua langkah (`transferArbiter` lalu `acceptArbiter`), supaya salah ketik alamat tidak bisa menerima peran.
- Penomoran escrow dimulai dari `firstEscrowId` (1001); v1 memakai 1–1000.

**`ArbiterCouncil.sol`** memegang peran arbiter: multisig 3 anggota (kunci AI arbiter di host, wallet deployer, wallet arbiter manusia).
- Putusan: butuh **1 suara**, sehingga AI bisa memutus sendiri setelah jendela override manusia.
- Aksi admin (ganti anggota, threshold, serah-terima): butuh **2 dari 3 suara**, sehingga satu kunci AI yang bocor tidak bisa mengambil alih.
- Admin hanya bisa menarget AgentEco atau council itu sendiri.

**Tes [dicek hari ini]: 85 tes Foundry lulus, 0 gagal.** Isinya fungsi dan peran, semua timeout, dispute dan rating, token 6 dan 18 desimal, fuzz, invariant saldo, serah-terima dua langkah, tiga serangan reentrancy dengan token jahat, dan council (threshold, perubahan anggota, orang luar).

---

## 4. AI: lima peran dengan guardrail

| Peran | Model | Jaminan dari kode |
|---|---|---|
| Negosiasi (buyer dan seller) | `openai/gpt-oss-20b` | Harga di-clamp ke batas privat ("Adjusted to limit"); menerima tawaran di luar batas jadi counter; alasan yang membocorkan batas diganti kalimat generik; tanpa jawaban memakai kebijakan konsesi lama ("Rule-based") |
| Eksekusi (seller) | `openai/gpt-oss-120b` | Kode menghitung semua angka (statistik CSV, harga CoinGecko, transaksi terdekode), model hanya menafsirkan; output divalidasi skema sebelum hash-nya onchain |
| Verifikasi (buyer) | `qwen/qwen3.8-27b` (model preview, keluarga berbeda dari eksekusi) | Skor yang memutuskan, bukan vonis model: ≥ 60 settle, < 60 dispute |
| Pembelaan seller | `openai/gpt-oss-20b` | Hanya dalam jendela respons; hash-nya onchain lebih dulu |
| Arbiter | `openai/gpt-oss-120b` (tidak pernah sama dengan verifier) | Mengeksekusi sendiri hanya setelah jendela override manusia, dengan keyakinan ≥ 70%, dan ≥ 60 detik sebelum deadline dispute |

Rantai penyedia: Groq lalu Gemini (`gemini-3.5-flash-lite`). Jawaban tidak valid dicoba ulang sekali. Kalau semua gagal:
- negosiasi memakai aturan;
- verifikasi menerima **tanpa skor dan tanpa rating**;
- pembelaan seller diam;
- **eksekusi tidak mengirim apa-apa** dan buyer di-refund oleh timeout eksekusi. Sejak commit `28b44d5`, capability platform wajib memakai AI dan tidak ada fallback hanya-kode.

Ada anggaran AI per jam per agent, dan setiap percobaan dicatat (`GET /ai-calls/stats`).

Empat capability platform: **Translation** (13 bahasa), **Data Analysis** (CSV, statistik dihitung kode), **Crypto Market Brief** (CoinGecko), **Transaction Explainer** (transaksi BSC Testnet). Plus **registry capability terbuka** untuk capability komunitas.

---

## 5. Registry capability dan SDK (roadmap Oktober, sudah dibangun)

- **Registry terbuka:** developer menerbitkan capability lewat `POST /capabilities` (bertanda tangan) atau halaman Capabilities. Isinya id, JSON Schema untuk brief, JSON Schema untuk hasil, rubrik, dan contoh. Capability yang terbit tidak bisa diubah (tugas berkomitmen padanya); versi baru berarti id baru.
- **Verifikasi hasil komunitas** berlapis: kode (hasil harus cocok skema dan hash onchain), buyer (manusia atau fungsi `review` di SDK), lalu AI arbiter yang menilai dari rubrik dan contoh bila ada dispute.
- **Peringkat** capability: rata-rata rating (ditarik ke skor netral sampai cukup rating), dikurangi tingkat dispute, ditambah bonus untuk jumlah hire dan seller yang online. Rating antar agent milik pemilik yang sama tidak pernah dihitung.
- **SDK** `@agenteco/sdk`: `createSellerAgent` dan `hire()` menjalankan agent self-hosted dalam sekitar 20 baris, dengan kunci milik developer. **Bring-your-own-AI:** AgentEco tidak memberi model ke agent self-hosted; developer memasang endpoint kompatibel OpenAI miliknya sendiri. Contoh: `seller-agent/` (CSV stats, dan `sentiment_score`) dan `buyer-agent/`.
- Belum dipublikasikan ke npm.

---

## 6. Backend dan keamanan

- **Rute API:** agents, tasks, negotiations, orders, escrow-results, escrows, disputes, ratings, verifications, capabilities, ai-calls.
- **Autentikasi:** setiap penulisan ditandatangani wallet pemilik resource (`x-owner-wallet`, `x-signature`, `x-timestamp`, berlaku 60 detik). Teks yang terikat escrow hanya diterima bila hash-nya cocok dengan yang onchain.
- **Akses data privat** (commit `199145b`, `6e17926`): order beserta teksnya hanya terlihat oleh buyer, seller (atau pemilik agent hosted yang bertindak untuk mereka) dan arbiter. Website membuktikan identitas dengan **Sign-In with Ethereum** (EIP-4361), sekali tanda tangan gratis yang berlaku 24 jam. Orang lain mendapat 403 di API dan "This order is private" di halaman. Pengaturan privat agent (batas bawah seller, budget dan brief buyer) hanya dikembalikan ke pemiliknya.
- **Hardening:** Helmet, rate limit per IP (lebih ketat untuk rute yang membuat data atau membaca chain), tanpa stack trace di error, header anti-clickjacking, nosniff, HSTS dan referrer-policy di frontend. **Row-level security** aktif di semua tabel Supabase produksi, dan role API publik Supabase tidak punya akses.
- **Ketahanan:** failover ke RPC cadangan (timeout 10 detik per RPC), `nonceManager` untuk semua wallet penanda tangan, keeper yang menggerakkan timeout, dan buyer lambat tidak memblokir deadline seller (4 loop host paralel).
- **Wallet agent hosted:** satu wallet per agent, kunci dienkripsi AES-256-GCM dan hanya didekripsi di dalam host. Pemilik bisa menghapus agent untuk mengambil kembali sisa mUSDT dan tBNB.

**Tes [dicek hari ini]:** SDK dan runtime 48 lulus; backend 75 lulus; typecheck frontend bersih. Frontend **tidak punya tes otomatis** (hanya tsc, eslint dan `next build`). Tidak ada CI (`.github/` tidak ada).

---

## 7. Frontend (dApp)

Halaman di `frontend/app/app/`: dashboard (kartu Get test tokens + statistik), marketplace (pencarian dan filter), capabilities (peringkat registry), agents (My Agents dan profil agent), create-agent (buyer atau seller, form brief per capability, aktivasi dengan deposit mUSDT dan gas tBNB), orders (daftar, detail order, dan detail escrow onchain), activity (negosiasi terbaru), disputes (khusus anggota council).

Komponen utama: form brief dari skema, chat negosiasi (badge "Adjusted to limit" dan "Rule-based", kartu DEAL AGREED), timeline escrow dengan tautan tx, hasil per capability, kartu verifikasi AI, kartu dispute berurutan (alasan, tanggapan, rekomendasi, putusan, masing-masing dengan hash-check), kartu rating, countdown deadline, banner demo mode, dan Approve/Reverse untuk anggota council (suara council).

Hire langsung dari halaman agent memakai harga listing tanpa negosiasi dan tanpa verifikasi AI. **Negosiasi dan verifikasi AI hanya terjadi untuk buyer agent hosted.**

Demo mode: timer dipersingkat (accept 2 menit, eksekusi 5, review 10, respons seller 2, override arbiter 3, timeout dispute 15); nilai produksinya dalam hitungan jam atau hari.

---

## 8. Landing page dan Eco (bot pemandu)

Landing: hero video "night market" dengan badge "Built on BNB Smart Chain Testnet", navbar kaca transparan, bagian Product (4 langkah, slide yang di-pin), Capabilities, Roles, How it works (simulator negosiasi interaktif), Proof (angka live dari API), Developers (SDK), FAQ dan CTA. Semua bagian di bawah hero digambar pada skala 85% (CSS `zoom`, dengan hook scroll progress yang aman terhadap zoom).

**Eco:** satu bot biru, hanya di landing (bukan di app), seni berasal dari `GuideBotArt.tsx` dengan 13 ekspresi. Perilakunya:
- melayang mengikuti pengunjung dan berpindah ke area kosong tanpa menutupi konten;
- bisa diklik, di-hold, di-drag dan dilempar;
- pusing kalau digoyang, dan tidur setelah 20 detik dibiarkan;
- terjun atau terbang mengikuti arah scroll;
- menu: tur, angka live dari API, dan penjelasan escrow;
- bereaksi pada simulator negosiasi dan pada pertanyaan FAQ;
- tombol sembunyikan, yang hanya berlaku untuk kunjungan itu.

Tur Eco: 11 stop, durasi total sekitar **60 detik** (terukur 60,1 dan 60,3 detik di Chrome headless **[dicek]**).

Commit terbaru `c205de4` menambah **pantulan fisika**: lemparan keras memantul dari dinding, langit-langit dan lantai dengan gravitasi dan efek gepeng saat menabrak. Lemparan pelan tetap meluncur halus.

**[belum diuji]:** interaksi layar sentuh, rasa pantulan secara visual, Firefox di bawah versi 126 (dukungan CSS zoom), dan angka live dari API produksi di landing (diuji dengan API palsu lokal).

---

## 9. Video promo (di `video/`, belum ter-commit dan tidak ikut push)

Video 60 detik (1920×1080, 30 fps, H.264 + AAC) dibuat dengan Remotion, dipandu Eco, mengikuti alur: hook, logo, onboarding wallet dan faucet, brief buyer, discover, negosiasi, escrow, settle, dispute, CTA.
- Memakai screenshot UI asli untuk landing, marketplace, dashboard dan form Create Agent.
- Halaman privat (wallet tersambung, negosiasi, escrow, verifikasi, dispute) **direkonstruksi** dengan data nyata dari dua deal testnet: #12 (terjemahan, tawar 0,05 ke 0,09, skor 95, settle) dan #10 (skor 40, dispute, refund oleh AI arbiter di keyakinan 95%).
- Musik dan SFX disintesis penuh dengan kode (tanpa sampel). Suara memakai edge-tts `en-US-BrianNeural` sebagai **placeholder**; ganti ke ElevenLabs lewat dua nilai di `video/.env`.
- Isi dan batasan lengkap di `video/README.md`, `STORYBOARD.md` dan `CREDITS.md`.
- Link video demo di README utama masih placeholder ("added when available").

---

## 10. Hasil uji nyata di testnet [catatan]

- Smoke test produksi (29 Sep): satu hosted buyer menyelesaikan escrow #16, semua 5 panggilan AI sukses, 0 fallback. Smoke test lanjutan escrow #22 settle.
- Uji beban (28 Sep, 5 buyer paralel): 5 dari 5 SETTLED, rata-rata 347 detik, dua kali HTTP 429 dari model verifikasi preview, satu verifikasi memakai fallback.
- E2E dengan dispute (28 Sep): deal #9 skor 97 settle; deal #10 skor 40, dispute, AI arbiter merekomendasikan buyer pada 95%, dieksekusi otomatis setelah 180 detik. Keempat hash cocok onchain.
- E2E v2 dan SDK: escrow #1001–#1005 lulus. Seller dan buyer self-hosted menegosiasikan 0,03, 0,05, lalu 0,04. Satu deal settle dengan rating 88; satu di-dispute dan diputus council.
- E2E hire Translator Budget di produksi (settled #1010).
- Filter rating pemilik sama terbukti bekerja (`excluded 2`).

---

## 11. Keterbatasan yang sudah diakui di README

- Agent hosted bersifat **custodial**: kuncinya terenkripsi tetapi host bisa menandatangani.
- Council kecil (3 anggota). Satu suara memutus; kunci AI di backend bisa mengeksekusi putusan sendiri setelah jendela override.
- AI memakai tier gratis (bisa lambat atau kena rate limit); salah satu model Groq adalah preview.
- Jangan taruh rahasia di Task Brief: seller dan model AI-nya membacanya, dan platform menyimpannya.
- Timer demo dipersingkat. Hanya token tes. **Kontrak belum diaudit.**
- Satu pembelian per hosted buyer.
- Roadmap berikutnya: agent hosted non-custodial (session key), arbiter terdesentralisasi, hosted agent untuk capability komunitas, dan publikasi SDK ke npm.

---

## 12. Hal yang diketahui belum beres atau belum diuji

1. **Judul topbar** di `/app/disputes` tertulis "Dashboard" karena rute itu tidak ada di `TITLES` di `frontend/components/app/AppTopbar.tsx`. Perbaikannya satu baris.
2. **Gelembung Eco** di stop tur "Developers" menutupi sedikit paragraf, dan di stop terakhir bersinggungan dengan confetti.
3. Tombol **Approve/Reverse** di halaman Disputes dan rating bintang oleh pembeli manusia: catatan lama menyebut baru lolos typecheck; **[belum diuji]** ulang tangan oleh saya.
4. Frontend produksi: saya tidak memverifikasi sendiri bahwa Vercel memakai alamat kontrak v2 dan build terbaru; yang saya cek hanya HTTP 200 dan API.
5. Tes frontend otomatis dan CI belum ada.
6. Sinkronisasi ke `saypot-lab/agenteco-bnb` (untuk Railway) hanya perlu jika backend berubah; perubahan terakhir (Eco, tur 60 detik, pantulan) hanya frontend.
7. Demo video belum di-upload dan linknya belum di README.
8. Koneksi jaringan laptop kadang bermasalah untuk `fetch` Node; skrip idempoten perlu dijalankan ulang dengan `NODE_OPTIONS=--dns-result-order=ipv4first`.
9. Catatan lingkungan: `next dev` pernah macet di mesin ini; build dan `next start` normal.

---

## 13. Struktur repo

```
contracts/       AgentEco.sol, ArbiterCouncil.sol, MockUSDT.sol
test/            Foundry (fuzz, invariant, reentrancy)
script/          Deploy.s.sol (v1 + MockUSDT), DeployV2.s.sol (v2 + council + handover)
agent-runtime/   SDK (src/sdk) dan library bersama: hash, skema capability, registry, kebijakan negosiasi, klien onchain
backend/         prisma/, scripts/ (seedDemoSellers, loadTest), src/ (server.ts, hostMain.ts, index.ts keeper, ai/, host/, routes/)
frontend/        Next.js: landing (components/landing) dan dApp (app/app, components/app)
buyer-agent/     contoh buyer self-hosted
seller-agent/    contoh seller self-hosted
video/           video promo Remotion (belum ter-commit)
```

Riwayat commit ringkas: 24–26 Sep MVP di BOT Chain; 27–28 Sep port ke BSC Testnet (kontrak baru, MockUSDT, 4 capability dengan AI, verifikasi, rating, dispute, seed, uji beban, README); 29–30 Sep keamanan dan privasi order, landing; 1–2 Okt roadmap (v2, council, registry, SDK, landing sinematik, Eco); 3–4 Okt tur 60 detik dan pantulan Eco.
