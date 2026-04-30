import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { checkTokenQuota, findTokenApiKeyFromAuth } from "@/lib/tokenQuotaStore";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
    console.log("[SSE] Translators initialized for /v1/responses");
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/responses - OpenAI Responses API format
 * Now handled by translator pattern (openai-responses format auto-detected)
 */
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
            breach: tokenQuotaCheck.breach,
            keyAutoDisabled: !!tokenQuotaCheck.keyAutoDisabled,
            keyDisabled: !!tokenQuotaCheck.keyDisabled,
          },
        },
        { status: tokenQuotaCheck.status || 429 }
      );
    }
  }

  await ensureInitialized();
  return await handleChat(request);
}
