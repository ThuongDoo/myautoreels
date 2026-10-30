import { useState } from 'react';
import {
  Alert, App, Button, Card, Checkbox, Input, Modal, Space, Table, Tag, Typography,
} from 'antd';
import { CloudOutlined, HddOutlined, ReloadOutlined, WarningOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, fmtSize, useApi } from '../api.js';

// Waits until the restarted server answers again.
async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      await api.get('/overview');
      return true;
    } catch { /* still restarting */ }
  }
  return false;
}

function RestoreModal({ backup, busy, onClose }) {
  const { message } = App.useApp();
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [step, setStep] = useState('confirm'); // confirm -> working -> restarting
  const when = dayjs(backup.at).format('HH:mm DD/MM/YYYY');

  const restore = async () => {
    setStep('working');
    try {
      const r = await api.post('/backups/restore', { name: backup.name, password });
      setStep('restarting');
      message.info(`Đã nạp bản ${when}: ${r.pages} page, ${r.jobs} lịch, ${r.reels} reel. Đang khởi động lại...`);
      if (await waitForServer()) window.location.reload();
      else message.error('Server chưa chạy lại, kiểm tra trên VPS (pm2 status)');
    } catch (e) {
      message.error(e.message);
      setStep('confirm');
    }
  };

  return (
    <Modal
      open
      title={<Space><WarningOutlined style={{ color: '#e5484d' }} />Khôi phục bản backup {when}</Space>}
      onCancel={step === 'confirm' ? onClose : undefined}
      closable={step === 'confirm'}
      maskClosable={false}
      footer={[
        <Button key="cancel" onClick={onClose} disabled={step !== 'confirm'}>Hủy</Button>,
        <Button
          key="ok"
          danger
          type="primary"
          disabled={!agreed || !password}
          loading={step !== 'confirm'}
          onClick={restore}
        >
          {step === 'restarting' ? 'Đang khởi động lại...' : 'Khôi phục'}
        </Button>,
      ]}
    >
      <Alert
        type="error"
        showIcon
        style={{ marginBottom: 16 }}
        message="Thao tác này thay TOÀN BỘ dữ liệu hiện tại"
        description={(
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li>Page, tài khoản BM, lịch đăng, số liệu reel, nhóm, cài đặt sẽ quay về lúc <b>{when}</b>.</li>
            <li>Mọi thứ tạo hoặc sửa <b>sau thời điểm đó sẽ mất</b> (lịch mới, page mới, số liệu mới).</li>
            <li>Lịch chưa đăng có giờ đăng đã qua sẽ bị <b>hủy</b> để tránh đăng trùng reel đã đăng sau lúc backup. Lịch trong tương lai giữ nguyên.</li>
            <li>App sẽ <b>khởi động lại</b>, mất khoảng vài giây đến 1 phút.</li>
            <li>Dữ liệu hiện tại được cất lại trong <Typography.Text code>data/backup/before-restore-…</Typography.Text> phòng khi cần lấy lại.</li>
          </ul>
        )}
      />
      {busy > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`Đang có ${busy} video đang tải lên / đăng. Khôi phục lúc này có thể làm reel đó bị đăng dở hoặc không được ghi nhận.`}
        />
      )}
      <Space direction="vertical" style={{ width: '100%' }}>
        <Checkbox checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={step !== 'confirm'}>
          Tôi hiểu dữ liệu hiện tại sẽ bị thay thế
        </Checkbox>
        <Input.Password
          placeholder="Nhập mật khẩu đăng nhập web để xác nhận"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onPressEnter={() => agreed && password && step === 'confirm' && restore()}
          disabled={step !== 'confirm'}
          autoComplete="current-password"
        />
      </Space>
    </Modal>
  );
}

export default function BackupsCard() {
  const { data, loading, reload } = useApi('/backups');
  const [target, setTarget] = useState(null);

  return (
    <Card
      title="Sao lưu & khôi phục"
      extra={<Button type="text" icon={<ReloadOutlined />} loading={loading} onClick={() => reload()} />}
    >
      <Typography.Paragraph type="secondary">
        VPS tự backup lúc 3h sáng mỗi ngày (giữ 7 bản trên VPS, 30 ngày trên Google Drive). Bản backup gồm database và ảnh đại diện;
        khi khôi phục, file .env (mật khẩu, cấu hình máy) được giữ nguyên.
      </Typography.Paragraph>
      {data?.driveError && <Alert type="warning" showIcon style={{ marginBottom: 12 }} message={`Không đọc được backup trên Drive: ${data.driveError}`} />}
      {data && !data.canRestore && (
        <Alert type="info" showIcon style={{ marginBottom: 12 }} message="Máy này chưa đặt APP_PASSWORD trong .env nên không dùng được chức năng khôi phục." />
      )}
      <Table
        rowKey="name"
        size="small"
        loading={loading}
        dataSource={data?.backups || []}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{ emptyText: 'Chưa có bản backup nào' }}
        columns={[
          {
            title: 'Thời điểm',
            dataIndex: 'at',
            render: (t) => (
              <>
                {dayjs(t).format('HH:mm DD/MM/YYYY')}{' '}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>({dayjs(t).fromNow()})</Typography.Text>
              </>
            ),
          },
          { title: 'Dung lượng', dataIndex: 'size', width: 110, render: fmtSize },
          {
            title: 'Nơi lưu',
            key: 'where',
            width: 170,
            render: (_, b) => (
              <>
                {b.local && <Tag icon={<HddOutlined />}>VPS</Tag>}
                {b.drive && <Tag icon={<CloudOutlined />} color="blue">Drive</Tag>}
              </>
            ),
          },
          {
            title: '',
            key: 'restore',
            width: 110,
            render: (_, b) => (
              <Button size="small" danger disabled={!data?.canRestore} onClick={() => setTarget(b)}>Khôi phục</Button>
            ),
          },
        ]}
      />
      {target && <RestoreModal backup={target} busy={data?.busy || 0} onClose={() => setTarget(null)} />}
    </Card>
  );
}
