# Bản tin hôm nay
triggers: bản tin | tóm tắt hôm nay | hôm nay có gì | hôm nay tôi có gì | chào buổi sáng | lịch hôm nay | kế hoạch hôm nay | việc hôm nay
---
Tóm tắt ngày hôm nay cho người dùng. Chạy song song trong một lệnh bash:
{mac} calendar-list 1; echo ---; {mac} reminders-list; echo ---; curl -s -m 6 -A curl 'https://wttr.in/?format=%l:+%C,+%t&lang=vi'
Nói tối đa ba câu: thời tiết, các lịch còn lại trong ngày (giờ + tên), rồi nhắc việc đến hạn hôm nay hoặc quá hạn. Bỏ qua mục trống, không đọc nhắc việc không hạn trừ khi chẳng còn gì khác.
