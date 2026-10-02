<p align="center">
  <img src=".github/readme-hero.svg" width="100%" alt="Tibo, trợ lý giọng nói ở notch Mac">
</p>

# Tibo

Tibo là một agent chạy ngay ở notch Mac. Bạn gõ hoặc nói; Tibo tự gọi model,
dùng công cụ, nhớ việc lâu dài và hỏi xác nhận trước khi làm điều có hậu quả.
Giọng nói là lớp tuỳ chọn: mic tắt vẫn dùng được đầy đủ bằng bàn phím.

Trang này giúp bạn **build từ mã nguồn và thử câu đầu tiên**. Kiến trúc và
ranh giới an toàn nằm ở [Tibo Agent](docs/agent-architecture.md).

## Trước khi bắt đầu

- Mac có Xcode Command Line Tools, Rust/Cargo và `python3` (chỉ dùng thư viện
  chuẩn). Chưa có Command Line Tools: `xcode-select --install`.
- Một endpoint tương thích OpenAI chat-completions (dịch vụ từ xa hoặc model
  chạy local), tên model và API key.
- [`build.sh`](build.sh) **thay** `~/Applications/Tibo.app`, chép `tibo` vào
  `~/.local/bin/` và tạo `dist/Tibo.dmg`.

## 1. Build

```sh
git clone https://github.com/lukebaze/Tibo.git
cd Tibo
mkdir -p "$HOME/Applications" "$HOME/.local/bin"
./build.sh
open Tibo.app
```

## 2. Thiết lập

Thiết lập lần đầu có ba bước bắt buộc: tên của bạn, model và thử notch. Mọi
thứ khác nằm ở bước **Tùy chỉnh** (bấm Tiếp để bỏ qua) và trong Cài đặt:

1. **Hồ sơ & tính cách**: tên bạn, tên trợ lý, xưng hô (mình – bạn, em – anh…
   hoặc tự đặt), độ dài và giọng điệu câu trả lời, hướng dẫn riêng (tối đa
   2.000 ký tự) và trí nhớ. Tất cả đi vào prompt của agent.
2. **Model**: chọn nhà cung cấp có sẵn (OpenAI, OpenRouter, Gemini, Groq,
   opencode Go, Ollama, LM Studio) hoặc nhập endpoint tương thích OpenAI
   (HTTPS, hoặc HTTP chỉ với localhost). **Tải danh sách model** đọc
   `/models`; **Kiểm tra kết nối** gửi một câu ngắn tới model đã chọn. Key lưu
   trong Chuỗi khóa của macOS, không ghi vào `profile.json` hay lịch sử hội
   thoại.
3. **Notch & phím tắt**: vị trí, thời gian tự thu, phím tắt mở notch (mặc định
   ⌃⌥Space) và tối đa hai gợi ý nhanh trên notch trống.
4. **Quyền của agent**: bật/tắt shell, web, ghi file, ứng dụng Mac và MCP; nhóm
   đã tắt không được đưa cho model và runtime từ chối nếu bị gọi. Chọn thư mục
   làm việc bằng Finder.
5. **Giọng nói** (tuỳ chọn): chọn Apple Speech và giọng hệ thống để bắt đầu
   nhanh. Whisper và Kokoro chỉ dùng được khi đã cài model.
6. **Quyền hệ thống**: Microphone/Speech nếu muốn nói; Ghi màn hình chỉ khi dùng
   đọc màn hình.

## 3. Thử một câu

Bấm vào notch (hoặc ⌃⌥Space) để mở, gõ “đọc smoke-note.txt trong
workspace” hoặc bật mic và nói “Tibo, chào bạn”. Notch hiện câu trả lời, các
lần gọi công cụ và hộp xác nhận. Thu gọn notch hay tắt mic **không** dừng tác
vụ; chỉ nút **Dừng** mới dừng.

Kéo tệp, thư mục, ảnh hoặc link vào notch (hoặc bấm **+** → Đính kèm) rồi gõ yêu
cầu, hoặc nhấn Return để Tibo xem nhanh. Thả xong Tibo **chưa gửi gì**; nội dung
chỉ đi tới model khi bạn gửi.

## Tibo làm được gì

