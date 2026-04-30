import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { createApiKey, deleteApiKey, getApiKeys, updateApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";
import { DATA_DIR } from "@/lib/dataDir";

const TOKEN_QUOTA_DATA_DIR = process.env.TOKEN_QUOTA_DATA_DIR || DATA_DIR;
const DB_FILE = path.join(TOKEN_QUOTA_DATA_DIR, ".9router-token-quota.json");
const VIETNAM_UTC_OFFSET_MS = 7 * 60 * 60 * 1000;

const DEFAULT_DB = {
  usage: [],
  usageOverrides: [],
};

const EXACT_USAGE_SOURCE = "usage-db-exact";

async function ensureDbFile() {
  try {
    await fs.access(DB_FILE);
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), "utf8");
  }
}

async function readQuotaDb() {
  await ensureDbFile();
  const raw = await fs.readFile(DB_FILE, "utf8");
  const db = JSON.parse(raw || "{}");
  db.usage ||= [];
  db.usageOverrides ||= [];
  return db;
}

async function writeQuotaDb(db) {
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeTokenRow(row = {}) {
  const promptDetails = row.prompt_tokens_details || row.input_tokens_details || {};
  const completionDetails = row.completion_tokens_details || row.output_tokens_details || {};
  const inputTokens = toFiniteNumber(row.inputTokens ?? row.prompt_tokens ?? row.input_tokens);
  const outputTokens = toFiniteNumber(row.outputTokens ?? row.completion_tokens ?? row.output_tokens);
  const cachedTokens = toFiniteNumber(
    row.cachedTokens ??
      row.cached_tokens ??
      row.cache_read_input_tokens ??
      promptDetails.cached_tokens ??
      row.prompt_cache_hit_tokens
  );
  const cacheReadTokens = toFiniteNumber(row.cacheReadTokens ?? row.cache_read_input_tokens);
  const cacheCreationTokens = toFiniteNumber(row.cacheCreationTokens ?? row.cache_creation_input_tokens);
  const reasoningTokens = toFiniteNumber(row.reasoningTokens ?? row.reasoning_tokens ?? completionDetails.reasoning_tokens);
  const hasSeparateCacheTokens = row.cache_read_input_tokens !== undefined || row.cache_creation_input_tokens !== undefined;
  const totalTokens = toFiniteNumber(
    row.totalTokens ?? row.total_tokens,
    inputTokens +
      outputTokens +
      reasoningTokens +
      (hasSeparateCacheTokens ? cacheReadTokens + cacheCreationTokens : 0)
  );

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedTokens,
    cacheCreationTokens,
    reasoningTokens,
  };
}

async function recordExactUsageEntry({ apiKey, usageEntry = {}, provider, model, endpoint } = {}) {
  if (!apiKey?.id || !usageEntry?.tokens) return null;

  const tokens = normalizeTokenRow(usageEntry.tokens);
  if (tokens.inputTokens <= 0 && tokens.outputTokens <= 0 && tokens.totalTokens <= 0) return null;

  const usageEntryId =
    usageEntry.id ||
    crypto
      .createHash("sha256")
      .update(
        JSON.stringify({
          apiKeyId: apiKey.id,
          timestamp: usageEntry.timestamp,
          provider: usageEntry.provider || provider,
          model: usageEntry.model || model,
          tokens: usageEntry.tokens,
        })
      )
      .digest("hex");

  const db = await readQuotaDb();
  const existing = db.usage.find((row) => row.source === EXACT_USAGE_SOURCE && row.usageEntryId === usageEntryId);
  if (existing) return existing;

  const row = {
    id: crypto.randomUUID(),
    usageEntryId,
    apiKeyId: apiKey.id,
    source: EXACT_USAGE_SOURCE,
    provider: provider || usageEntry.provider || "unknown",
    model: model || usageEntry.model || "unknown",
    endpoint: endpoint || usageEntry.endpoint || null,
    inputTokens: tokens.inputTokens,
    outputTokens: tokens.outputTokens,
    totalTokens: tokens.totalTokens,
    cachedTokens: tokens.cachedTokens,
    cacheCreationTokens: tokens.cacheCreationTokens,
    reasoningTokens: tokens.reasoningTokens,
    createdAt: usageEntry.timestamp || usageEntry.createdAt || new Date().toISOString(),
  };

  db.usage.push(row);
  await writeQuotaDb(db);
  return row;
}

