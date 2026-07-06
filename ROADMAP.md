# MERIDIAN Terminal — Roadmap ke SaaS Komersial

> **Dokumen hidup** — diupdate setiap sesi development. Tanggal di kolom "Estimasi" adalah perkiraan optimis (1 sesi ≈ 1 sesi kerja intensif).

**Last updated:** Hari ini
**Status:** Pivot dari multi-asset single-user → crypto/Web3 multi-tenant SaaS

---

## Ringkasan Eksekutif

| Fase | Fokus | Estimasi | Outcome | Status |
|---|---|---|---|---|
| **1. Commercial Foundation** | PostgreSQL + multi-tenancy + crypto-only + user keys + Docker | 3-4 sesi | Bisa serve multiple customers | 🔜 Berikutnya |
| **2. SaaS Layer** | Stripe billing + signup + usage limits + admin | 2-3 sesi | Customer self-onboard & pay | ⏳ Menunggu Fase 1 |
| **3. Institutional Hardening** | Audit log + backup + compliance + monitoring + CI/CD | 3-4 sesi | Lolos enterprise security review | ⏳ |
| **4. Web3 Enhancement** | DefiLlama + on-chain + 10-15 exchanges + wallet | 2-3 sesi | Differentiator vs kompetitor | ⏳ |
| **5. Launch & Polish** | Docs + pentest + performance + support | 2-3 sesi | Public launch ready | ⏳ |

**Total estimasi:** 12-17 sesi (≈ 3-5 minggu kerja intensif)

---

## Keputusan Strategis (locked)

Berdasarkan diskusi dengan founder:

1. **Target market:** Global sejak awal (tidak mulai dari Indonesia)
2. **Model bisnis:** SaaS subscription — bulanan & tahunan
3. **Fokus aset:** Crypto/Web3 penuh (hapus IDX, forex, gold)
4. **Infrastruktur:** VPS murah untuk testing, scale up saat layak
5. **Web3 depth:** Level B — CEX + Basic On-Chain (DefiLlama TVL + wallet movements)
6. **Exchange coverage:** Multi-exchange sejak awal — 10-15 top CoinMarketCap exchanges via CCXT

---

## Fase 1 — Commercial Foundation

> **Goal:** Transform dari single-user local app → multi-tenant cloud-deployable SaaS.
> **Blocker:** Tanpa fase ini, tidak bisa serve multiple customers. Sisanya tidak ada artinya.

### 1.1 PostgreSQL Migration (1 sesi)

**Kenapa:** SQLite file-locking tidak handle concurrent users. PostgreSQL wajib untuk multi-tenant.

**Tasks:**
- [ ] Ganti `datasource db` di `prisma/schema.prisma` dari `sqlite` ke `postgresql`
- [ ] Update `DATABASE_URL` di `.env` (format: `postgresql://user:pass@host:port/db`)
- [ ] Pilih PostgreSQL provider untuk dev:
  - Opsi A: **Neon** (serverless PostgreSQL, free tier, branch-per-feature) — recommended
  - Opsi B: **Supabase** (free tier, dashboard UI)
  - Opsi C: Self-host di VPS (paling murah, paling raw)
- [ ] Run `bun run db:push` ke PostgreSQL
- [ ] Test semua API routes — pastikan no regression
- [ ] Fix raw SQL di `persist-candles.ts` (`INSERT OR IGNORE` → PostgreSQL `ON CONFLICT DO NOTHING`)
- [ ] Fix BigInt handling jika ada perbedaan SQLite vs PostgreSQL
- [ ] Seed instruments ke PostgreSQL

**Done when:**
- App berjalan dengan PostgreSQL
- Semua API routes return data real
- Backtesting persistence bekerja
- Execution bot baca/tulis DB dengan benar

---

### 1.2 Remove Non-Crypto Code (0.5 sesi)

**Kenapa:** Yahoo Finance adalah root cause sandbox instability. Crypto-only menyederhanakan codebase.

