import { NextResponse } from "next/server";
import { runCodexBulkLogin } from "@/lib/oauth/codexBulkLogin";

export async function POST(req) {
  try {
    const body = await req.json();
    const accountsText = body?.accountsText || "";
    const headless = body?.headless === true;

    if (!String(accountsText).trim()) {
      return NextResponse.json({ error: "accountsText is required" }, { status: 400 });
    }

    const results = await runCodexBulkLogin({ accountsText, headless });
    const ok = results.filter((x) => x.ok).length;
    const failed = results.length - ok;

    return NextResponse.json({
      ok: true,
      summary: { total: results.length, ok, failed },
      results,
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Bulk login failed" },
      { status: 500 }
    );
  }
}
