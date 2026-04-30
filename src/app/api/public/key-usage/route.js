import { NextResponse } from "next/server";
import { getTokenApiKeyStatusBySecret } from "@/lib/tokenQuotaStore";

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url);
    const apiKey = searchParams.get("apiKey") || "";

    if (!apiKey.trim()) {
      return NextResponse.json({ error: "apiKey is required" }, { status: 400 });
    }

    const result = await getTokenApiKeyStatusBySecret(apiKey);
    if (!result.found) {
      return NextResponse.json({ found: false, error: "API key not found" }, { status: 404 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Failed to check key usage" }, { status: 500 });
  }
}
