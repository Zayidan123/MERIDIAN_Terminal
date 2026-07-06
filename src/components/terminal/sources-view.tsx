"use client";

import { Panel, EmptyState, LoadingState } from "@/components/panel";
import { useHealth } from "@/lib/api-client";
import { fmtTimeAgo, SOURCE_LABELS } from "@/lib/format";
import { Database, CheckCircle2, XCircle, AlertTriangle, Clock, Activity, Send, MessageSquare, Loader2, ShieldCheck, KeyRound, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useState } from "react";

const STATUS_META: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; label: string }> = {
  OK: { icon: CheckCircle2, color: "#2e9e6d", bg: "rgba(46,158,109,0.12)", label: "Operational" },
  FAIL: { icon: XCircle, color: "#c7484b", bg: "rgba(199,72,75,0.12)", label: "Failed" },
  RATE_LIMITED: { icon: AlertTriangle, color: "#d4a02a", bg: "rgba(212,160,42,0.12)", label: "Rate-Limited" },
  TIMEOUT: { icon: Clock, color: "#d4a02a", bg: "rgba(212,160,42,0.12)", label: "Timed Out" },
};

const SOURCES = [
  {
    key: "binance",
    label: "Binance API",
    desc: "Crypto OHLCV klines + ticker (data-api.binance.vision)",
    endpoints: ["klines", "ticker/price", "klines24h"],
  },
  {
    key: "yahoo",
    label: "Yahoo Finance",
    desc: "IDX equities (.JK), forex (XXX=X), gold (GC=F) via query2",
    endpoints: ["chart"],
  },
  {
    key: "coingecko",
    label: "CoinGecko",
    desc: "Crypto market cap / FDV (reserved; not actively used)",
    endpoints: [],
  },
];

// ─── Telegram notifications config (PRD FR-2.3) ────────────────────────
// Inline hook + panel — kept inside sources-view.tsx so we don't touch the
// shared api-client.ts (other agents may be editing it).
interface TelegramConfigData {
  configured: boolean;
  chatId: string | null;
  botTokenSet: boolean;
}

interface TelegramConfigResponse {
  ok: true;
  data: TelegramConfigData;
}

function useTelegramConfig() {
  return useQuery<TelegramConfigData>({
    queryKey: ["telegram-config"],
    queryFn: async () => {
      const r = await fetch("/api/v1/notifications/telegram", {
        headers: { Accept: "application/json" },
      });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const j = (await r.json()) as { error?: string };
          if (j?.error) msg = j.error;
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const j = (await r.json()) as TelegramConfigResponse;
      return j.data;
    },
    staleTime: 30_000,
  });
}

