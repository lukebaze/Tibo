// Narration per scene. `npm run voice` turns each line into public/vo/<id>.wav (macOS voice "Linh")
// and writes the measured lengths to src/durations.json, which sets every scene's length.
export const SCRIPT = [
	{id: 'intro', text: 'Xin chào, mình là Tibo. Trợ lý giọng nói sống ngay trên notch của Mac.'},
	{id: 'voice', text: 'Chỉ cần gọi Tibo. Tibo biết khi nào bạn nói xong, và bạn có thể ngắt lời bất cứ lúc nào.'},
	{id: 'notch', text: 'Rê chuột lên notch để mở. Gõ câu hỏi, hoặc gõ dấu gạch chéo để dùng lệnh nhanh.'},
	{id: 'apps', text: 'Mở ứng dụng tức thì, không cần chờ.'},
	{id: 'agents', text: 'Giao việc lập trình cho pi, omp, Claude Code hay Codex. Tibo hỏi bạn trước khi chạy, rồi báo lại kết quả.'},
	{id: 'screen', text: 'Hỏi về màn hình: lỗi này nghĩa là gì, tóm tắt trang này. Tibo đọc chữ, và nhìn cả hình khi cần.'},
	{id: 'control', text: 'Tibo điều khiển máy tính thay bạn, và luôn xin phép trước khi bấm.'},
	{id: 'local', text: 'Nhận giọng nói chạy ngay trên máy, hiểu lệnh trong chưa tới nửa giây.'},
	{id: 'onboarding', text: 'Cài đặt trong vài bước: chọn model, micro, giọng đọc và vị trí notch.'},
	{id: 'recap', text: 'Tóm lại, Tibo nghe, hiểu, nhìn, và làm việc cùng bạn.'},
	{id: 'outro', text: 'Tibo ơi, bắt đầu thôi!'},
] as const;

export type SceneId = (typeof SCRIPT)[number]['id'];
