import { NextResponse } from "next/server";
import { createTokenApiKey, getTokenApiKeyUsage, listTokenApiKeys } from "@/lib/tokenQuotaStore";

export const dynamic = "force-dynamic";

export async function GET() {
  const keys = await listTokenApiKeys();
  const enriched = await Promise.all(
    keys.map(async (key) => ({
      ...key,
      usage: await getTokenApiKeyUsage(key.id, key.quota?.window || "monthly"),
    }))
  );
  return NextResponse.json(
    { keys: enriched, updatedAt: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}

export async function POST(req) {
  const body = await req.json();
  const key = await createTokenApiKey(body);
  return NextResponse.json({ key, secret: key.key, warning: "API key generated from main key store." });
}
