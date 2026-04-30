import { callCloudWithMachineId } from "@/shared/utils/cloud.js";
import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { checkTokenQuota, findTokenApiKeyFromAuth, recordTokenUsage } from "@/lib/tokenQuotaStore";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
    console.log("[SSE] Translators initialized");
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function POST(request) {  
  const authHeader = request.headers.get("authorization");
  const body = await request.clone().json().catch(() => null);
  const tokenQuotaApiKey = await findTokenApiKeyFromAuth(authHeader);
  if (authHeader) {
    const tokenQuotaCheck = await checkTokenQuota({ apiKey: tokenQuotaApiKey, body });
    if (!tokenQuotaCheck.allowed) {
      return Response.json(
        {
          error: {
            message: tokenQuotaCheck.error,
            type: "rate_limit_exceeded",
            usage: tokenQuotaCheck.usage,
            limit: tokenQuotaCheck.limit,
          },
        },
        { status: tokenQuotaCheck.status || 429 }
      );
    }
    await recordTokenUsage({
      apiKeyId: tokenQuotaApiKey?.id,
      model: body?.model,
      provider: "chat-completions",
      inputTokens: tokenQuotaCheck.estimatedInputTokens || 0,
      outputTokens: 0,
    });
  }

  // Fallback to local handling
  await ensureInitialized();
  
  return await handleChat(request);
}

