# Trình duyệt
triggers: mở trang | vào trang | xem trang | đọc trang | mở web | vào web | mở website | truy cập | mở link | mở liên kết | lên mạng | trên mạng | tìm trên | tìm kiếm trên | tìm kiếm web | tìm trên web | tra trên | tra cứu trên | tra cứu web | trên google | tìm google | trên youtube | tìm youtube | mở youtube | trên shopee | trên lazada | trên tiki | trên facebook | trên wikipedia | điền form | điền biểu mẫu | bấm vào | nhấn vào | duyệt web | lướt web | trình duyệt
confirm: yes
---
Sau khi người dùng xác nhận, app Tibo chạy trực tiếp `~/jev-ultrafast/scripts/agent_run.py` trên Chrome. Câu lệnh đã nói là mục tiêu; trang bắt đầu là YouTube, Wikipedia hoặc Google tuỳ câu lệnh.
Agent tự bấm, gõ và cuộn trong tối đa 90 giây. Kết quả `done` chỉ là lời model tự nhận: app mở trang cuối trong Chrome cho người dùng đối chiếu, không khẳng định đã hoàn tất giao dịch hay tìm đúng thông tin.
Không đăng nhập, thanh toán, đặt hàng, gửi tin nhắn, sửa hoặc xoá dữ liệu. Nếu Chrome hỏi “Allow remote debugging”, người dùng phải bấm Allow.