**Tasks:**
- [ ] Hapus `src/lib/data-sources/yahoo.ts`
- [ ] Update `src/lib/data-sources/index.ts` — hapus yahoo branch
- [ ] Hapus Yahoo instruments dari `src/lib/seed.ts` (7 IDX + 4 forex + 1 gold)
- [ ] Tambah crypto instruments baru (10-15 top: BTC, ETH, SOL, BNB, XRP, ADA, DOGE, AVAX, DOT, MATIC, LINK, UNI, ATOM, LTC, BCH)
- [ ] Update `src/app/api/v1/fundamentals/[id]/route.ts` — hapus EQUITY branch (atau keep tapi return "not applicable")
- [ ] Update `src/components/terminal/instrument-detail.tsx` — hapus equity fundamentals UI
- [ ] Update `src/components/terminal/quote-table.tsx` — pastikan hanya crypto
- [ ] Grep seluruh codebase untuk referensi yahoo/IDX/forex/gold, hapus atau update

**Done when:**
- Tidak ada import `yahoo` di seluruh codebase
- Watchlist hanya berisi crypto
- Yahoo tidak muncul di health log lagi
- Sandbox stabil (no ECONNRESET crashes)

---

### 1.3 Multi-Exchange Setup via CCXT (1 sesi)

**Kenapa:** Global target sejak hari 1. User di region tanpa Binance (US) butuh Coinbase/Kraken.

**Tasks:**
- [ ] Definisikan 10-15 top exchanges (dari CoinMarketCap ranking):
  - Binance, Coinbase Exchange, Kraken, Bybit, OKX, KuCoin, Gate.io, Bitfinex, Gemini, Bitstamp, HTX, MEXC, Crypto.com, Bithumb, Upbit
- [ ] Buat `src/lib/exchanges/registry.ts` — config per exchange (id, label, CCXT class, capabilities, rate limits, logo URL)
- [ ] Buat `src/lib/exchanges/client.ts` — factory function: `createExchange(exchangeId, apiKey, apiSecret)` → CCXT instance
- [ ] Update `src/lib/data-sources/binance.ts` → generalize ke multi-exchange (fetch OHLCV via CCXT, bukan Binance REST langsung)
- [ ] Update execution bot `mini-services/execution-bot/index.ts` — baca exchange dari per-tenant config
- [ ] Update WebSocket mini-service — support multi-exchange WS streams (Binance WS, Coinbase WS, dll)
- [ ] UI: exchange selector di Settings (user pilih exchange + input API key/secret)

**Done when:**
- User bisa pilih dari 10-15 exchanges di UI
- Data harga fetched via CCXT (bukan Binance REST langsung)
- Execution bot bisa trade di exchange manapun yang user config

---

### 1.4 Multi-Tenancy Schema (1.5 sesi)

**Kenapa:** Blocker terbesar. Tanpa ini, 1 instance = 1 customer.

**Tasks:**
- [ ] Buat model `User` baru:
  ```
  model User {
    id            String   @id @default(cuid())
    email         String   @unique
    passwordHash  String
    name          String?
    role          String   @default("USER")  // "USER" | "ADMIN"
    plan          String   @default("FREE")  // "FREE" | "PRO" | "INSTITUTIONAL"
    stripeCustomerId String?
    createdAt     DateTime @default(now())
    // ... relations
  }
  ```
- [ ] Tambah `userId` ke semua tenant-scoped models: `Watchlist`, `WatchlistItem`, `Alert`, `Position`, `Backtest`, `Setting`, `BotConfig`, `Order`, `SignalEvent` (jika per-tenant)
- [ ] Tambah `userId` ke `Instrument`? Atau bikin `UserInstrument` (user pilih instrumen sendiri)? → **Decision: Instrument global (master list), UserInstrument = user's selected instruments** (mirip Watchlist sekarang)
- [ ] Update semua API routes di `/api/v1/*` — filter by `userId` dari session
- [ ] Update NextAuth config — baca user dari DB (bukan env hardcoded)
- [ ] Row-level isolation test: user A tidak bisa akses data user B
- [ ] Admin role bisa akses semua (untuk admin dashboard)
- [ ] Migration script: existing single-user data → assign ke user admin pertama

**Done when:**
- Multiple users bisa signup & login
- User A's data tidak visible ke user B
- Admin bisa lihat semua user
- Semua API routes enforce `userId` filter

---

### 1.5 User-Managed Encrypted API Keys (1 sesi)

**Kenapa:** Customer input keys sendiri, operator tidak pegang secrets. Wajib untuk trust & scalability.

**Tasks:**
- [ ] Buat model `ExchangeCredential`:
  ```
  model ExchangeCredential {
    id          String   @id @default(cuid())
    userId      String
    exchangeId  String   // "binance" | "coinbase" | ...
    apiKeyEnc   String   // AES-256-GCM encrypted
    apiSecretEnc String  // AES-256-GCM encrypted
    label       String?  // user-friendly name
    isDefault   Boolean  @default(false)
    createdAt   DateTime @default(now())
    // ... relation to User
  }
  ```