function aggregateUsageRows(rows = []) {
  return rows.reduce(
    (acc, row) => {
      const tokens = normalizeTokenRow(row);
      acc.requests += 1;
      acc.inputTokens += tokens.inputTokens;
      acc.outputTokens += tokens.outputTokens;
      acc.totalTokens += tokens.totalTokens;
      acc.cachedTokens += tokens.cachedTokens;
      acc.cacheCreationTokens += tokens.cacheCreationTokens;
      acc.reasoningTokens += tokens.reasoningTokens;
      return acc;
    },
    {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
    }
  );
}

function ensureQuotaShape(key) {
  const quota = key.quota || {};
  return {
    enabled: quota.enabled ?? true,
    window: quota.window || "monthly",
    maxInputTokens: Number(quota.maxInputTokens || 0),
    maxOutputTokens: Number(quota.maxOutputTokens || 0),
    maxTotalTokens: Number(quota.maxTotalTokens || 1000000),
    action: quota.action || "reject",
    fallbackModel: quota.fallbackModel || "",
  };
}

function shapeTokenApiKey(key) {
  if (!key) return null;
  return {
    ...key,
    enabled: key.isActive !== false,
    expired: isApiKeyExpired(key),
    quota: ensureQuotaShape(key),
    allowedModels: Array.isArray(key.allowedModels) ? key.allowedModels : [],
  };
}

function isApiKeyExpired(key, at = new Date()) {
  if (!key?.expiresAt) return false;
  const expiresAt = new Date(key.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= at.getTime();
}

function normalizeExpiresAt(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function buildExpiredKeyMessage(key) {
  const keyName = key?.name || key?.id || "API key";
  const expiresAt = key?.expiresAt ? new Date(key.expiresAt).toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }) : "the configured expiration time";
  return `API key "${keyName}" expired at ${expiresAt} Vietnam time. Extend the expiration in API Key Token Limits to use it again.`;
}

function normalizeUsageTotals(usage = {}) {
  return normalizeTokenRow(usage);
}

function getQuotaBreach(usage = {}, quota = {}, { inclusive = true } = {}) {
  const current = normalizeUsageTotals(usage);
  const checks = [
    { type: "input", used: current.inputTokens, limit: Number(quota.maxInputTokens || 0), label: "input tokens" },
    { type: "output", used: current.outputTokens, limit: Number(quota.maxOutputTokens || 0), label: "output tokens" },
    { type: "total", used: current.totalTokens, limit: Number(quota.maxTotalTokens || 0), label: "total tokens" },
  ];

  return checks.find((item) => item.limit > 0 && (inclusive ? item.used >= item.limit : item.used > item.limit)) || null;
}

function buildQuotaMessage({ key, usage, limit, breach, locked = false, projected = null }) {
  const keyName = key?.name || "API key";
  const used = Number(breach?.used ?? 0).toLocaleString();
  const max = Number(breach?.limit ?? 0).toLocaleString();
  const metric = breach?.label || "tokens";
  const window = limit?.window || "monthly";
  const prefix = locked ? "API key has reached its token limit and was locked." : "API key token quota would be exceeded.";
  const projectedText = projected ? ` Projected ${metric}: ${Number(projected).toLocaleString()}.` : "";

  return `${prefix} Key "${keyName}" used ${used}/${max} ${metric} in the ${window} window.${projectedText} Please use another key or raise the limit in API Key Token Limits.`;
}

