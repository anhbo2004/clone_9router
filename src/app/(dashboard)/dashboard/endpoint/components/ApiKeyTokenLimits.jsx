"use client";

import { useEffect, useMemo, useRef, useState } from "react";

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

function fmtLimit(n) {
  return Number(n || 0) > 0 ? fmt(n) : "Unlimited";
}

function remaining(used, limit) {
  return Number(limit || 0) > 0 ? Math.max(0, Number(limit || 0) - Number(used || 0)) : null;
}

function percent(used, limit) {
  return Number(limit || 0) > 0 ? Math.min(100, Math.round((Number(used || 0) / Number(limit || 0)) * 100)) : 0;
}

function formatDateTimeLocal(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function addDaysLocal(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setSeconds(0, 0);
  return formatDateTimeLocal(date.toISOString());
}

function formatExpiry(value) {
  if (!value) return "No expiry";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "No expiry";
  const label = date.toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" });
  return date.getTime() <= Date.now() ? `Expired: ${label}` : `Expires: ${label}`;
}

function statusTone({ key, expired, quotaLocked }) {
  if (expired) return "border-red-500/40 bg-red-500/10 text-red-300";
  if (quotaLocked) return "border-amber-500/40 bg-amber-500/10 text-amber-300";
  if (key.enabled) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
  return "border-neutral-600 bg-neutral-800 text-neutral-300";
}

function rowTone({ expired, quotaLocked, over }) {
  if (expired) return "border-l-red-500 hover:bg-red-500/[0.04]";
  if (quotaLocked || over) return "border-l-amber-500 hover:bg-amber-500/[0.04]";
  return "border-l-orange-500/50 hover:bg-orange-500/[0.035]";
}

const AUTO_REFRESH_MS = 60_000;

export default function ApiKeyTokenLimits() {
  const [keys, setKeys] = useState([]);
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState("");
  const [testingId, setTestingId] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [rowEdits, setRowEdits] = useState({});
  const [dirtyRows, setDirtyRows] = useState({});
  const [savingId, setSavingId] = useState("");
  const [lastUpdatedAt, setLastUpdatedAt] = useState("");
  const [liveConnected, setLiveConnected] = useState(false);
  const refreshTimerRef = useRef(null);
  const loadingRef = useRef(false);
  const [form, setForm] = useState({
    name: "",
    window: "daily",
    maxTotalTokens: 1000000,
    allowedModels: "",
    expiresAt: "",
  });

  async function load() {
    if (loadingRef.current) return;
    loadingRef.current = true;
    try {
      const res = await fetch("/api/dashboard/token-limits/api-keys", {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const data = await res.json();
      const nextKeys = data.keys || [];
      setKeys(nextKeys);
      setLastUpdatedAt(data.updatedAt || new Date().toISOString());
      setRowEdits((prev) =>
        Object.fromEntries(
          nextKeys.map((key) => {
            const current = {
              limit: Number(key.quota?.maxTotalTokens || 0),
              expiresAt: formatDateTimeLocal(key.expiresAt),
            };
            return [key.id, dirtyRows[key.id] ? prev[key.id] || current : current];
          })
        )
      );
    } finally {
      loadingRef.current = false;
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      load();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(t);
  }, [dirtyRows]);

  useEffect(() => {
    const events = new EventSource("/api/usage/stream");
    events.onopen = () => setLiveConnected(true);
    events.onerror = () => setLiveConnected(false);
    events.onmessage = () => {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        load();
      }, 250);
    };

    return () => {
      clearTimeout(refreshTimerRef.current);
      events.close();
      setLiveConnected(false);
    };
  }, [dirtyRows]);

  async function createKey() {
    setLoading(true);
    try {
      const res = await fetch("/api/dashboard/token-limits/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name || "API Key",
          allowedModels: form.allowedModels
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          quota: {
            enabled: true,
            window: form.window,
            maxTotalTokens: Number(form.maxTotalTokens || 0),
            maxInputTokens: 0,
            maxOutputTokens: 0,
            action: "reject",
          },
          expiresAt: form.expiresAt || null,
        }),
      });
      const data = await res.json();
      setSecret(data.secret || data.key?.secret || "");
      setForm((prev) => ({ ...prev, name: "", expiresAt: "" }));
      await load();
    } finally {
      setLoading(false);
    }
  }

  async function patchKey(id, patch) {
    await fetch(`/api/dashboard/token-limits/api-keys/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    await load();
  }

  function getRowEdit(key) {
    return rowEdits[key.id] || {
      limit: Number(key.quota?.maxTotalTokens || 0),
      expiresAt: formatDateTimeLocal(key.expiresAt),
    };
  }

  function onChangeRow(id, field, value) {
    setDirtyRows((prev) => ({ ...prev, [id]: true }));
    setRowEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
  }

  async function saveRow(key) {
    const edit = getRowEdit(key);
    setSavingId(key.id);
    try {
      await patchKey(key.id, {
        quota: {
          ...key.quota,
          maxTotalTokens: Number(edit.limit || 0),
          maxInputTokens: 0,
          maxOutputTokens: 0,
        },
        expiresAt: edit.expiresAt || null,
      });
      setDirtyRows((prev) => {
        const next = { ...prev };
        delete next[key.id];
        return next;
      });
    } finally {
      setSavingId("");
    }
  }

  async function deleteKey(id) {
    if (!confirm("Delete this API key?")) return;
    await fetch(`/api/dashboard/token-limits/api-keys/${id}`, { method: "DELETE" });
    await load();
  }

  async function copyKey(id, keyValue) {
    try {
      await navigator.clipboard.writeText(keyValue || "");
      setCopiedId(id);
      setTimeout(() => setCopiedId(""), 1200);
    } catch {
      // ignore clipboard errors
    }
  }

  async function quickTest(key) {
    setTestingId(key.id);
    setTestMessage("");
    try {
      const model = key.allowedModels?.[0] || "if/qwen3-coder-plus";
      const res = await fetch("/api/dashboard/token-limits/quick-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyId: key.id,
          model,
          prompt: `quick test ${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTestMessage(`Test OK: +${fmt(data.estimatedTotalTokens || data.estimatedInputTokens || 0)} tokens`);
      } else {
        setTestMessage(`Test fail (${res.status}): ${data.error || "Unknown error"}`);
      }
      await load();
    } finally {
      setTestingId("");
    }
  }

  const totalUsed = useMemo(() => keys.reduce((s, k) => s + Number(k.usage?.totalTokens || 0), 0), [keys]);
  const activeCount = useMemo(() => keys.filter((key) => key.enabled && !key.expired).length, [keys]);
  const lockedCount = useMemo(
    () => keys.filter((key) => key.disabledReason === "token_quota_exceeded" || key.disabledReason === "api_key_expired").length,
    [keys]
  );
  const lastUpdatedLabel = lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : "";
  const inputClass =
    "rounded-xl border border-neutral-800 bg-neutral-950/80 px-3 py-2.5 text-sm text-neutral-100 outline-none transition placeholder:text-neutral-600 focus:border-orange-400 focus:ring-2 focus:ring-orange-500/20";
  const actionButtonClass =
    "rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-xs font-semibold text-neutral-200 transition hover:border-orange-500/60 hover:bg-orange-500/10 disabled:opacity-60";

  return (
    <section className="relative mt-6 overflow-hidden rounded-2xl border border-orange-500/20 bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.14),transparent_34%),linear-gradient(180deg,rgba(23,23,23,0.96),rgba(10,10,10,0.98))] p-5 text-neutral-100 shadow-[0_24px_80px_rgba(0,0,0,0.36)]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-orange-500/0 via-orange-400/80 to-cyan-400/0" />

      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-200">
            <span className={`h-2 w-2 rounded-full ${liveConnected ? "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.8)]" : "bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.7)]"}`} />
            {liveConnected ? "Live connected" : "Live reconnecting"}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-white">API Key Token Limits</h2>
          <p className="max-w-2xl text-sm text-neutral-400">Manage token limits, expiration time, and lock state for every API key.</p>
          <p className="text-xs text-neutral-500">Auto refresh: 1m{lastUpdatedLabel ? ` | Last update: ${lastUpdatedLabel}` : ""}</p>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:min-w-[430px]">
          <div className="rounded-xl border border-orange-500/20 bg-neutral-950/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Total Used</div>
            <div className="mt-2 text-lg font-bold text-orange-200">{fmt(totalUsed)}</div>
          </div>
          <div className="rounded-xl border border-emerald-500/20 bg-neutral-950/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Active</div>
            <div className="mt-2 text-lg font-bold text-emerald-300">{fmt(activeCount)}</div>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-neutral-950/70 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Locked</div>
            <div className="mt-2 text-lg font-bold text-red-300">{fmt(lockedCount)}</div>
          </div>
        </div>
      </div>

      {secret ? (
        <div className="mb-5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 shadow-[0_0_0_1px_rgba(245,158,11,0.08)]">
          <div className="font-medium text-amber-200">New API key - shown once</div>
          <code className="mt-2 block break-all rounded-lg border border-amber-500/20 bg-black/40 p-3 text-sm text-amber-100">{secret}</code>
        </div>
      ) : null}

      <div className="mb-6 rounded-2xl border border-neutral-800 bg-neutral-950/55 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-neutral-200">Create API key</div>
            <div className="text-xs text-neutral-500">Set model access, token ceiling, reset window, and expiration from the start.</div>
          </div>
          <button onClick={load} className="rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm font-semibold text-neutral-200 transition hover:border-cyan-500/50 hover:bg-cyan-500/10">
            Refresh
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-7">
          <input className={`${inputClass} md:col-span-2`} placeholder="Key name, e.g. Team A" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className={inputClass} type="number" placeholder="Total tokens" value={form.maxTotalTokens} onChange={(e) => setForm({ ...form, maxTotalTokens: e.target.value })} />
          <select className={inputClass} value={form.window} onChange={(e) => setForm({ ...form, window: e.target.value })}>
            <option value="rolling_5h">Rolling 5h</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <input className={inputClass} placeholder="Allowed models, comma separated" value={form.allowedModels} onChange={(e) => setForm({ ...form, allowedModels: e.target.value })} />
          <input
            className={inputClass}
            type="datetime-local"
            title="API key expiration time"
            value={form.expiresAt}
            onChange={(e) => setForm({ ...form, expiresAt: e.target.value })}
          />
          <button disabled={loading} onClick={createKey} className="rounded-xl border border-orange-400/40 bg-orange-600 px-4 py-2.5 text-sm font-bold text-white shadow-[0_14px_36px_rgba(249,115,22,0.24)] transition hover:bg-orange-500 disabled:opacity-60">
            {loading ? "Creating..." : "Create key"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl bg-gradient-to-r from-orange-500/35 via-cyan-500/20 to-emerald-500/25 p-px shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
        <div className="overflow-x-auto rounded-2xl border border-neutral-900 bg-neutral-950/95">
          <table className="w-full min-w-[1160px] text-sm">
            <thead className="bg-neutral-900/95 text-[11px] uppercase tracking-wide text-neutral-400">
              <tr>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Key</th>
                <th className="p-3 text-left">Window</th>
                <th className="p-3 text-left">Used / Limit</th>
                <th className="p-3 text-left">Expiration</th>
                <th className="p-3 text-left">Allowed Models</th>
                <th className="p-3 text-left">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => {
                const used = Number(key.usage?.totalTokens || 0);
                const requests = Number(key.usage?.requests || 0);
                const limit = Number(key.quota?.maxTotalTokens || 0);
                const remainingTotal = remaining(used, limit);
                const edit = getRowEdit(key);
                const pct = percent(used, limit);
                const over = limit > 0 && used >= limit;
                const quotaLocked = key.disabledReason === "token_quota_exceeded";
                const expired = key.expired || key.disabledReason === "api_key_expired";
                const progressColor = expired || over ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-orange-500";
                const statusLabel = expired ? "Expired" : key.enabled ? "Enabled" : quotaLocked ? "Limit locked" : "Disabled";

                return (
                  <tr key={key.id} className={`border-l-2 border-t border-neutral-800 transition ${rowTone({ expired, quotaLocked, over })}`}>
                    <td className="p-3">
                      <div className="font-semibold text-neutral-100">{key.name}</div>
                      <div className="mt-1 text-xs text-neutral-500">Created {key.createdAt ? new Date(key.createdAt).toLocaleDateString() : "-"}</div>
                    </td>
                    <td className="p-3 font-mono text-neutral-300">
                      <div className="flex items-center gap-2">
                        <span className="max-w-[260px] truncate rounded-lg border border-neutral-800 bg-black/25 px-2 py-1">{key.key}</span>
                        <button className={actionButtonClass} onClick={() => copyKey(key.id, key.key)}>
                          {copiedId === key.id ? "Copied" : "Copy"}
                        </button>
                      </div>
                    </td>
                    <td className="p-3">
                      <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-2.5 py-1 text-xs font-semibold text-cyan-200">{key.quota?.window}</span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-neutral-200">{fmt(used)} / {fmtLimit(limit)}</span>
                        <span className="text-xs text-neutral-500">Remaining: {remainingTotal === null ? "Unlimited" : fmt(remainingTotal)}</span>
                      </div>
                      <div className="mt-2 h-2.5 overflow-hidden rounded-full border border-neutral-800 bg-neutral-900">
                        <div className={`h-full rounded-full ${progressColor} shadow-[0_0_16px_rgba(249,115,22,0.35)] transition-all`} style={{ width: `${pct}%` }} />
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-neutral-500">
                        <span>Requests: {fmt(requests)}</span>
                        <span>{pct}% used</span>
                      </div>
                      <input
                        className={`${inputClass} mt-2 w-full py-1.5 text-xs`}
                        type="number"
                        min="0"
                        value={edit.limit}
                        onChange={(e) => onChangeRow(key.id, "limit", e.target.value)}
                        placeholder="Limit"
                      />
                    </td>
                    <td className="p-3">
                      <div className={expired ? "font-medium text-red-300" : "font-medium text-neutral-300"}>{formatExpiry(key.expiresAt)}</div>
                      <input
                        className={`${inputClass} mt-2 w-full py-1.5 text-xs`}
                        type="datetime-local"
                        value={edit.expiresAt}
                        onChange={(e) => onChangeRow(key.id, "expiresAt", e.target.value)}
                      />
                      <div className="mt-2 flex flex-wrap gap-1">
                        <button type="button" className={actionButtonClass} onClick={() => onChangeRow(key.id, "expiresAt", addDaysLocal(7))}>+7d</button>
                        <button type="button" className={actionButtonClass} onClick={() => onChangeRow(key.id, "expiresAt", addDaysLocal(30))}>+30d</button>
                        <button type="button" className={actionButtonClass} onClick={() => onChangeRow(key.id, "expiresAt", "")}>No expiry</button>
                      </div>
                    </td>
                    <td className="p-3 text-neutral-300">
                      <div className="max-w-[180px] rounded-lg border border-neutral-800 bg-neutral-900/60 px-2.5 py-2 text-xs leading-5">
                        {key.allowedModels?.length ? key.allowedModels.join(", ") : "All models"}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="max-w-[230px]">
                        <span className={`inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-bold ${statusTone({ key, expired, quotaLocked })}`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {statusLabel}
                        </span>
                        {key.disabledMessage ? (
                          <div className="mt-2 rounded-lg border border-red-500/20 bg-red-500/10 p-2 text-xs leading-5 text-red-200">{key.disabledMessage}</div>
                        ) : null}
                      </div>
                    </td>
                    <td className="p-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button className={actionButtonClass} disabled={testingId === key.id} onClick={() => quickTest(key)}>
                          {testingId === key.id ? "Testing..." : "Quick test"}
                        </button>
                        <button className="rounded-lg border border-emerald-500/30 bg-emerald-600/90 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-emerald-500 disabled:opacity-60" disabled={savingId === key.id} onClick={() => saveRow(key)}>
                          {savingId === key.id ? "Saving..." : "Save"}
                        </button>
                        <button className={actionButtonClass} onClick={() => patchKey(key.id, { enabled: !key.enabled })}>{key.enabled ? "Disable" : "Enable"}</button>
                        <button className="rounded-lg border border-red-500/30 bg-red-600/90 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-red-500" onClick={() => deleteKey(key.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!keys.length ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-neutral-400">No API key token limits yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
      {testMessage ? <p className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950/70 px-3 py-2 text-sm text-neutral-300">{testMessage}</p> : null}
    </section>
  );
}
