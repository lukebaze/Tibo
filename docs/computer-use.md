# Computer use hiện có

Tibo **không có agent điều khiển toàn bộ desktop tuỳ ý**. Có ba đường riêng: mở ứng dụng bằng macOS, đọc màn hình trong app, và chạy các workflow đã cấu hình. Chỉ workflow trình duyệt dùng Chrome để bấm/gõ/cuộn; `--computer-plan` chỉ là bộ chọn hành động cho chương trình khác.

| Nhu cầu / câu thử | Tibo làm gì | Điều kiện / giới hạn |
| --- | --- | --- |
| “Tibo, mở Safari” | Mở hoặc đưa ứng dụng có tên được nhận dạng ra trước bằng `open -a`. | Cần app Tibo; không tự mở URL hay thao tác bên trong app. Mở app đơn lẻ không hỏi phê duyệt. |
| “Tibo, trên màn hình đang có gì?”, “biểu đồ trong ảnh này nói gì?” | Chụp **màn hình chính**; OCR bằng Apple Vision; câu hỏi thị giác còn đính kèm ảnh cho agent hỗ trợ ảnh. | Cần quyền **Ghi màn hình**; chỉ có trong app, không có đường chụp của CLI/web. Đọc, không bấm/gõ. Claude Code chỉ nhận OCR, không nhận ảnh. |
| “Tibo, tìm kiếm web về trí tuệ nhân tạo”, “truy cập Wikipedia đọc bài này”, “mở link …” | Workflow `trinh-duyet`: sau một lần xác nhận, app gọi **Jev Ultrafast trực tiếp** để tìm, bấm, gõ, cuộn trên Chrome, rồi mở trang cuối cho bạn xem; Tibo chỉ nói tên trang, bạn tự đối chiếu kết quả. | **Hỏi Xác nhận/Huỷ trước khi chạy**, không cần xác nhận từng lần bấm. Cần `~/jev-ultrafast` cài được `uv run python scripts/agent_run.py`, khóa TypeSafe/text model trong `.env`, Chrome và quyền remote debugging nếu Chrome hỏi. Không đăng nhập, thanh toán, đặt hàng, gửi tin nhắn hay xoá; dừng trước những bước đó. Không có workflow phù hợp thì Tibo báo chưa hỗ trợ, không tự chạy agent GUI khác. |
| “Tibo, nhắc tôi 8 giờ gọi mẹ”, “xem lịch”, “ghi chú …”, “hẹn giờ 5 phút”, “soạn email …” | Workflow gọi helper macOS và lệnh mạng theo bảng dưới. | Quyền Automation của macOS có thể được hỏi khi thao tác Lời nhắc/Lịch/Ghi chú. Thư chỉ mở **nháp**, người dùng tự gửi. Hẹn giờ bằng tiến trình `sleep`, mất khi máy ngủ/tắt. |
| “Tibo, dịch đoạn vừa copy …” | Đọc clipboard, xử lý và chép bản dịch/bản sửa trở lại clipboard. | Có thể ghi đè clipboard; phần được đọc giới hạn 12.000 byte trong workflow mặc định. |

Trong lúc Chrome đang chạy, Tibo bỏ qua nhận giọng qua VAD để tiếng nền không huỷ ngang tác vụ; **bấm mic** nếu cần ngắt. Trình duyệt có giới hạn chạy 90 giây và được dừng sau 120 giây nếu runner mắc kẹt. Cấm thao tác nhạy cảm hiện là chỉ dẫn cho browser agent, **không phải sandbox kỹ thuật**: đừng xác nhận tác vụ trên trang có dữ liệu nhạy cảm.

## Các function đáng chú ý

Helper `workflows/mac.js` chạy qua `osascript -l JavaScript mac.js <command> [args...]`:

| Command | Tác dụng |
| --- | --- |
| `reminders-add`, `reminders-list` | Thêm / xem nhắc việc chưa hoàn thành trong Reminders. |
| `calendar-add`, `calendar-list` | Thêm sự kiện / xem lịch theo số ngày từ hôm nay trong Calendar. |
| `notes-add` | Lưu ghi chú vào Notes. |
| `timer` | Đếm ngược rồi hiển thị thông báo và đọc lời nhắn. |
| `mail-draft` | Mở cửa sổ soạn thư của app mail mặc định; **không gửi**. |

Các workflow còn có `ban-tin` (lịch + nhắc việc + thời tiết), `thoi-tiet` (wttr.in), `clipboard` (`pbpaste`/`pbcopy`) và `trinh-duyet` (Jev Ultrafast). Xem mẫu trong [`../workflows/`](../workflows/). Mẫu được chép sang `~/.local/share/tibo/workflows/` khi **thư mục chưa tồn tại**; sau đó Tibo đọc bản người dùng ở đó, nên sửa mẫu trong repo không tự ghi đè bản đã cài. Xoá riêng một file workflow sẽ tắt workflow ấy. Với `trinh-duyet`, sửa `triggers` để đổi câu gọi; body chỉ để hướng dẫn, runner tích hợp trong app và luôn yêu cầu xác nhận.

Luồng trong mã: `policy::decide` phân loại `computer_use` thành `OpenApp`, `ReadScreen` hoặc `UnsupportedComputerUse`; `workflow::find` chọn workflow theo trigger; `src/bin/tibo.rs` bắt xác nhận cho workflow `confirm: yes` **và luôn cho `trinh-duyet`**. `handlers::handle` phát `TIBO_NATIVE_ACTION` để app mở ứng dụng; `VoiceController.readScreen` xử lý ảnh/OCR; `VoiceController.startBrowser` chạy Jev Ultrafast trực tiếp cho workflow trình duyệt, các workflow khác chạy một lượt với công cụ bash qua `startAgent`. Yêu cầu đọc màn hình là một lượt riêng, không cấp bash. Nếu bộ định tuyến Jev lỗi, fallback chỉ nhận một số lệnh mở app/đọc màn hình rõ ràng; không tự chạy hành động GUI chưa được định nghĩa.

## `tibo --computer-plan` (tích hợp Jevcast, không phải điều khiển Tibo)

Đọc JSON `{"query":"mở Safari","candidates":[{"id":"open_safari","title":"Mở Safari","detail":"Đưa Safari ra trước"}]}` từ stdin; trả `{"id":"open_safari"}` hoặc `{"id":null}`. Chỉ chọn một ID đã cấp, **không chạy hành động, không nhấp chuột, không cấp quyền**. Cần `TYPESAFE_API_KEY`; câu hỏi và danh sách lựa chọn được gửi tới Jev. Đầu vào không hợp lệ hoặc Jev lỗi thì lệnh thất bại. Chương trình gọi (ví dụ Jevcast) tự giới hạn danh sách hành động và xin xác nhận trước khi thực thi. Xem thêm [README](../README.md#dùng-tibo-để-chọn-thao-tác-trong-jevcast).

Quyền macOS và xác nhận trong Tibo **không phải sandbox** cho CLI agent chạy workflow. Chỉ chấp thuận khi nội dung workflow và tác vụ phù hợp; tác vụ coding agent là luồng riêng, không phải computer use.
