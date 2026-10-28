import { useState } from 'react';
import {
  App, Button, Card, Col, Drawer, Empty, Input, Row, Segmented, Select, Space, Statistic, Switch, Table, Tag, Typography,
} from 'antd';
import { FireOutlined, ReloadOutlined } from '@ant-design/icons';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import dayjs from 'dayjs';
import { api, fmtNum, fmtSec, useApi } from '../api.js';

const viewsPerHour = (r) => r.views / Math.max(1, (Date.now() - r.published_at) / 3_600_000);

function HistoryDrawer({ reel, onClose }) {
  const { data = [], loading } = useApi(`/reels/${reel.video_id}/history`);
  const points = data.map((d) => ({ ...d, time: dayjs(d.ts).format('DD/MM HH:mm') }));
  return (
    <Drawer open width={640} onClose={onClose} title={reel.page_name}>
      <Typography.Paragraph ellipsis={{ rows: 3, expandable: true }}>{reel.caption}</Typography.Paragraph>
      <Space wrap size="large" style={{ marginBottom: 16 }}>
        <Statistic title="Views" value={reel.views} />
        <Statistic title="Like" value={reel.likes} />
        <Statistic title="Comment" value={reel.comments} />
        <Statistic title="Share" value={reel.shares} />
      </Space>
      <Typography.Title level={5}>Views theo thời gian</Typography.Title>
      {points.length > 1 ? (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={points} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={30} />
            <YAxis tickFormatter={(v) => Intl.NumberFormat('vi-VN', { notation: 'compact' }).format(v)} width={50} />
            <ChartTooltip formatter={(v) => fmtNum(v)} />
            <Line type="monotone" dataKey="views" name="Views" stroke="#e5484d" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <Empty description={loading ? 'Đang tải...' : 'Cần ít nhất 2 lần cập nhật để vẽ biểu đồ'} />
      )}
      <Button type="link" href={reel.permalink} target="_blank" style={{ paddingLeft: 0 }}>Mở reel trên Facebook →</Button>
    </Drawer>
  );
}

export default function Reels() {
  const { message } = App.useApp();
  const [days, setDays] = useState(7);
  const [pageId, setPageId] = useState();
  const [viralOnly, setViralOnly] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);

  const { data: pages = [] } = useApi('/pages');
  const { data: ov, reload: reloadOverview } = useApi('/overview', { refreshMs: 15_000 });
  const query = new URLSearchParams({ days, ...(pageId && { pageId }), ...(viralOnly && { viral: '1' }) }).toString();
  const { data = [], loading, reload } = useApi(`/reels?${query}`, { refreshMs: 60_000 });

  const refresh = async () => {
    try {
      const r = await api.post('/stats/refresh');
      message.info(r.started ? 'Đang cập nhật số liệu, có thể mất vài phút...' : 'Đang cập nhật rồi, chờ chút nhé');
      reloadOverview({ silent: true });
    } catch (e) {
      message.error(e.message);
    }
  };

  const needle = q.toLowerCase();
  const rows = data.filter((r) => !needle || (r.caption || '').toLowerCase().includes(needle));

  const stats = [
    { title: 'Page đang bật', value: ov?.pages },
    { title: 'Chờ đăng', value: ov?.upcoming },
    { title: 'Đã đăng hôm nay', value: ov?.doneToday },
    { title: 'Lỗi', value: ov?.failed, style: ov?.failed ? { color: '#e5484d' } : undefined },
    { title: 'Views 7 ngày', value: ov?.views7d },
    { title: 'Reel viral 7 ngày', value: ov?.viral7d, prefix: <FireOutlined style={{ color: '#f76b15' }} /> },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        {stats.map((s) => (
          <Col xs={12} md={8} xl={4} key={s.title}>
            <Card size="small">
              <Statistic title={s.title} value={s.value ?? '-'} prefix={s.prefix} valueStyle={s.style} formatter={(v) => fmtNum(v)} />
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        title="Thống kê Reels"
        extra={(
          <Space>
            <Typography.Text type="secondary">
              {ov?.statsLastRun ? `Cập nhật ${dayjs(ov.statsLastRun).fromNow()}` : 'Chưa cập nhật lần nào'}
            </Typography.Text>
            <Button icon={<ReloadOutlined />} loading={ov?.statsRunning} onClick={refresh}>Cập nhật số liệu</Button>
          </Space>
        )}
      >
        <Space wrap style={{ marginBottom: 16 }}>
          <Segmented
            value={days}
            onChange={setDays}
            options={[{ value: 1, label: '24h' }, { value: 3, label: '3 ngày' }, { value: 7, label: '7 ngày' }, { value: 30, label: '30 ngày' }]}
          />
          <Select
            allowClear
            showSearch
            placeholder="Tất cả page"
            optionFilterProp="label"
            style={{ width: 220 }}
            value={pageId}
            onChange={setPageId}
            options={pages.map((p) => ({ value: p.id, label: p.name }))}
          />
          <Space><Switch checked={viralOnly} onChange={setViralOnly} />Chỉ reel viral</Space>
          <Input.Search placeholder="Tìm caption..." allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
          <Button type="text" icon={<ReloadOutlined />} onClick={() => reload()} />
        </Space>

        <Table
          rowKey="video_id"
          size="middle"
          loading={loading}
          dataSource={rows}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          scroll={{ x: 1100 }}
          onRow={(r) => ({ onClick: () => setOpen(r), style: { cursor: 'pointer' } })}
          columns={[
            {
              title: 'Reel',
              dataIndex: 'caption',
              ellipsis: true,
              render: (c, r) => (
                <Space>
                  {r.viral ? <FireOutlined style={{ color: '#f76b15' }} /> : null}
                  <a href={r.permalink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{c || '(không caption)'}</a>
                </Space>
              ),
            },
            { title: 'Page', dataIndex: 'page_name', width: 160, ellipsis: true },
            {
              title: 'Đăng',
              dataIndex: 'published_at',
              width: 120,
              sorter: (a, b) => a.published_at - b.published_at,
              render: (t) => dayjs(t).fromNow(),
            },
            { title: 'Views', dataIndex: 'views', width: 100, align: 'right', sorter: (a, b) => a.views - b.views, defaultSortOrder: 'descend', render: fmtNum },
            {
              title: 'View/giờ',
              key: 'vph',
              width: 100,
              align: 'right',
              sorter: (a, b) => viewsPerHour(a) - viewsPerHour(b),
              render: (_, r) => fmtNum(Math.round(viewsPerHour(r))),
            },
            { title: 'Like', dataIndex: 'likes', width: 80, align: 'right', sorter: (a, b) => a.likes - b.likes, render: fmtNum },
            { title: 'Comment', dataIndex: 'comments', width: 90, align: 'right', sorter: (a, b) => a.comments - b.comments, render: fmtNum },
            { title: 'Share', dataIndex: 'shares', width: 80, align: 'right', sorter: (a, b) => a.shares - b.shares, render: fmtNum },
            { title: 'Xem TB', dataIndex: 'avg_watch_ms', width: 80, align: 'right', render: fmtSec },
            {
              title: 'Viral',
              dataIndex: 'viral_score',
              width: 90,
              align: 'right',
              sorter: (a, b) => (a.viral_score || 0) - (b.viral_score || 0),
              render: (s, r) => (s == null ? '-' : <Tag color={r.viral ? 'volcano' : 'default'}>x{s.toFixed(1)}</Tag>),
            },
          ]}
        />
      </Card>
      {open && <HistoryDrawer reel={open} onClose={() => setOpen(null)} />}
    </Space>
  );
}