async function lockTokenApiKeyForQuota(apiKey, usage, breach, source = {}) {
  const limit = apiKey.quota || ensureQuotaShape(apiKey);
  const message = buildQuotaMessage({ key: apiKey, usage, limit, breach, locked: true });
  const now = new Date().toISOString();

  await updateApiKey(apiKey.id, {
    isActive: false,
    disabledReason: "token_quota_exceeded",
    disabledMessage: message,
    disabledAt: now,
    quotaExceededAt: now,
    quotaExceededMetric: breach?.type || "total",
    quotaExceededUsage: usage,
    quotaExceededLimit: limit,
    quotaExceededSource: {
      provider: source.provider || null,
      model: source.model || null,
      endpoint: source.endpoint || null,
    },
  });

  return {
    locked: true,
    keyAutoDisabled: true,
    keyId: apiKey.id,
    keyName: apiKey.name,
    message,
    usage,
    limit,
    breach,
  };
}

function getVietnamDateParts(date = new Date()) {
  const vnDate = new Date(date.getTime() + VIETNAM_UTC_OFFSET_MS);
  return {
    year: vnDate.getUTCFullYear(),
    month: vnDate.getUTCMonth(),
    day: vnDate.getUTCDate(),
    weekday: vnDate.getUTCDay() || 7,
  };
}

function vietnamMidnightUtcIso({ year, month, day }) {
  return new Date(Date.UTC(year, month, day, -7, 0, 0, 0)).toISOString();
}

function addToVietnamDate({ year, month, day }, amount) {
  const vnDate = new Date(Date.UTC(year, month, day));
  vnDate.setUTCDate(vnDate.getUTCDate() + amount);
  return {
    year: vnDate.getUTCFullYear(),
    month: vnDate.getUTCMonth(),
    day: vnDate.getUTCDate(),
  };
}

export function quotaWindowStart(window, at = new Date()) {
  if (window === "rolling_5h") {
    return new Date(at.getTime() - 5 * 60 * 60 * 1000).toISOString();
  }

  const parts = getVietnamDateParts(at);

  if (window === "daily") {
    return vietnamMidnightUtcIso(parts);
  }

  if (window === "weekly") {
    const vnDate = new Date(Date.UTC(parts.year, parts.month, parts.day));
    vnDate.setUTCDate(vnDate.getUTCDate() - parts.weekday + 1);
    return vietnamMidnightUtcIso({
      year: vnDate.getUTCFullYear(),
      month: vnDate.getUTCMonth(),
      day: vnDate.getUTCDate(),
    });
  }

  return vietnamMidnightUtcIso({ year: parts.year, month: parts.month, day: 1 });
}

export function quotaWindowEnd(window, at = new Date()) {
  if (window === "rolling_5h") {
    return new Date(at.getTime() + 5 * 60 * 60 * 1000).toISOString();
  }

  const parts = getVietnamDateParts(at);

  if (window === "daily") {
    return vietnamMidnightUtcIso(addToVietnamDate(parts, 1));
  }

  if (window === "weekly") {
    const vnDate = new Date(Date.UTC(parts.year, parts.month, parts.day));
    vnDate.setUTCDate(vnDate.getUTCDate() - parts.weekday + 8);
    return vietnamMidnightUtcIso({
      year: vnDate.getUTCFullYear(),
      month: vnDate.getUTCMonth(),
      day: vnDate.getUTCDate(),
    });
  }

  return vietnamMidnightUtcIso({ year: parts.year, month: parts.month + 1, day: 1 });
}

