# MERIDIAN Terminal

> **Institutional-grade crypto/Web3 research, signal, risk & execution terminal** — built for global SaaS commercialization. 100% real market data, zero simulation.

![Status](https://img.shields.io/badge/status-pivoting%20to%20crypto%2FWeb3%20SaaS-3b5fe0)
![Data](https://img.shields.io/badge/data-100%25%20real%20market-2e9e6d)
![Target](https://img.shields.io/badge/target-global%20SaaS%20launch-d4a02a)
![License](https://img.shields.io/badge/license-commercial-8891a0)

---

## Daftar Isi

1. [Tentang Proyek](#tentang-proyek)
2. [Pengumuman: Pivot Strategis](#pengumuman-pivot-strategis)
3. [Status Saat Ini (v1.0)](#status-saat-ini-v10)
4. [Roadmap ke SaaS Komersial](#roadmap-ke-saas-komersial)
5. [Tujuan Akhir](#tujuan-akhir)
6. [Arsitektur Sistem](#arsitektur-sistem)
7. [Tech Stack](#tech-stack)
8. [Cara Menjalankan](#cara-menjalankan)
9. [Struktur Proyek](#struktur-proyek)
10. [Keamanan](#keamanan)
11. [Tantangan Selama Development](#tantangan-selama-development)
12. [Disclaimer](#disclaimer)

---

## Tentang Proyek

**MERIDIAN Terminal** adalah platform riset dan trading yang menyatukan empat fungsi dalam satu sistem: riset/dashboard, sinyal & alert, manajemen risiko/portofolio, dan eksekusi otomatis (paper + live).

**Tujuan komersial:** Diluncurkan sebagai **SaaS global** dengan subscription bulanan/tahunan, fokus penuh ke dunia cryptocurrency dan Web3, dengan standar institusional global.

**Prinsip inti (non-negotiable):** seluruh data yang ditampilkan harus data pasar nyata — tidak ada simulasi, dummy, atau placeholder. Ketika sumber data down/rate-limited, sistem menampilkan "Source unavailable" secara eksplisit.

---

## Pengumuman: Pivot Strategis

> **Update terbaru:** Proyek ini sedang dalam transisi dari multi-asset (crypto + IDX + forex + gold) menjadi **crypto/Web3-only** untuk persiapan komersialisasi SaaS global.

### Mengapa pivot?

1. **Fokus pasar global** — crypto/Web3 adalah pasar 24/7 tanpa batas geografis, cocok untuk SaaS global sejak hari 1.
2. **Stabilitas teknis** — Yahoo Finance (sumber IDX/forex/gold) adalah penyebab utama crash sandbox (ECONNRESET, rate-limit, IP ban). Binance/CoinGecko jauh lebih stabil.
3. **Sederhanakan compliance** — crypto-only menghindari kompleksitas regulator saham IDX (OJK) dan forex (broker partnerships per region).
4. **Ekosistem Web3 berkembang pesat** — DefiLlama, on-chain data, multi-exchange via CCXT memberi nilai unik dibanding trading terminal tradisional.

### Apa yang berubah?

| Aspek | Sebelum (v1.0) | Sesudah (v2.0 target) |
|---|---|---|
| **Kelas aset** | Crypto + IDX + Forex + Gold | **Crypto-only** (10-15 top exchanges via CCXT) |
| **Pengguna** | Single-user (env config) | **Multi-tenant** (signup, billing, usage limits) |
| **Database** | SQLite | **PostgreSQL** (concurrent users) |
| **Deployment** | Local-only | **VPS + Docker + TLS** (domain publik) |
| **API keys** | Operator set di .env | **User input via UI** (encrypted di DB) |
| **Monetisasi** | Tidak ada | **Stripe subscription** (bulan/tahun) |
| **Web3 layer** | Tidak ada | **DefiLlama TVL + on-chain metrics** |
| **Target market** | Personal | **Global SaaS** |

### Apa yang tetap?

- ✅ Core engine: data layer, signal engine, risk calculator, backtesting, execution bot
- ✅ UI/UX institusional (dark palette, density, provenance bars)
- ✅ Prinsip integritas data 100%
- ✅ Security foundations (NextAuth, bcrypt, TOTP, CSP, CSRF, audit log)
- ✅ Tech stack: Next.js 16 + TypeScript + Prisma + CCXT

---

## Status Saat Ini (v1.0)

Build saat ini masih **multi-asset single-user** (sebelum pivot). Ini snapshot jujur:

### ✅ Berfungsi penuh

| Modul | Status | Detail |
|---|---|---|
| **Auth** | ✅ | NextAuth + bcrypt + optional 2FA/TOTP, login screen, session management |
| **Data Layer** | ✅ | Binance (crypto), Yahoo (IDX/forex/gold), CoinGecko (crypto fundamentals), health logging, retry/backoff |
| **Dashboard** | ✅ | Cross-asset overview, live quotes, signal feed, portfolio snapshot |
| **Watchlist** | ✅ | 19 instrumen default, add/remove, instrument detail (chart + technicals + fundamentals) |
| **Signals** | ✅ | Custom alerts (price, %change, volume spike, RSI, MA), anomaly scanner (VOLUME_SPIKE, BREAKOUT, RSI_OB/OS, ANOMALY), Telegram notifications |
| **Risk** | ✅ | Exposure tracking, VaR, drawdown monitor (with alert triggers), correlation matrix, position sizing calculator |
| **Portfolio** | ✅ | Position tracking, live mark-to-market, PnL |
| **Execution Bot** | ✅ | Paper trading (live prices), CCXT for live crypto, kill-switch, hard caps, tamper-evident audit log, anomaly detection |
| **Backtesting** | ✅ | 4 strategies (MA Cross, RSI, Breakout, Buy&Hold), equity curve, metrics (Sharpe, max DD, win rate), persisted historical data |
| **WebSocket** | ✅ | Real-time price streaming via socket.io mini-service |
| **Security** | ✅ | CSP, CSRF, rate-limit, instrumentation error handlers, process isolation |

### ⚠️ Akan dihapus di v2.0 (pivot crypto-only)

- Yahoo Finance data source (`src/lib/data-sources/yahoo.ts`)
- 7 IDX equities (BBCA, BBRI, TLKM, ASII, GOTO, TPIA, ICBP)
- 4 forex pairs (EURUSD, GBPUSD, USDJPY, AUDUSD)
- Gold (GC=F)
- MT5 bridge planning (sudah deferred, sekarang irrelevant)

### 🔴 Belum ada (blocker komersialisasi)

- Multi-tenancy (1 user hardcoded)
- PostgreSQL (SQLite tidak handle concurrent)
- User-managed API keys via UI
- Stripe billing
- Cloud deployment (Docker + TLS + domain)
- Self-service signup
- Compliance docs (ToS, Privacy Policy, DPA)

---

## Roadmap ke SaaS Komersial

Roadmap lengkap dengan 4 fase → [**ROADMAP.md**](./ROADMAP.md)

**Ringkasan:**

| Fase | Fokus | Estimasi | Outcome |
|---|---|---|---|
| **1. Commercial Foundation** | PostgreSQL + multi-tenancy + crypto-only + user-managed keys + Docker deploy | 3-4 sesi | Bisa serve multiple customers di 1 instance |
| **2. SaaS Layer** | Stripe billing + signup + usage limits + admin dashboard | 2-3 sesi | Customer bisa self-onboard & pay |
| **3. Institutional Hardening** | Audit log ekspansi + backup + compliance + monitoring + CI/CD + tests | 3-4 sesi | Lolos enterprise security review |
| **4. Web3 Enhancement** | DefiLlama TVL + on-chain metrics + multi-exchange (10-15) + wallet tracking | 2-3 sesi | Differentiator vs kompetitor |
| **5. Launch & Polish** | Docs + security audit + performance + support system | 2-3 sesi | Public launch ready |

---

## Tujuan Akhir

**Vision:** Menjadi terminal trading crypto/Web3 pilihan untuk trader institusional dan sophisticated retail globally, dengan standar keandalan data setara Bloomberg Terminal.

**Mission:** Menyatukan riset, sinyal, risk, dan eksekusi crypto dalam satu platform self-hosted SaaS yang:
1. **100% real data** — setiap angka terverifikasi ke sumber pasar nyata
2. **Multi-exchange** — 10-15 top exchanges via CCXT, user pilih sendiri
3. **Web3-native** — DefiLlama TVL, on-chain metrics, DeFi overview
4. **Institutional-grade** — audit log tamper-evident, compliance docs, monitoring
5. **Affordable** — VPS murah untuk testing, scale up saat revenue mengalir

**Bukan tujuan:** menjamin profit. Sinyal bersifat probabilistik, alat bantu keputusan, bukan nasihat keuangan.

---

## Arsitektur Sistem

### Saat ini (v1.0 — multi-asset single-user)

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER (single page)                      │
│  Login · Dashboard · Watchlist · Signals · Risk · Portfolio  │
│  Execution · Backtest · Data Sources                         │
└───────────────┬─────────────────────────┬───────────────────┘
                │ REST (auth+CSRF)        │ WebSocket
┌───────────────▼───────────┐  ┌──────────▼──────────────────┐
│   Next.js 16 App (3000)    │  │  WS Prices (3001)           │
│  - NextAuth + bcrypt+TOTP  │  │  - Binance WS upstream      │
│  - Middleware: CSP/CSRF/   │  │  - Yahoo polling            │
│    rate-limit/auth         │  └─────────────────────────────┘
│  - API routes /api/v1/*    │
│  - Prisma → SQLite         │  ┌─────────────────────────────┐
└───────┬─────────────────────┘  │  Execution Bot (3002)       │
        │   Caddy gateway (81)   │  - Paper + Live (CCXT)      │
        │   XTransformPort       │  - Kill-switch + hard caps  │
        └───────────────────►    │  - Tamper-evident audit log │
                                └─────────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────┐
│    SUMBER DATA: Binance · Yahoo · CoinGecko                  │
└──────────────────────────────────────────────────────────────┘
```

### Target v2.0 (crypto/Web3 SaaS)

```
┌─────────────────────────────────────────────────────────────┐
│              BROWSER (multi-tenant, global users)             │
│  Signup · Billing · Dashboard · Watchlist · Signals · Risk   │
│  Portfolio · Execution · Backtest · Settings (API keys)      │
└───────────────┬─────────────────────────┬───────────────────┘
                │ HTTPS (TLS via Caddy)   │ WSS
┌───────────────▼───────────────────────────┐  ┌──────────────▼──────────┐
│   Next.js 16 App (Docker container)        │  │  WS Prices (Docker)     │
│  - Multi-tenant auth (NextAuth + DB users) │  │  - Multi-exchange WS    │
│  - Stripe billing + plan tiers             │  │  - Per-tenant isolation │
│  - User-managed encrypted API keys         │  └─────────────────────────┘
│  - Usage limits per plan                   │
│  - Prisma → PostgreSQL (managed)           │  ┌─────────────────────────┐
└───────┬─────────────────────────────────────┘  │  Execution Bot (Docker) │
        │                                       │  - Per-tenant CCXT       │
        │   VPS (Hetzner/DO) + custom domain     │  - Per-tenant hard caps  │
        │                                       │  - Shared audit log      │
        └──────────────────────────────────────►└─────────────────────────┘
        │
┌───────▼─────────────────────────────────────────────────────┐
│  SUMBER DATA: Binance · Coinbase · Kraken · Bybit · OKX ·   │
│  ... (10-15 top exchanges via CCXT) · CoinGecko · DefiLlama │
└──────────────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Saat ini | Target v2.0 | Alasan |
|---|---|---|---|
| **Frontend** | Next.js 16 + React 19 + TypeScript 5 | sama | App Router, ecosystem matang |
| **Styling** | Tailwind CSS 4 + shadcn/ui | sama | Institutional components |
| **Charting** | Custom SVG candlestick | sama | Full control, no heavy dep |
| **State** | TanStack Query + Zustand | sama | Server + client state |
| **Database** | SQLite via Prisma | **PostgreSQL** via Prisma | Concurrent users, scale |
| **Auth** | NextAuth v4 + bcrypt + TOTP | sama + multi-user | Single → multi-tenant |
| **Realtime** | socket.io mini-service | sama + per-tenant | Live prices |
| **Billing** | — | **Stripe** | Global, crypto-friendly |
| **Notifications** | node-telegram-bot-api | sama | Gratis, real-time |
| **Execution** | ccxt (Binance) | **ccxt (10-15 exchanges)** | Multi-exchange global |
| **Web3 data** | — | **DefiLlama + on-chain** | TVL, protocol stats |
| **Gateway** | Caddy | sama + TLS + domain | Reverse proxy |
| **Deploy** | Local | **Docker + VPS** | Cloud, scalable |
| **Monitoring** | — | **Sentry + uptime** | Observability |

---

## Cara Menjalankan (v1.0 saat ini)

### Prasyarat
- Node.js 18+ / Bun
- SQLite (bundle)
- Internet (untuk Binance/Yahoo/CoinGecko API)

### Langkah

1. **Clone & install:**
   ```bash
   git clone https://github.com/Zayidan123/MERIDIAN_Terminal.git
   cd MERIDIAN_Terminal
   bun install
   ```

2. **Konfigurasi:**
   ```bash
   cp .env.example .env
   # Edit .env — set MERIDIAN_ADMIN_PASSWORD, NEXTAUTH_SECRET
   ```

3. **Database:**
   ```bash
   bun run db:push    # create schema + seed instruments
   ```

4. **Jalankan app utama:**
   ```bash
   bun run dev        # Next.js di port 3000
   ```

5. **(Opsional) Mini-services:**
   ```bash
   # WebSocket live prices (port 3001)
   cd mini-services/ws-prices && bun install && bun index.ts &

   # Execution bot (port 3002)
   cd mini-services/execution-bot && bun install && bun index.ts &
   ```

6. **Akses:** buka `http://localhost:3000` atau gateway `http://localhost:81`

7. **Login default:**
   - Email: `admin@meridian.local`
   - Password: `Meridian@2025`
   - **UBAH sebelum production!**

### Catatan preview panel

Jika mengakses via preview panel (cross-origin iframe), browser memblok cookies SameSite → login tidak berfungsi. App akan menampilkan tombol **"Open in New Tab"** — klik untuk membuka di tab browser penuh tempat cookies bekerja normal.

---

## Struktur Proyek

```
MERIDIAN_Terminal/
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── auth/                    # NextAuth + TOTP setup/verify
│   │   │   └── v1/                      # REST API (auth-protected)
│   │   │       ├── instruments/         # CRUD instrumen
│   │   │       ├── watchlist/           # watchlist management
│   │   │       ├── prices/ + history/   # live + persisted candles
│   │   │       ├── quotes/              # live quotes
│   │   │       ├── technicals/          # MA/EMA/RSI/MACD
│   │   │       ├── fundamentals/        # CoinGecko (crypto) + Yahoo (equity)
│   │   │       ├── market-summary/      # cross-asset snapshot
│   │   │       ├── alerts/ + signals/   # signal engine
│   │   │       ├── portfolio/ + risk/   # position + risk management
│   │   │       ├── backtest/            # strategy backtesting
│   │   │       ├── settings/            # user preferences
│   │   │       ├── notifications/       # Telegram config
│   │   │       ├── health/              # data source health
│   │   │       └── seed/                # seed instruments
│   │   ├── layout.tsx
│   │   ├── page.tsx                     # auth gate (handles iframe detection)
│   │   └── globals.css                  # institutional dark palette
│   ├── components/
│   │   ├── terminal/                    # 8 module views + app shell
│   │   ├── ui/                          # shadcn/ui
│   │   └── ...
│   ├── hooks/                           # use-live-prices (socket.io)
│   ├── lib/
│   │   ├── auth.config.ts               # NextAuth (bcrypt + TOTP)
│   │   ├── data-sources/                # binance, yahoo, coingecko
│   │   ├── backtest/                    # strategies + runner
│   │   ├── indicators.ts                # SMA/EMA/RSI/MACD/correlation/VaR
│   │   ├── notifications/telegram.ts
│   │   └── ...
│   └── instrumentation.ts               # global error handlers (stability)
├── mini-services/
│   ├── ws-prices/                       # socket.io, port 3001
│   └── execution-bot/                   # Bun, port 3002
├── prisma/schema.prisma                 # 13 models
├── middleware.ts                        # auth + CSP + CSRF + rate-limit
├── next.config.ts                       # security headers
├── Caddyfile                            # gateway config
├── .env.example                         # env template
├── ROADMAP.md                           # ← roadmap lengkap ke SaaS
└── README.md                            # ← this file
```

---

## Keamanan

### ✅ Sudah implementasi (v1.0)

- Secrets via env (`.env` gitignored)
- Password bcrypt-hashed + optional 2FA/TOTP
- Session cookie httpOnly, SameSite=Lax
- CSP strict, CSRF protection, rate-limiting (600/min)
- SQL injection prevention (Prisma parameterized + raw SQL parameterized)
- Process isolation (execution bot terpisah)
- Audit log tamper-evident (hash chain) untuk bot actions
- Hard caps + kill-switch untuk execution
- Anomaly detection (>5 order/60s → auto kill)
- Global error handlers (instrumentation.ts) untuk sandbox stability

### 🔴 Akan ditambahkan (v2.0+)

- Multi-tenant row-level isolation
- User-managed encrypted API keys (AES-256-GCM di DB)
- Audit log ekspansi (login, config, alert mutations)
- Backup automation + disaster recovery
- Compliance docs (ToS, Privacy Policy, DPA, GDPR)
- Monitoring (Sentry, uptime, metrics)
- CI/CD + automated testing
- Third-party security audit/pentest

---

## Tantangan Selama Development

1. **Rate limit API gratis** — Yahoo Finance sering 429, Binance sempat IP-banned. Solusi: cache + retry/backoff + honest error surface. (Akan hilang setelah pivot crypto-only.)
2. **Dev server stability** — ECONNRESET dari Yahoo crash server. Solusi: `instrumentation.ts` global error handlers (212+ errors suppressed).
3. **Prisma client drift** — schema push tidak invalidate module cache. Solusi: restart dev server setelah schema change.
4. **Mini-service daemonization** — `nohup` tidak cukup. Solusi: `setsid` + subshell pattern.
5. **Preview panel iframe** — cross-origin iframe blok SameSite cookies → login gagal. Solusi: detect iframe + "Open in New Tab" notice.
6. **SQLite persistence** — `createMany skipDuplicates` tidak didukung. Solusi: raw `INSERT OR IGNORE`.
7. **otplib v13 breaking change** — API beda dari v12. Solusi: `new OTP({ strategy: 'totp' })`.
8. **NextAuth URL behind proxy** — hardcoded `NEXTAUTH_URL` salah port. Solusi: `trustHost: true` + auto-detect.

---

## Disclaimer

Proyek ini adalah perangkat lunak teknis, **bukan nasihat keuangan**. Seluruh keputusan trading tetap tanggung jawab pengguna. Sinyal bersifat alat bantu analisis, bukan jaminan hasil.

Pengguna bertanggung jawab memastikan penggunaan sesuai regulasi yang berlaku (Bappebti untuk aset kripto di Indonesia, regulasi masing-masing negara untuk global) serta Terms of Service masing-masing exchange/API provider.

**Gunakan modal yang siap Anda rugikan. Jangan aktifkan LIVE execution tanpa memahami risikonya.**

---

## License

Commercial — semua hak dilindungi. Lisensi spesifik akan ditentukan sebelum launch SaaS.

---

## Acknowledgments

- [Binance API](https://binance-docs.github.io/apidocs/) — crypto data
- [CoinGecko API](https://www.coingecko.com/api) — crypto fundamentals
- [CCXT](https://github.com/ccxt/ccxt) — multi-exchange library
- [DefiLlama](https://defillama.com/) — TVL & protocol data (planned)
- [shadcn/ui](https://ui.shadcn.com/) — UI components
- [Next.js](https://nextjs.org/) · [Prisma](https://www.prisma.io/) · [socket.io](https://socket.io/)

---

**MERIDIAN Terminal** — *Research · Signal · Risk · Execution. 100% real market data, zero simulation. Pivoting to crypto/Web3 SaaS.*
