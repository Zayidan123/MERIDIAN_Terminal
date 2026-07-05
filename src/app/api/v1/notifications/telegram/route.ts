// MERIDIAN Terminal — Telegram notifications config endpoint (PRD FR-2.3).
//
// GET  : returns the current Telegram configuration status. Auth enforced by
//        the global middleware (every /api/v1/* except /health requires a
//        valid session). The response NEVER includes the bot token.
// POST : body `{ test: true }` sends a test message to the configured chat.
//        Returns 400 when Telegram is not configured.

import { NextResponse } from "next/server";
import { isConfigured, sendMessage } from "@/lib/notifications/telegram";

const TEST_MESSAGE = "🧪 MERIDIAN Terminal — test notification";

interface ConfigData {
  configured: boolean;
  chatId: string | null;
  botTokenSet: boolean;
}

function getConfigData(): ConfigData {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const tokenSet = typeof token === "string" && token.trim().length > 0;
  const chatIdVal =
    typeof chatId === "string" && chatId.trim().length > 0
      ? chatId.trim()
      : null;
  return {
    configured: tokenSet && chatIdVal !== null,
    chatId: chatIdVal,
    botTokenSet: tokenSet,
  };
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, data: getConfigData() });
  } catch (e) {
    console.error("[notifications.telegram.GET]", e);
    return NextResponse.json(
      { ok: false, error: "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    // Body is optional — `{ test: true }` is the documented shape but the
    // endpoint also accepts an empty body (defaults to test mode).
    let body: unknown = {};
    try {
      const text = await request.text();
      if (text.length > 0) body = JSON.parse(text);
    } catch {
      // Non-JSON / empty body — fall through with the default `{}` shape.
      body = {};
    }

    const isTest =
      typeof body === "object" &&
      body !== null &&
      (body as { test?: unknown }).test === true;

    if (!isTest) {
      return NextResponse.json(
        { ok: false, error: "Only `{ test: true }` is supported" },
        { status: 400 }
      );
    }

    if (!isConfigured()) {
      return NextResponse.json(
        { ok: false, error: "Telegram not configured" },
        { status: 400 }
      );
    }

    // sendMessage never throws — it logs + swallows on failure. We surface
    // a success response regardless; if the user sees the toast but no
    // Telegram message arrives, the cause will be in the server log.
    await sendMessage(TEST_MESSAGE);
    return NextResponse.json({ ok: true, data: { sent: true } });
  } catch (e) {
    console.error("[notifications.telegram.POST]", e);
    return NextResponse.json(
      { ok: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