function formatDuration(ms) {
  const safeMs = Math.max(0, Number(ms || 0));
  const totalSeconds = Math.ceil(safeMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

async function refreshQuotaLockState(rawKey) {
  const key = shapeTokenApiKey(rawKey);
  if (!key) return key;

  if (isApiKeyExpired(key)) {
    if (key.enabled !== false || key.disabledReason !== "api_key_expired") {
      const updated = await updateApiKey(key.id, {
        isActive: false,
        disabledReason: "api_key_expired",
        disabledMessage: buildExpiredKeyMessage(key),
        disabledAt: new Date().toISOString(),
        expiredAt: key.expiresAt,
      });
      return shapeTokenApiKey(updated);
    }
    return key;
  }

  if (key.disabledReason !== "token_quota_exceeded") return key;

  const window = key.quota?.window || "daily";
  const windowStart = quotaWindowStart(window);
  const disabledAt = new Date(key.disabledAt || key.quotaExceededAt || 0).getTime();
  const resetAt = new Date(windowStart).getTime();

  if (key.enabled === false && disabledAt > 0 && disabledAt < resetAt) {
    const updated = await updateApiKey(key.id, {
      isActive: true,
      disabledReason: null,
      disabledMessage: null,
      disabledAt: null,
      quotaExceededAt: null,
      quotaExceededMetric: null,
      quotaExceededUsage: null,
      quotaExceededLimit: null,
      quotaExceededSource: null,
      lastQuotaResetAt: new Date().toISOString(),
      lastQuotaResetWindowStart: windowStart,
    });
    return shapeTokenApiKey(updated);
  }

  return key;
}

export function estimateTokens(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload || "");
  return Math.max(1, Math.ceil(text.length / 4));
}

export function estimateOutputTokens(body = {}) {
  const fromMaxCompletion = Number(body?.max_completion_tokens || 0);
  if (fromMaxCompletion > 0) return fromMaxCompletion;

  const fromMaxTokens = Number(body?.max_tokens || 0);
  if (fromMaxTokens > 0) return fromMaxTokens;

  return 0;
}

export async function listTokenApiKeys() {
  const keys = await getApiKeys();
  return Promise.all(keys.map((k) => refreshQuotaLockState(k)));
}

export async function createTokenApiKey(input = {}) {
  const machineId = await getConsistentMachineId();
  const apiKey = await createApiKey(input.name || "New API Key", machineId);

  const patch = {
    allowedModels: Array.isArray(input.allowedModels) ? input.allowedModels : [],
    quota: ensureQuotaShape({ quota: input.quota || {} }),
  };
  if (typeof input.expiresAt === "string" && input.expiresAt.trim()) {
    const expiresAt = normalizeExpiresAt(input.expiresAt);
    patch.expiresAt = expiresAt;
  }
  const updated = await updateApiKey(apiKey.id, patch);
  return shapeTokenApiKey(updated);
}

export async function updateTokenApiKey(id, patch = {}) {
  const updateData = {};
  if (typeof patch.name === "string") updateData.name = patch.name;
  if (typeof patch.enabled === "boolean") {
    updateData.isActive = patch.enabled;
    if (patch.enabled) {
      updateData.disabledReason = null;
      updateData.disabledMessage = null;
      updateData.disabledAt = null;
    }
  }
  if (typeof patch.isActive === "boolean") {
    updateData.isActive = patch.isActive;
    if (patch.isActive) {
      updateData.disabledReason = null;
      updateData.disabledMessage = null;
      updateData.disabledAt = null;
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, "expiresAt")) {
    updateData.expiresAt = normalizeExpiresAt(patch.expiresAt);
    updateData.expiredAt = null;
  }
  if (Array.isArray(patch.allowedModels)) updateData.allowedModels = patch.allowedModels;
  if (patch.quota) updateData.quota = { ...ensureQuotaShape({}), ...patch.quota };

  const keys = await getApiKeys();
  const current = keys.find((item) => item.id === id);
  if (
    current?.disabledReason === "api_key_expired" &&
    Object.prototype.hasOwnProperty.call(updateData, "expiresAt") &&
    (!updateData.expiresAt || !isApiKeyExpired({ expiresAt: updateData.expiresAt }))
  ) {
    updateData.isActive = true;
    updateData.disabledReason = null;
    updateData.disabledMessage = null;
    updateData.disabledAt = null;
  }

  const updated = await updateApiKey(id, updateData);
  if (!updated) return null;

  return refreshQuotaLockState(updated);
}

export async function deleteTokenApiKey(id) {
  return deleteApiKey(id);
}

export async function findTokenApiKeyFromAuth(authHeader) {
  const secret = authHeader?.replace(/^Bearer\s+/i, "")?.trim();
  if (!secret) return null;

  const keys = await getApiKeys();
  const key = keys.find((item) => item.key === secret);
  if (!key) return null;

  return refreshQuotaLockState(key);
}

export async function findTokenApiKeyBySecret(secret) {
  const value = String(secret || "").trim();
  if (!value) return null;

  const keys = await getApiKeys();
  const key = keys.find((item) => item.key === value);
  if (!key) return null;

  return refreshQuotaLockState(key);
}

export async function getTokenApiKeyUsage(apiKeyId, window = "monthly") {
  const db = await readQuotaDb();
  const since = quotaWindowStart(window);
  const sinceDate = new Date(since);

  // Internal token-quota usage DB:
  // keep quick-test/manual entries; legacy chat-completions estimates are ignored
  const internalRows = db.usage
    .filter((row) => row.apiKeyId === apiKeyId)
    .filter((row) => new Date(row.createdAt) >= sinceDate)
    .filter((row) => row.provider !== "chat-completions");
  const internalUsage = aggregateUsageRows(internalRows);
  const exactLedgerIds = new Set(
    internalRows
      .filter((row) => row.source === EXACT_USAGE_SOURCE && row.usageEntryId)
      .map((row) => row.usageEntryId)
  );

  // Exact usage from open-sse usage history (saved with apiKey + real/normalized tokens)
  let exactUsage = aggregateUsageRows();
  try {
    const keys = await getApiKeys();
    const keyObj = keys.find((k) => k.id === apiKeyId);
    const apiKeyValue = keyObj?.key;
    if (apiKeyValue) {
      const { getUsageHistory } = await import("@/lib/usageDb");
      const history = await getUsageHistory({ startDate: since });
      const rows = history
        .filter((row) => row.apiKey === apiKeyValue)
        .filter((row) => !row.id || !exactLedgerIds.has(row.id))
        .map((row) => {
          return normalizeTokenRow(row.tokens || {});
        });
      exactUsage = aggregateUsageRows(rows);
    }
  } catch {
    // Fallback to internalUsage when usageDb is unavailable
  }

  const usage = {
    requests: exactUsage.requests + internalUsage.requests,
    inputTokens: exactUsage.inputTokens + internalUsage.inputTokens,
    outputTokens: exactUsage.outputTokens + internalUsage.outputTokens,
    totalTokens: exactUsage.totalTokens + internalUsage.totalTokens,
    cachedTokens: exactUsage.cachedTokens + internalUsage.cachedTokens,
    cacheCreationTokens: exactUsage.cacheCreationTokens + internalUsage.cacheCreationTokens,
    reasoningTokens: exactUsage.reasoningTokens + internalUsage.reasoningTokens,
    exactRequests: exactUsage.requests,
    internalRequests: internalUsage.requests,
  };

  const override = db.usageOverrides
    .filter((row) => row.apiKeyId === apiKeyId && row.window === window)
    .filter((row) => row.windowStart === since || (!row.windowStart && new Date(row.updatedAt || row.createdAt || 0) >= sinceDate))
    .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))[0];

  if (!override) return usage;

  return {
    ...usage,
    manualBaselineTokens: toFiniteNumber(override.totalTokens),
  };
}

