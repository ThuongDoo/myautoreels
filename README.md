# AutoReels

Lên lịch đăng Reels hàng loạt cho nhiều Facebook Page (dùng chung 1 BM), video lấy từ Google Drive, theo dõi view/like/comment/share và phát hiện reel viral.

App **tự giữ lịch**: video được upload sẵn trước giờ đăng vài phút, đúng giờ app mới gọi Facebook đăng ngay (`video_state=PUBLISHED`) — không dùng tính năng hẹn giờ của Facebook.

## Chạy

```bash
npm install          # cài cả server và web
npm run build        # build giao diện
npm start            # http://127.0.0.1:3000
```

Khi phát triển: `npm run dev` rồi mở http://localhost:5173.

App phải chạy liên tục thì mới đăng đúng giờ. Trên VPS dùng pm2:

```bash
npm i -g pm2
pm2 start npm --name autoreels -- start
pm2 save && pm2 startup
```

## Cấu hình lần đầu

### 1. Facebook (không cần App Review)
1. developers.facebook.com → tạo app loại **Business**, gắn vào BM.
2. Business Settings → **System Users** → thêm system user quyền Admin.
3. Gán **100 page** + app cho system user (Full control).
4. Generate token → chọn app → hết hạn: **Never** → quyền:
   `pages_show_list, pages_manage_posts, pages_read_engagement, read_insights, business_management`
5. **Cài đặt → Tài khoản Facebook (BM) → Thêm BM**: đặt tên, dán token và Business ID, rồi sang **Pages → Đồng bộ từ Facebook**.

Nhiều BM: lặp lại các bước trên cho từng BM (mỗi BM một app, System User và token riêng) rồi bấm **Thêm BM**. Page của BM nào đăng bằng token của BM đó.

### 2. Google Drive
1. console.cloud.google.com → tạo project → bật **Google Drive API**.
2. IAM → Service Accounts → tạo → Keys → Add key → JSON → tải về.
3. Dán nội dung file JSON vào **Cài đặt → Google Drive**, lưu.
4. Share thư mục video trên Drive cho email service account hiện ra (quyền Người xem).
5. Dán link thư mục vào ô "Thư mục video mặc định".

### 3. Telegram (tuỳ chọn)
Tạo bot qua @BotFather, lấy chat ID qua @userinfobot, dán vào Cài đặt → bấm "Gửi thử".

## Cách hoạt động

| Trạng thái | Ý nghĩa |
|---|---|
| Chờ | Chưa tới giờ upload |
| Đang upload | Tải từ Drive về rồi đẩy lên Facebook (bắt đầu trước giờ đăng N phút) |
| Đã upload, chờ giờ | Video đã nằm trên Facebook nhưng chưa hiện |
| FB đang xử lý | Đã gọi đăng, chờ Facebook xử lý xong |
| Đã đăng / Lỗi | Lỗi tự thử lại tối đa 3 lần |

- Một video dùng cho nhiều page chỉ tải từ Drive **một lần** (cache trong `data/cache`, tự xoá khi xong).
- Thống kê cập nhật mỗi 2 giờ (chỉnh trong Cài đặt) cho reel trong N ngày gần nhất — kể cả reel đăng tay.
- **Viral** = views ≥ *X lần* trung vị views của chính page đó và ≥ số view tối thiểu.

## Lưu ý
- Facebook giới hạn khoảng 30 reel/page/24h qua API.
- Đăng cùng 1 video lên nhiều page cùng lúc dễ bị đánh spam/trùng lặp: dùng "lệch ngẫu nhiên" và spintax caption.
- Tên metric insights có thể đổi theo Graph API version; app tự dò metric nào còn dùng được.
