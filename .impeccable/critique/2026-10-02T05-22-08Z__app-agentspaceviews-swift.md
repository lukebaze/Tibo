---
target: Tibo notch UI
total_score: 26
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
target_identity: "file:/Users/hieuho/Tibo/app/AgentSpaceViews.swift"
target_fingerprint: "sha256:20683499091674db66a03f6fe64fede7cfdb15474532f2354fdc0f68a143d8fe"
target_path: /Users/hieuho/Tibo/app/AgentSpaceViews.swift
timestamp: 2026-10-02T05-22-08Z
slug: app-agentspaceviews-swift
closed: true
---
# Critique: Tibo notch UI (app/AgentSpaceViews.swift + app/TiboApp.swift, onboarding nhẹ)

## Design Health Score
| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | "Đang suy nghĩ…" lặp ở header và timeline; spinner bước công cụ vẫn quay khi câu trả lời đã stream |
| 2 | Match System / Real World | 3 | Lỗi runtime tiếng Anh lọt ra ("HTTP 403: Forbidden", "API key") |
| 3 | User Control and Freedom | 3 | Xoá qua context menu không xác nhận; Lịch sử/Phiên mới bị khoá khi bận |
| 4 | Consistency and Standards | 2 | Cam vs xanh hệ thống (checkbox duyệt, nút onboarding); accent dùng trang trí; bán kính 8/10/12/14/18 không hệ thống |
| 5 | Error Prevention | 2 | "Nhớ lệnh này" bật sẵn; `rm -rf X` → tin mọi lệnh `rm` |
| 6 | Recognition Rather Than Recall | 3 | Esc/⌘↩ chỉ nằm trong tooltip |
| 7 | Flexibility and Efficiency | 3 | Không xếp hàng yêu cầu tiếp khi đang chạy |
| 8 | Aesthetic and Minimalist Design | 3 | Dải gọn, nhưng thẻ duyệt + composer chen nhau trong 200 pt |
| 9 | Error Recovery | 2 | Banner lỗi 11 pt đỏ trên nền đỏ, không có nút sửa |
| 10 | Help and Documentation | 2 | Onboarding nói "Ba bước bắt buộc" nhưng đếm 1/7 |
| **Total** | | **26/40** | **Acceptable** |

## Design Specificity Verdict
Vỏ (pill quanh camera, cánh trái mặt Taby, cánh phải trạng thái, glow kiểu Siri, ToolPresentation tiếng Việt) được thiết kế riêng cho Tibo. Phần thân dưới dải menu là chat chung chung: bong bóng xám căn phải, hàng chip, composer viên thuốc, bất kỳ "ChatGPT for Mac" nào cũng dùng được. Mặt Taby, chữ ký duy nhất của sản phẩm, bị nhốt trong một ô đen 48×24 pt trông như dải che thông tin, và không phản ứng với lúc xong việc hay lúc lỗi (`.sleeping` khai báo nhưng không dùng).
Detector: `impeccable detect` trên 3 tệp Swift trả `[]`, exit 0. Detector chỉ hiểu markup web nên kết quả sạch không chứng minh chất lượng; mọi phát hiện dưới đây đến từ ảnh chụp và mã nguồn.

## Priority Issues
- **[P1] Thẻ duyệt mặc định tin cả họ lệnh** — `@State remember = true` (AgentSpaceViews.swift:357); runtime nhớ tiền tố tới cờ đầu tiên (tibo_agent_tools.py:242-251) nên duyệt `rm -rf ~/x` một lần = tự cho phép mọi `rm`. Fix: mặc định tắt, ghi rõ phạm vi ("Luôn cho phép `rm`"), không cho nhớ động từ phá huỷ.
- **[P1] Lúc duyệt, dải 200 pt bị chen**: timeline + thẻ 4 dòng + composer vẫn sống (placeholder "đang làm việc", nút dừng). Bong bóng của người dùng bị cắt mất dấu. Fix: thay composer bằng thẻ duyệt khi đang chờ; dải cao theo nội dung.
- **[P2] Lỗi khó đọc, không có đường sửa**: caption 11 pt đỏ trên nền đỏ 12% (AgentSpaceViews.swift:133-141), lỗi công cụ tiếng Anh thô (:73, :323). Fix: chữ body màu text, chỉ icon đỏ; nút "Mở Cài đặt"; dịch lỗi HTTP phổ biến.
- **[P2] Markdown và mép cuộn**: danh sách hiện dấu "- " thô, dòng trống phí chỗ (:290); nội dung cắt cứng dưới header và trên composer, ToolStack chỉ còn 3 vệt. Fix: render khối danh sách; mép cuộn mờ.
- **[P2] Mặt Taby không kể kết quả**: không vui khi xong, không lo khi lỗi, không ngủ khi rảnh (TiboApp.swift:609-617). Mặt thu gọn chỉ ~30×18 pt.

## Persona Red Flags
- **Alex (power user)**: không gửi tiếp/mở lịch sử khi đang chạy; ⌘↩/Esc chỉ ở tooltip; onboarding 7 trang không có Bỏ qua.
- **Sam (VoiceOver / thị lực kém)**: trạng thái, lỗi, đích công cụ đều 11 pt; lỗi đỏ trên đỏ; checkbox "Nhớ lệnh này" không đọc phạm vi thật.
- **Jordan (lần đầu)**: icon header không nhãn; trang Model đầy thuật ngữ; placeholder endpoint trông như đã điền rồi lại báo lỗi.

## Minor Observations
- Dòng phiên đang mở trong Lịch sử nhỏ hơn các dòng khác (11 pt đậm vs 13 pt, :469); 6 icon bút/thùng rác luôn hiện.
- Hàng chip lệch trái, 4 chip (DESIGN.md nói 3), icon cam trang trí (:537), "Đính kèm tệp" lặp menu +.
- Banner lỗi rộng hết dải trong khi câu trả lời giới hạn 540 pt.
- Onboarding: "Xin chào!" phạm quy tắc không dấu chấm than; nút chính xanh hệ thống thay vì cam Taby.
- Pill không notch: thanh đen 250 pt, mặt nhỏ ở trái, cánh phải trống.

## Questions to Consider
- Nếu mặt Taby là chữ ký, sao nó là sticker 48×24 trong khi danh sách bong bóng chiếm cả dải?
- Duyệt mới là sản phẩm chứ không phải chat: có nên để nó sống ngay trong dải menu (✋ + lệnh + ⌘↩)?
- Checkbox "Nhớ lệnh này" bật sẵn phục vụ ai khi lệnh đầu tiên được nhớ là `rm`?
