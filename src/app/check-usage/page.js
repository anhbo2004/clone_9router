"use client";

import { useEffect, useMemo, useState } from "react";

function fmtNumber(value) {
  if (value === null || value === undefined) return "Unlimited";
  return Number(value || 0).toLocaleString("vi-VN");
}

function fmtCompact(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return fmtNumber(n);
}

function fmtDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-GB", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function pct(used, limit) {
  const max = Number(limit || 0);
  if (max <= 0) return 0;
  return Math.min(100, Math.round((Number(used || 0) / max) * 100));
}

function maskKey(value) {
  const key = String(value || "");
  if (key.length <= 12) return key || "sk-...";
  return `${key.slice(0, 5)}...${key.slice(-4)}`;
}

function splitMs(ms) {
  const seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    mins: Math.floor((seconds % 3600) / 60),
    secs: seconds % 60,
  };
}

function Icon({ children, className = "h-4 w-4" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {children}
    </svg>
  );
}

function LogoMark() {
  return (
    <div className="grid h-8 w-8 place-items-center rounded-lg bg-orange-600 text-white shadow-[0_0_24px_rgba(249,115,22,0.28)]">
      <Icon className="h-5 w-5">
        <circle cx="12" cy="12" r="2" />
        <path d="M12 4v4M12 16v4M4 12h4M16 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M17.7 6.3l-2.8 2.8M9.1 14.9l-2.8 2.8" />
      </Icon>
    </div>
  );
}

function StatCell({ icon, label, value, sub }) {
  return (
    <div className="min-h-[130px] border-t border-neutral-800/90 p-5 md:border-l md:first:border-l-0">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-neutral-500">
        <span className="text-neutral-500">{icon}</span>
        {label}
      </div>
      <div className="mt-5 text-center text-2xl font-bold tracking-wide text-neutral-100">{value}</div>
      {sub ? <div className="mt-1 text-center text-xs text-neutral-500">{sub}</div> : null}
    </div>
  );
}

function TrendChart({ data }) {
  const points = data?.length ? data : [];
  const width = 680;
  const height = 170;
  const pad = { left: 54, right: 22, top: 14, bottom: 28 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const max = Math.max(1, ...points.map((item) => Number(item.totalTokens || 0)));
  const coords = points.map((item, index) => {
    const x = pad.left + (points.length <= 1 ? 0 : (index / (points.length - 1)) * chartW);
    const y = pad.top + chartH - (Number(item.totalTokens || 0) / max) * chartH;
    return { ...item, x, y };
  });
  const linePath = coords.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
  const areaPath = coords.length ? `${linePath} L${coords[coords.length - 1].x},${pad.top + chartH} L${coords[0].x},${pad.top + chartH} Z` : "";
  const yTicks = [1, 0.75, 0.5, 0.25, 0];

  return (
    <div className="px-6 py-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-neutral-300">
        <Icon className="h-5 w-5 text-orange-500">
          <path d="M3 17l6-6 4 4 8-8" />
          <path d="M14 7h7v7" />
        </Icon>
        7-Day Token Trend
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-[190px] w-full overflow-visible">
        <defs>
          <linearGradient id="token-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#f97316" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#f97316" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {yTicks.map((tick) => {
          const y = pad.top + chartH * (1 - tick);
          return (
            <g key={tick}>
              <text x="0" y={y + 4} className="fill-neutral-500 text-[11px]">{fmtCompact(max * tick)}</text>
              <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="#262626" strokeDasharray="4 4" />
            </g>
          );
        })}
        {coords.map((point) => (
          <g key={point.date}>
            <line x1={point.x} x2={point.x} y1={pad.top} y2={pad.top + chartH} stroke="#202020" strokeDasharray="4 4" />
            <text x={point.x} y={height - 5} textAnchor="middle" className="fill-neutral-500 text-[11px]">{point.label}</text>
          </g>
        ))}
        <path d={`M${pad.left},${pad.top + chartH} L${width - pad.right},${pad.top + chartH}`} stroke="#2563eb" strokeWidth="2" />
        {areaPath ? <path d={areaPath} fill="url(#token-area)" /> : null}
        {linePath ? <path d={linePath} fill="none" stroke="#f97316" strokeWidth="3" /> : null}
        {coords.map((point) => (
          <circle key={`${point.date}-dot`} cx={point.x} cy={point.y} r="3" fill="#f97316" stroke="#15110e" strokeWidth="2" />
        ))}
      </svg>
    </div>
  );
}

