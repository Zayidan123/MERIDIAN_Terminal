// MERIDIAN Terminal — Telegram Bot notifications (PRD FR-2.3, gap item #3).
//
// Lazy singleton wrapper around `node-telegram-bot-api`. Reads
// `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` from the environment.
//
// Design rules (notifications must NEVER break the data path):
//   • When the bot token is missing, `isConfigured()` returns false and every
//     `send*` / `notify*` call is a no-op that logs a single debug line.
//   • On any send failure (429, network, Telegram API error), the error is
//     logged to stdout and swallowed — callers receive a resolved promise.
//   • All notifications are fire-and-forget from the signal engines' point of
//     view (the engine does not await them).
//
// Messages are sent with `parse_mode: 'HTML'` and `disable_web_page_preview`
// enabled. The chat ID is parsed defensively — numeric IDs, `-100…` supergroup
// IDs, and `@channelusername` strings are all accepted by the upstream API.

import type TelegramBot from "node-telegram-bot-api";

interface NotifySignalParams {
  instrumentSymbol: string;
  assetClass: string;
  signalType: string;
  severity: string;
  message: string;
  priceAtEvent?: number | null;
}

interface NotifyAlertTriggeredParams {
  instrumentSymbol: string;
  metric: string;
  operator: string;
  threshold: number;
  observed: number;
  priceAtEvent?: number | null;
}

let botSingleton: TelegramBot | null = null;
let botInitAttempted = false;

function getToken(): string | undefined {
  const v = process.env.TELEGRAM_BOT_TOKEN;
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

function getChatId(): string | undefined {
  const v = process.env.TELEGRAM_CHAT_ID;
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

/// True only when BOTH the bot token and chat ID are present in the env.
/// Used by the config endpoint and by the UI to decide what to render.
export function isConfigured(): boolean {
  return getToken() !== undefined && getChatId() !== undefined;
}

/// Lazy singleton accessor. Returns the cached `TelegramBot` instance, or
/// `null` when unconfigured / not yet initialized. We never throw on
/// instantiation failure — the singleton is simply left null and a warning
/// is logged.
function getBot(): TelegramBot | null {
  if (botInitAttempted) return botSingleton;
  botInitAttempted = true;

  const token = getToken();
  if (!token) {
    // Unconfigured — this is the expected default state. Stay quiet (the
    // caller's send path will log a single debug line).
    return null;
  }

  try {
    // `node-telegram-bot-api` is imported dynamically so the module loads
    // cleanly on the server side without being bundled into the client.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Ctor = require("node-telegram-bot-api") as typeof TelegramBot;
    // polling:false — we only call sendMessage; never start long polling.
    botSingleton = new Ctor(token, { polling: false });
    return botSingleton;
  } catch (e) {
    console.warn(
      "[telegram] failed to initialize bot instance — notifications disabled:",
      e instanceof Error ? e.message : String(e)
    );
    return null;
  }
}

/// Low-level send. Never throws — returns a resolved promise on failure.
/// `text` is sent as HTML with link preview disabled.
export async function sendMessage(text: string): Promise<void> {
  const bot = getBot();
  const chatId = getChatId();
  if (!bot || !chatId) {
    if (process.env.NODE_ENV !== "production") {
      console.debug(
        "[telegram] sendMessage skipped — not configured (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)"
      );
    }
    return;
  }
  try {
    await bot.sendMessage(chatId, text, {
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });
  } catch (e) {
    // 429 / network / Telegram API error — surface once, then swallow.
    // Notifications MUST NOT break the data path.
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[telegram] sendMessage failed: ${msg}`);
  }
}

/// Format + send a signal-detection notification (from /signals/scan).
export async function notifySignal(params: NotifySignalParams): Promise<void> {
  const {
    instrumentSymbol,
    assetClass,
    signalType,
    severity,
    message,
    priceAtEvent,
  } = params;

  const ts = new Date().toISOString();
  const priceLine =
    typeof priceAtEvent === "number" && Number.isFinite(priceAtEvent)
      ? `\nPrice: <code>${priceAtEvent.toFixed(4)}</code>`
      : "";

  const text =
    `<b>🚨 MERIDIAN Signal</b>\n` +
    `<b>${escapeHtml(instrumentSymbol)}</b> (${escapeHtml(assetClass)}) — ` +
    `${escapeHtml(signalType)} [${escapeHtml(severity)}]\n` +
    `${escapeHtml(message)}${priceLine}\n` +
    `<i>${escapeHtml(ts)}</i>`;

  await sendMessage(text);
}

/// Format + send an alert-triggered notification (from /alerts/evaluate).
export async function notifyAlertTriggered(
  params: NotifyAlertTriggeredParams
): Promise<void> {
  const {
    instrumentSymbol,
    metric,
    operator,
    threshold,
    observed,
    priceAtEvent,
  } = params;

  const ts = new Date().toISOString();
  const priceLine =
    typeof priceAtEvent === "number" && Number.isFinite(priceAtEvent)
      ? `\nPrice: <code>${priceAtEvent.toFixed(4)}</code>`
      : "";

  const text =
    `<b>🔔 MERIDIAN Alert Triggered</b>\n` +
    `<b>${escapeHtml(instrumentSymbol)}</b> — ${escapeHtml(metric)} ` +
    `${escapeHtml(operator)} ${threshold.toFixed(4)} ` +
    `(observed <code>${observed.toFixed(4)}</code>)${priceLine}\n` +
    `<i>${escapeHtml(ts)}</i>`;

  await sendMessage(text);
}

/// Minimal HTML escaper — Telegram's HTML parse mode only requires `<`, `>`,
/// and `&` to be escaped inside text. We do not escape attributes (none used).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