function vietnamDayKey(date = new Date()) {
  const vnDate = new Date(date.getTime() + VIETNAM_UTC_OFFSET_MS);
  const year = vnDate.getUTCFullYear();
  const month = String(vnDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(vnDate.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function trendLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Ho_Chi_Minh",
    month: "short",
    day: "numeric",
  }).format(date);
}

function getLastVietnamDays(count = 7) {
  const today = new Date(Date.now() + VIETNAM_UTC_OFFSET_MS);
  today.setUTCHours(0, 0, 0, 0);

  return Array.from({ length: count }, (_, index) => {
    const day = new Date(today);
    day.setUTCDate(today.getUTCDate() - (count - 1 - index));
    const utcDate = new Date(day.getTime() - VIETNAM_UTC_OFFSET_MS);
    return {
      date: vietnamDayKey(utcDate),
      label: trendLabel(utcDate),
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
  });
}

export async function getTokenApiKeyDailyTrend(apiKeyId, days = 7) {
  const buckets = getLastVietnamDays(days);
  const bucketMap = new Map(buckets.map((bucket) => [bucket.date, bucket]));
  const startDate = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000);

  const db = await readQuotaDb();
  const exactLedgerIds = new Set(
    (db.usage || [])
      .filter((row) => row.source === EXACT_USAGE_SOURCE && row.usageEntryId)
      .map((row) => row.usageEntryId)
  );
  for (const row of db.usage || []) {
    if (row.apiKeyId !== apiKeyId) continue;
    if (row.provider === "chat-completions") continue;
    const createdAt = new Date(row.createdAt || 0);
    if (createdAt < startDate) continue;

    const bucket = bucketMap.get(vietnamDayKey(createdAt));
    if (!bucket) continue;
    const tokens = normalizeTokenRow(row);
    bucket.requests += 1;
    bucket.inputTokens += tokens.inputTokens;
    bucket.outputTokens += tokens.outputTokens;
    bucket.totalTokens += tokens.totalTokens;
  }

  try {
    const keys = await getApiKeys();
    const keyObj = keys.find((k) => k.id === apiKeyId);
    const apiKeyValue = keyObj?.key;
    if (apiKeyValue) {
      const { getUsageHistory } = await import("@/lib/usageDb");
      const history = await getUsageHistory({ startDate: startDate.toISOString() });
      for (const row of history) {
        if (row.apiKey !== apiKeyValue) continue;
        if (row.id && exactLedgerIds.has(row.id)) continue;
        const bucket = bucketMap.get(vietnamDayKey(new Date(row.timestamp || 0)));
        if (!bucket) continue;

        const tokens = normalizeTokenRow(row.tokens || {});
        bucket.requests += 1;
        bucket.inputTokens += tokens.inputTokens;
        bucket.outputTokens += tokens.outputTokens;
        bucket.totalTokens += tokens.totalTokens;
      }
    }
  } catch {
    // Trend falls back to internal token-quota rows only.
  }

  return buckets;
}

