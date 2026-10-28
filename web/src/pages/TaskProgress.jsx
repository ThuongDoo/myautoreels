import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Modal, Popconfirm, Progress, Space, Typography } from 'antd';
import { LoadingOutlined } from '@ant-design/icons';
import { api, useApi } from '../api.js';

const STALL_MS = 90_000;
export const LOG_COLORS = { success: '#2f9e44', error: '#e5484d', warning: '#d9480f', info: undefined };

const elapsed = (from, to) => {
  const s = Math.max(0, Math.round((to - from) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Live view of a server background task (see server/tasks.js): progress, log, rate-limit wait, stop.
export default function TaskProgressModal({ statusUrl, cancelUrl, title, stopDescription, stats, onClose }) {
  const { data: task, reload } = useApi(statusUrl);
  const [now, setNow] = useState(Date.now());
  const logEnd = useRef(null);

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      reload({ silent: true });
    }, 1000);
    return () => clearInterval(t);
  }, [reload]);

  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'nearest' }); }, [task?.log?.length]);

  if (!task || task.idle) return null;

  const running = task.running;
  const waiting = running && task.waitUntil;
  const stalled = running && !waiting && now - task.updatedAt > STALL_MS;
  const stop = () => api.post(cancelUrl).then(() => reload({ silent: true }));
  const percent = task.todo ? Math.round((task.done / task.todo) * 100) : (running ? 0 : 100);
  let status = 'active';
  if (task.error) status = 'exception';
  else if (!running) status = task.failed.length ? 'normal' : 'success';

  return (
    <Modal
      open
      width={680}
      title={<Space>{running && <LoadingOutlined />}{typeof title === 'function' ? title(task) : title}</Space>}
      onCancel={onClose}
      maskClosable={!running}
      footer={(
        <Space>
          {running && (
            <Popconfirm title="Dừng lại?" description={stopDescription} onConfirm={stop}>
              <Button danger disabled={task.cancel}>{task.cancel ? 'Đang dừng...' : 'Dừng'}</Button>
            </Popconfirm>
          )}
          <Button type={running ? 'default' : 'primary'} onClick={onClose}>{running ? 'Ẩn (vẫn chạy nền)' : 'Đóng'}</Button>
        </Space>
      )}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <div>
          <Typography.Text strong>{task.phase}</Typography.Text>
          {task.current && <Typography.Text type="secondary"> — {task.current}</Typography.Text>}
          {running && task.nextAt > now && !waiting && (
            <Typography.Text type="secondary"> · page tiếp theo sau {Math.ceil((task.nextAt - now) / 1000)}s</Typography.Text>
          )}
          <Typography.Text type="secondary" style={{ float: 'right' }}>
            {elapsed(task.startedAt, task.finishedAt || now)}
          </Typography.Text>
        </div>

        <Progress percent={percent} status={status} format={() => `${task.done}/${task.todo}`} />

        <Space size="large" wrap>
          {stats(task).filter(Boolean).map(({ label, value, color }) => (
            <span key={label} style={{ color }}>{label}: <b>{value}</b></span>
          ))}
          <span style={{ color: task.failed.length ? LOG_COLORS.error : undefined }}>Lỗi: <b>{task.failed.length}</b></span>
        </Space>

        {waiting && (
          <Alert
            type="warning"
            showIcon
            message={`Facebook tạm chặn vì thao tác nhanh — tự thử lại sau ${elapsed(now, task.waitUntil)}`}
            description={`Sẽ chạy tiếp lúc ${new Date(task.waitUntil).toLocaleTimeString('vi-VN')}. App vẫn đang hoạt động, không cần làm gì. Đừng thao tác thủ công trên Facebook trong lúc này, sẽ bị chặn lâu hơn.`}
          />
        )}
        {stalled && (
          <Alert
            type="warning"
            showIcon
            message={`Đã ${Math.round((now - task.updatedAt) / 1000)}s không có tiến triển`}
            description="Facebook đang phản hồi chậm. Mỗi lần gọi tối đa 60s rồi sẽ tự báo lỗi và chạy tiếp, không cần làm gì."
          />
        )}
        {task.error && <Alert type="error" showIcon message="Đã dừng vì lỗi" description={task.error} />}

        <div
          style={{
            height: 260, overflowY: 'auto', background: '#fafafa', border: '1px solid #f0f0f0',
            borderRadius: 8, padding: '8px 12px', fontFamily: 'Consolas, monospace', fontSize: 12,
          }}
        >
          {task.log.map((l, i) => (
            <div key={i} style={{ color: LOG_COLORS[l.type] }}>
              <span style={{ color: '#999' }}>{new Date(l.ts).toLocaleTimeString('vi-VN')} </span>{l.text}
            </div>
          ))}
          <div ref={logEnd} />
        </div>
      </Space>
    </Modal>
  );
}
