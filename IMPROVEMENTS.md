# Tibo: checklist cải thiện (học từ Taby, 27/09)

Nguồn: dùng thử Taby app 1.0.11 và repo TRIIIS-LABS/firmware-taby. Xem thêm `/tmp/tibo-taby-handoff.md`.

## Mặt (BuddyFace)
- [ ] Chạy `./build.sh` rồi xem mặt Taby trên notch thật: idle, nghe, xử lý, nói, hành động ngẫu nhiên.
- [ ] Trạng thái xử lý: chọn giữa `claude_in/loop` (hiện tại) và phù thủy `working_in/loop` (Taby dùng cái này).
- [ ] Thêm trạng thái "đang chuyển giọng thành chữ" riêng (Taby dùng mặt nhắm mắt), khác với "đang xử lý".
- [ ] Gắn clip theo sự kiện: mở app xong → `thumbs_up`, lỗi → `disappointed`, ngồi không lâu → `sleeping_loop`.
- [ ] Đo CPU của `FacePlayer` trên app thật (ước tính khoảng 1–2%).

## Notch
- [x] Thời gian giữ chuột trước khi mở theo từng loại app: app thường mở ngay, trình duyệt 0,5 s, game hoặc app toàn màn hình 0,8 s. Hiện Tibo mở ngay khi chuột vào vùng notch (nới thêm 6 px).
- [x] Cho chỉnh độ rộng vùng kích hoạt và thời gian tự thu lại (đang cố định 1,2 s), kèm nút "Hiện vùng hover".
- [x] Chọn vị trí notch: Trái / Giữa / Phải.
- [x] Hiện lỗi ngay trong placeholder của ô nhập (vd "Tibo chưa nghe rõ, thử lại"), thay cho caption.
- [x] Ô nhập co theo chiều rộng notch; placeholder ngắn để không đè lên nút lệnh và mic.
- [x] Thêm menu grid hoặc lệnh `/` cho các tác vụ hay dùng.

## Onboarding
- [~] Tải model **chạy ngầm**, nút Tiếp hiện %: xong cho Whisper (tự tải bản đề xuất nếu máy chưa có). Kokoro voicepack và VietASR chưa có nguồn tải công khai ổn định nên chưa làm.
- [x] Gợi ý cỡ model Whisper theo RAM và ổ trống của máy.
- [x] Bắt người dùng làm thử một lần: hover notch, nói "Tibo" rồi xem mặt phản ứng.
- [x] Màn tổng kết: model, mic, giọng đọc, từ gọi, vị trí.
- [x] Bước cuối điền sẵn một câu lệnh mẫu tiếng Việt, bấm là chạy.

## Giọng nói
- [x] Ngoài wake word, thêm chế độ **bấm mic → tự gửi khi ngừng nói** (Smart) và **bấm để bắt đầu / bấm lại để gửi**.
- [x] Tách hai công tắc "Cho Tibo nói" và "Đọc to mọi câu trả lời".
- [x] Hiện rõ trạng thái "Đang nghe… ngừng nói để gửi" và "Đang chuyển thành chữ…".
- [~] Model tải về nằm ở `~/.local/share/tibo/models/whisper-<cỡ>/<revision>/`, kèm LICENSE: xong cho Whisper. Kokoro và VietASR vẫn ở đường dẫn cũ, chưa có version.

## Tích hợp
- [ ] (Tuỳ chọn) REST/MCP chỉ nghe trên localhost, có token và phân quyền, để agent khác điều khiển Tibo.
- [ ] (Tuỳ chọn) Mặt Tibo trên board ESP32 qua USB serial theo protocol `TABY:`: `voice_listening` / `voice_talking` / `tool_use` / `ambient_idle`.

## Pháp lý
- [ ] Artwork Taby chỉ dùng cá nhân. Trước khi phát hành Tibo phải thay bằng hình tự vẽ (xem `app/taby/LICENSE`).
