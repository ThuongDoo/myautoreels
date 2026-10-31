import { useState } from 'react';
import {
  Alert, App, Button, Card, Col, Input, Modal, Row, Segmented, Select, Space, Statistic, Switch, Table, Tag, Tooltip, Typography,
} from 'antd';
import { PlayCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, fmtNum, fmtSec, useApi } from '../api.js';

const avg = (s) => (s.reels ? s.views / s.reels : 0);

export function Preview({ hook, onClose }) {
  const src = `/api/drive/stream/${encodeURIComponent(hook.id)}`;
  return (
    <Modal open title={hook.name} footer={null} onCancel={onClose} width={340} destroyOnClose>
      {/* eslint-disable jsx-a11y/media-has-caption */}
      {hook.kind === 'audio' ? (
        <audio controls autoPlay src={src} style={{ width: '100%' }} />
      ) : (
        <div style={{ width: '100%', aspectRatio: '9 / 16', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
          <video controls autoPlay src={src} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
        </div>
      )}
    </Modal>
  );
}

export default function Hooks() {
  const { message } = App.useApp();
  const [days, setDays] = useState(30);
  const [fresh, setFresh] = useState(0);
  const [search, setSearch] = useState('');
  const [folder, setFolder] = useState();
  const [preview, setPreview] = useState(null);
  const { data, loading, reload } = useApi(`/hooks?days=${days}${fresh ? `&fresh=${fresh}` : ''}`);
  const files = data?.files || [];
  const folders = [...new Set(files.map((h) => h.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const q = search.trim().toLowerCase();
  const rows = files.filter((h) => (!folder || h.folder === folder || h.folder.startsWith(`${folder}/`))
    && (!q || h.name.toLowerCase().includes(q)));

  const toggle = async (h, on) => {
    try {
      await api.put(`/hooks/${h.id}`, { disabled: !on });
      reload({ silent: true });
    } catch (e) {
      message.error(e.message);
    }
  };

  const withHook = data?.compare?.withHook || { reels: 0, views: 0 };
  const withoutHook = data?.compare?.withoutHook || { reels: 0, views: 0 };
  const lift = avg(withoutHook) ? avg(withHook) / avg(withoutHook) - 1 : null;

  return (
    <Card
      title="Kho hook"
      extra={<Typography.Text type="secondary">Video hoặc voice ngắn ghép vào đầu reel khi lên lịch</Typography.Text>}
    >
      {data && !data.configured && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={<>Chưa có thư mục hook. Tạo một thư mục trên Google Drive, share cho Service Account rồi dán link vào <a href="#settings">Cài đặt</a>.</>}
        />
      )}

      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented
          value={days}
          onChange={setDays}
          options={[{ value: 7, label: '7 ngày' }, { value: 30, label: '30 ngày' }, { value: 90, label: '90 ngày' }]}
        />
        <Select
          allowClear
          placeholder="Tất cả thư mục"
          style={{ width: 200 }}
          value={folder}
          onChange={setFolder}
          options={folders.map((d) => ({ value: d, label: d }))}
        />
        <Input.Search allowClear placeholder="Tìm tên hook" style={{ width: 220 }} onChange={(e) => setSearch(e.target.value)} />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => setFresh(Date.now())}>Tải lại thư mục hook</Button>
      </Space>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}><Statistic title="Tổng hook" value={files.length} /></Col>
        <Col xs={12} md={6}><Statistic title="Đang bật" value={files.filter((h) => !h.disabled).length} /></Col>
        <Col xs={12} md={6}><Statistic title="Chưa dùng lần nào" value={files.filter((h) => !h.posted && !h.upcoming).length} /></Col>
        <Col xs={12} md={6}>
          <Tooltip title={`Reel có hook: ${fmtNum(withHook.reels)} reel, TB ${fmtNum(Math.round(avg(withHook)))} views. Không hook: ${fmtNum(withoutHook.reels)} reel, TB ${fmtNum(Math.round(avg(withoutHook)))} views.`}>
            <Statistic
              title={`Views TB / reel có hook (${days} ngày)`}
              value={withHook.reels ? Math.round(avg(withHook)) : '-'}
              formatter={(v) => (v === '-' ? '-' : fmtNum(v))}
              suffix={lift != null && withHook.reels > 0 && (
                <Typography.Text type={lift >= 0 ? 'success' : 'danger'} style={{ fontSize: 14 }}>
                  {lift >= 0 ? '+' : ''}{(lift * 100).toFixed(0)}% so với không hook
                </Typography.Text>
              )}
            />
          </Tooltip>
        </Col>
      </Row>

      <Table
        rowKey="id"
        size="middle"
        loading={loading && !data}
        dataSource={rows}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
        scroll={{ x: 900 }}
        columns={[
          {
            title: 'Bật',
            dataIndex: 'disabled',
            width: 70,
            filters: [{ text: 'Đang bật', value: false }, { text: 'Đã tắt', value: true }],
            onFilter: (v, h) => h.disabled === v,
            render: (d, h) => (
              <Tooltip title={d ? 'Đã tắt: không được chọn khi lên lịch' : 'Được chọn ngẫu nhiên khi lên lịch'}>
                <Switch size="small" checked={!d} onChange={(on) => toggle(h, on)} />
              </Tooltip>
            ),
          },
          {
            title: 'Hook',
            dataIndex: 'name',
            sorter: (a, b) => a.name.localeCompare(b.name),
            render: (n, h) => (
              <Space size={6}>
                <Button type="text" size="small" icon={<PlayCircleOutlined />} onClick={() => setPreview(h)} />
                <Typography.Text type={h.disabled ? 'secondary' : undefined} delete={h.disabled}>{n}</Typography.Text>
                {h.folder && <Tag style={{ margin: 0 }}>{h.folder}</Tag>}
              </Space>
            ),
          },
          {
            title: 'Thời lượng',
            dataIndex: 'durationMs',
            width: 115,
            sorter: (a, b) => a.durationMs - b.durationMs,
            render: (v) => (v > 5000
              ? <Tooltip title="Hook dài quá 5 giây dễ làm người xem lướt qua"><Typography.Text type="warning">{fmtSec(v)}</Typography.Text></Tooltip>
              : fmtSec(v)),
          },
          {
            title: 'Khung hình',
            key: 'size',
            width: 120,
            render: (_, h) => (h.kind === 'audio' ? (
              <Tooltip title="Hook chỉ có tiếng: khi ghép, hình lấy từ đoạn cuối của video"><Tag color="purple">Chỉ tiếng</Tag></Tooltip>
            ) : h.width ? (
              h.width > h.height
                ? <Tooltip title="Video ngang: sẽ có viền đen trên dưới khi ghép vào reel dọc"><Tag color="orange">{h.width}×{h.height}</Tag></Tooltip>
                : `${h.width}×${h.height}`
            ) : '-'),
          },
          { title: 'Đã đăng', dataIndex: 'posted', width: 100, align: 'right', sorter: (a, b) => a.posted - b.posted, render: fmtNum },
          { title: 'Sắp đăng', dataIndex: 'upcoming', width: 105, align: 'right', sorter: (a, b) => a.upcoming - b.upcoming, render: fmtNum },
          {
            title: `Views TB / reel (${days} ngày)`,
            key: 'avg',
            width: 190,
            align: 'right',
            defaultSortOrder: 'descend',
            sorter: (a, b) => avg(a) - avg(b),
            render: (_, h) => (h.reels ? <Tooltip title={`${fmtNum(h.views)} views / ${h.reels} reel`}>{fmtNum(Math.round(avg(h)))}</Tooltip> : '-'),
          },
          {
            title: 'Đăng gần nhất',
            dataIndex: 'last_posted',
            width: 130,
            sorter: (a, b) => (a.last_posted || 0) - (b.last_posted || 0),
            render: (t) => (t ? <Tooltip title={dayjs(t).format('DD/MM/YYYY HH:mm')}>{dayjs(t).fromNow()}</Tooltip> : '-'),
          },
        ]}
      />
      {preview && <Preview hook={preview} onClose={() => setPreview(null)} />}
    </Card>
  );
}
