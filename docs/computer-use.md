# Computer use hiện có

Tibo **không điều khiển desktop tuỳ ý**. Agent chỉ có các đường sau, và mọi thao tác có hậu quả đều cần bạn bấm **Cho phép** trong notch.

| Nhu cầu | Công cụ | Xác nhận | Giới hạn |
| --- | --- | --- | --- |
| Đọc / tìm / liệt kê file | `read_file`, `list_files`, `search_files` | Không | Chỉ trong workspace (mặc định `~/.local/share/tibo/workspace`). Không đọc `~/.ssh`, `~/.aws`, `Library/Keychains`, file `.env`, kể cả qua symlink. |
| Ghi file | `write_file` | Có | Trong workspace, ghi nguyên tử, tối đa 1 MB. |
| Chạy lệnh | `shell` | Có | Chạy với quyền của bạn, tối đa 120 giây mặc định; huỷ sẽ dừng cả cây tiến trình. **Không phải sandbox.** |
| Web | `web_fetch`, `web_search` | Không | Chỉ địa chỉ công khai; chặn loopback, mạng riêng, link-local (kiểm tra lại ở mỗi redirect). `web_search` trả khoảng 10 kết quả (tiêu đề, URL, đoạn trích). |
| Xem lịch, lời nhắc | `mac_read`: `calendar-list`, `reminders-list` | Không | Quyền Automation của macOS có thể được hỏi. |
| Thêm nhắc việc, lịch, ghi chú, hẹn giờ, nháp thư | `mac_write`: `reminders-add`, `calendar-add`, `notes-add`, `timer`, `mail-draft` | Có | Thư chỉ mở **nháp**. Hẹn giờ mất khi máy ngủ/tắt. |
| Bộ nhớ, skill | `memory`, `session_search`, `skills_read`, `skills_save` (danh mục skill nằm sẵn trong prompt) | `memory` và `skills_save` có | Xem README. |
| MCP | `mcp__<server>__<tool>` | Có, mỗi lần gọi | Server cấu hình trong `mcp.json`; chú thích “read-only” của server không thay thế xác nhận. |

Đọc màn hình là nút riêng trong notch: app chụp màn hình chính, OCR bằng Apple Vision rồi gửi văn bản (và ảnh nếu model hỗ trợ) vào một lượt hội thoại. Cần quyền **Ghi màn hình**; không bấm hay gõ.

Helper `workflows/mac.js` chạy qua `osascript -l JavaScript`; các file `workflows/*.md` là skill dạng văn bản mà agent đọc khi cần, không phải bộ định tuyến từ khoá chạy trước agent.

Quyền macOS và xác nhận trong Tibo **không phải sandbox**. Chỉ cho phép khi bạn hiểu lệnh hoặc nội dung được hiển thị trong hộp xác nhận.
