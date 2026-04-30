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
    }, 2000);
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
        }),
      });
      const data = await res.json();
      setSecret(data.secret || data.key?.secret || "");
      setForm({ ...form, name: "" });
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

  return (
    <section className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5 text-neutral-100">
      <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">API Key Token Limits</h2>
          <p className="text-xs text-neutral-500">
            {liveConnected ? "Live updates connected" : "Live updates reconnecting"}
            {lastUpdatedAt ? ` | Last update: ${new Date(lastUpdatedAt).toLocaleTimeString()}` : ""}
          </p>
          <p className="text-sm text-neutral-400">Giới hạn token theo từng API key. Tổng đã dùng: {fmt(totalUsed)} tokens.</p>
        </div>
        <button onClick={load} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">Refresh</button>
      </div>

      {secret ? (
        <div className="mb-5 rounded-xl border border-amber-600/40 bg-amber-500/10 p-4">
          <div className="font-medium text-amber-200">API key mới - chỉ hiển thị một lần</div>
          <code className="mt-2 block break-all rounded bg-black/40 p-3 text-sm text-amber-100">{secret}</code>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 md:grid-cols-6">
        <input className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 md:col-span-2" placeholder="Tên key, ví dụ: Team A" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2" type="number" placeholder="Total tokens" value={form.maxTotalTokens} onChange={(e) => setForm({ ...form, maxTotalTokens: e.target.value })} />
        <select className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2" value={form.window} onChange={(e) => setForm({ ...form, window: e.target.value })}>
          <option value="rolling_5h">Rolling 5h</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <input className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2" placeholder="Allowed models, cách nhau bằng dấu phẩy" value={form.allowedModels} onChange={(e) => setForm({ ...form, allowedModels: e.target.value })} />
        <button disabled={loading} onClick={createKey} className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white hover:bg-orange-500 disabled:opacity-60">Create key</button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-800">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-neutral-900 text-neutral-300">
            <tr>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Key</th>
              <th className="p-3 text-left">Window</th>
              <th className="p-3 text-left">Used / Limit</th>
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
              return (
                <tr key={key.id} className="border-t border-neutral-800">
                  <td className="p-3 font-medium">{key.name}</td>
                  <td className="p-3 font-mono text-neutral-300">
                    <div className="flex items-center gap-2">
                      <span className="max-w-[260px] truncate">{key.key}</span>
                      <button className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700" onClick={() => copyKey(key.id, key.key)}>
                        {copiedId === key.id ? "Copied" : "Copy"}
                      </button>
                    </div>
                  </td>
                  <td className="p-3">{key.quota?.window}</td>
                  <td className="p-3">
                    <div className="flex items-center justify-between gap-3">
                      <span>{fmt(used)} / {fmtLimit(limit)}</span>
                      <span className="text-xs text-neutral-500">Remaining: {remainingTotal === null ? "Unlimited" : fmt(remainingTotal)}</span>
                    </div>
                    <div className="mt-1 h-2 rounded bg-neutral-800">
                      <div className={`h-2 rounded ${over ? "bg-red-600" : "bg-orange-600"}`} style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-1 text-xs text-neutral-400">Requests: {fmt(requests)}</div>

                    <div className="mt-2 grid gap-2">
                      <input
                        className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1 text-xs"
                        type="number"
                        min="0"
                        value={edit.limit}
                        onChange={(e) => onChangeRow(key.id, "limit", e.target.value)}
                        placeholder="Limit"
                      />
                    </div>
                  </td>
                  <td className="p-3 text-neutral-300">{key.allowedModels?.length ? key.allowedModels.join(", ") : "All"}</td>
                  <td className="p-3">
                    {key.enabled ? (
                      <span className="text-green-400">Enabled</span>
                    ) : (
                      <div className="max-w-[220px]">
                        <span className="text-red-400">{quotaLocked ? "Locked by token limit" : "Disabled"}</span>
                        {key.disabledMessage ? (
                          <div className="mt-1 text-xs text-red-300">{key.disabledMessage}</div>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td className="space-x-2 p-3 text-right">
                    <button className="rounded bg-blue-700 px-3 py-1 hover:bg-blue-600 disabled:opacity-60" disabled={testingId === key.id} onClick={() => quickTest(key)}>
                      {testingId === key.id ? "Testing..." : "Quick test"}
                    </button>
                    <button className="rounded bg-emerald-700 px-3 py-1 hover:bg-emerald-600 disabled:opacity-60" disabled={savingId === key.id} onClick={() => saveRow(key)}>
                      {savingId === key.id ? "Saving..." : "Save Limit"}
                    </button>
                    <button className="rounded bg-neutral-800 px-3 py-1 hover:bg-neutral-700" onClick={() => patchKey(key.id, { enabled: !key.enabled })}>{key.enabled ? "Disable" : "Enable"}</button>
                    <button className="rounded bg-red-700 px-3 py-1 hover:bg-red-600" onClick={() => deleteKey(key.id)}>Delete</button>
                  </td>
                </tr>
              );
            })}
            {!keys.length ? <tr><td colSpan={7} className="p-6 text-center text-neutral-400">Chua co API key token-limit nao.</td></tr> : null}
          </tbody>
        </table>
      </div>
      {testMessage ? <p className="mt-3 text-sm text-neutral-300">{testMessage}</p> : null}
    </section>
  );
}
