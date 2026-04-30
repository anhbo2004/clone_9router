# 9Router Token Limit Full Patch

Patch nay them gioi han token theo tung API key vao trang:

`http://localhost:20129/dashboard/endpoint`

## Chay nhanh

```bash
cd 9router
npm install
PORT=20129 NEXT_PUBLIC_BASE_URL=http://localhost:20129 npm run dev
```

Mo:

```txt
http://localhost:20129/dashboard/endpoint
```

## Du lieu luu o dau?

Mac dinh luu tai:

```txt
.9router-token-quota.json
```

Co the doi bang env:

```bash
TOKEN_QUOTA_DATA_DIR=/data PORT=20129 NEXT_PUBLIC_BASE_URL=http://localhost:20129 npm run dev
```