function TelegramNotificationsPanel() {
  const cfg = useTelegramConfig();
  const qc = useQueryClient();
  const sendTest = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/v1/notifications/telegram", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ test: true }),
      });
      const j = (await r.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!r.ok || !j.ok) {
        throw new Error(j.error || `HTTP ${r.status}`);
      }
    },
    onSuccess: () => {
      toast.success("Telegram test message sent");
    },
    onError: (e: unknown) => {
      toast.error("Telegram test failed", {
        description: e instanceof Error ? e.message : String(e),
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["telegram-config"] });
    },
  });

  const data = cfg.data;
  const loading = cfg.isLoading;
  const error = cfg.error;

  return (
    <Panel
      title="Notifications"
      subtitle="Telegram Bot · PRD FR-2.3"
      bodyClassName="flex flex-col gap-2"
    >
      {loading ? (
        <LoadingState rows={2} />
      ) : error ? (
        <EmptyState
          title="Unable to load Telegram config"
          hint={error instanceof Error ? error.message : String(error)}
          icon={<MessageSquare className="h-6 w-6" />}
        />
      ) : data ? (
        <>
          <div className="border border-[#262b33] rounded-md p-3 bg-[#11151c]">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-3.5 w-3.5 text-[#8891a0]" />
                  <span className="text-[12px] font-semibold text-[#e7e9ec]">Telegram Bot</span>
                </div>
                <p className="text-[10px] text-[#8891a0] mt-1">
                  Push signal &amp; alert notifications to a Telegram chat.
                </p>
              </div>
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded shrink-0"
                style={{
                  backgroundColor: data.configured
                    ? "rgba(46,158,109,0.12)"
                    : "rgba(199,72,75,0.12)",
                }}
              >
                {data.configured ? (
                  <CheckCircle2 className="h-3 w-3" style={{ color: "#2e9e6d" }} />
                ) : (
                  <XCircle className="h-3 w-3" style={{ color: "#c7484b" }} />
                )}
                <span
                  className="text-[10px] uppercase tracking-wider"
                  style={{ color: data.configured ? "#2e9e6d" : "#c7484b" }}
                >
                  {data.configured ? "Configured" : "Not Configured"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 mt-3 text-[10px]">
              <div className="flex flex-col gap-0.5">
                <span className="uppercase tracking-wider text-[#4a525c]">Bot token</span>
                <span className="tabular text-[#8891a0]">
                  {data.botTokenSet ? "set in env" : "missing"}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="uppercase tracking-wider text-[#4a525c]">Chat ID</span>
                <span className="tabular text-[#8891a0] truncate" title={data.chatId ?? ""}>
                  {data.chatId ?? "—"}
                </span>
              </div>
            </div>
          </div>

          {data.configured ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] text-[#8891a0] leading-snug">
                Send a test message to verify the bot can reach your chat.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={sendTest.isPending}
                onClick={() => sendTest.mutate()}
                className="h-7 gap-1.5 text-[11px] border-[#262b33] bg-[#11151c] hover:bg-[#1b2029] hover:text-[#e7e9ec]"
              >
                {sendTest.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Send className="h-3 w-3" />
                )}
                Send test
              </Button>
            </div>
          ) : (
            <div className="p-2 rounded bg-[#0b0e13] border border-[#262b33] text-[10px] text-[#8891a0] leading-relaxed">
              <strong className="text-[#e7e9ec]">How to enable:</strong>
              <ol className="list-decimal list-inside mt-1 space-y-0.5">
                <li>
                  Talk to <code className="text-[#e7e9ec]">@BotFather</code> → create a bot → copy
                  the token.
                </li>
                <li>
                  Add the bot to your channel/group, or open a private chat with it.
                </li>
                <li>
                  Get your chat ID from <code className="text-[#e7e9ec]">@userinfobot</code> (or use{" "}
                  <code className="text-[#e7e9ec]">@channelusername</code>).
                </li>
                <li>
                  Set <code className="text-[#e7e9ec]">TELEGRAM_BOT_TOKEN</code> and{" "}
                  <code className="text-[#e7e9ec]">TELEGRAM_CHAT_ID</code> in{" "}
                  <code className="text-[#e7e9ec]">.env</code>, then restart the app.
                </li>
              </ol>
              <p className="mt-1.5 text-[#4a525c]">
                Until configured, signal &amp; alert notifications are silently skipped — the data
                path is unaffected.
              </p>
            </div>
          )}
        </>
      ) : null}
    </Panel>
  );
}

