import { saveRequestUsage, appendRequestLog, saveRequestDetail } from "@/lib/usageDb.js";
import { COLORS } from "../../utils/stream.js";

const OPTIONAL_PARAMS = [
  "temperature", "top_p", "top_k",
  "max_tokens", "max_completion_tokens",
  "thinking", "reasoning", "enable_thinking",
  "presence_penalty", "frequency_penalty",
  "seed", "stop", "tools", "tool_choice",
  "response_format", "prediction", "store", "metadata",
  "n", "logprobs", "top_logprobs", "logit_bias",
  "user", "parallel_tool_calls"
];

export function extractRequestConfig(body, stream) {
  const config = { messages: body.messages || [], model: body.model, stream };
  for (const param of OPTIONAL_PARAMS) {
    if (body[param] !== undefined) config[param] = body[param];
  }
  return config;
}

function toFiniteNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export function extractUsageFromResponse(responseBody) {
  if (!responseBody || typeof responseBody !== "object") return null;

  // Claude / Responses API input-output format
  if (responseBody.usage?.input_tokens !== undefined) {
    const usage = responseBody.usage;
    const inputTokens = toFiniteNumber(usage.input_tokens);
    const outputTokens = toFiniteNumber(usage.output_tokens);
    const cacheReadTokens = toFiniteNumber(usage.cache_read_input_tokens ?? usage.input_tokens_details?.cached_tokens);
    const cacheCreationTokens = toFiniteNumber(usage.cache_creation_input_tokens);
    const reasoningTokens = toFiniteNumber(usage.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens);
    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      prompt_tokens: inputTokens,
      completion_tokens: outputTokens,
      total_tokens:
        usage.total_tokens ??
        usage.totalTokens ??
        inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens + reasoningTokens,
      cached_tokens: cacheReadTokens,
      cache_read_input_tokens: cacheReadTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      reasoning_tokens: reasoningTokens,
      prompt_tokens_details: usage.input_tokens_details,
      completion_tokens_details: usage.output_tokens_details
    };
  }

  // OpenAI format
  if (responseBody.usage?.prompt_tokens !== undefined) {
    const usage = responseBody.usage;
    const promptTokens = toFiniteNumber(usage.prompt_tokens);
    const completionTokens = toFiniteNumber(usage.completion_tokens);
    const reasoningTokens = toFiniteNumber(usage.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens);
    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens:
        usage.total_tokens ??
        promptTokens + completionTokens + reasoningTokens,
      cached_tokens: usage.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? usage.prompt_tokens_details?.cached_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
      reasoning_tokens: reasoningTokens,
      prompt_tokens_details: usage.prompt_tokens_details,
      completion_tokens_details: usage.completion_tokens_details
    };
  }

  // Gemini format
  if (responseBody.usageMetadata) {
    const usage = responseBody.usageMetadata;
    const promptTokens = toFiniteNumber(usage.promptTokenCount);
    const completionTokens = toFiniteNumber(usage.candidatesTokenCount);
    const reasoningTokens = toFiniteNumber(usage.thoughtsTokenCount);
    return {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens:
        usage.totalTokenCount ??
        promptTokens + completionTokens + reasoningTokens,
      cached_tokens: usage.cachedContentTokenCount,
      cache_read_input_tokens: usage.cachedContentTokenCount,
      reasoning_tokens: reasoningTokens
    };
  }

  return null;
}

export function buildRequestDetail(base, overrides = {}) {
  return {
    provider: base.provider || "unknown",
    model: base.model || "unknown",
    connectionId: base.connectionId || undefined,
    timestamp: new Date().toISOString(),
    latency: base.latency || { ttft: 0, total: 0 },
    tokens: base.tokens || { prompt_tokens: 0, completion_tokens: 0 },
    request: base.request,
    providerRequest: base.providerRequest || null,
    providerResponse: base.providerResponse || null,
    response: base.response || {},
    status: base.status || "success",
    ...overrides
  };
}

export async function saveUsageStats({ provider, model, tokens, connectionId, apiKey, endpoint, label = "USAGE" }) {
  if (!tokens || typeof tokens !== "object") return null;

  const promptDetails = tokens.prompt_tokens_details || tokens.input_tokens_details || {};
  const completionDetails = tokens.completion_tokens_details || tokens.output_tokens_details || {};
  const inTokens = toFiniteNumber(tokens.input_tokens ?? tokens.prompt_tokens);
  const outTokens = toFiniteNumber(tokens.output_tokens ?? tokens.completion_tokens);
  const cachedTokens = toFiniteNumber(
    tokens.cached_tokens ??
      tokens.cache_read_input_tokens ??
      promptDetails.cached_tokens ??
      tokens.prompt_cache_hit_tokens
  );
  const cacheCreationTokens = toFiniteNumber(tokens.cache_creation_input_tokens);
  const reasoningTokens = toFiniteNumber(tokens.reasoning_tokens ?? completionDetails.reasoning_tokens);

  if (inTokens === 0 && outTokens === 0) return null;

  const time = new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const accountSuffix = connectionId ? ` | account=${connectionId.slice(0, 8)}...` : "";
  console.log(`${COLORS.green}[${time}] 📊 [${label}] ${provider.toUpperCase()} | in=${inTokens} | out=${outTokens}${accountSuffix}${COLORS.reset}`);

  // Normalize to OpenAI token shape for storage
  const normalized = {
    prompt_tokens: inTokens,
    completion_tokens: outTokens,
    total_tokens:
      tokens.total_tokens ??
      inTokens +
        outTokens +
        reasoningTokens +
        (tokens.input_tokens !== undefined ? cachedTokens + cacheCreationTokens : 0),
    cached_tokens: cachedTokens,
    cache_read_input_tokens: cachedTokens,
    cache_creation_input_tokens: cacheCreationTokens,
    reasoning_tokens: reasoningTokens,
    prompt_tokens_details: promptDetails,
    completion_tokens_details: completionDetails,
  };

  const saved = await saveRequestUsage({
    provider: provider || "unknown",
    model: model || "unknown",
    tokens: normalized,
    timestamp: new Date().toISOString(),
    connectionId: connectionId || undefined,
    apiKey: apiKey || undefined,
    endpoint: endpoint || null
  }).catch(() => null);

  return saved?.quotaStatus || null;
}

export function buildQuotaLockedResponse(quotaStatus, source = {}) {
  const message = quotaStatus?.message || "API key token quota reached. The key was locked.";
  const body = {
    error: {
      message,
      type: "rate_limit_exceeded",
      code: "api_key_token_quota_exceeded",
      keyAutoDisabled: !!quotaStatus?.keyAutoDisabled,
      usage: quotaStatus?.usage,
      limit: quotaStatus?.limit,
      breach: quotaStatus?.breach,
      provider: source.provider,
      model: source.model,
    },
  };

  return new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "X-9Router-Quota-Locked": "true",
    },
  });
}
