// MERIDIAN Terminal — instrumentation hook (runs once at server startup).
// https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
//
// Purpose: install global process-level error handlers so transient network
// errors (ECONNRESET from Yahoo Finance, socket hang-up, etc.) do NOT crash
// the dev server. These errors are logged but the process stays alive —
// critical for sandbox stability (a crashed dev server = "sandbox inactive").

export async function register(): Promise<void> {
  // Instrumentation runs in both nodejs and edge runtimes. process.on is
  // only available in the Node.js runtime — guard so we don't crash edge.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (typeof process === "undefined" || typeof process.on !== "function") return;

  let warned = false;
  const install = () => {
    if (warned) return;
    warned = true;
    process.on("uncaughtException", (err: NodeJS.ErrnoException) => {
      // ECONNRESET / ECONNREFUSED / EPIPE / ETIMEDOUT are transient network
      // errors from external API calls (Yahoo Finance rate-limit resets).
      // Log + swallow so the server stays alive.
      const code = err?.code ?? "";
      const transient = [
        "ECONNRESET",
        "ECONNREFUSED",
        "EPIPE",
        "ETIMEDOUT",
        "ENOTFOUND",
        "EAI_AGAIN",
        "UND_ERR_SOCKET",
        "ABORT_ERR",
      ].includes(code);
      if (transient || /aborted|socket hang up/i.test(err.message)) {
        console.error(
          `[instrumentation] transient network error suppressed (${code}): ${err.message}`
        );
        return;
      }
      // Non-transient: log loudly but still don't crash the dev server.
      // In production these would warrant investigation.
      console.error("[instrumentation] uncaughtException (non-transient):", err);
    });
    process.on("unhandledRejection", (reason: unknown) => {
      const msg = reason instanceof Error ? reason.message : String(reason);
      const code =
        reason instanceof Error && "code" in reason
          ? String((reason as { code?: unknown }).code ?? "")
          : "";
      const transient = [
        "ECONNRESET",
        "ECONNREFUSED",
        "EPIPE",
        "ETIMEDOUT",
        "ENOTFOUND",
        "EAI_AGAIN",
        "UND_ERR_SOCKET",
        "ABORT_ERR",
      ].includes(code);
      if (transient || /aborted|socket hang up|fetch failed/i.test(msg)) {
        console.error(
          `[instrumentation] transient unhandledRejection suppressed (${code}): ${msg}`
        );
        return;
      }
      console.error("[instrumentation] unhandledRejection (non-transient):", reason);
    });
    console.log("[instrumentation] global error handlers installed");
  };

  install();
}
