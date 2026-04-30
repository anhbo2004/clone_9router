import { NextResponse } from "next/server";
import { checkTokenQuota, listTokenApiKeys, recordTokenUsage } from "@/lib/tokenQuotaStore";

export async function POST(req) {
  try {
    const body = await req.json();
    const keyId = body?.keyId;
    const model = body?.model || "if/qwen3-coder-plus";
    const prompt = body?.prompt || "quick quota test";

    if (!keyId) {
      return NextResponse.json({ error: "keyId is required" }, { status: 400 });
    }

    const keys = await listTokenApiKeys();
    const apiKey = keys.find((k) => k.id === keyId);
    if (!apiKey) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    const requestBody = {
      model,
      messages: [{ role: "user", content: prompt }],
    };

    const check = await checkTokenQuota({ apiKey, body: requestBody });
    if (!check.allowed) {
      return NextResponse.json(
        {
          ok: false,
          status: check.status || 429,
          error: check.error,
          usage: check.usage,
          limit: check.limit,
          keyAutoDisabled: !!check.keyAutoDisabled,
        },
        { status: check.status || 429 }
      );
    }

    await recordTokenUsage({
      apiKeyId: apiKey.id,
      model,
      provider: "quick-test",
      inputTokens: check.estimatedInputTokens || 0,
      outputTokens: 0,
    });

    return NextResponse.json({
      ok: true,
      message: "Quick test passed and usage recorded",
      estimatedInputTokens: check.estimatedInputTokens || 0,
    });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Quick test failed" }, { status: 500 });
  }
}