- **Công cụ trong workspace**: đọc, liệt kê, tìm và ghi file. Workspace mặc
  định là `~/.local/share/tibo/workspace`, không phải thư mục home; đổi trong
  Cài đặt › Quyền của agent. Không đọc được `~/.ssh`, `~/.aws`, Keychains và
  file `.env`.
- **Shell và MCP**: chạy lệnh và gọi MCP server cấu hình trong
  `~/.local/share/tibo/mcp.json`. Mỗi lần gọi đều hỏi xác nhận, trừ một lệnh chỉ
  đọc đứng riêng: `pgrep`, `dig`, `which`… hoặc `ls`, `cat`, `grep`… trên file
  trong workspace (không pipe, chuyển hướng hay nối lệnh).
- **Nhớ quyền**: khi Tibo xin phép chạy lệnh, ô “Lần sau tự chạy …” mặc định
  **tắt** và ghi đúng phần sẽ được nhớ: phần đầu của lệnh, tới tham số đầu tiên.
  Tick rồi cho phép thì phần đó được lưu vào `~/.local/share/tibo/trusted.json`,
  lần sau chạy không hỏi lại. Lệnh xoá, di chuyển, đổi quyền, `sudo`, trình
  thông dịch, `curl`, `git`… không bao giờ được nhớ, và lệnh có nối, pipe hay
  chuyển hướng luôn hỏi lại. Xem và bỏ từng mục trong Cài đặt → Model → “Lệnh
  đã nhớ”.
- **Trình duyệt**: workflow `trinh-duyet.md` chạy `~/jev-ultrafast`. Khi Chrome
  hỏi “Allow remote debugging?”, Tibo tự chạy `browser-harness mac-approve` rồi
  thử lại, không nhờ bạn bấm. Tab của runner bị đóng khi lượt chạy kết thúc, nên
  nhạc/video được mở lại bằng `open` trong trình duyệt của bạn.
- **Web**: `web_fetch` và `web_search`; chỉ tới địa chỉ công khai, chặn
  loopback, mạng riêng và link-local.
- **Bộ nhớ**: `USER.md` và `MEMORY.md` giới hạn nhỏ, chụp một lần khi bắt đầu
  phiên; tool `memory` thêm/sửa/xoá có xác nhận. Tắt “bộ nhớ” trong Cài đặt thì
  không có tool và không chèn gì vào prompt. `session_search` tìm lại các phiên cũ.
- **Skill**: file Markdown trong `workflows/` và `~/.local/share/tibo/skills/`;
  tên và dòng đầu của từng skill nằm trong prompt, nội dung đọc khi cần.
- **Mac**: `mac_read` (xem lịch, lời nhắc) không hỏi; `mac_write` (thêm nhắc
  việc, lịch, ghi chú, hẹn giờ, nháp thư) hỏi xác nhận. Xem
  [Computer use hiện có](docs/computer-use.md).
- **Tệp đính kèm**: notch trích chữ từ text, PDF, Word/RTF/OpenDocument, OCR ảnh
  và danh sách thư mục (tối đa 10 mục, 30.000 ký tự mỗi tệp, 60.000 ký tự mỗi
  lượt); ảnh còn được gửi dạng JPEG cho model có vision. Tibo chỉ đọc đúng mục
  bạn đưa, không được quyền duyệt ngoài workspace. Đọc màn hình đi cùng đường này.

Phiên mới tự mở sau khoảng 4 giờ không hoạt động hoặc khi sang ngày mới. Mở lại
app khôi phục hội thoại nhưng không chạy lại hành động nào.

## An toàn

Xác nhận trong Tibo và quyền macOS **không phải sandbox**: shell và MCP chạy với
quyền của bạn. Model từ xa nhận hội thoại, nội dung tệp đính kèm và kết quả công
cụ. Từ chối hoặc hết hạn xác nhận thì hành động không chạy.

## Phát triển

- `python3 -m unittest discover -s scripts` chạy test của runtime.
- `cargo test` chạy test phần âm thanh/giọng (`src/`: audio, tts, profile);
  `tibo` chỉ còn `--doctor`, `--transcribe`, `--tts-server`, `--say`.
- [Brandkit](.github/tibo-brandkit.webp) và [icon](app/icon.svg) là định hướng
  hình ảnh. Ảnh động ở `app/taby/` là artwork của Taby; xem
  [điều khoản và ghi công](app/taby/LICENSE).
