<p align="center">
  <img src=".github/readme-hero.svg" width="100%" alt="Tibo, trợ lý giọng nói ở notch Mac">
</p>

# Tibo

Tibo là trợ lý giọng nói ở notch Mac. Bạn có thể gõ hoặc nói để hỏi đáp, đọc
màn hình và giao việc cho coding agent đã cài trên máy.

Trang này giúp bạn **build Tibo từ mã nguồn và thử câu đầu tiên**. Chưa cần
cài Whisper hay Kokoro: lần đầu có thể chọn Apple Speech và giọng macOS.

## Trước khi bắt đầu

- Dùng máy Mac có Xcode Command Line Tools và Rust/Cargo. Nếu chưa có Command
  Line Tools, chạy `xcode-select --install` và hoàn tất cửa sổ cài đặt.
- Cài và cấu hình ít nhất một CLI agent: pi, OMP, Claude Code hoặc Codex. Tibo
  mặc định chọn pi, nhưng cho đổi sang agent đã có trên máy.
- Đọc [`build.sh`](build.sh) nếu bạn đã cài Tibo: script **thay**
  `~/Applications/Tibo.app`, chép CLI vào `~/.local/bin/` và tạo
  `dist/Tibo.dmg`. Bản build sẽ được ký bằng chứng chỉ có sẵn hoặc ký ad-hoc.

## 1. Lấy mã nguồn và build

```sh
git clone https://github.com/lukebaze/Tibo.git
cd Tibo
mkdir -p "$HOME/Applications" "$HOME/.local/bin"
./build.sh
```

Sau khi build xong, kiểm tra `Tibo.app` và `dist/Tibo.dmg` trong thư mục repo.
Không cần chạy lại `build.sh` để mở ứng dụng.

## 2. Mở và thiết lập

```sh
open Tibo.app
```

Trong màn hình thiết lập:

1. Chọn agent đã cài và cấu hình model/tài khoản của agent đó.
2. Chọn cách nghe. Để bắt đầu nhanh, chọn **Apple Speech** và **Giọng hệ thống
   macOS**. Whisper cần tải model khi bạn chọn; Kokoro chỉ dùng được khi đã
   cài voicepack.
3. Cho phép Microphone và Speech Recognition nếu muốn nói với Tibo. Chỉ cấp
   Ghi màn hình khi dùng tính năng đọc màn hình; chỉ cấp Trợ năng khi cần
   điều khiển máy.

## 3. Thử một câu

Di chuột tới notch, nhập **“Tibo, chào bạn”** rồi gửi. Tibo sẽ hiện câu trả lời
ở notch; giọng đọc phụ thuộc cài đặt bạn vừa chọn. Bạn cũng có thể bấm mic
để nói hoặc gõ `/` để xem lệnh nhanh.

Nếu không thấy phản hồi, kiểm tra agent bạn chọn đã đăng nhập/cấu hình model.
Nếu mic không hoạt động, xem quyền Microphone và Speech Recognition trong
System Settings. Mục **Chẩn đoán** trong Cài đặt Tibo chạy `tibo --doctor`;
lệnh này kiểm tra cả Whisper, VietASR và Kokoro tùy chọn, nên có thể báo
`DOCTOR FAIL` dù chế độ Apple Speech vẫn hoạt động.

## Khi giao việc cho Tibo

Tác vụ coding cần xác nhận trước khi khởi chạy. Một số quy trình sử dụng CLI
agent có thể chạy shell trên Mac; xem kỹ nội dung tác vụ trước khi đồng ý.
Quyền macOS và xác nhận trong Tibo không phải sandbox bảo mật cho agent ngoài.
Model/agent từ xa có thể gửi nội dung yêu cầu tới dịch vụ của chúng.

## Xem thêm

- [Brandkit Tibo](.github/tibo-brandkit.webp) là bảng định hướng hình ảnh;
  [icon gốc](app/icon.svg) là biểu tượng đang dùng trong app.
- Ảnh động ở `app/taby/` là artwork của Taby, không phải nhân vật gốc của
  Tibo. Xem [điều khoản và ghi công](app/taby/LICENSE).
- Muốn sửa backend Rust, chạy `cargo test`. `./build.sh` đóng gói cả ứng dụng
  macOS và ghi đè bản cài trong `~/Applications/`.
