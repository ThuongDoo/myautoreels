import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, App, Button, Image, InputNumber, Modal, Progress, Space, Typography,
} from 'antd';
import { FolderOpenOutlined, PictureOutlined } from '@ant-design/icons';

const ALLOWED = ['image/jpeg', 'image/png'];
const MAX_BYTES = 4 * 1024 * 1024;
const PREVIEW_COUNT = 24;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Random page -> image pairs. Each image is used once before any is reused; every reuse round is reshuffled.
function assignImages(pages, files) {
  let pool = [];
  return shuffle(pages).map((page) => {
    if (!pool.length) pool = shuffle(files);
    return { page, file: pool.pop() };
  });
}

async function uploadImage(file) {
  const res = await fetch('/api/avatars/upload', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${file.name}: ${data.message || res.statusText}`);
  return data.id;
}

export default function AvatarBulkModal({ pages, onClose, onStarted }) {
  const { message } = App.useApp();
  const folderInput = useRef(null);
  const filesInput = useRef(null);
  const [files, setFiles] = useState([]);
  const [skipped, setSkipped] = useState({ type: 0, size: 0 });
  const [delayMin, setDelayMin] = useState(10);
  const [delayMax, setDelayMax] = useState(30);
  const [upload, setUpload] = useState(null); // { done, total } while sending images to the app

  const previews = useMemo(() => files.slice(0, PREVIEW_COUNT).map((f) => ({ name: f.name, url: URL.createObjectURL(f) })), [files]);
  useEffect(() => () => previews.forEach((p) => URL.revokeObjectURL(p.url)), [previews]);

  const pick = (list) => {
    const all = [...(list || [])];
    const images = all.filter((f) => ALLOWED.includes(f.type));
    setSkipped({ type: all.length - images.length, size: images.filter((f) => f.size > MAX_BYTES).length });
    setFiles(images.filter((f) => f.size <= MAX_BYTES));
  };

  const start = async (testOne) => {
    const targets = testOne ? [pages[Math.floor(Math.random() * pages.length)]] : pages;
    const plan = assignImages(targets, files);
    const unique = [...new Set(plan.map((p) => p.file))];
    try {
      setUpload({ done: 0, total: unique.length });
      const ids = new Map();
      for (const file of unique) {
        ids.set(file, await uploadImage(file));
        setUpload((u) => ({ ...u, done: u.done + 1 }));
      }
      const res = await fetch('/api/avatars/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          delayMinSec: Math.min(delayMin, delayMax),
          delayMaxSec: Math.max(delayMin, delayMax),
          items: plan.map(({ page, file }) => ({ pageId: page.id, imageId: ids.get(file), fileName: file.name })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || res.statusText);
      onStarted();
    } catch (e) {
      message.error(e.message);
    } finally {
      setUpload(null);
    }
  };

  const reused = files.length > 0 && files.length < pages.length;
  const lo = Math.min(delayMin, delayMax);
  const hi = Math.max(delayMin, delayMax);
  const eta = (sec) => Math.ceil(((pages.length - 1) * sec) / 60);

  return (
    <Modal
      open
      width={720}
      title={<Space><PictureOutlined />Đổi avatar cho {pages.length} page</Space>}
      onCancel={upload ? undefined : onClose}
      maskClosable={!upload}
      footer={(
        <Space>
          <Button onClick={onClose} disabled={!!upload}>Huỷ</Button>
          <Button disabled={!files.length || !!upload} onClick={() => start(true)}>Thử trước 1 page</Button>
          <Button type="primary" disabled={!files.length || !!upload} loading={!!upload} onClick={() => start(false)}>
            Đổi cho {pages.length} page
          </Button>
        </Space>
      )}
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap>
          <Button icon={<FolderOpenOutlined />} onClick={() => folderInput.current?.click()}>Chọn thư mục ảnh</Button>
          <Button onClick={() => filesInput.current?.click()}>hoặc chọn từng ảnh</Button>
          {/* webkitdirectory lets the user pick a whole folder from their computer. */}
          <input ref={folderInput} type="file" webkitdirectory="" directory="" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
          <input ref={filesInput} type="file" accept="image/jpeg,image/png" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
        </Space>

        {files.length > 0 && (
          <>
            <Typography.Text>
              <b>{files.length}</b> ảnh hợp lệ — mỗi page nhận ngẫu nhiên 1 ảnh
              {skipped.type > 0 && <Typography.Text type="secondary"> · bỏ qua {skipped.type} file không phải JPG/PNG</Typography.Text>}
            </Typography.Text>
            <Image.PreviewGroup>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 170, overflowY: 'auto' }}>
                {previews.map((p) => (
                  <Image
                    key={p.url}
                    src={p.url}
                    alt={p.name}
                    width={56}
                    height={56}
                    style={{ objectFit: 'cover', borderRadius: '50%' }}
                  />
                ))}
                {files.length > PREVIEW_COUNT && (
                  <Typography.Text type="secondary" style={{ alignSelf: 'center' }}>+{files.length - PREVIEW_COUNT} ảnh</Typography.Text>
                )}
              </div>
            </Image.PreviewGroup>
          </>
        )}

        {skipped.size > 0 && <Alert type="warning" showIcon message={`${skipped.size} ảnh lớn hơn 4 MB đã bị bỏ qua — hãy nén nhỏ lại.`} />}
        {reused && (
          <Alert
            type="warning"
            showIcon
            message={`Chỉ có ${files.length} ảnh cho ${pages.length} page — một số ảnh sẽ được dùng cho nhiều page.`}
            description="Nhiều page dùng chung avatar dễ bị coi là cùng một chủ / page giả mạo. Nên thêm ảnh để mỗi page một ảnh riêng."
          />
        )}

        <Space>
          Mỗi page cách nhau ngẫu nhiên
          <Space.Compact>
            <InputNumber min={3} max={3600} value={delayMin} onChange={(v) => setDelayMin(v || 3)} addonBefore="từ" style={{ width: 120 }} />
            <InputNumber min={3} max={3600} value={delayMax} onChange={(v) => setDelayMax(v || 3)} addonBefore="đến" addonAfter="giây" style={{ width: 170 }} />
          </Space.Compact>
          {pages.length > 1 && (
            <Typography.Text type="secondary">
              ≈ {eta(lo) === eta(hi) ? eta(lo) : `${eta(lo)}–${eta(hi)}`} phút cho {pages.length} page
            </Typography.Text>
          )}
        </Space>

        <Typography.Text type="secondary" style={{ fontSize: 13 }}>
          Ảnh vuông, tối thiểu 180×180 px, JPG hoặc PNG. Token của BM cần có quyền <code>pages_manage_metadata</code>.
          Nên bấm "Thử trước 1 page" để kiểm tra trước khi đổi cả loạt.
        </Typography.Text>

        {upload && (
          <div>
            <Typography.Text>Đang gửi ảnh lên app {upload.done}/{upload.total}...</Typography.Text>
            <Progress percent={Math.round((upload.done / upload.total) * 100)} status="active" />
          </div>
        )}
      </Space>
    </Modal>
  );
}
