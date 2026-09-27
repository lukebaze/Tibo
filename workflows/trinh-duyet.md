# Trình duyệt
triggers: mở trang | vào trang | mở web | vào web | mở website | lên mạng | trên mạng | tìm trên | tra trên | trên google | trên youtube | mở youtube | trên shopee | trên lazada | trên tiki | trên facebook | trên wikipedia | điền form | điền biểu mẫu | bấm vào | nhấn vào | duyệt web | trình duyệt
---
Thao tác trên Chrome thật của người dùng bằng Jev Ultrafast (tự bấm, gõ, cuộn tới khi xong mục tiêu):
cd ~/jev-ultrafast && uv run python scripts/agent_run.py --url "<trang bắt đầu>" --goal "<mục tiêu hẹp, viết bằng tiếng Anh>" --budget 90 --json
Trang bắt đầu: trang người dùng nói; tìm kiếm chung thì https://www.google.com; video thì https://www.youtube.com. Mỗi lượt chỉ chạy một lệnh (một tab, một daemon); nhiều bước thì lặp lại --goal theo thứ tự trong cùng lệnh.
Kết quả là JSON {ok, status, final_url, page_title, error}. "done" chỉ là lời model tự nhận: đối chiếu final_url và page_title với mục tiêu trước khi nói đã xong. Lỗi hoặc "blocked" thì nói ngắn gọn chưa làm được và lý do trong error.
Cần đọc nội dung trang để trả lời (giá, kết quả, thông tin) thì sau khi chạy xong đọc thêm: curl -sL -m 10 -A 'Mozilla/5.0' "<final_url>" | textutil -stdin -format html -convert txt -stdout | tr -s '[:space:]' ' ' | head -c 6000
Không bao giờ đăng nhập, thanh toán, đặt hàng, gửi tin nhắn hay xoá gì trong trình duyệt; dừng ở bước ngay trước đó và bảo người dùng tự bấm. Nếu Chrome hỏi "Allow remote debugging", bảo người dùng bấm Allow rồi thử lại.