- [ ] Buat `src/lib/crypto.ts` — AES-256-GCM encrypt/decrypt dengan master key dari env (`ENCRYPTION_MASTER_KEY`)
- [ ] API routes: `GET /api/v1/exchange-credentials` (list, masked), `POST` (create, encrypt before store), `DELETE` (revoke)
- [ ] UI: Settings → API Keys → add/remove/test connection
- [ ] Execution bot baca credentials dari DB (decrypt on-demand), bukan dari env
- [ ] Test connection button — CCXT `fetchBalance()` untuk verify keys valid
- [ ] **Security:** master key tidak pernah di-log, credentials hanya decrypt di memory saat dibutuhkan

**Done when:**
- User bisa add/remove API keys via UI
- Keys ter-encrypt di DB (tidak plaintext)
- Execution bot pakai keys dari DB
- Test connection button verify keys valid

---

### 1.6 Docker + Cloud Deploy (1 sesi)

**Kenapa:** Tanpa ini, app tidak accessible dari internet. VPS murah untuk testing.

**Tasks:**
- [ ] Buat `Dockerfile` untuk Next.js app (multi-stage build, standalone output)
- [ ] Buat `Dockerfile` untuk setiap mini-service (ws-prices, execution-bot)
- [ ] Buat `docker-compose.yml` — orchestrate app + mini-services + PostgreSQL + Caddy
- [ ] Pilih VPS:
  - Opsi A: **Hetzner Cloud** (€4.5/bln, 2GB RAM, Eropa) — recommended
  - Opsi B: **DigitalOcean** ($6/bln, 1GB RAM, global)
  - Opsi C: **Vultr** ($6/bln, similar)