export async function setTokenApiKeyUsage({ apiKeyId, window = "monthly", totalTokens, inputTokens, outputTokens }) {
  if (!apiKeyId) return null;

  const db = await readQuotaDb();
  const idx = db.usageOverrides.findIndex((row) => row.apiKeyId === apiKeyId && row.window === window);
  const payload = {
    id: idx >= 0 ? db.usageOverrides[idx].id : crypto.randomUUID(),
    apiKeyId,
    window,
    windowStart: quotaWindowStart(window),
    inputTokens: Number(inputTokens ?? 0),
    outputTokens: Number(outputTokens ?? 0),
    totalTokens: Number(totalTokens ?? 0),
    updatedAt: new Date().toISOString(),
  };

  if (idx >= 0) db.usageOverrides[idx] = payload;
  else db.usageOverrides.push(payload);

  await writeQuotaDb(db);
  return payload;
}

export async function checkTokenQuota({ apiKey, body }) {
  if (!apiKey) return { allowed: false, status: 401, error: "Missing or invalid API key" };
  if (isApiKeyExpired(apiKey)) {
    const refreshed = await refreshQuotaLockState(apiKey);
    return {
      allowed: false,
      status: 403,
      error: refreshed?.disabledMessage || buildExpiredKeyMessage(apiKey),
      limit: refreshed?.quota || apiKey.quota,
      keyDisabled: true,
      keyExpired: true,
    };
  }
  if (apiKey.enabled === false || apiKey.isActive === false) {
    return {
      allowed: false,
      status: 403,
      error:
        apiKey.disabledMessage ||
        `API key "${apiKey.name || apiKey.id}" is disabled. Please enable it in API Key Token Limits or use another key.`,
      limit: apiKey.quota,
      keyDisabled: true,
      keyAutoDisabled: apiKey.disabledReason === "token_quota_exceeded",
    };
  }
  if (!apiKey.quota?.enabled) return { allowed: true };

  const model = body?.model || "";
  if (apiKey.allowedModels?.length && !apiKey.allowedModels.includes(model)) {
    return { allowed: false, status: 403, error: `Model ${model} is not allowed for this key` };
  }

  const estimatedInputTokens = estimateTokens(body?.messages || body?.input || body);
  const estimatedOutputTokens = estimateOutputTokens(body);
  const usage = await getTokenApiKeyUsage(apiKey.id, apiKey.quota.window);

  const currentBreach = getQuotaBreach(usage, apiKey.quota, { inclusive: true });
  if (currentBreach) {
    const lock = await lockTokenApiKeyForQuota(apiKey, usage, currentBreach, { provider: "preflight", model });
    return {
      allowed: false,
      status: 429,
      error: lock.message,
      usage,
      limit: apiKey.quota,
      breach: currentBreach,
      keyAutoDisabled: true,
    };
  }

  const projectedInput = usage.inputTokens + estimatedInputTokens;
  const projectedOutput = usage.outputTokens + estimatedOutputTokens;
  const projectedTotal = usage.totalTokens + estimatedInputTokens + estimatedOutputTokens;

  const projectedUsage = {
    inputTokens: projectedInput,
    outputTokens: projectedOutput,
    totalTokens: projectedTotal,
  };
  const projectedBreach = getQuotaBreach(projectedUsage, apiKey.quota, { inclusive: false });

  if (projectedBreach) {
    return {
      allowed: false,
      status: 429,
      error: buildQuotaMessage({
        key: apiKey,
        usage,
        limit: apiKey.quota,
        breach: { ...projectedBreach, used: usage[`${projectedBreach.type}Tokens`] ?? projectedBreach.used },
        projected: projectedBreach.used,
      }),
      usage,
      limit: apiKey.quota,
      breach: projectedBreach,
      keyAutoDisabled: false,
    };
  }

  return { allowed: true, usage, estimatedInputTokens, estimatedOutputTokens };
}

