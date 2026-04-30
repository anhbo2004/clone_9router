"use client";

import { useState } from "react";

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

export default function KeyUsageLandingPage() {
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function checkUsage() {
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch(`/api/public/key-usage?apiKey=${encodeURIComponent(apiKey.trim())}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Check failed");
        return;
      }
      setResult(data);
    } catch (e) {
      setError(e?.message || "Check failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#111] text-white px-4 py-10">
      <div className="mx-auto w-full max-w-3xl">
        <h1 className="text-3xl font-bold mb-2">API Key Usage Checker</h1>
        <p className="text-neutral-400 mb-6">Public page - no login required</p>

        <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
          <label className="block text-sm text-neutral-300 mb-2">API Key</label>
          <div className="flex gap-2">
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
              className="flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-orange-500"
            />
            <button
              onClick={checkUsage}
              disabled={!apiKey.trim() || loading}
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold hover:bg-orange-500 disabled:opacity-60"
            >
              {loading ? "Checking..." : "Check"}
            </button>
          </div>
          {error ? <p className="mt-3 text-sm text-red-400">{error}</p> : null}
        </div>

        {result?.found ? (
          <div className="mt-6 rounded-xl border border-neutral-800 bg-neutral-900 p-4">
            <h2 className="text-lg font-semibold mb-3">{result.key.name}</h2>
            <div className="grid gap-2 text-sm">
              <div>Status: {result.status.active ? "Enabled" : "Disabled"}</div>
              <div>Quota window: {result.status.window}</div>
              <div>Window start: {new Date(result.status.windowStart).toLocaleString()}</div>
              <div>Allowed models: {result.key.allowedModels?.length ? result.key.allowedModels.join(", ") : "All"}</div>
              <div>Requests: {fmt(result.usage.requests)}</div>
              <div>Input tokens used: {fmt(result.usage.inputTokens)}</div>
              <div>Output tokens used: {fmt(result.usage.outputTokens)}</div>
              <div>Total tokens used: {fmt(result.usage.totalTokens)}</div>
              <div>Total limit: {result.key.quota.maxTotalTokens > 0 ? fmt(result.key.quota.maxTotalTokens) : "∞"}</div>
              <div>Remaining total: {result.status.remainingTotalTokens === null ? "∞" : fmt(result.status.remainingTotalTokens)}</div>
              <div>Exceeded: {result.status.exceeded ? "Yes" : "No"}</div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