- [ ] Setup VPS: SSH, firewall, Docker install
- [ ] Deploy: `docker-compose up -d` di VPS
- [ ] Config domain (ataupun gunakan IP sementara untuk testing)
- [ ] Caddy TLS (auto Let's Encrypt) + reverse proxy
- [ ] Environment variables management (Docker secrets atau `.env.production`)
- [ ] Health check endpoint untuk monitoring

**Done when:**
- App accessible via domain publik dengan HTTPS
- Docker containers restart otomatis on crash
- PostgreSQL persistent (volume mount)
- TLS certificate valid (browser green lock)

---

## Fase 2 — SaaS Layer

> **Goal:** Customer bisa self-onboard, pay, dan use tanpa intervensi operator.

### 2.1 Stripe Billing (1 sesi)

- [ ] Stripe account setup (support global, crypto-friendly)
- [ ] Definisikan plan tiers:
  - **FREE** — 1 exchange, 5 instruments, 10 alerts, paper trading only, community support
  - **PRO** ($29/bln atau $290/thn) — 3 exchanges, 50 instruments, 100 alerts, live trading, email support
  - **INSTITUTIONAL** ($99/bln atau $990/thn) — unlimited exchanges, unlimited instruments, priority support, audit log export, API access
- [ ] Stripe Checkout + Customer Portal integration
- [ ] Webhook handler untuk `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
- [ ] Update `User.plan` berdasarkan Stripe subscription status
- [ ] UI: pricing page, upgrade/downgrade, billing history, cancel
- [ ] Trial period (14 days PRO free, no card required)

### 2.2 Self-Service Signup (0.5 sesi)

- [ ] Public signup page (email + password, email verification)
- [ ] Password reset flow (email link)
- [ ] Email service (Resend atau AWS SES)
- [ ] Onboarding wizard: pilih exchange → input API key → select instruments → done
- [ ] Rate limit signup (anti-abuse)

### 2.3 Usage Limits per Plan (0.5 sesi)

- [ ] Middleware/hook untuk enforce limits:
  - Max instruments per plan
  - Max alerts per plan
  - Max backtests per day
  - Live trading only for PRO+
- [ ] UI: show usage (X/50 instruments used), upgrade prompt saat limit

### 2.4 Admin Dashboard (1 sesi)

- [ ] Admin-only route `/admin`
- [ ] User management (list, suspend, delete, change plan)
- [ ] Revenue metrics (MRR, churn, ARPU via Stripe API)
- [ ] System health (DB connections, error rate, active users)
- [ ] Abuse detection (signup spam, API abuse)

---

## Fase 3 — Institutional Hardening

> **Goal:** Lolos security review enterprise customer. Trust = revenue.

### 3.1 Audit Log Ekspansi (1 sesi)

- [ ] Extend hash-chain audit log ke semua mutations:
  - Login/logout events
  - Config changes (alerts, settings, API key add/remove)
  - Order lifecycle (sudah ada, extend ke semua order actions)
  - Backtest runs
- [ ] Audit log UI: filter by action/user/date, export CSV/JSON
- [ ] Tamper-evident verification endpoint

### 3.2 Backup & Disaster Recovery (1 sesi)

- [ ] Automated daily PostgreSQL backup (pg_dump, encrypted, offsite)
- [ ] Point-in-time recovery (WAL archiving)
- [ ] Monthly restore test (automated, alert jika fail)
- [ ] Documented RPO/RTO
- [ ] Runbook untuk disaster recovery

### 3.3 Compliance Docs (1 sesi)

- [ ] Terms of Service (lawyer-reviewed)
- [ ] Privacy Policy (GDPR-compliant)
- [ ] Data Processing Agreement (DPA) template
- [ ] GDPR endpoints: data export (user's all data as JSON), data deletion
- [ ] Cookie policy + consent banner (jika perlu)
- [ ] Subprocessor list (Stripe, VPS provider, email service)

### 3.4 Monitoring & Observability (0.5 sesi)

- [ ] Sentry error tracking (frontend + backend)
- [ ] Uptime monitoring (BetterUptime atau UptimeRobot)
- [ ] Performance metrics (Next.js Analytics atau Vercel Analytics jika deploy ke Vercel)
- [ ] Log aggregation (Loki atau CloudWatch)
- [ ] Alerting (Slack/Discord webhook untuk critical errors)

### 3.5 CI/CD + Testing (1 sesi)

- [ ] GitHub Actions:
  - Lint + type check on every PR
  - Unit tests (Vitest)
  - Integration tests (API routes dengan test DB)
  - E2E tests (Playwright untuk critical flows: signup, login, place order, backtest)
  - Auto-deploy ke staging on merge to main
- [ ] Test coverage target: 70%+ untuk critical paths
- [ ] Pre-deploy checklist (manual review untuk production deploy)

---

## Fase 4 — Web3 Enhancement

> **Goal:** Differentiator vs kompetitor (TradingView, Coinigy, dll). Web3-native features.

### 4.1 DefiLlama Integration (0.5 sesi)

- [ ] `src/lib/data-sources/defillama.ts` — TVL per chain, per protocol, protocol stats
- [ ] Dashboard widget: top chains by TVL, top protocols, TVL trend
- [ ] Protocol detail page: TVL breakdown, chain distribution, treasury

### 4.2 On-Chain Metrics (1 sesi)

- [ ] Wallet movement tracking untuk watched instruments (whale alerts)
- [ ] Exchange inflow/outflow (Glassnode API atau free alternative)
- [ ] On-chain indicators: active addresses, transaction volume, holder distribution
- [ ] UI: on-chain metrics panel di instrument detail

### 4.3 Multi-Exchange Completion (1 sesi)

- [ ] Test semua 10-15 exchanges di CCXT (beberapa mungkin perlu special handling)
- [ ] Per-exchange rate limit config
- [ ] Per-exchange WS stream (tidak semua exchange punya WS, fallback ke polling)
- [ ] Exchange status page (uptime per exchange)
- [ ] Aggregated order book (opsional, advanced)

### 4.4 Wallet Connect (opsional, 1 sesi)

- [ ] MetaMask/WalletConnect integration
- [ ] Track user's on-chain portfolio (ETH, ERC-20, NFTs)
- [ ] DeFi position monitoring (Uniswap LP, Aave lending, dll)
- [ ] Combine CEX + on-chain portfolio dalam 1 view

---

## Fase 5 — Launch & Polish

> **Goal:** Public launch ready. Trust + usability + performance.

### 5.1 Documentation (1 sesi)

- [ ] User manual (getting started, each module, FAQ)
- [ ] API docs (OpenAPI/Swagger untuk public API jika ada)
- [ ] Admin guide (operator manual)
- [ ] Video tutorials (onboarding, key features)
- [ ] Knowledge base / helpdesk (Crisp atau Intercom)

### 5.2 Security Audit (1 sesi)

- [ ] Self-pentest (Burp Suite, Nmap, OWASP ZAP)
- [ ] Third-party security review ( freelance pentester atau firm)
- [ ] Bug bounty program (HackerOne atau Immunefi untuk Web3)
- [ ] Fix all high/critical findings
- [ ] Public security disclosure policy

### 5.3 Performance Optimization (0.5 sesi)

- [ ] Query optimization (Prisma query analysis, add indexes)
- [ ] Caching layer (Redis untuk hot data: quotes, health)
- [ ] CDN untuk static assets (Cloudflare)
- [ ] Bundle size optimization (Next.js analyzer)
- [ ] Load test (k6 atau Artillery) — target 100 concurrent users

### 5.4 Support System (0.5 sesi)

- [ ] Helpdesk integration (Crisp atau Intercom)
- [ ] SLA document (response time guarantees per plan)
- [ ] Incident response runbook
- [ ] Status page (status.meridian.example.com)
- [ ] On-call rotation (jika team > 1 orang)

### 5.5 Marketing Prep (0.5 sesi)

- [ ] Landing page (marketing site, separate dari app)
- [ ] SEO optimization
- [ ] Product Hunt launch prep
- [ ] Social media (Twitter/X, Discord community)
- [ ] Content marketing (blog posts, trading guides)

---

## Metrik Sukses

### Pre-launch (akhir Fase 4)
- [ ] 10 beta users active
- [ ] 0 data integrity violations (grep codebase, no mock/dummy)
- [ ] 99.5% uptime selama 30 hari
- [ ] Security audit: 0 critical findings
- [ ] Backup restore tested successfully

### Post-launch (3 bulan)
- [ ] 100 paying customers
- [ ] $3,000 MRR (Monthly Recurring Revenue)
- [ ] < 2% churn rate
- [ ] 4.5+ star rating (jika ada review platform)
- [ ] 99.9% uptime

### Scale (12 bulan)
- [ ] 1,000 paying customers
- [ ] $30,000 MRR
- [ ] Enterprise customer (1+ institutional plan)
- [ ] Team hire (1-2 orang)
- [ ] SOC 2 compliance (jika enterprise demand)

---

## Risk & Mitigation

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Exchange API change/break | Tinggi | Sedang | Multi-exchange (CCXT abstracts), monitor health, quick fallback |
| Regulatory crackdown (crypto) | Sedang | Tinggi | Multi-jurisdiction, ToS clear "not financial advice", compliance docs |
| Security breach | Rendah | Sangat Tinggi | Audit log, encryption, pentest, bug bounty, incident response |
| Competitor (TradingView, dll) | Tinggi | Sedang | Web3-native differentiator, competitive pricing, superior UX |
| Cost overruns (VPS, API) | Sedang | Sedang | Usage limits per plan, monitoring, auto-scale only when revenue justifies |
| Single founder burnout | Sedang | Tinggi | Roadmap realistis, outsourcing ops tasks, hire pertama saat $10k MRR |

---

## Decision Log

Record keputusan penting + tanggal + alasan.

| Tanggal | Keputusan | Alasan |
|---|---|---|
| Hari ini | Pivot multi-asset → crypto/Web3-only | Stabilitas teknis (Yahoo crash), fokus pasar global, sederhanakan compliance |
| Hari ini | Level B (CEX + basic on-chain) untuk MVP | Balance value vs effort, Level C (wallet connect) bisa Fase 4+ |
| Hari ini | Multi-exchange sejak awal (10-15 via CCXT) | Global target, CCXT sudah ada, cost tambahan kecil |
| Hari ini | Stripe untuk billing | Global, crypto-friendly, 46+ countries |
| Hari ini | VPS murah (Hetzner/DO) untuk testing | Validasi product-market fit sebelum invest infra mahal |
| Hari ini | PostgreSQL (Neon/Supabase) | Concurrent users, scale, managed service |

---

## Cara Kontribusi (untuk founder/dev)

1. **Sebelum mulai sesi:** baca roadmap ini, pilih task dari fase aktif
2. **Saat sesi:** update checkbox `[x]` saat task selesai, catat di Decision Log jika ada keputusan
3. **Sesudah sesi:** commit + push, update "Last updated" di atas
4. **Saat fase selesai:** tandai status di tabel Ringkasan Eksekutif

**Aturan:** jangan skip fase. Jangan mulai Fase 2 sebelum Fase 1 selesai. Setiap fase punya dependency.

---

**Roadmap ini adalah dokumen hidup. Update setiap sesi. Jujur tentang status.**
