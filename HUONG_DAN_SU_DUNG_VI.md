# Huong Dan Su Dung clone_9router (Ban Ca Nhan)

Tai lieu nay tap trung vao cach dung thuc te cho repo ca nhan `clone_9router`, bao gom cac chuc nang moi vua them.

## 1. Muc tieu nhanh

- Chay 9Router local o cong `20129`
- Ket noi provider de dung ngay trong Claude Code/Codex/Cursor/Cline
- Quan ly API key theo han muc token
- Test nhanh tung key khong can CLI
- Public trang tra cuu usage key khong can login
- Dang nhap Codex hang loat (multi account) bang Playwright + TOTP

## 2. Cai dat va chay

### Cach 1: Chay tu source (khuyen dung cho repo nay)

```bash
cp .env.example .env
npm install
PORT=20129 NEXT_PUBLIC_BASE_URL=http://localhost:20129 npm run dev
```

Production:

```bash
npm run build
PORT=20129 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20129 npm run start
```

URL mac dinh:
- Dashboard: `http://localhost:20129/dashboard`
- API OpenAI-compatible: `http://localhost:20129/v1`

### Dang nhap dashboard

- Mat khau lan dau lay tu `.env`:
  - `INITIAL_PASSWORD=123456` (mac dinh hien tai)

## 3. Ket noi tool code AI (Claude/Codex/Cursor/Cline)

Dat chung:
- Base URL: `http://localhost:20129/v1`
- API Key: copy trong Dashboard -> Endpoint
- Model: vd `kr/claude-sonnet-4.5` hoac ten combo

Codex CLI:

```bash
export OPENAI_BASE_URL="http://localhost:20129"
export OPENAI_API_KEY="your-9router-api-key"
codex "hello"
```

## 4. Huong dan chuc nang moi vua them

## 4.1 API Key Token Limits

Muc dich:
- Gioi han token theo tung API key (tong/input/output)
- Chia cua so quota: `rolling_5h`, `daily`, `weekly`, `monthly`
- Gioi han model duoc phep cho tung key

Duong dan:
- `http://localhost:20129/dashboard/endpoint`
- Khu vuc: `API Key Token Limits`

Cach dung:
1. Tao key moi hoac chon key co san.
2. Chon `quota window`.
3. Dat limit:
   - `total token limit`
   - `input token limit`
   - `output token limit`
4. (Tuy chon) Set `allowed models`.
5. Save.

Ket qua:
- Key vuot han muc se bi chan o API chat (tra loi quota exceeded).

## 4.2 Quick Test theo tung key (khong can CLI)

Muc dich:
- Test key ngay trong dashboard, check nhanh pass/fail
- Ghi nhan usage vao bang thong ke key

Cach dung:
1. Vao `API Key Token Limits`.
2. O dong key can test, bam `Quick test`.
3. Xem ket qua ngay tai UI.

Ket qua mong doi:
- Neu key hop le + con quota: pass
- Neu key bi disable/het quota/sai rule model: fail kem thong bao

## 4.3 Public API Key Usage Checker (khong can login)

Muc dich:
- Tra cuu nhanh tinh trang key tu ngoai dashboard

UI public:
- `http://localhost:20129/landing/key-usage`

API public:
- `GET /api/public/key-usage?apiKey=sk-...`

Thong tin tra ve:
- Trang thai key (enabled/disabled)
- Quota window + moc bat dau
- Usage input/output/total
- So token con lai
- Co vuot han muc hay chua

Vi du:

```bash
curl "http://localhost:20129/api/public/key-usage?apiKey=sk_xxx"
```

## 4.4 Bulk Codex Auto Login (nhieu tai khoan)

Muc dich:
- Dang nhap nhieu account Codex mot lan
- Tu dong hoa browser + TOTP 2FA

Vi tri:
- Dashboard -> Providers -> `Bulk Codex Auto Login`

Input format:
- Moi dong 1 account: `email | password | 2fa_secret`

Vi du:
- `user1@example.com | pass123 | ABCDEFGHIJKLMNOP`
- `user2@example.com | pass456 | QWERTYUIOPASDFGH`

Ket qua:
- Hien trang thai tung dong: `OK` / `FAIL`

Luu y:
- Neu gap CAPTCHA/challenge nang thi co the fail, can retry thu cong account do.

## 5. Quy trinh khuyen nghi de dung hang ngay

1. Connect it nhat 1 provider free (Kiro/OpenCode Free).
2. Tao 1 combo fallback (Subscription -> Cheap -> Free).
3. Tao API key rieng cho tung tool/nhom cong viec.
4. Bat token limits de tranh dot ngot vuot quota.
5. Dung Quick test sau moi lan doi rule.
6. Khi can chia se tinh trang key, dung trang public key-usage.

## 6. Troubleshooting nhanh

- Dashboard khong dung cong:
  - Dam bao `PORT=20129`
  - Dam bao `NEXT_PUBLIC_BASE_URL=http://localhost:20129`

- Login khong vao duoc:
  - Kiem tra `INITIAL_PASSWORD` trong `.env`

- Khong thay log request:
  - Set `ENABLE_REQUEST_LOGS=true`

- API bi chan bat ngo:
  - Kiem tra token limits cua key
  - Kiem tra key co bi disable hoac bi gioi han model khong

## 7. Ghi chu cho repo ca nhan nay

- File `.9router-token-quota.json` la du lieu runtime local, khong bat buoc push.
- Neu deploy public, nen bat:
  - `REQUIRE_API_KEY=true`
  - `AUTH_COOKIE_SECURE=true` (khi chay sau HTTPS reverse proxy)