export async function enforceTokenQuotaAfterUsage({ apiKeyValue, apiKeyId, usageEntry = {}, provider, model, endpoint } = {}) {
  let apiKey = null;
  if (apiKeyId) {
    const keys = await getApiKeys();
    apiKey = keys.find((item) => item.id === apiKeyId) || null;
  } else if (apiKeyValue) {
    apiKey = await findTokenApiKeyBySecret(apiKeyValue);
  }

  if (!apiKey) return { locked: false };
  apiKey = {
    ...apiKey,
    enabled: apiKey.isActive !== false,
    quota: ensureQuotaShape(apiKey),
  };

  if (!apiKey.quota.enabled) return { locked: false };

  const limit = apiKey.quota || ensureQuotaShape(apiKey);
  await recordExactUsageEntry({ apiKey, usageEntry, provider, model, endpoint });
  const usage = await getTokenApiKeyUsage(apiKey.id, limit.window);
  const breach = getQuotaBreach(usage, limit, { inclusive: true });
  if (!breach) return { locked: false, usage, limit };

  if (apiKey.enabled === false || apiKey.isActive === false) {
    return {
      locked: true,
      keyAutoDisabled: apiKey.disabledReason === "token_quota_exceeded",
      keyId: apiKey.id,
      keyName: apiKey.name,
      message:
        apiKey.disabledMessage ||
        buildQuotaMessage({ key: apiKey, usage, limit, breach, locked: true }),
      usage,
      limit,
      breach,
    };
  }

  const result = await lockTokenApiKeyForQuota(apiKey, usage, breach, {
    provider: provider || usageEntry.provider,
    model: model || usageEntry.model,
    endpoint: endpoint || usageEntry.endpoint,
  });
  console.warn(`[TokenQuota] ${result.message}`);
  return result;
}

