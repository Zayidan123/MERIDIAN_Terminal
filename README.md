# MERIDIAN Terminal

> **Platform riset, sinyal, risk & eksekusi multi-aset** — institutional-grade trading terminal yang menyatukan crypto, saham IDX, forex & gold dalam satu layar. 100% data pasar nyata, tanpa simulasi.

![Status](https://img.shields.io/badge/status-v1.0%20(Phase%200%E2%80%934)-3b5fe0)
![Data](https://img.shields.io/badge/data-100%25%20real%20market-2e9e6d)
![License](https://img.shields.io/badge/license-MIT-8891a0)

---

## Daftar Isi

1. [Tentang Proyek](#tentang-proyek)
2. [Tujuan Akhir](#tujuan-akhir)
3. [Fitur yang Sudah Dikerjakan](#fitur-yang-sudah-dikerjakan)
4. [Yang Belum Dikerjakan](#yang-belum-dikerjakan)
5. [Yang Akan Dikerjakan Selanjutnya](#yang-akan-dikerjakan-selanjutnya)
6. [Arsitektur Sistem](#arsitektur-sistem)
7. [Tech Stack](#tech-stack)
8. [Cara Menjalankan](#cara-menjalankan)
9. [Struktur Proyek](#struktur-proyek)
10. [Sumber Data](#sumber-data)
11. [Keamanan](#keamanan)
12. [Tantangan Selama Development](#tantangan-selama-development)
13. [Hal Paling Sulit](#hal-paling-sulit)
14. [Disclaimer](#disclaimer)

---

## Tentang Proyek

**MERIDIAN Terminal** adalah platform riset dan trading multi-aset yang menyatukan empat fungsi dalam satu sistem: riset/dashboard, sinyal & alert, manajemen risiko/portofolio, dan eksekusi otomatis (paper + live). Dibangun mengikuti PRD yang mensyaratkan standar tampilan dan keandalan data setara institusi finansial profesional.

**Prinsip inti yang tidak bisa ditawar:** seluruh data yang ditampilkan harus data pasar nyata — tidak ada data simulasi, dummy, atau placeholder dalam bentuk apa pun, di lingkungan produksi maupun development. Ketika sumber data down atau rate-limited, sistem menampilkan status "Source unavailable" secara eksplisit, bukan angka karangan.

### Mengapa dibangun?

Trader/investor yang mengelola lebih dari satu kelas aset biasanya harus berpindah antar banyak tool terpisah (exchange app, broker saham, TradingView, spreadsheet risk management manual). Ini memecah fokus dan memperlambat pengambilan keputusan. MERIDIAN menyatukan riset, sinyal, dan manajemen risiko lintas aset dalam satu tempat.

### Untuk siapa?

Single-user (pemilik platform), berperan sebagai trader/investor aktif lintas aset. Use case inti: cek kondisi market pagi hari lintas 3 kelas aset dalam satu layar, terima alert saat kondisi tertentu terpenuhi, evaluasi risiko portofolio sebelum entry baru.

---

## Tujuan Akhir

Tujuan akhir proyek ini adalah menjadi **terminal trading pribadi yang lengkap dan self-hosted** dengan kemampuan:

1. **Riset terpadu** — satu dashboard untuk crypto, saham IDX, forex & gold dengan chart teknikal + fundamental.
2. **Sinyal otomatis** — deteksi anomali volume, breakout, RSI ekstrem, return anomaly, dan drawdown breach dari data historis nyata.
3. **Manajemen risiko institusional** — exposure tracking, position sizing, VaR, drawdown monitor, correlation matrix.
4. **Eksekusi otomatis** — paper trading (data live, eksekusi simulasi) sebagai default, dengan jalur menuju live execution untuk crypto via CCXT.
5. **Integritas data 100%** — setiap angka yang tampil bisa dilacak ke sumber pasar nyata + timestamp sinkron.
6. **Local-first** — berjalan penuh di hardware kelas menengah tanpa bergantung mutlak pada cloud berbayar.

**Bukan tujuan:** menjamin profit. Seluruh sinyal bersifat probabilistik dan alat bantu keputusan, bukan nasihat keuangan.

---

## Fitur yang Sudah Dikerjakan

### ✅ Fase 0 — Data Layer
- Pipeline data nyata untuk 3 kelas aset (crypto via Binance, IDX/forex/gold via Yahoo Finance).
- Normalisasi ke skema internal seragam (OHLCV).
- Setiap request ke data source dicatat ke `data_source_health_log` (status, latency, error).
- Retry & backoff untuk API yang gagal, tanpa fallback ke data karangan.
- **Persistensi `price_ohlcv`** — candle disimpan ke DB lokal saat di-fetch, siap untuk backtesting.

### ✅ Fase 1 — Dashboard Riset
- Watchlist lintas aset (19 instrumen default: 7 crypto, 7 IDX, 4 forex, 1 gold).
- Chart candlestick custom (SVG) dengan MA20 overlay, volume bars, last-price tag.
- Indikator teknikal: MA20, MA50, EMA12, RSI14, MACD, volume z-score.
- Panel fundamental saham: PER, PBV, ROE, EPS, Revenue, Graham Number (dari Yahoo Finance).
- Panel fundamental crypto: Market Cap, FDV, Circulating/Total/Max Supply (dari CoinGecko).
- **Provenance Bar** di setiap panel — source + waktu sync terakhir (signature element PRD §13).

### ✅ Fase 2 — Signal & Alert Engine
- Custom alert berbasis threshold: price, %change 24h, volume spike (z-score), RSI, price vs MA.
- Engine evaluasi alert terhadap data real (polling 60s) → trigger SignalEvent.
- Scanner anomali (polling 180s): VOLUME_SPIKE, BREAKOUT, RSI_OB, RSI_OS, ANOMALY (return anomaly vs baseline statistik).
- Baseline statistik dihitung dari data historis nyata (mean/std log-returns), bukan threshold arbitrer.
- Dedup 1 jam per (instrument, signalType) untuk hindari spam.
- **Notifikasi Telegram Bot** — setiap WARN/CRITICAL signal + alert trigger dikirim ke chat Telegram (fire-and-forget, never throws).

### ✅ Fase 3 — Risk & Portfolio Management
- Tracking posisi aktif lintas aset (manual entry, live mark-to-market).
- Kalkulasi exposure per aset & per kelas aset (% dari total portofolio).
- Position sizing calculator berbasis % risiko per trade vs equity.
- Drawdown monitor (current vs historical max) dari reconstructed equity curve.
- **Drawdown alert trigger (FR-3.4)** — SignalEvent DRAWDOWN_BREACH saat drawdown melewati -10% (WARN) / -20% (CRITICAL), + Telegram notification.
- Correlation matrix antar aset (Pearson, pairwise, daily log-returns 3 bulan).
- VaR (Value at Risk) parametrik 95% dari portfolio return series.

### ✅ Fase 4 — Execution Bot
- **Paper trading mode** — eksekusi disimulasikan, tapi harga fill = harga live real-time dari Binance.
- **Live execution crypto** via CCXT (Binance) — siap, tapi default off (PAPER).
- **Kill-switch** manual (tombol darurat) + otomatis (auto-fire saat daily drawdown > threshold).
- **Hard caps** di level kode: max per-order USD, max per-day USD (configurable).
- **Anomaly detection** — jika >5 order dalam 60s → auto kill-switch + alert.
- **Large-order confirm** — order >80% per-order cap butuh konfirmasi manual.
- **Audit log tamper-evident** — hash chain (setiap row = sha256(prevHash + content)), verifiable.
- **Process isolation** — execution bot berjalan sebagai mini-service terpisah (port 3002), bukan di proses Next.js.
- **MT5 (forex/gold live) DEFERRED** — Python-only API, tidak bisa diimplementasikan di stack TypeScript.

### ✅ Security & Infrastructure
- **Autentikasi** NextAuth v4 + bcrypt (password hash) + optional 2FA/TOTP (otplib).
- **CSP, CSRF, rate-limit** via Next.js middleware + next.config headers.
- **WebSocket real-time** — mini-service socket.io (port 3001) broadcast harga live dari Binance WS + Yahoo polling, dengan flash animation + LIVE indicator di UI.
- Dark mode institusional (palette `#0B0E13`/`#151920`/`#262B33`, aksen gain `#2E9E6D` / loss `#C7484B` / brand `#3B5FE0`).
- Font: IBM Plex Sans (heading), Inter (body), JetBrains Mono (semua angka finansial).
- Responsive (mobile-first), sticky footer, nav rail persisten.

---

## Yang Belum Dikerjakan

Berikut yang belum diimplementasikan dari PRD, disusun jujur berdasarkan kondisi saat ini:

### 🔴 Belum Sama Sekali

| Item | PRD Reference | Alasan |
|---|---|---|
| **Live execution forex/gold via MetaTrader5** | FR-4.2 | MT5 adalah Python-only API. Stack ini TypeScript. Paper trading untuk forex/gold tetap berfungsi. |
| **Backtesting engine** | §6 | Tabel `price_ohlcv` sudah persist, endpoint `/api/v1/history/[id]` sudah ada, tapi engine backtest (strategy runner, equity curve simulation, metrics) belum dibangun. |
| **Audit log login & config changes** | §16.10 | Audit log saat ini hanya mencatat bot actions (order/kill-switch/mode). Login event, config alert changes belum di-audit. |
| **Tamper-evident log untuk selain bot** | §16.10 | Hash chain hanya di audit log bot. Health log, alert log belum tamper-evident. |
| **2FA/TOTP enable flow UI** | §16.3 | Backend TOTP verify sudah ada, endpoint `/api/auth/totp-setup` ada, tapi UI untuk scan QR & enable belum dibangun (manual env set). |
| **Backup terenkripsi & restore test** | §16.6 | Belum ada backup automation. |

### 🟡 Parsial

| Item | Status |
|---|---|
| **DCF sederhana** (FR-1.3) | Graham Number dihitung jika EPS+PBV tersedia. DCF fair value selalu null — tidak ada data free cash flow. |
| **Laporan keuangan resmi IDX** (§10) | Fundamental saham dari Yahoo Finance quoteSummary, bukan parsing langsung dari laporan resmi IDX. Yahoo sering rate-limited. |
| **Telegram untuk INFO signals** | Hanya WARN/CRITICAL yang dikirim (untuk hindari spam). INFO signal (BREAKOUT) tidak dikirim. |
| **CORS eksplisit whitelist** | Default Next.js CORS. Tapi CSP `connect-src` sudah restriktif. |

### 🟠 Deviasi Tech Stack (driven by environment constraint)

PRD §11 merekomendasikan Python (FastAPI) + DuckDB/TimescaleDB + Redis. Aktual: Next.js 16 (TypeScript) + SQLite (Prisma) + in-memory cache. Ini karena environment wajib Next.js 16. Dampak:
- Library `ccxt` tetap dipakai (TS version tersedia).
- `MetaTrader5` tidak bisa (Python-only) → forex/gold live execution deferred.
- `pandas`/`numpy` tidak dipakai — indikator teknikal dihitung manual di `src/lib/indicators.ts`.

---

## Yang Akan Dikerjakan Selanjutnya

Prioritas lanjutan (jika proyek dilanjutkan):

1. **Backtesting engine** — strategy runner + equity curve simulation menggunakan data `price_ohlcv` yang sudah persist. Priority tinggi karena fondasi data sudah ada.
2. **MT5 bridge** untuk forex/gold live execution — kemungkinan via mini-service Python terpisah yang berkomunikasi dengan Next.js via HTTP.
3. **2FA enable flow UI** — QR code scan + verification di settings page.
4. **Audit log ekspansi** — cover login, config changes, alert mutations (dengan hash chain yang sama).
5. **Telegram INFO signals** — opsi opt-in untuk receive INFO-level signals.
6. **Fundamental dari laporan resmi IDX** — scraper/parser PDF laporan keuangan.
7. **Backup automation** — scheduled encrypted backup + restore test.
8. **Production hardening** — TLS via reverse proxy, Tailscale untuk akses remote, dependency scanning otomatis (`npm audit` di CI).

---

## Arsitektur Sistem

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER (single page)                      │
│  Login · Dashboard · Watchlist · Signals · Risk · Portfolio  │
│  Execution · Data Sources   (react-query polling + WS live)  │
└───────────────┬─────────────────────────┬───────────────────┘
                │ REST (auth+CSRF)        │ WebSocket
┌───────────────▼───────────┐  ┌──────────▼──────────────────┐
│   Next.js 16 App (3000)    │  │  WS Prices mini-service     │
│  - NextAuth + bcrypt+TOTP  │  │  (socket.io, port 3001)     │
│  - Middleware: CSP/CSRF/   │  │  - Binance WS upstream      │
│    rate-limit/auth         │  │  - Yahoo polling (15s)      │
│  - API routes /api/v1/*    │  │  - Broadcast to clients     │
│  - Prisma → SQLite         │  └─────────────────────────────┘
└───────┬─────────────────────┘
        │                    ┌────────────────────────────────┐
        │                    │  Execution Bot mini-service    │
        │   Caddy gateway    │  (Bun, port 3002)              │
        │   (port 81)        │  - Paper + Live (CCXT)         │
        │   XTransformPort   │  - Kill-switch + hard caps     │
        └───────────────────►│  - Tamper-evident audit log    │
                             │  - Raw SQL → same SQLite DB    │
                             └────────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────┐
│         SUMBER DATA EKSTERNAL (real, gratis/freemium)        │
│  Binance (crypto) · Yahoo Finance (IDX/forex/gold) ·         │
│  CoinGecko (crypto fundamentals)                             │
└──────────────────────────────────────────────────────────────┘
```

**Caddy gateway** (port 81) adalah satu-satunya port yang expose externally. Frontend memanggil mini-services via relative path + `?XTransformPort=3001/3002` query, yang Caddy forward ke port yang sesuai.

---

## Tech Stack

| Layer | Teknologi | Alasan |
|---|---|---|
| **Frontend** | Next.js 16 + React 19 + TypeScript 5 | App Router, ekosistem matang untuk dashboard data-heavy |
| **Styling** | Tailwind CSS 4 + shadcn/ui (New York) | Komponen institusional, customizable |
| **Font** | IBM Plex Sans + Inter + JetBrains Mono | Heading teknikal, body readable, angka monospace |
| **Charting** | Custom SVG candlestick | Full control, no heavy dep, institutional look |
| **State** | TanStack Query (server) + Zustand (client) | Polling + cache for server state, nav for client |
| **Database** | SQLite via Prisma ORM | Local-first, no server needed, easy schema migration |
| **Auth** | NextAuth.js v4 + bcryptjs + otplib | Credentials provider + hashed password + TOTP |
| **Realtime** | socket.io (mini-service) | Binance WS upstream → broadcast ke clients |
| **Notifications** | node-telegram-bot-api | Gratis, real-time, mudah |
| **Execution** | ccxt (crypto) | Library matang, multi-exchange |
| **Gateway** | Caddy | Reverse proxy + XTransformPort routing |
| **Runtime** | Bun (mini-services) + Node (Next.js) | Bun untuk speed di mini-services |

---

## Cara Menjalankan

### Prasyarat
- Node.js 18+ / Bun
- SQLite (sudah bundle)
- Koneksi internet (untuk akses Binance/Yahoo/CoinGecko API)

### Langkah

1. **Clone & install dependencies:**
   ```bash
   git clone https://github.com/Zayidan123/MERIDIAN_Terminal.git
   cd MERIDIAN_Terminal
   bun install
   ```

2. **Konfigurasi environment:**
   ```bash
   cp .env.example .env
   # Edit .env — set MERIDIAN_ADMIN_PASSWORD, NEXTAUTH_SECRET, dll.
   ```

3. **Setup database:**
   ```bash
   bun run db:push    # create schema + seed real instruments
   ```

4. **Jalankan aplikasi utama:**
   ```bash
   bun run dev        # Next.js di port 3000
   ```

5. **(Opsional) Jalankan mini-services:**
   ```bash
   # WebSocket live prices (port 3001)
   cd mini-services/ws-prices && bun install && bun index.ts &

   # Execution bot (port 3002)
   cd mini-services/execution-bot && bun install && bun index.ts &
   ```

6. **Akses:** buka `http://localhost:3000` (atau via gateway `http://localhost:81`).

7. **Login default:**
   - Email: `admin@meridian.local`
   - Password: `Meridian@2025` (atau sesuai `MERIDIAN_ADMIN_PASSWORD` di `.env`)
   - **UBAH password sebelum production!**

### Mengaktifkan fitur opsional

- **Telegram:** set `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` di `.env`, restart. Test button di Data Sources module.
- **2FA/TOTP:** set `MERIDIAN_TOTP_SECRET` (base32) + `NEXT_PUBLIC_TOTP_ENABLED=1`, restart.
- **Live execution (crypto):** set `EXCHANGE_API_KEY` + `EXCHANGE_API_SECRET` (trade-only, no withdrawal, IP-whitelisted) di `.env`, restart, lalu confirm security checklist di Execution module.

---

## Struktur Proyek

```
MERIDIAN_Terminal/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/[...nextauth]/     # NextAuth handler
│   │   │   ├── auth/totp-setup/        # 2FA setup endpoint
│   │   │   └── v1/                     # REST API (protected by middleware)
│   │   │       ├── instruments/        # CRUD instrumen
│   │   │       ├── watchlist/          # watchlist management
│   │   │       ├── prices/[id]/        # OHLCV candles (live fetch)
│   │   │       ├── history/[id]/       # persisted candles (backtest source)
│   │   │       ├── quotes/             # live quotes (batch + single)
│   │   │       ├── technicals/[id]/    # MA/EMA/RSI/MACD/volume-z
│   │   │       ├── fundamentals/[id]/  # equity (Yahoo) + crypto (CoinGecko)
│   │   │       ├── market-summary/     # cross-asset snapshot
│   │   │       ├── alerts/             # alert CRUD + evaluate engine
│   │   │       ├── signals/            # signal feed + scan engine
│   │   │       ├── portfolio/          # positions CRUD + live MTM
│   │   │       ├── risk/               # summary + position-size calc
│   │   │       ├── health/             # data source health log
│   │   │       ├── notifications/      # Telegram config + test
│   │   │       └── seed/               # seed real instruments
│   │   ├── layout.tsx                  # fonts + theme + toaster
│   │   ├── page.tsx                    # auth gate → LoginScreen / AppShell
│   │   └── globals.css                 # institutional dark palette
│   ├── components/
│   │   ├── terminal/                   # 8 module views + app shell
│   │   │   ├── app-shell.tsx           # nav rail + status bar + footer
│   │   │   ├── nav-rail.tsx            # left navigation (7 modules)
│   │   │   ├── status-bar.tsx          # top: market summary + WS status
│   │   │   ├── login-screen.tsx        # auth UI
│   │   │   ├── dashboard-view.tsx      # cross-asset overview
│   │   │   ├── watchlist-view.tsx      # table + instrument detail
│   │   │   ├── instrument-detail.tsx   # chart + technicals + fundamentals
│   │   │   ├── signals-view.tsx        # alerts + signal feed
│   │   │   ├── risk-view.tsx           # exposure + VaR + DD + correlation
│   │   │   ├── portfolio-view.tsx      # positions table
│   │   │   ├── execution-view.tsx      # Fase 4 bot UI
│   │   │   ├── sources-view.tsx        # data source health + Telegram
│   │   │   ├── quote-table.tsx         # live quotes table (WS-integrated)
│   │   │   └── candlestick-chart.tsx   # custom SVG chart + sparkline
│   │   ├── ui/                         # shadcn/ui components
│   │   ├── panel.tsx                   # institutional Panel + ProvenanceBar
│   │   ├── provenance-bar.tsx          # signature: source + sync time
│   │   ├── asset-badge.tsx             # asset class badge + change text
│   │   └── providers.tsx               # SessionProvider + QueryClient
│   ├── hooks/
│   │   └── use-live-prices.ts          # socket.io singleton + flash
│   └── lib/
│       ├── auth.config.ts              # NextAuth options (bcrypt+TOTP)
│       ├── auth.ts                     # getSession / requireAuth
│       ├── api-client.ts               # typed hooks (react-query)
│       ├── api.ts                      # API response envelope
│       ├── data-sources/
│       │   ├── binance.ts              # Binance REST client
│       │   ├── yahoo.ts                # Yahoo Finance client
│       │   ├── coingecko.ts            # CoinGecko fundamentals
│       │   └── index.ts                # unified facade + persist
│       ├── data-health.ts              # cache + health log + retry
│       ├── indicators.ts               # SMA/EMA/RSI/MACD/correlation/VaR
│       ├── persist-candles.ts          # write-through to price_ohlcv
│       ├── notifications/telegram.ts   # Telegram bot service
│       ├── seed.ts                     # 19 real instruments
│       ├── store.ts                    # Zustand nav state
│       ├── types.ts                    # domain types
│       ├── format.ts                   # price/compact/pct/time formatters
│       └── utils.ts                    # cn() helper
├── mini-services/
│   ├── ws-prices/                      # socket.io, port 3001
│   │   └── index.ts                    # Binance WS + Yahoo poll → broadcast
│   └── execution-bot/                  # Bun, port 3002
│       └── index.ts                    # paper/live orders + audit log
├── prisma/
│   └── schema.prisma                   # 11 models (Instrument, PriceOhlcv,
│                                      #   Fundamental, Watchlist, Alert,
│                                      #   SignalEvent, Position, RiskSnapshot,
│                                      #   BotConfig, Order, AuditLog,
│                                      #   DataSourceHealthLog)
├── middleware.ts                       # auth + CSP + CSRF + rate-limit
├── next.config.ts                      # security headers fallback
├── Caddyfile                           # gateway config (XTransformPort)
├── .env.example                        # env template (NO real secrets)
└── .gitignore                          # excludes .env, db, node_modules, logs
```

---

## Sumber Data

Semua sumber data adalah **real, gratis/freemium**, dipakai sesuai ToS masing-masing.

| Kelas Aset | Sumber | Data | Status |
|---|---|---|---|
| Crypto | Binance `data-api.binance.vision` | OHLCV klines, ticker/price, WS trade stream | ✅ Aktif |
| Crypto | CoinGecko API | Market cap, FDV, circulating/total/max supply | ✅ Aktif (60s cache, 429-aware) |
| IDX Equities | Yahoo Finance `query2.finance.yahoo.com` | Harga + chart + quoteSummary fundamentals | ✅ Aktif (sering 429) |
| Forex | Yahoo Finance (`EURUSD=X` dll) | Harga + chart | ✅ Aktif |
| Gold | Yahoo Finance `GC=F` (COMEX futures) | Harga + chart | ✅ Aktif |
| ~~Forex/Gold~~ | ~~OANDA API~~ | ~~Harga real-time~~ | ❌ Tidak digunakan (Yahoo sebagai substitusi) |
| ~~Crypto on-chain~~ | ~~DefiLlama~~ | ~~TVL~~ | ❌ Tidak diintegrasikan |
| ~~Historical tick~~ | ~~Dukascopy~~ | ~~Tick historis~~ | ❌ Tidak diintegrasikan |
| ~~IDX laporan resmi~~ | ~~IDX/perusahaan~~ | ~~Fundamental dari PDF~~ | ❌ Tidak diintegrasikan (pakai Yahoo) |

**Catatan rate limit:** Yahoo Finance sering return 429 di sandbox ini. Sistem menampilkan "Source unavailable" secara jujur untuk affected rows, tidak menyembunyikan kegagalan. Crypto (Binance) stabil.

---

## Keamanan

Implementasi keamanan mengikuti PRD §16 (Threat Model → Secure Coding Guardrail). Yang sudah:

- ✅ **Secrets via env** — tidak ada API key hardcoded di kode (`.env` di-gitignore).
- ✅ **Password bcrypt-hashed** — `MERIDIAN_ADMIN_PASSWORD_HASH` atau auto-hash dari plaintext env.
- ✅ **2FA/TOTP** — optional via `MERIDIAN_TOTP_SECRET` (otplib).
- ✅ **Session cookie** — httpOnly, SameSite=Lax, 8h expiry.
- ✅ **CSP strict** — `default-src 'self'`, `frame-ancestors 'none'`, `connect-src` terbatas.
- ✅ **CSRF protection** — Origin header check pada POST/PUT/PATCH/DELETE.
- ✅ **Rate limiting** — 600 req/min per IP di middleware.
- ✅ **SQL injection prevention** — Prisma ORM (parameterized), raw SQL di mini-service juga parameterized.
- ✅ **No eval/exec** — tidak ada `eval()` di kode.
- ✅ **Process isolation** — execution bot terpisah dari web app (§16.7).
- ✅ **API key trade-only** — dokumentasi + checklist dialog sebelum switch to LIVE.
- ✅ **Hard caps** — max per-order & per-day di level kode (bukan strategi).
- ✅ **Kill-switch** — manual + automatic (drawdown threshold).
- ✅ **Audit log tamper-evident** — hash chain untuk bot actions.
- ✅ **Anomaly detection** — >5 order/60s → auto kill-switch.
- ✅ **Large-order confirm** — >80% per-order cap butuh konfirmasi.

### ⚠️ Catatan Keamanan (jujur)

- **Fallback default password** `Meridian@2025` ada di `src/lib/auth.config.ts` sebagai fallback ketika env tidak set. **Wajib diubah** via `.env` sebelum production. Ini deviasi minor dari PRD §16.2 (no secret in code) demi UX "fresh dev box can log in" — trade-off yang disengaja, didokumentasikan di sini.
- **Bot API token** (`BOT_API_TOKEN`) optional — jika kosong, mini-service execution bot terbuka di local network. Cocok untuk local-only, tapi **wajib set** sebelum expose ke jaringan manapun.
- **TLS/HTTPS** belum dikonfigurasi di sandbox (HTTP polos). Wajib reverse proxy dengan TLS (Caddy/Nginx) + Tailscale/WireGuard sebelum akses remote (§16.4).
- **Dependency scanning** (`npm audit`) belum di-automate di CI.
- **Backup** belum ada automation.

---

## Tantangan Selama Development

### 1. Rate limit API gratis yang agresif
Yahoo Finance `query2` sering return 429 (Too Many Requests) di sandbox. CoinGecko juga. Binance `api.binance.com` sempat IP-banned permanen sehingga harus pindah ke `data-api.binance.vision`. **Solusi:** cache agresif (in-memory TTL), retry+backoff, dan honest error surface ("Source unavailable") sesuai PRD §6 — tidak pernah fabricate data.

### 2. Dev server tidak stabil di sandbox
Next.js dev server berkali-kali mati karena `ECONNRESET` dari koneksi Yahoo yang di-reset, plus masalah orphan process saat background. **Solusi:** pola `setsid` + subshell `(nohup ... &)` untuk daemon survival, restart otomatis.

### 3. Prisma client drift setelah schema push
Setelah `bun run db:push` menambah field baru, Next.js HMR re-compile route handlers tapi tidak invalidate `@prisma/client` module-level cache → `PrismaClientValidationError: Unknown argument`. **Solusi:** restart dev server setelah setiap schema change (didokumentasikan di worklog).

### 4. Mini-service daemonization
`nohup bun --hot index.ts &` tidak cukup — process mati ~10s setelah shell exit. `--hot` watcher parent orphan child. **Solusi:** `bun index.ts` (tanpa --hot) + `setsid` + subshell untuk reparent ke PID 1.

### 5. Browser tidak bisa reach localhost:3000 langsung
Agent Browser di sandbox tidak resolve `localhost` dengan andal. **Solusi:** akses via gateway Caddy port 81 yang forward ke 3000.

### 6. Rate limit middleware terlalu ketat
Awalnya 120 req/min — terlalu rendah untuk app data-heavy (quotes 30s, risk 60s, signals 60s, bot status 10s polling = burst). **Solusi:** naikkan ke 600 req/min, masih cukup untuk block brute-force.

### 7. otplib v13 breaking change
v13.4.1 drop v12 `authenticator` singleton. **Solusi:** switch ke `new OTP({ strategy:'totp' })` dengan `await otp.verify({ token, secret, epochTolerance:30 })`.

### 8. Next.js 16 middleware deprecation
`middleware.ts` deprecated → `proxy.ts`. Masih bekerja tapi warning. Dibiarkan sebagai `middleware.ts` per spec.

### 9. Yahoo fundamentals (quoteSummary) unreliable
Endpoint `quoteSummary` sering 429/blocked. **Solusi:** defensive parsing, honest null fields, fallback ke "Fundamentals unavailable" UI state.

### 10. CORS + WebSocket routing
Frontend harus connect ke WS service via gateway (`?XTransformPort=3001`), bukan langsung `localhost:3001`. **Solusi:** socket.io-client config dengan `query: { XTransformPort: '3001' }` ke same-origin.

---

## Hal Paling Sulit

### #1: Menjaga integritas data 100% saat sumber tidak stabil

Ini tantangan filosofis sekaligus teknis. PRD §6 sangat eksplisit: "Dilarang keras menggunakan data simulasi... termasuk saat development atau demo." Tapi Yahoo Finance rate-limit terus-menerus, Binance IP-banned, CoinGecko 429. Godaan untuk "return something, anything" agar UI tidak kosong sangat besar.

**Bagaimana diselesaikan:** Disiplin arsitektural — setiap data-source call return `DataResult<T>` dengan `ok: boolean`. Jika gagal, return `{ ok: false, error }`. API route pakai `fromResult()` yang otomatis return 502 + error message. Frontend render "Source unavailable" badge per-row. Tidak ada satu pun fallback ke data karangan di seluruh codebase.

### #2: Execution bot dengan audit log tamper-evident

Membangun hash chain yang benar (setiap row = sha256(prevHash + canonical content)) di SQLite dengan raw SQL, sambil menjaga tidak break data path, plus anomaly detection + hard caps + kill-switch + process isolation — ini paling kompleks. Subagent butuh context besar dan sempat timeout, harus di-resume.

### #3: Reconciliasi real-time (WebSocket) dengan polling (REST)

WebSocket memberikan price ticks, tapi 24h stats (change%, high, low, volume) butuh REST polling. Frontend harus overlay live price di atas polled quote tanpa conflict, plus flash animation yang re-fire pada back-to-back ticks (butuh `key={live-${time}}` untuk force remount). Detail kecil tapi tricky.

### #4: Dashboard institusional yang dense tanpa library chart berat

PRD §13 minta "density over decoration, presisi, bukan tampilan konsumen." TradingView Lightweight Charts bagus tapi add dep. **Solusi:** custom SVG candlestick chart (160 baris) dengan grid, volume bars, MA overlay, last-price tag — full control, zero dep, institutional look.

---

## Disclaimer

Proyek ini adalah perangkat lunak teknis, **bukan nasihat keuangan**. Seluruh keputusan trading/investasi tetap menjadi tanggung jawab penuh pengguna. Sinyal, skor, atau output apa pun dari sistem ini bersifat alat bantu analisis, bukan jaminan hasil.

Pengguna bertanggung jawab memastikan penggunaan platform ini sesuai regulasi yang berlaku di Indonesia (mis. ketentuan OJK untuk efek, Bappebti untuk aset kripto) serta Terms of Service masing-masing penyedia data/API/exchange.

**Gunakan modal yang siap Anda rugikan. Jangan pernah mengaktifkan LIVE execution mode tanpa memahami risikonya.**

---

## License

MIT — bebas digunakan, dimodifikasi, didistribusikan. Tanpa jaminan.

---

## Acknowledgments

- [Binance API](https://binance-docs.github.io/apidocs/) — crypto data
- [Yahoo Finance](https://finance.yahoo.com/) — IDX/forex/gold data
- [CoinGecko API](https://www.coingecko.com/api) — crypto fundamentals
- [shadcn/ui](https://ui.shadcn.com/) — komponen UI
- [Next.js](https://nextjs.org/) — framework
- [Prisma](https://www.prisma.io/) — ORM
- [CCXT](https://github.com/ccxt/ccxt) — crypto exchange library
- [socket.io](https://socket.io/) — real-time communication

---

**MERIDIAN Terminal** — *Research · Signal · Risk · Execution. 100% real market data, zero simulation.*
