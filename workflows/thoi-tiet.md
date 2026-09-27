# Thời tiết
triggers: thời tiết | trời mưa | có mưa | nhiệt độ | nóng không | lạnh không | mang ô | mang áo mưa | dự báo | weather
---
Lấy thời tiết (bỏ trống thành phố để dùng vị trí hiện tại, hoặc dùng thành phố người dùng nói, viết không dấu, thay khoảng trắng bằng +):
Hiện tại: curl -s -m 6 -A curl 'https://wttr.in/<thành phố>?format=%l:+%C,+%t,+độ+ẩm+%h,+gió+%w&lang=vi'
Dự báo 3 ngày: curl -s -m 6 -A curl 'https://wttr.in/<thành phố>?format=j1' | head -c 6000
Trả lời một câu tự nhiên; nếu hỏi có mưa hay mang ô thì trả lời thẳng có hoặc không trước.
