"use client";

import { useMemo, useState } from "react";

function fmtNumber(value) {
  if (value === null || value === undefined) return "Unlimited";
  return Number(value || 0).toLocaleString();
}

function fmtDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function pct(used, limit) {
  const max = Number(limit || 0);
  if (max <= 0) return 0;
  return Math.min(100, Math.round((Number(used || 0) / max) * 100));
}

function ProgressRow({ label, used, limit, remaining }) {
  const percent = pct(used, limit);
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-neutral-200">{label}</div>
        <div className="text-xs text-neutral-400">{percent}%</div>
      </div>
      <div className="h-2 overflow-hidden rounded bg-neutral-800">
        <div
          className={percent >= 100 ? "h-full bg-red-500" : percent >= 85 ? "h-full bg-amber-500" : "h-full bg-emerald-500"}
          style={{ width: `${percent}%` }}
        />
      </div>
      <div className="mt-3 grid gap-2 text-xs text-neutral-400 sm:grid-cols-3">
        <div>Used: <span className="text-neutral-100">{fmtNumber(used)}</span></div>
        <div>Limit: <span className="text-neutral-100">{fmtNumber(limit && limit > 0 ? limit : null)}</span></div>
        <div>Remaining: <span className="text-neutral-100">{fmtNumber(remaining)}</span></div>
      </div>
    </div>
  );
}

export default function CheckUsagePage() {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const status = result?.status;
  const key = result?.key;
  const usage = result?.usage;
  const quota = key?.quota;

  const statusTone = useMemo(() => {
    if (!status) return "border-neutral-800 bg-neutral-900 text-neutral-200";
    if (!status.active) return "border-red-500/40 bg-red-500/10 text-red-200";
    if (status.exceeded) return "border-amber-500/40 bg-amber-500/10 text-amber-100";
    return "border-emerald-500/40 bg-emerald-500/10 text-emerald-100";
  }, [status]);

  async function checkUsage(event) {
    event?.preventDefault();
    const trimmed = apiKey.trim();
    if (!trimmed) return;

    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/public/key-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: trimmed }),
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Unable to check this API key.");
        return;
      }
      setResult(data);
    } catch (err) {
      setError(err?.message || "Unable to check this API key.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-100">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold md:text-3xl">Check API Key Usage</h1>
          <p className="text-sm text-neutral-400">Public usage status for 9Router API keys.</p>
        </header>

        <form onSubmit={checkUsage} className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <label className="mb-2 block text-sm font-medium text-neutral-300" htmlFor="api-key">
            API Key
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="api-key"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="sk-..."
              className="min-h-11 flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 text-sm text-neutral-100 outline-none focus:border-orange-500"
            />
            <button
              type="submit"
              disabled={!apiKey.trim() || loading}
              className="min-h-11 rounded-md bg-orange-600 px-5 text-sm font-semibold text-white hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Checking..." : "Check usage"}
            </button>
          </div>
          {error ? <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</div> : null}
        </form>

        {result?.found ? (
          <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <div className="flex flex-col gap-4">
              <div className={`rounded-lg border p-4 ${statusTone}`}>
                <div className="text-sm text-neutral-300">Key status</div>
                <div className="mt-1 text-xl font-semibold">
                  {status.active ? (status.exceeded ? "Limit reached" : "Active") : "Locked"}
                </div>
                {key.disabledMessage ? <p className="mt-2 text-sm">{key.disabledMessage}</p> : null}
              </div>

              <ProgressRow
                label="Total tokens"
                used={usage.totalTokens}
                limit={quota.maxTotalTokens}
                remaining={status.remainingTotalTokens}
              />
              <ProgressRow
                label="Input tokens"
                used={usage.inputTokens}
                limit={quota.maxInputTokens}
                remaining={status.remainingInputTokens}
              />
              <ProgressRow
                label="Output tokens"
                used={usage.outputTokens}
                limit={quota.maxOutputTokens}
                remaining={status.remainingOutputTokens}
              />
            </div>

            <aside className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <h2 className="text-base font-semibold">{key.name || "API Key"}</h2>
              <div className="mt-4 grid gap-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-neutral-400">Requests</span>
                  <span>{fmtNumber(usage.requests)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-neutral-400">Window</span>
                  <span>{status.window}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-neutral-400">Timezone</span>
                  <span>{status.timezone}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-neutral-400">Window start</span>
                  <span className="text-right">{fmtDate(status.windowStart)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-neutral-400">Next reset</span>
                  <span className="text-right">{fmtDate(status.resetAt)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-neutral-400">Reset in</span>
                  <span>{status.resetIn}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-neutral-400">Allowed models</span>
                  <span className="max-w-44 text-right">{key.allowedModels?.length ? key.allowedModels.join(", ") : "All"}</span>
                </div>
              </div>
            </aside>
          </section>
        ) : null}
      </div>
    </main>
  );
}
