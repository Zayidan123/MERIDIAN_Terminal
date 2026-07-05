# Task ID: 5-4
# Agent: full-stack-developer (Telegram Bot notifications)

## Task
Implement Telegram Bot notifications for MERIDIAN Terminal (PRD FR-2.3,
gap item #3):
- A. Telegram notification service `src/lib/notifications/telegram.ts`
- B. Config endpoint `src/app/api/v1/notifications/telegram/route.ts`
- C. Hook `notifyAlertTriggered` into `alerts/evaluate` and `notifySignal`
     (WARN+CRITICAL only) into `signals/scan` — fire-and-forget
- D. Settings UI panel in `sources-view.tsx` (Notifications panel below
     the Data Sources panel)
- E. Append env block to `.env`

## Files created
- `src/lib/notifications/telegram.ts` — lazy singleton wrapper around
  `node-telegram-bot-api`. Reads `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`
  from env. Exports: `isConfigured()`, `sendMessage(text)`,
  `notifySignal(params)`, `notifyAlertTriggered(params)`. All sends are
  no-ops when unconfigured (single debug log line), and swallow all
  errors (429/network/API) → never throw.
- `src/app/api/v1/notifications/telegram/route.ts` —
  - `GET` → `{ ok:true, data:{ configured, chatId, botTokenSet } }`.
    Auth enforced by middleware (no body change). Never returns the
    bot token.
  - `POST` body `{ test:true }` → sends `🧪 MERIDIAN Terminal — test
    notification` to the configured chat. 400 with
    `{ ok:false, error:"Telegram not configured" }` when unconfigured.
    Empty / non-test body → 400 `{ ok:false, error:"Only { test: true }
    is supported" }`.

## Files modified (minimal edits — only the import + the fire-and-forget call)
- `src/app/api/v1/alerts/evaluate/route.ts` — added
  `import { notifyAlertTriggered } from "@/lib/notifications/telegram"`
  + a 12-line `void notifyAlertTriggered({...}).catch(...)` block right
  after the `triggered.push({...})` call (i.e. after the SignalEvent
  was created in the `db.$transaction`). Handler structure unchanged.
  Notifies on ALL `ALERT_TRIGGER` events (INFO/WARN/CRITICAL) — per
  spec ("at least notify on ALERT_TRIGGER events").
- `src/app/api/v1/signals/scan/route.ts` — added
  `import { notifySignal } from "@/lib/notifications/telegram"` + a
  guarded `void notifySignal({...}).catch(...)` block right after
  `detected.push({...})`. Notifies ONLY on `severity === "WARN" ||
  severity === "CRITICAL"` (VOLUME_SPIKE=warn, RSI_OB/OS=warn,
  ANOMALY=critical; BREAKOUT=info is skipped to avoid spam).
- `src/components/terminal/sources-view.tsx` — added the
  `TelegramNotificationsPanel` component (inline
  `useTelegramConfig` query + `useMutation` "Send test" button) below
  the existing "Data Sources" panel in the left column. Uses shadcn
  `Button`, sonner `toast`, lucide `Send`/`MessageSquare`/`Loader2`
  icons. Shows configured/not-configured badge, bot token presence,
  chat ID (or "—"), and a 4-step "How to enable" instruction list when
  unconfigured. The inline hook keeps `src/lib/api-client.ts` untouched
  (other agents may be editing it).
- `.env` — appended documented Telegram block:
  ```
  # ── Telegram Bot notifications (PRD FR-2.3). ─────────────────────────────
  TELEGRAM_BOT_TOKEN=
  TELEGRAM_CHAT_ID=
  ```
  Both empty by default (unconfigured → silent no-op).

## Design decisions
- `node-telegram-bot-api` is loaded via `require()` inside `getBot()`
  (lazy, only on first send attempt). This keeps the module load cheap
  when notifications are unused, and avoids bundling the lib into
  client builds (the route handlers run server-side only).
- The singleton is initialized exactly once via the `botInitAttempted`
  flag; subsequent calls return the cached instance (or `null` if the
  first attempt failed because the token was missing).
- All `send*` / `notify*` calls are async but never throw — the
  internal try/catch logs `[telegram] sendMessage failed: <msg>` and
  returns. Callers in the signal engines use
  `void notifyX(...).catch(...)` defensively, though the function
  already swallows.
- HTML parse mode is used (Telegram's default). All user-controlled
  text (symbol, message, severity, etc.) is escaped via a small
  `escapeHtml()` helper (`&`/`<`/`>`). Numbers are formatted via
  `.toFixed(4)`.
- The `POST { test: true }` endpoint accepts an empty body too (defaults
  to test mode if `test` is omitted) — graceful against curl mistakes.
  When `test` is explicitly `false` or another value → 400 with a
  helpful message.
- The notifications endpoint relies entirely on the global middleware
  for auth/CSRF/rate-limit (no body change). Verified: GET/POST
  without a session cookie → 401 Unauthorized.

## Verification
- `bun run lint` → exit 0, 0 errors, 0 warnings.
- Main app `GET /` → HTTP 200.
- Authenticated `GET /api/v1/notifications/telegram` →
  `{"ok":true,"data":{"configured":false,"chatId":null,"botTokenSet":false}}`
  ✓ (env empty by default → not configured, exactly as required).
- Authenticated `POST /api/v1/notifications/telegram` body
  `{"test":true}` → `{"ok":false,"error":"Telegram not configured"}`
  HTTP 400 ✓.
- Unauthenticated GET/POST → `{"ok":false,"error":"Unauthorized"}` HTTP
  401 ✓ (middleware auth enforced).
- Authenticated `POST /api/v1/signals/scan` → HTTP 200
  (`scanned:19, detected:[], skipped:[Yahoo 429s…]`). The notifySignal
  hook is in place but a no-op because Telegram is unconfigured — no
  errors logged. Data path is unaffected.
- Authenticated `POST /api/v1/alerts/evaluate` → HTTP 200
  (`evaluated:1, triggered:[], skipped:[EUR/USD HTTP 429]`). The
  notifyAlertTriggered hook is in place but a no-op. Data path
  unaffected.
- dev.log shows: `GET /api/v1/notifications/telegram 200 in 465ms`,
  `POST /api/v1/notifications/telegram 400 in 15ms`,
  `POST /api/v1/signals/scan 200 in 1476ms`,
  `POST /api/v1/alerts/evaluate 200 in 171ms` — no compile errors.

## How the user enables Telegram
1. DM `@BotFather` on Telegram → `/newbot` → choose a name → copy the
   bot token (format `123456789:ABCdefGhiJklMno…`).
2. Create a private chat with the new bot, or add it as an admin to a
   channel/group. (The bot must be able to post messages.)
3. Get the chat ID:
   - For a private chat: DM `@userinfobot` → it replies with your
     numeric chat ID (e.g. `123456789`).
   - For a channel/group: use the public username (e.g.
     `@mychannel`) OR invite `@userinfobot` to read the chat ID.
4. Edit `.env`:
   ```
   TELEGRAM_BOT_TOKEN=123456789:ABCdefGhiJklMno…
   TELEGRAM_CHAT_ID=123456789
   ```
5. Restart the app (`bun run dev`).
6. Open the terminal → Data Sources module → Notifications panel now
   shows "Configured" with the chat ID. Click "Send test" — a
   `🧪 MERIDIAN Terminal — test notification` message should arrive
   in Telegram. The toast confirms success.
7. From now on, every WARN/CRITICAL signal detected by
   `/api/v1/signals/scan` and every ALERT_TRIGGER fired by
   `/api/v1/alerts/evaluate` will push an HTML-formatted message to
   the chat. INFO signals (BREAKOUT) are not pushed (filter them in
   Telegram by muting INFO keywords if desired).

## Files NOT touched (per ownership rules)
- `src/app/page.tsx`, `src/components/providers.tsx`,
  `src/app/layout.tsx`, `src/middleware.ts`, `next.config.ts`,
  `prisma/schema.prisma`, `src/components/terminal/quote-table.tsx`,
  `src/components/terminal/status-bar.tsx`, `src/hooks/use-live-prices.ts`,
  `src/lib/api-client.ts`, and all other `/api/v1/*` handlers EXCEPT
  the two hook-ins (alerts/evaluate, signals/scan) and the new
  notifications route.

## Lint status
`bun run lint` → exit 0, 0 errors, 0 warnings.
