import { NextResponse } from "next/server";
import { getTokenApiKeyStatusBySecret } from "@/lib/tokenQuotaStore";

async function handleCheck(apiKey) {
  try {
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

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  return handleCheck(searchParams.get("apiKey") || "");
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  return handleCheck(body?.apiKey || "");
}
