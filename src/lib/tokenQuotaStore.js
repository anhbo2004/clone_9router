import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { createApiKey, deleteApiKey, getApiKeys, updateApiKey } from "@/lib/localDb";
import { getConsistentMachineId } from "@/shared/utils/machineId";

const DATA_DIR = process.env.TOKEN_QUOTA_DATA_DIR || process.cwd();
const DB_FILE = path.join(DATA_DIR, ".9router-token-quota.json");

const DEFAULT_DB = {
  usage: [],
};

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
  return db;
}

async function writeQuotaDb(db) {
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
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

export function quotaWindowStart(window) {
  const now = new Date();
  const start = new Date(now);

  if (window === "rolling_5h") {
    start.setHours(start.getHours() - 5);
  } else if (window === "daily") {
    start.setHours(0, 0, 0, 0);
  } else if (window === "weekly") {
    const day = start.getDay() || 7;
    start.setDate(start.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }

  return start.toISOString();
}

export function estimateTokens(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload || "");
  return Math.max(1, Math.ceil(text.length / 4));
}

export async function listTokenApiKeys() {
  const keys = await getApiKeys();
  return keys.map((k) => ({
    ...k,
    enabled: k.isActive !== false,
    quota: ensureQuotaShape(k),
    allowedModels: Array.isArray(k.allowedModels) ? k.allowedModels : [],
  }));
}

export async function createTokenApiKey(input = {}) {
  const machineId = await getConsistentMachineId();
  const apiKey = await createApiKey(input.name || "New API Key", machineId);

  const patch = {
    allowedModels: Array.isArray(input.allowedModels) ? input.allowedModels : [],
    quota: ensureQuotaShape({ quota: input.quota || {} }),
  };
  const updated = await updateApiKey(apiKey.id, patch);
  return {
    ...updated,
    enabled: updated.isActive !== false,
  };
}

export async function updateTokenApiKey(id, patch = {}) {
  const updateData = {};
  if (typeof patch.name === "string") updateData.name = patch.name;
  if (typeof patch.enabled === "boolean") updateData.isActive = patch.enabled;
  if (typeof patch.isActive === "boolean") updateData.isActive = patch.isActive;
  if (Array.isArray(patch.allowedModels)) updateData.allowedModels = patch.allowedModels;
  if (patch.quota) updateData.quota = { ...ensureQuotaShape({}), ...patch.quota };

  const updated = await updateApiKey(id, updateData);
  if (!updated) return null;

  return {
    ...updated,
    enabled: updated.isActive !== false,
    quota: ensureQuotaShape(updated),
    allowedModels: Array.isArray(updated.allowedModels) ? updated.allowedModels : [],
  };
}

export async function deleteTokenApiKey(id) {
  return deleteApiKey(id);
}

export async function findTokenApiKeyFromAuth(authHeader) {
  const secret = authHeader?.replace(/^Bearer\s+/i, "")?.trim();
  if (!secret) return null;

  const keys = await getApiKeys();
  const key = keys.find((item) => item.key === secret && item.isActive !== false);
  if (!key) return null;

  return {
    ...key,
    enabled: key.isActive !== false,
    quota: ensureQuotaShape(key),
    allowedModels: Array.isArray(key.allowedModels) ? key.allowedModels : [],
  };
}

export async function findTokenApiKeyBySecret(secret) {
  const value = String(secret || "").trim();
  if (!value) return null;

  const keys = await getApiKeys();
  const key = keys.find((item) => item.key === value);
  if (!key) return null;

  return {
    ...key,
    enabled: key.isActive !== false,
    quota: ensureQuotaShape(key),
    allowedModels: Array.isArray(key.allowedModels) ? key.allowedModels : [],
  };
}

export async function getTokenApiKeyUsage(apiKeyId, window = "monthly") {
  const db = await readQuotaDb();
  const since = quotaWindowStart(window);

  return db.usage
    .filter((row) => row.apiKeyId === apiKeyId)
    .filter((row) => new Date(row.createdAt) >= new Date(since))
    .reduce(
      (acc, row) => {
        acc.requests += 1;
        acc.inputTokens += Number(row.inputTokens || 0);
        acc.outputTokens += Number(row.outputTokens || 0);
        acc.totalTokens += Number(row.totalTokens || 0);
        return acc;
      },
      { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    );
}

export async function checkTokenQuota({ apiKey, body }) {
  if (!apiKey) return { allowed: false, status: 401, error: "Missing or invalid API key" };
  if (!apiKey.quota?.enabled) return { allowed: true };

  const model = body?.model || "";
  if (apiKey.allowedModels?.length && !apiKey.allowedModels.includes(model)) {
    return { allowed: false, status: 403, error: `Model ${model} is not allowed for this key` };
  }

  const estimatedInputTokens = estimateTokens(body?.messages || body?.input || body);
  const usage = await getTokenApiKeyUsage(apiKey.id, apiKey.quota.window);

  const projectedInput = usage.inputTokens + estimatedInputTokens;
  const projectedTotal = usage.totalTokens + estimatedInputTokens;

  const inputExceeded = apiKey.quota.maxInputTokens > 0 && projectedInput > apiKey.quota.maxInputTokens;
  const totalExceeded = apiKey.quota.maxTotalTokens > 0 && projectedTotal > apiKey.quota.maxTotalTokens;

  if (inputExceeded || totalExceeded) {
    return {
      allowed: false,
      status: 429,
      error: "API key token quota exceeded",
      usage,
      limit: apiKey.quota,
    };
  }

  return { allowed: true, usage, estimatedInputTokens };
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
  return row;
}

export async function getTokenApiKeyStatusBySecret(secret) {
  const apiKey = await findTokenApiKeyBySecret(secret);
  if (!apiKey) return { found: false };

  const window = apiKey.quota?.window || "monthly";
  const usage = await getTokenApiKeyUsage(apiKey.id, window);
  const limit = apiKey.quota || ensureQuotaShape(apiKey);
  const remainingInput =
    limit.maxInputTokens > 0 ? Math.max(0, Number(limit.maxInputTokens) - Number(usage.inputTokens || 0)) : null;
  const remainingTotal =
    limit.maxTotalTokens > 0 ? Math.max(0, Number(limit.maxTotalTokens) - Number(usage.totalTokens || 0)) : null;
  const exceeded =
    (limit.maxInputTokens > 0 && Number(usage.inputTokens || 0) >= Number(limit.maxInputTokens)) ||
    (limit.maxTotalTokens > 0 && Number(usage.totalTokens || 0) >= Number(limit.maxTotalTokens));

  return {
    found: true,
    key: {
      id: apiKey.id,
      name: apiKey.name,
      key: apiKey.key,
      enabled: apiKey.enabled,
      createdAt: apiKey.createdAt,
      allowedModels: apiKey.allowedModels || [],
      quota: limit,
    },
    usage,
    status: {
      active: apiKey.enabled,
      exceeded,
      window,
      windowStart: quotaWindowStart(window),
      remainingInputTokens: remainingInput,
      remainingTotalTokens: remainingTotal,
    },
  };
}
