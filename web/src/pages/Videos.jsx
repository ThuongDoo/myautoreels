import { useState } from 'react';
import { Card, Input, Segmented, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { FireOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { fmtNum, useApi } from '../api.js';
import VideoDrawer from './VideoDrawer.jsx';

const FILTERS = {
  all: { label: 'Tất cả', test: () => true },
  posted: { label: 'Đã đăng', test: (v) => v.posted > 0 },
  upcoming: { label: 'Sắp đăng', test: (v) => v.upcoming > 0 },
  viral: { label: 'Có reel viral', test: (v) => v.viral > 0 },
  failed: { label: 'Có lỗi', test: (v) => v.failed > 0 },
};

export default function Videos() {
  const { data = [], loading } = useApi('/videos', { refreshMs: 60_000 });
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);

  const needle = q.toLowerCase();
  const rows = data.filter((v) => FILTERS[filter].test(v) && (!needle || (v.name || '').toLowerCase().includes(needle)));

  return (
    <Card title={`Kho video (${data.length})`}>
      <Typography.Paragraph type="secondary">
        Mỗi dòng là một video gốc trên Google Drive đã từng được lên lịch. Bấm vào để xem video đó đã đăng lên những page nào và kết quả từng reel.
      </Typography.Paragraph>
      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented
          value={filter}
          onChange={setFilter}
          options={Object.entries(FILTERS).map(([value, f]) => ({ value, label: `${f.label} (${data.filter(f.test).length})` }))}
        />
        <Input.Search placeholder="Tìm tên video..." allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 240 }} />
      </Space>
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        scroll={{ x: 950 }}
        onRow={(v) => ({ onClick: () => setOpen(v), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: 'Video',
            dataIndex: 'name',
            ellipsis: true,
            render: (n, v) => <Space>{v.viral > 0 && <FireOutlined style={{ color: '#f76b15' }} />}<a>{n || v.id}</a></Space>,
          },
          {
            title: 'Đã đăng',
            dataIndex: 'posted',
            width: 100,
            align: 'right',
            sorter: (a, b) => a.posted - b.posted,
            render: (n, v) => <Tooltip title={`Trên ${v.pages} page`}>{n} lần</Tooltip>,
          },
          { title: 'Sắp đăng', dataIndex: 'upcoming', width: 105, align: 'right', sorter: (a, b) => a.upcoming - b.upcoming, render: (n) => n || '-' },
          { title: 'Tổng views', dataIndex: 'views', width: 110, align: 'right', sorter: (a, b) => a.views - b.views, defaultSortOrder: 'descend', render: fmtNum },
          {
            title: 'Views TB / lần',
            width: 135,
            align: 'right',
            sorter: (a, b) => (a.posted ? a.views / a.posted : 0) - (b.posted ? b.views / b.posted : 0),
            render: (_, v) => (v.posted ? fmtNum(Math.round(v.views / v.posted)) : '-'),
          },
          { title: 'Reel tốt nhất', dataIndex: 'best_views', width: 130, align: 'right', sorter: (a, b) => a.best_views - b.best_views, render: fmtNum },
          {
            title: 'Viral',
            dataIndex: 'viral',
            width: 70,
            align: 'right',
            sorter: (a, b) => a.viral - b.viral,
            render: (n) => (n ? <Tag color="volcano" style={{ margin: 0 }}>{n}</Tag> : '-'),
          },
          {
            title: 'Đăng gần nhất',
            dataIndex: 'last_posted',
            width: 130,
            sorter: (a, b) => (a.last_posted || 0) - (b.last_posted || 0),
            render: (t) => (t ? dayjs(t).fromNow() : '-'),
          },
        ]}
      />
      {open && <VideoDrawer video={open} onClose={() => setOpen(null)} />}
    </Card>
  );
}
