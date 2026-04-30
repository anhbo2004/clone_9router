#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-.}"
cd "$ROOT"

if [ ! -f package.json ]; then
  echo "❌ Không thấy package.json. Hãy chạy trong thư mục repo 9router."
  exit 1
fi

mkdir -p src/lib
mkdir -p src/app/api/dashboard/token-limits/api-keys/[id]
mkdir -p src/app/dashboard/endpoint/components
mkdir -p scripts

BACKUP_DIR=".quota-patch-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "✅ Đang cài Token Limit patch vào: $(pwd)"
echo "📦 Backup file bị sửa vào: $BACKUP_DIR"

cat > src/lib/tokenQuotaStore.js <<'JS'
import crypto from "crypto"
import fs from "fs/promises"
import path from "path"

const DATA_DIR = process.env.TOKEN_QUOTA_DATA_DIR || process.cwd()
const DB_FILE = path.join(DATA_DIR, ".9router-token-quota.json")

const DEFAULT_DB = {
  apiKeys: [],
  usage: [],
  settings: {
    enabled: true,
    requireApiKey: false,
  },
}

export function generateApiKey() {
  return `sk-9r-${crypto.randomBytes(32).toString("base64url")}`
}

export function hashApiKey(secret) {
  return crypto.createHash("sha256").update(secret).digest("hex")
}

export function safePrefix(secret) {
  return secret.slice(0, 14)
}

async function ensureDbFile() {
  try {
    await fs.access(DB_FILE)
  } catch {
    await fs.writeFile(DB_FILE, JSON.stringify(DEFAULT_DB, null, 2), "utf8")
  }
}

export async function readQuotaDb() {
  await ensureDbFile()
  const raw = await fs.readFile(DB_FILE, "utf8")
  const db = JSON.parse(raw || "{}")
  db.apiKeys ||= []
  db.usage ||= []
  db.settings ||= DEFAULT_DB.settings
  return db
}

export async function writeQuotaDb(db) {
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8")
}

export function quotaWindowStart(window) {
  const now = new Date()
  const start = new Date(now)

  if (window === "rolling_5h") {
    start.setHours(start.getHours() - 5)
  } else if (window === "daily") {
    start.setHours(0, 0, 0, 0)
  } else if (window === "weekly") {
    const day = start.getDay() || 7
    start.setDate(start.getDate() - day + 1)
    start.setHours(0, 0, 0, 0)
  } else {
    start.setDate(1)
    start.setHours(0, 0, 0, 0)
  }

  return start.toISOString()
}

export function estimateTokens(payload) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload || "")
  return Math.max(1, Math.ceil(text.length / 4))
}

export async function listTokenApiKeys() {
  const db = await readQuotaDb()
  return db.apiKeys.map(({ hash, ...safe }) => safe)
}

export async function createTokenApiKey(input = {}) {
  const db = await readQuotaDb()
  const secret = generateApiKey()
  const now = new Date().toISOString()

  const key = {
    id: crypto.randomUUID(),
    name: input.name || "New API Key",
    prefix: safePrefix(secret),
    hash: hashApiKey(secret),
    enabled: input.enabled ?? true,
    allowedModels: Array.isArray(input.allowedModels) ? input.allowedModels : [],
    quota: {
      enabled: input.quota?.enabled ?? true,
      window: input.quota?.window || "monthly",
      maxInputTokens: Number(input.quota?.maxInputTokens || 0),
      maxOutputTokens: Number(input.quota?.maxOutputTokens || 0),
      maxTotalTokens: Number(input.quota?.maxTotalTokens || 1000000),
      action: input.quota?.action || "reject",
      fallbackModel: input.quota?.fallbackModel || "",
    },
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
  }

  db.apiKeys.push(key)
  await writeQuotaDb(db)

  const { hash, ...safe } = key
  return { ...safe, secret }
}

