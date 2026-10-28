// Job status labels shared by the queue and the video detail drawer.
export const STATUS = {
  pending: { label: 'Chờ', color: 'default' },
  uploading: { label: 'Đang upload', color: 'processing' },
  uploaded: { label: 'Đã upload, chờ giờ', color: 'cyan' },
  publishing: { label: 'Đang đăng', color: 'processing' },
  processing: { label: 'FB đang xử lý', color: 'geekblue' },
  done: { label: 'Đã đăng', color: 'success' },
  failed: { label: 'Lỗi', color: 'error' },
  canceled: { label: 'Đã huỷ', color: 'default' },
};