export async function recordTokenUsage({ apiKeyId, model, provider, inputTokens = 0, outputTokens = 0, totalTokens }) {
  if (!apiKeyId) return null;
  const db = await readQuotaDb();
  const row = {
    id: crypto.randomUUID(),
    apiKeyId,
    model: model || "unknown",
    provider: provider || "unknown",
    inputTokens: Number(inputTokens || 0),
    outputTokens: Number(outputTokens || 0),
    totalTokens: Number(totalTokens ?? (Number(inputTokens || 0) + Number(outputTokens || 0))),
    createdAt: new Date().toISOString(),
  };
  db.usage.push(row);
  await writeQuotaDb(db);
  const quotaStatus = await enforceTokenQuotaAfterUsage({ apiKeyId, usageEntry: row, provider, model });
  return { ...row, quotaStatus };
}

export async function getTokenApiKeyStatusBySecret(secret) {
  const apiKey = await findTokenApiKeyBySecret(secret);
  if (!apiKey) return { found: false };

  const window = apiKey.quota?.window || "monthly";
  const usage = await getTokenApiKeyUsage(apiKey.id, window);
  const dailyTrend = await getTokenApiKeyDailyTrend(apiKey.id, 7);
  const limit = apiKey.quota || ensureQuotaShape(apiKey);
  const remainingInput =
    limit.maxInputTokens > 0 ? Math.max(0, Number(limit.maxInputTokens) - Number(usage.inputTokens || 0)) : null;
  const remainingTotal =
    limit.maxTotalTokens > 0 ? Math.max(0, Number(limit.maxTotalTokens) - Number(usage.totalTokens || 0)) : null;
  const exceeded =
    (limit.maxInputTokens > 0 && Number(usage.inputTokens || 0) >= Number(limit.maxInputTokens)) ||
    (limit.maxOutputTokens > 0 && Number(usage.outputTokens || 0) >= Number(limit.maxOutputTokens)) ||
    (limit.maxTotalTokens > 0 && Number(usage.totalTokens || 0) >= Number(limit.maxTotalTokens));
  const breach = getQuotaBreach(usage, limit, { inclusive: true });
  let effectiveEnabled = apiKey.enabled;
  let disabledMessage = apiKey.disabledMessage;
  const now = Date.now();
  const resetAt = quotaWindowEnd(window);
  const resetInMs = Math.max(0, new Date(resetAt).getTime() - now);

  if (breach && apiKey.enabled !== false) {
    const lock = await lockTokenApiKeyForQuota(apiKey, usage, breach, { provider: "status-check" });
    effectiveEnabled = false;
    disabledMessage = lock.message;
  }

  return {
    found: true,
    key: {
      id: apiKey.id,
      name: apiKey.name,
      enabled: effectiveEnabled,
      expired: apiKey.expired || apiKey.disabledReason === "api_key_expired",
      expiresAt: apiKey.expiresAt || null,
      createdAt: apiKey.createdAt,
      allowedModels: apiKey.allowedModels || [],
      quota: limit,
      disabledMessage,
      disabledReason: apiKey.disabledReason || null,
      disabledAt: apiKey.disabledAt || null,
    },
    usage,
    dailyTrend,
    status: {
      active: effectiveEnabled,
      expired: apiKey.expired || apiKey.disabledReason === "api_key_expired",
      expiresAt: apiKey.expiresAt || null,
      exceeded,
      breach,
      window,
      windowStart: quotaWindowStart(window),
      resetAt,
      resetInMs,
      resetIn: formatDuration(resetInMs),
      timezone: "Asia/Ho_Chi_Minh",
      remainingInputTokens: remainingInput,
      remainingOutputTokens:
        limit.maxOutputTokens > 0 ? Math.max(0, Number(limit.maxOutputTokens) - Number(usage.outputTokens || 0)) : null,
      remainingTotalTokens: remainingTotal,
    },
  };
}