export async function updateTokenApiKey(id, patch = {}) {
  const db = await readQuotaDb()
  const key = db.apiKeys.find((item) => item.id === id)
  if (!key) return null

  if (typeof patch.name === "string") key.name = patch.name
  if (typeof patch.enabled === "boolean") key.enabled = patch.enabled
  if (Array.isArray(patch.allowedModels)) key.allowedModels = patch.allowedModels
  if (patch.quota) key.quota = { ...key.quota, ...patch.quota }
  key.updatedAt = new Date().toISOString()

  await writeQuotaDb(db)
  const { hash, ...safe } = key
  return safe
}

export async function deleteTokenApiKey(id) {
  const db = await readQuotaDb()
  const before = db.apiKeys.length
  db.apiKeys = db.apiKeys.filter((item) => item.id !== id)
  await writeQuotaDb(db)
  return db.apiKeys.length !== before
}

export async function findTokenApiKeyFromAuth(authHeader) {
  const secret = authHeader?.replace(/^Bearer\s+/i, "")?.trim()
  if (!secret) return null

  const db = await readQuotaDb()
  const hash = hashApiKey(secret)
  const key = db.apiKeys.find((item) => item.hash === hash && item.enabled)
  if (!key) return null

  key.lastUsedAt = new Date().toISOString()
  await writeQuotaDb(db)
  return key
}

