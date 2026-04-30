import { handleEmbeddings } from "@/sse/handlers/embeddings.js";
import { checkTokenQuota, findTokenApiKeyFromAuth } from "@/lib/tokenQuotaStore";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/embeddings - OpenAI-compatible embeddings endpoint
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

  return await handleEmbeddings(request);
}