function CountdownBlock({ resetMs }) {
  const time = splitMs(resetMs);
  const cells = [
    { label: "HOURS", value: time.hours },
    { label: "MINS", value: time.mins },
    { label: "SECS", value: time.secs, accent: true },
  ];

  return (
    <div className="border-t border-neutral-800/90 px-6 py-5">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-neutral-300">
        <Icon className="h-5 w-5 text-orange-500">
          <circle cx="12" cy="13" r="8" />
          <path d="M12 9v4l3 2M9 2h6" />
        </Icon>
        Daily Reset In
      </div>
      <div className="flex items-end justify-center gap-4">
        {cells.map((cell, index) => (
          <div key={cell.label} className="flex items-center gap-4">
            {index > 0 ? <span className="pb-8 text-2xl text-neutral-600">:</span> : null}
            <div className="text-center">
              <div className={`grid h-16 w-16 place-items-center rounded-lg border border-neutral-700 bg-neutral-800/60 text-xl font-bold ${cell.accent ? "text-orange-500" : "text-neutral-100"}`}>
                {String(cell.value).padStart(2, "0")}
              </div>
              <div className="mt-2 text-[10px] uppercase tracking-wide text-neutral-500">{cell.label}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-[11px] text-neutral-500">Usage limits reset daily at 00:00 Vietnam time (UTC+7)</p>
    </div>
  );
}

export default function CheckUsagePage() {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const status = result?.status;
  const key = result?.key;
  const usage = result?.usage;
  const quota = key?.quota || {};
  const dailyTrend = result?.dailyTrend || [];
  const resetMs = status?.resetAt ? Math.max(0, new Date(status.resetAt).getTime() - now) : status?.resetInMs || 0;
  const totalPercent = pct(usage?.totalTokens, quota.maxTotalTokens);
  const statusLabel = status?.active ? (status.exceeded ? "Limit reached" : "Active") : "Locked";

  const statusTone = useMemo(() => {
    if (!status) return "bg-neutral-800 text-neutral-300";
    if (!status.active) return "bg-red-500/15 text-red-300";
    if (status.exceeded) return "bg-amber-500/15 text-amber-300";
    return "bg-emerald-500/15 text-emerald-300";
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
    <main className="min-h-screen bg-[#080706] text-neutral-100">
      <header className="border-b border-neutral-900 bg-[#090807]/95">
        <div className="mx-auto flex h-[74px] max-w-6xl items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <LogoMark />
            <span className="text-xl font-bold tracking-tight">KRouter</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm font-semibold text-neutral-500 md:flex">
            <a className="hover:text-neutral-200" href="/landing">Overview</a>
            <a className="hover:text-neutral-200" href="/landing#how-it-works">How it Works</a>
            <a className="hover:text-neutral-200" href="/dashboard/cli-tools">CLI Tools</a>
            <a className="text-neutral-200" href="/check-usage">Check Usage</a>
            <a className="hover:text-neutral-200" href="/dashboard">Notice</a>
            <a className="hover:text-neutral-200" href="/dashboard">Docs</a>
          </nav>
          <button className="flex h-9 items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-300">
            <Icon className="h-4 w-4">
              <path d="M5 8h10M9 4v4M4 14l4-4 4 4M14 20l5-12 5 12M16 16h6" />
            </Icon>
            VI
          </button>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[760px] px-5 py-7">
        <form onSubmit={checkUsage} className="flex flex-col gap-3 sm:flex-row">
          <label className="relative min-h-12 flex-1">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500">
              <Icon className="h-5 w-5">
                <circle cx="8" cy="12" r="3" />
                <path d="M11 12h10M16 12v3M19 12v3" />
              </Icon>
            </span>
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              placeholder="Enter API key"
              className="h-12 w-full rounded-xl border border-neutral-700 bg-[#1a1715] pl-12 pr-4 text-sm text-neutral-100 outline-none transition focus:border-orange-500"
            />
          </label>
          <button
            type="submit"
            disabled={!apiKey.trim() || loading}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-orange-600 px-8 text-sm font-bold text-white shadow-[0_12px_32px_rgba(249,115,22,0.25)] hover:bg-orange-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Icon className="h-5 w-5">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </Icon>
            {loading ? "Checking..." : "Check"}
          </button>
        </form>

        {error ? <div className="mt-5 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div> : null}

        {result?.found ? (
          <section className="mt-7 overflow-hidden rounded-2xl border border-neutral-800 bg-[#151311] shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
            <div className="flex items-center justify-between px-6 py-7">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-orange-500/10 text-orange-500">
                  <Icon className="h-5 w-5">
                    <circle cx="8" cy="12" r="3" />
                    <path d="M11 12h10M16 12v3M19 12v3" />
                  </Icon>
                </div>
                <div>
                  <h1 className="text-lg font-bold">{key.name || "API Key"}</h1>
                  <div className="mt-1 font-mono text-xs text-neutral-500">{maskKey(apiKey)}</div>
                </div>
              </div>
              <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-bold ${statusTone}`}>
                <span className="h-2 w-2 rounded-full bg-current" />
                {statusLabel}
              </div>
            </div>

            {key.disabledMessage ? <div className="mx-6 mb-5 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{key.disabledMessage}</div> : null}

            <div className="grid md:grid-cols-4">
              <StatCell
                icon={
                  <Icon className="h-4 w-4">
                    <path d="M7 3v14M7 17l-4-4M7 17l4-4M17 21V7M17 7l-4 4M17 7l4 4" />
                  </Icon>
                }
                label="Requests"
                value={fmtNumber(usage.requests)}
              />
              <StatCell
                icon={
                  <Icon className="h-4 w-4">
                    <path d="M21 16V8l-9-5-9 5v8l9 5 9-5Z" />
                    <path d="M3.3 7.5 12 12l8.7-4.5M12 22V12" />
                  </Icon>
                }
                label="Input Tokens"
                value={fmtNumber(usage.inputTokens)}
                sub={`/ ${fmtNumber(quota.maxInputTokens && quota.maxInputTokens > 0 ? quota.maxInputTokens : null)}`}
              />
              <StatCell
                icon={
                  <Icon className="h-4 w-4">
                    <path d="M12 3a9 9 0 1 0 9 9" />
                    <path d="M12 7v5l3 3" />
                  </Icon>
                }
                label="Output Tokens"
                value={fmtNumber(usage.outputTokens)}
                sub={`/ ${fmtNumber(quota.maxOutputTokens && quota.maxOutputTokens > 0 ? quota.maxOutputTokens : null)}`}
              />
              <StatCell
                icon={
                  <Icon className="h-4 w-4">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </Icon>
                }
                label="Total Used"
                value={fmtNumber(usage.totalTokens)}
                sub={`${totalPercent}% of ${fmtNumber(quota.maxTotalTokens && quota.maxTotalTokens > 0 ? quota.maxTotalTokens : null)}`}
              />
            </div>

            <TrendChart data={dailyTrend} />
            <CountdownBlock resetMs={resetMs} />

            <div className="grid gap-3 border-t border-neutral-800/90 px-6 py-4 text-xs text-neutral-500 sm:grid-cols-3">
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5">
                  <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z" />
                </Icon>
                Created: <span className="font-semibold text-neutral-300">{fmtDate(key.createdAt)}</span>
              </div>
              <div className="flex items-center justify-center gap-2">
                Window: <span className="font-semibold text-neutral-300">{status.window}</span>
              </div>
              <div className="flex items-center gap-2 sm:justify-end">
                <Icon className="h-5 w-5">
                  <path d="M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14H3V6a2 2 0 0 1 2-2Z" />
                  <path d="m9 14 6 4M15 14l-6 4" />
                </Icon>
                Resets: <span className="font-semibold text-neutral-300">{fmtDate(status.resetAt)}</span>
              </div>
            </div>
          </section>
        ) : (
          <section className="mt-7 rounded-2xl border border-neutral-900 bg-[#11100f] p-10 text-center text-sm text-neutral-500">
            Enter an API key to view requests, input tokens, output tokens, total usage, trend, and reset time.
          </section>
        )}
      </div>
    </main>
  );
}