export async function getTokenApiKeyUsage(apiKeyId, window = "monthly") {
  const db = await readQuotaDb()
  const since = quotaWindowStart(window)

  return db.usage
    .filter((row) => row.apiKeyId === apiKeyId)
    .filter((row) => new Date(row.createdAt) >= new Date(since))
    .reduce(
      (acc, row) => {
        acc.requests += 1
        acc.inputTokens += Number(row.inputTokens || 0)
        acc.outputTokens += Number(row.outputTokens || 0)
        acc.totalTokens += Number(row.totalTokens || 0)
        return acc
      },
      { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    )
}

export async function checkTokenQuota({ apiKey, body }) {
  if (!apiKey) return { allowed: false, status: 401, error: "Missing or invalid API key" }
  if (!apiKey.quota?.enabled) return { allowed: true }

  const model = body?.model || ""
  if (apiKey.allowedModels?.length && !apiKey.allowedModels.includes(model)) {
    return { allowed: false, status: 403, error: `Model ${model} is not allowed for this key` }
  }

  const estimatedInputTokens = estimateTokens(body?.messages || body?.input || body)
  const usage = await getTokenApiKeyUsage(apiKey.id, apiKey.quota.window)

  const projectedInput = usage.inputTokens + estimatedInputTokens
  const projectedTotal = usage.totalTokens + estimatedInputTokens

  const inputExceeded = apiKey.quota.maxInputTokens > 0 && projectedInput > apiKey.quota.maxInputTokens
  const totalExceeded = apiKey.quota.maxTotalTokens > 0 && projectedTotal > apiKey.quota.maxTotalTokens

  if (inputExceeded || totalExceeded) {
    return {
      allowed: false,
      status: 429,
      error: "API key token quota exceeded",
      usage,
      limit: apiKey.quota,
    }
  }

  return { allowed: true, usage, estimatedInputTokens }
}

export async function recordTokenUsage({ apiKeyId, model, provider, inputTokens = 0, outputTokens = 0, totalTokens }) {
  if (!apiKeyId) return null
  const db = await readQuotaDb()
  const row = {
    id: crypto.randomUUID(),
    apiKeyId,
    model: model || "unknown",
    provider: provider || "unknown",
    inputTokens: Number(inputTokens || 0),
    outputTokens: Number(outputTokens || 0),
    totalTokens: Number(totalTokens ?? (Number(inputTokens || 0) + Number(outputTokens || 0))),
    createdAt: new Date().toISOString(),
  }
  db.usage.push(row)
  await writeQuotaDb(db)
  return row
}
JS

cat > src/app/api/dashboard/token-limits/api-keys/route.js <<'JS'
import { NextResponse } from "next/server"
import { createTokenApiKey, getTokenApiKeyUsage, listTokenApiKeys } from "@/lib/tokenQuotaStore"

export async function GET() {
  const keys = await listTokenApiKeys()
  const enriched = await Promise.all(
    keys.map(async (key) => ({
      ...key,
      usage: await getTokenApiKeyUsage(key.id, key.quota?.window || "monthly"),
    }))
  )
  return NextResponse.json({ keys: enriched })
}

export async function POST(req) {
  const body = await req.json()
  const key = await createTokenApiKey(body)
  return NextResponse.json({ key, secret: key.secret, warning: "Secret is shown once. Save it now." })
}
JS

cat > src/app/api/dashboard/token-limits/api-keys/[id]/route.js <<'JS'
import { NextResponse } from "next/server"
import { deleteTokenApiKey, getTokenApiKeyUsage, updateTokenApiKey } from "@/lib/tokenQuotaStore"

export async function GET(req, { params }) {
  const id = params.id
  const url = new URL(req.url)
  const window = url.searchParams.get("window") || "monthly"
  const usage = await getTokenApiKeyUsage(id, window)
  return NextResponse.json({ usage })
}

export async function PATCH(req, { params }) {
  const body = await req.json()
  const key = await updateTokenApiKey(params.id, body)
  if (!key) return NextResponse.json({ error: "API key not found" }, { status: 404 })
  return NextResponse.json({ key })
}

export async function DELETE(_req, { params }) {
  const ok = await deleteTokenApiKey(params.id)
  if (!ok) return NextResponse.json({ error: "API key not found" }, { status: 404 })
  return NextResponse.json({ ok: true })
}
JS

cat > src/app/dashboard/endpoint/components/ApiKeyTokenLimits.jsx <<'JSX'
"use client"

import { useEffect, useMemo, useState } from "react"

function fmt(n) {
  return Number(n || 0).toLocaleString()
}

export default function ApiKeyTokenLimits() {
  const [keys, setKeys] = useState([])
  const [secret, setSecret] = useState("")
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    name: "",
    window: "monthly",
    maxTotalTokens: 1000000,
    maxInputTokens: 0,
    maxOutputTokens: 0,
    allowedModels: "",
  })

  async function load() {
    const res = await fetch("/api/dashboard/token-limits/api-keys", { cache: "no-store" })
    const data = await res.json()
    setKeys(data.keys || [])
  }

  useEffect(() => {
    load()
  }, [])

  async function createKey() {
    setLoading(true)
    try {
      const res = await fetch("/api/dashboard/token-limits/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name || "API Key",
          allowedModels: form.allowedModels
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          quota: {
            enabled: true,
            window: form.window,
            maxTotalTokens: Number(form.maxTotalTokens || 0),
            maxInputTokens: Number(form.maxInputTokens || 0),
            maxOutputTokens: Number(form.maxOutputTokens || 0),
            action: "reject",
          },
        }),
      })
      const data = await res.json()
      setSecret(data.secret || data.key?.secret || "")
      setForm({ ...form, name: "" })
      await load()
    } finally {
      setLoading(false)
    }
  }

  async function patchKey(id, patch) {
    await fetch(`/api/dashboard/token-limits/api-keys/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    await load()
  }

  async function deleteKey(id) {
    if (!confirm("Delete this API key?")) return
    await fetch(`/api/dashboard/token-limits/api-keys/${id}`, { method: "DELETE" })
    await load()
  }

  const totalUsed = useMemo(() => keys.reduce((s, k) => s + Number(k.usage?.totalTokens || 0), 0), [keys])

  return (
    <section className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950/70 p-5 text-neutral-100">
      <div className="mb-5 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-xl font-semibold">API Key Token Limits</h2>
          <p className="text-sm text-neutral-400">Giới hạn token theo từng API key. Tổng đã dùng: {fmt(totalUsed)} tokens.</p>
        </div>
        <button onClick={load} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm hover:bg-neutral-800">Refresh</button>
      </div>

      {secret ? (
        <div className="mb-5 rounded-xl border border-amber-600/40 bg-amber-500/10 p-4">
          <div className="font-medium text-amber-200">API key mới — chỉ hiển thị một lần</div>
          <code className="mt-2 block break-all rounded bg-black/40 p-3 text-sm text-amber-100">{secret}</code>
        </div>
      ) : null}

      <div className="mb-6 grid gap-3 md:grid-cols-6">
        <input className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 md:col-span-2" placeholder="Tên key, ví dụ: Team A" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2" type="number" placeholder="Total tokens" value={form.maxTotalTokens} onChange={(e) => setForm({ ...form, maxTotalTokens: e.target.value })} />
        <select className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2" value={form.window} onChange={(e) => setForm({ ...form, window: e.target.value })}>
          <option value="rolling_5h">Rolling 5h</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
        <input className="rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2" placeholder="Allowed models, cách nhau bằng dấu phẩy" value={form.allowedModels} onChange={(e) => setForm({ ...form, allowedModels: e.target.value })} />
        <button disabled={loading} onClick={createKey} className="rounded-lg bg-orange-600 px-4 py-2 font-semibold text-white hover:bg-orange-500 disabled:opacity-60">Create key</button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-neutral-800">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-neutral-900 text-neutral-300">
            <tr>
              <th className="p-3 text-left">Name</th>
              <th className="p-3 text-left">Prefix</th>
              <th className="p-3 text-left">Window</th>
              <th className="p-3 text-left">Used / Limit</th>
              <th className="p-3 text-left">Allowed Models</th>
              <th className="p-3 text-left">Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => {
              const used = Number(key.usage?.totalTokens || 0)
              const limit = Number(key.quota?.maxTotalTokens || 0)
              const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0
              return (
                <tr key={key.id} className="border-t border-neutral-800">
                  <td className="p-3 font-medium">{key.name}</td>
                  <td className="p-3 font-mono text-neutral-300">{key.prefix}...</td>
                  <td className="p-3">{key.quota?.window}</td>
                  <td className="p-3">
                    <div>{fmt(used)} / {limit ? fmt(limit) : "∞"}</div>
                    <div className="mt-1 h-2 rounded bg-neutral-800"><div className="h-2 rounded bg-orange-600" style={{ width: `${pct}%` }} /></div>
                  </td>
                  <td className="p-3 text-neutral-300">{key.allowedModels?.length ? key.allowedModels.join(", ") : "All"}</td>
                  <td className="p-3">{key.enabled ? <span className="text-green-400">Enabled</span> : <span className="text-red-400">Disabled</span>}</td>
                  <td className="space-x-2 p-3 text-right">
                    <button className="rounded bg-neutral-800 px-3 py-1 hover:bg-neutral-700" onClick={() => patchKey(key.id, { enabled: !key.enabled })}>{key.enabled ? "Disable" : "Enable"}</button>
                    <button className="rounded bg-red-700 px-3 py-1 hover:bg-red-600" onClick={() => deleteKey(key.id)}>Delete</button>
                  </td>
                </tr>
              )
            })}
            {!keys.length ? <tr><td colSpan={7} className="p-6 text-center text-neutral-400">Chưa có API key token-limit nào.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  )
}
JSX

cat > scripts/apply-token-quota-patch.mjs <<'MJS'
import fs from "fs"
import path from "path"

const root = process.cwd()
const backupDir = process.argv[2] || ".quota-patch-backup"
function exists(p) { return fs.existsSync(path.join(root, p)) }
function read(p) { return fs.readFileSync(path.join(root, p), "utf8") }
function write(p, c) { fs.writeFileSync(path.join(root, p), c) }
function backup(p) {
  const full = path.join(root, p)
  if (!fs.existsSync(full)) return
  const dest = path.join(root, backupDir, p.replace(/[\\/]/g, "__"))
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(full, dest)
}

function findFirst(candidates) { return candidates.find(exists) }

function patchEndpointPage() {
  const file = findFirst([
    "src/app/dashboard/endpoint/page.jsx",
    "src/app/dashboard/endpoint/page.tsx",
    "app/dashboard/endpoint/page.jsx",
    "app/dashboard/endpoint/page.tsx",
  ])
  if (!file) {
    console.log("⚠️ Không tìm thấy dashboard endpoint page. UI component đã được tạo, bạn có thể import thủ công.")
    return
  }

  let code = read(file)
  if (code.includes("ApiKeyTokenLimits")) {
    console.log("✅ Endpoint page đã có ApiKeyTokenLimits, bỏ qua.")
    return
  }
  backup(file)

  const importLine = `import ApiKeyTokenLimits from "./components/ApiKeyTokenLimits"\n`
  if (code.startsWith("\"use client\"")) {
    const idx = code.indexOf("\n") + 1
    code = code.slice(0, idx) + importLine + code.slice(idx)
  } else if (code.startsWith("'use client'")) {
    const idx = code.indexOf("\n") + 1
    code = code.slice(0, idx) + importLine + code.slice(idx)
  } else {
    code = importLine + code
  }

  const component = `\n      <ApiKeyTokenLimits />\n`
  if (code.includes("</main>")) {
    code = code.replace("</main>", `${component}    </main>`)
  } else {
    const idx = code.lastIndexOf("</div>")
    if (idx !== -1) code = code.slice(0, idx) + component + code.slice(idx)
    else console.log("⚠️ Không tìm được vị trí JSX tốt để chèn UI. Đã thêm import, cần chèn <ApiKeyTokenLimits /> thủ công.")
  }

  write(file, code)
  console.log(`✅ Đã chèn UI Token Limits vào ${file}`)
}

function patchChatRoute() {
  const candidates = [
    "src/app/api/v1/chat/completions/route.js",
    "src/app/api/v1/chat/completions/route.ts",
    "app/api/v1/chat/completions/route.js",
    "app/api/v1/chat/completions/route.ts",
  ]
  const file = findFirst(candidates)
  if (!file) {
    console.log("⚠️ Không tìm thấy route /v1/chat/completions. Middleware quota chưa được gắn vào route.")
    return
  }

  let code = read(file)
  if (code.includes("checkTokenQuota") || code.includes("recordTokenUsage")) {
    console.log("✅ Chat completions route đã có quota hook, bỏ qua.")
    return
  }
  backup(file)

  const importLine = `import { checkTokenQuota, estimateTokens, findTokenApiKeyFromAuth, recordTokenUsage } from "@/lib/tokenQuotaStore"\n`
  code = importLine + code

  // Try to inject after the first body parse. Supports common patterns.
  const hook = `\n  const __tokenQuotaApiKey = await findTokenApiKeyFromAuth(req.headers.get("authorization"))\n  const __tokenQuotaCheck = await checkTokenQuota({ apiKey: __tokenQuotaApiKey, body })\n  if (!__tokenQuotaCheck.allowed) {\n    return Response.json({ error: { message: __tokenQuotaCheck.error, type: "rate_limit_exceeded", usage: __tokenQuotaCheck.usage, limit: __tokenQuotaCheck.limit } }, { status: __tokenQuotaCheck.status || 429 })\n  }\n`

  const patterns = [
    /(const\s+body\s*=\s*await\s+req\.json\(\)\s*)/,
    /(let\s+body\s*=\s*await\s+req\.json\(\)\s*)/,
    /(const\s+json\s*=\s*await\s+req\.json\(\)\s*)/,
  ]
  let injected = false
  for (const re of patterns) {
    if (re.test(code)) {
      code = code.replace(re, `$1${hook}`)
      injected = true
      break
    }
  }

  if (!injected) {
    console.log("⚠️ Không thấy `const body = await req.json()`. Đã thêm import nhưng cần gắn hook thủ công theo README.")
  }

  // Best-effort usage record: insert before first Response.json success is too risky; create helper comment instead.
  const note = `\n/* TOKEN_QUOTA_USAGE_NOTE:\nAfter provider returns, call:\nawait recordTokenUsage({ apiKeyId: __tokenQuotaApiKey?.id, model: body?.model, provider, inputTokens, outputTokens })\nIf you cannot get exact tokens, use estimateTokens(body.messages) for inputTokens.\n*/\n`
  code += note

  write(file, code)
  console.log(`✅ Đã gắn quota pre-check vào ${file}`)
}

patchEndpointPage()
patchChatRoute()
MJS

node scripts/apply-token-quota-patch.mjs "$BACKUP_DIR"

cat > README_TOKEN_LIMIT_FULL_VI.md <<'MD'
# 9Router Token Limit Full Patch

Patch này thêm giới hạn token theo từng API key vào trang:

`http://localhost:20129/dashboard/endpoint`

## Chạy nhanh

```bash
cd 9router
bash setup-9router-token-limit.sh .
npm install
PORT=20129 NEXT_PUBLIC_BASE_URL=http://localhost:20129 npm run dev
```

Mở:

```txt
http://localhost:20129/dashboard/endpoint
```

## Cách dùng

1. Vào Dashboard → Endpoint.
2. Kéo xuống mục **API Key Token Limits**.
3. Nhập tên key.
4. Nhập `Total tokens`, ví dụ `1000000`.
5. Chọn window: `monthly`, `daily`, `weekly`, hoặc `rolling_5h`.
6. Bấm **Create key**.
7. Copy secret `sk-9r-...`.
8. Gọi API bằng key đó.

## Test bằng curl

```bash
curl http://localhost:20129/v1/chat/completions \
  -H "Authorization: Bearer sk-9r-PASTE_KEY_HERE" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "MODEL_CUA_BAN",
    "messages": [{"role":"user","content":"hello"}]
  }'
```

Nếu vượt quota sẽ trả `429`:

```json
{
  "error": {
    "message": "API key token quota exceeded",
    "type": "rate_limit_exceeded"
  }
}
```

## Dữ liệu lưu ở đâu?

Mặc định lưu tại:

```txt
.9router-token-quota.json
```

Có thể đổi bằng env:

```bash
TOKEN_QUOTA_DATA_DIR=/data PORT=20129 NEXT_PUBLIC_BASE_URL=http://localhost:20129 npm run dev
```

## Rollback

Script tự backup file cũ vào thư mục `.quota-patch-backup-*`.
Muốn rollback thì copy file trong backup đè lại file gốc.

## Lưu ý quan trọng

Script đã tự gắn quota pre-check vào route `/v1/chat/completions` nếu repo đang dùng path chuẩn:

```txt
src/app/api/v1/chat/completions/route.js
src/app/api/v1/chat/completions/route.ts
```

Nếu repo của bạn đổi cấu trúc, mở file route chat và thêm đoạn sau ngay sau khi parse body:

```js
const __tokenQuotaApiKey = await findTokenApiKeyFromAuth(req.headers.get("authorization"))
const __tokenQuotaCheck = await checkTokenQuota({ apiKey: __tokenQuotaApiKey, body })
if (!__tokenQuotaCheck.allowed) {
  return Response.json(
    { error: { message: __tokenQuotaCheck.error, type: "rate_limit_exceeded" } },
    { status: __tokenQuotaCheck.status || 429 }
  )
}
```

Và import ở đầu file:

```js
import { checkTokenQuota, findTokenApiKeyFromAuth, recordTokenUsage } from "@/lib/tokenQuotaStore"
```

Sau khi provider trả kết quả, ghi usage:

```js
await recordTokenUsage({
  apiKeyId: __tokenQuotaApiKey?.id,
  model: body?.model,
  provider,
  inputTokens,
  outputTokens,
})
```
MD

echo "✅ Cài xong. Chạy: PORT=20129 NEXT_PUBLIC_BASE_URL=http://localhost:20129 npm run dev"
echo "📘 Đọc thêm: README_TOKEN_LIMIT_FULL_VI.md"
