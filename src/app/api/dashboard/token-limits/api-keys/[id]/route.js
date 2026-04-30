import { NextResponse } from "next/server";
import { deleteTokenApiKey, getTokenApiKeyUsage, updateTokenApiKey } from "@/lib/tokenQuotaStore";

export async function GET(req, { params }) {
  const { id } = await params;
  const url = new URL(req.url);
  const window = url.searchParams.get("window") || "monthly";
  const usage = await getTokenApiKeyUsage(id, window);
  return NextResponse.json({ usage });
}

export async function PATCH(req, { params }) {
  const { id } = await params;
  const body = await req.json();
  const key = await updateTokenApiKey(id, body);
  if (!key) return NextResponse.json({ error: "API key not found" }, { status: 404 });
  return NextResponse.json({ key });
}

export async function DELETE(_req, { params }) {
  const { id } = await params;
  const ok = await deleteTokenApiKey(id);
  if (!ok) return NextResponse.json({ error: "API key not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
