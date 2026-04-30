<div align="center">
  <img src="./images/arouter.png" alt="Arouter Dashboard" width="800"/>
  
  # Arouter - Personal AI Router

  **Router AI cá nhân đơn giản, giúp quản lý key, quota, provider và tự động chuyển đổi thông minh.**

  Dành cho developer muốn dùng AI ổn định, tiết kiệm chi phí và không bị gián đoạn.

  [![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
  
  [🚀 Quick Start](#-quick-start) • [✨ Tính năng](#-tính-năng) • [📦 Repo](https://github.com/anhbo2004/arouter)

  [🇻🇳 Tiếng Việt](./i18n/README.vi.md)
</div>

---

## 🚀 Quick Start

1. Cài đặt nhanh:
   ```bash
   npm install -g arouter
   arouter

Dashboard sẽ mở tại: http://localhost:20129
Kết nối provider miễn phí (không cần đăng ký):
Vào Providers → Chọn Kiro AI hoặc OpenCode Free → Connect.

Sử dụng ngay trong Claude Code, Cursor, Cline, OpenClaw…:
Endpoint: http://localhost:20129/v1
API Key: copy từ dashboard
Model: kr/claude-sonnet-4.5


Xong. Bạn đã có AI chạy ổn định.

✨ Tính năng

Tiết kiệm token: Tự động nén nội dung tool output (git diff, grep, ls…) trước khi gửi LLM
Tự động fallback: Chuyển giữa subscription → cheap → free mà không bị dừng
Quản lý API Key: Tạo key riêng với giới hạn token, quota window, quick test ngay trong dashboard
Bulk login: Thêm nhiều tài khoản Codex một lúc bằng file text
Theo dõi quota: Xem realtime usage và remaining quota
Public key checker: Kiểm tra tình trạng key mà không cần đăng nhập
Tương thích rộng: Hoạt động với Claude Code, Cursor, Cline, OpenClaw, Continue, Roo, Codex…


🌐 Providers được hỗ trợ
Miễn phí (khuyến nghị bắt đầu)

Kiro AI (Claude 4.5 + GLM-5 unlimited)
OpenCode Free (không cần auth)
Vertex AI ($300 credits)

Giá rẻ

GLM, MiniMax, Kimi, SiliconFlow…

Subscription

Claude Code, Codex, GitHub Copilot, Cursor

Hơn 40 provider khác qua API key (OpenRouter, Groq, Anthropic, OpenAI…).

📖 Hướng dẫn nhanh
Chạy từ source
Bashcp .env.example .env
npm install
PORT=20129 npm run dev
Production
Bashnpm run build
PORT=20129 HOSTNAME=0.0.0.0 npm run start
Dashboard: http://localhost:20129
API endpoint: http://localhost:20129/v1

❓ Câu hỏi thường gặp
Dashboard hiển thị chi phí cao nhưng tôi dùng free?
Đó chỉ là số liệu tham khảo để bạn thấy mình tiết kiệm được bao nhiêu. Thực tế bạn không mất tiền nếu dùng provider free.
Arouter có thu phí không?
Hoàn toàn miễn phí. Bạn chỉ trả tiền cho provider (nếu dùng gói trả phí).
Free provider có giới hạn không?
Kiro AI và OpenCode Free hiện tại là unlimited.

📄 License
MIT License - xem file LICENSE.


  Built for developers who just want to code without hassle.