export function SourcesView() {
  const health = useHealth();
  const latest = health.data?.latest ?? [];
  const recent = health.data?.recent ?? [];

  const bySource: Record<string, { status: string; latencyMs: number; checkedAt: number }> = {};
  for (const l of latest) bySource[l.source] = { status: l.status, latencyMs: l.latencyMs, checkedAt: l.checkedAt };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 h-full overflow-y-auto pr-1">
      {/* Source status cards */}
      <div className="flex flex-col gap-3 min-h-0">
        <Panel title="Data Sources" subtitle="Real-market providers · live health" bodyClassName="flex flex-col gap-2">
          {SOURCES.map((s) => {
            const h = bySource[s.key];
            const meta = h ? STATUS_META[h.status] : null;
            const Icon = meta?.icon ?? Activity;
            return (
              <div key={s.key} className="border border-[#262b33] rounded-md p-3 bg-[#11151c]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Database className="h-3.5 w-3.5 text-[#8891a0]" />
                      <span className="text-[12px] font-semibold text-[#e7e9ec]">{s.label}</span>
                    </div>
                    <p className="text-[10px] text-[#8891a0] mt-1">{s.desc}</p>
                  </div>
                  <div
                    className="flex items-center gap-1.5 px-2 py-1 rounded shrink-0"
                    style={{ backgroundColor: meta?.bg ?? "#1b2029" }}
                  >
                    <Icon className="h-3 w-3" style={{ color: meta?.color ?? "#8891a0" }} />
                    <span className="text-[10px] uppercase tracking-wider" style={{ color: meta?.color ?? "#8891a0" }}>
                      {h ? meta?.label : "Idle"}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-4 mt-2 text-[10px] text-[#4a525c] tabular">
                  {h ? (
                    <>
                      <span>latency <span style={{ color: "#8891a0" }}>{h.latencyMs}ms</span></span>
                      <span>last check <span style={{ color: "#8891a0" }}>{fmtTimeAgo(h.checkedAt)}</span></span>
                    </>
                  ) : (
                    <span>Awaiting first request…</span>
                  )}
                </div>
                {s.endpoints.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {s.endpoints.map((e) => (
                      <span key={e} className="text-[9px] uppercase tracking-wider text-[#4a525c] bg-[#0b0e13] border border-[#262b33] rounded px-1.5 py-0.5">
                        {e}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <div className="mt-1 p-2 rounded bg-[#0b0e13] border border-[#262b33] text-[10px] text-[#8891a0]">
            <strong className="text-[#e7e9ec]">Data Integrity Policy (PRD §6):</strong> When a source
            is down or rate-limited, affected panels surface “Source unavailable” — never fabricated
            values. Every panel shows a provenance bar (source + sync time).
          </div>
        </Panel>

        {/* Telegram notifications config (PRD FR-2.3) */}
        <TelegramNotificationsPanel />

        {/* 2FA / TOTP setup (PRD §16.3) */}
        <SecurityPanel />

        {/* Notification preferences */}
        <NotificationPreferencesPanel />
      </div>

      {/* Recent request log */}
      <div className="flex flex-col gap-3 min-h-0">
        <Panel
          title="Request Log"
          subtitle={`${recent.length} most recent external calls`}
          bodyClassName="p-0 overflow-y-auto max-h-[calc(100vh-200px)]"
        >
          {health.isLoading ? (
            <LoadingState rows={8} />
          ) : recent.length === 0 ? (
            <EmptyState
              title="No requests logged yet"
              hint="Health entries are written as the app fetches market data. Browse the dashboard to populate."
              icon={<Database className="h-6 w-6" />}
            />
          ) : (
            <table className="w-full text-[10px]">
              <thead className="sticky top-0 bg-[#11151c]">
                <tr className="text-left text-[9px] uppercase tracking-wider text-[#8891a0] border-b border-[#262b33]">
                  <th className="px-2 py-1.5 font-medium">Time</th>
                  <th className="px-2 py-1.5 font-medium">Source</th>
                  <th className="px-2 py-1.5 font-medium">Endpoint</th>
                  <th className="px-2 py-1.5 font-medium">Status</th>
                  <th className="px-2 py-1.5 font-medium text-right">Latency</th>
                  <th className="px-2 py-1.5 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((r) => {
                  const meta = STATUS_META[r.status];
                  return (
                    <tr key={r.source + r.checkedAt + r.endpoint} className="border-b border-[#11151c]">
                      <td className="px-2 py-1.5 tabular text-[#4a525c]">{fmtTimeAgo(r.checkedAt)}</td>
                      <td className="px-2 py-1.5 text-[#8891a0]">{SOURCE_LABELS[r.source] ?? r.source}</td>
                      <td className="px-2 py-1.5 text-[#e7e9ec] tabular">{r.endpoint}</td>
                      <td className="px-2 py-1.5">
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider"
                          style={{ backgroundColor: meta?.bg ?? "#1b2029", color: meta?.color ?? "#8891a0" }}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-right tabular text-[#8891a0]">
                        {r.latencyMs != null ? r.latencyMs + "ms" : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-[#c7484b] truncate max-w-[180px]" title={r.errorMessage ?? ""}>
                        {r.errorMessage ?? ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Panel>
      </div>
    </div>
  );
}

// ─── 2FA / TOTP Security Panel (PRD §16.3) ───────────────────────────────
function SecurityPanel() {
  const [token, setToken] = useState("");
  const [verified, setVerified] = useState(false);

  const setup = useQuery<{ enabled: boolean; secret?: string; otpauthUrl?: string; qrDataUrl?: string }>({
    queryKey: ["totp-setup"],
    queryFn: async () => {
      const res = await fetch("/api/auth/totp-setup");
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "Failed");
      return j.data;
    },
    staleTime: 0,
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/auth/totp-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, secret: setup.data?.secret }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "Failed");
      return j.data as { verified: boolean };
    },
    onSuccess: (r) => {
      if (r.verified) {
        setVerified(true);
        toast.success("TOTP verified! Now add the secret to .env (see instructions below).");
      } else {
        toast.error("Invalid code. Check your authenticator app time sync.");
      }
    },
    onError: (e) => toast.error("Verify failed: " + String(e)),
  });

  const d = setup.data;
  const totpEnabledInEnv = process.env.NEXT_PUBLIC_TOTP_ENABLED === "1";

  return (
    <Panel
      title="Two-Factor Authentication (2FA)"
      subtitle="TOTP · PRD §16.3"
      loading={setup.isLoading}
      actions={<ShieldCheck className={cn("h-3.5 w-3.5", d?.enabled || totpEnabledInEnv ? "text-[#2e9e6d]" : "text-[#8891a0]")} />}
    >
      {setup.isLoading ? (
        <LoadingState rows={3} />
      ) : d?.enabled ? (
        <div className="flex items-center gap-2 py-2">
          <CheckCircle2 className="h-4 w-4 text-[#2e9e6d]" />
          <span className="text-[11px] text-[#e7e9ec]">2FA is <strong className="text-[#2e9e6d]">enabled</strong>. Login requires your authenticator code.</span>
        </div>
      ) : d && !d.enabled ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 p-2 border border-[#d4a02a]/40 bg-[#d4a02a]/8 rounded text-[10px] text-[#e7e9ec]">
            <AlertTriangle className="h-3.5 w-3.5 text-[#d4a02a] shrink-0" />
            2FA is <strong className="text-[#d4a02a]">not enabled</strong>. Follow the steps below to require a TOTP code on every login.
          </div>

          {/* QR code */}
          {d.qrDataUrl && (
            <div className="flex flex-col items-center gap-2 py-2">
              <img src={d.qrDataUrl} alt="TOTP QR code" className="rounded border border-[#262b33]" width={200} height={200} />
              <p className="text-[9px] text-[#4a525c]">Scan with Google Authenticator, Authy, or 1Password</p>
            </div>
          )}

          {/* Secret (manual entry) */}
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Secret (manual entry if QR doesn't work)</Label>
            <div className="flex items-center gap-1 mt-1">
              <Input
                readOnly
                value={d.secret ?? ""}
                className="bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8 font-mono"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-8 px-2 border-[#262b33]"
                onClick={() => { navigator.clipboard.writeText(d.secret ?? ""); toast.success("Secret copied"); }}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Verify */}
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-[#8891a0]">Enter the 6-digit code from your app to verify</Label>
            <div className="flex items-center gap-1 mt-1">
              <Input
                value={token}
                onChange={(e) => setToken(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="000000"
                className="bg-[#0b0e13] border-[#262b33] text-[11px] tabular h-8 font-mono tracking-widest"
              />
              <Button
                size="sm"
                className="h-8 text-[10px] uppercase bg-[#3b5fe0] hover:bg-[#2f4ec2]"
                disabled={token.length !== 6 || verifyMutation.isPending}
                onClick={() => verifyMutation.mutate()}
              >
                {verifyMutation.isPending ? "…" : "Verify"}
              </Button>
            </div>
          </div>

          {/* Instructions after verify */}
          {verified && (
            <div className="p-2 border border-[#2e9e6d]/40 bg-[#2e9e6d]/8 rounded text-[10px] text-[#e7e9ec]">
              <p className="font-medium text-[#2e9e6d] mb-1">✓ Verified! Final step — add to .env & restart:</p>
              <pre className="text-[9px] tabular bg-[#0b0e13] p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">{`MERIDIAN_TOTP_SECRET=${d.secret}
NEXT_PUBLIC_TOTP_ENABLED=1`}</pre>
              <p className="mt-1 text-[#8891a0]">Then restart the app. Login will require the TOTP code.</p>
            </div>
          )}
        </div>
      ) : (
        <EmptyState title="Cannot load 2FA status" hint="Ensure you're logged in." icon={<KeyRound className="h-5 w-5" />} />
      )}
    </Panel>
  );
}

// ─── Notification Preferences (Telegram INFO opt-in) ─────────────────────
function NotificationPreferencesPanel() {
  const qc = useQueryClient();
  const settings = useQuery<Record<string, string>>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/v1/settings");
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "Failed");
      return j.data;
    },
    staleTime: 10_000,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string }) => {
      const res = await fetch("/api/v1/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error ?? "Failed");
      return j.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const notifyInfo = settings.data?.telegram_notify_info === "true";

  return (
    <Panel
      title="Notification Preferences"
      subtitle="Telegram signal filtering"
      loading={settings.isLoading}
    >
      <div className="flex items-center justify-between py-1">
        <div className="min-w-0 pr-3">
          <div className="flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-[#8891a0]" />
            <span className="text-[11px] font-medium text-[#e7e9ec]">Notify INFO signals</span>
          </div>
          <p className="text-[9px] text-[#4a525c] mt-0.5">
            When ON, BREAKOUT signals (INFO level) are also sent to Telegram. Default: OFF (only WARN/CRITICAL).
          </p>
        </div>
        <Switch
          checked={notifyInfo}
          disabled={updateMutation.isPending}
          onCheckedChange={(checked) => {
            updateMutation.mutate(
              { key: "telegram_notify_info", value: checked ? "true" : "false" },
              {
                onSuccess: () => toast.success(checked ? "INFO signals enabled" : "INFO signals disabled (WARN/CRITICAL only)"),
                onError: (e) => toast.error("Failed: " + String(e)),
              }
            );
          }}
        />
      </div>
    </Panel>
  );
}
