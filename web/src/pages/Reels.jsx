import { useState } from 'react';
import {
  App, Button, Card, Col, Drawer, Empty, Input, Row, Segmented, Select, Space, Statistic, Switch, Table, Tag, Typography,
} from 'antd';
import { BarChartOutlined, FireOutlined, ReloadOutlined, UnorderedListOutlined } from '@ant-design/icons';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis } from 'recharts';
import dayjs from 'dayjs';
import { api, fmtNum, fmtSec, groupColor, useApi } from '../api.js';
import ReelCharts from './ReelCharts.jsx';
import VideoDrawer from './VideoDrawer.jsx';
import PageDrawer from './PageDrawer.jsx';

const viewsPerHour = (r) => r.views / Math.max(1, (Date.now() - r.published_at) / 3_600_000);

const HISTORY_METRICS = {
  views: { label: 'Views' },
  likes: { label: 'Like' },
  comments: { label: 'Comment' },
  shares: { label: 'Share' },
};

export function HistoryDrawer({ reel, onClose, onOpenVideo }) {
  const [metric, setMetric] = useState('views');
  const { data = [], loading } = useApi(`/reels/${reel.video_id}/history`);
  const points = data.map((d) => ({ ...d, time: dayjs(d.ts).format('DD/MM HH:mm') }));
  return (
    <Drawer open width={640} onClose={onClose} title={reel.page_name}>
      <Typography.Paragraph ellipsis={{ rows: 3, expandable: true }}>{reel.caption}</Typography.Paragraph>
      <Typography.Paragraph>
        Video gốc:{' '}
        {reel.drive_file_id ? (
          <>
            <Typography.Text strong>{reel.drive_file_name}</Typography.Text>{' '}
            <Button size="small" onClick={() => onOpenVideo({ id: reel.drive_file_id, name: reel.drive_file_name })}>
              Xem video &amp; {reel.source_posts} lần đăng
            </Button>
          </>
        ) : <Typography.Text type="secondary">không rõ (reel đăng ngoài app)</Typography.Text>}
      </Typography.Paragraph>
      <Space wrap size="large" style={{ marginBottom: 16 }}>
        <Statistic title="Views" value={reel.views} />
        <Statistic title="Like" value={reel.likes} />
        <Statistic title="Comment" value={reel.comments} />
        <Statistic title="Share" value={reel.shares} />
      </Space>
      <Space style={{ marginBottom: 8 }}>
        <Typography.Title level={5} style={{ margin: 0 }}>{HISTORY_METRICS[metric].label} theo thời gian</Typography.Title>
        <Segmented
          size="small"
          value={metric}
          onChange={setMetric}
          options={Object.entries(HISTORY_METRICS).map(([value, m]) => ({ value, label: m.label }))}
        />
      </Space>
      {points.length > 1 ? (
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={points} margin={{ left: 8, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="time" tick={{ fontSize: 11 }} minTickGap={30} />
            <YAxis tickFormatter={(v) => Intl.NumberFormat('vi-VN', { notation: 'compact' }).format(v)} width={50} allowDecimals={false} />
            <ChartTooltip formatter={(v) => fmtNum(v)} />
            <Line type="monotone" dataKey={metric} name={HISTORY_METRICS[metric].label} stroke="#e5484d" strokeWidth={2} dot={false} />
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
  const [group, setGroup] = useState();
  const [tab, setTab] = useState('charts');
  const [viralOnly, setViralOnly] = useState(false);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [openVideo, setOpenVideo] = useState(null);
  const [openPage, setOpenPage] = useState(null);

  const { data: pages = [] } = useApi('/pages');
  const { data: groups = [] } = useApi('/groups');
  const { data: ov, reload: reloadOverview } = useApi('/overview', { refreshMs: 15_000 });
  const query = new URLSearchParams({ days, ...(pageId && { pageId }), ...(group && { group }) }).toString();
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
  const rows = data.filter((r) => (!viralOnly || r.viral) && (!needle || (r.caption || '').toLowerCase().includes(needle)));
  const pageOptions = pages.filter((p) => !group || (group === '__none__' ? !p.group_name : p.group_name === group));

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
            value={tab}
            onChange={setTab}
            options={[
              { value: 'charts', label: 'Biểu đồ', icon: <BarChartOutlined /> },
              { value: 'list', label: 'Danh sách reel', icon: <UnorderedListOutlined /> },
            ]}
          />
          <Segmented
            value={days}
            onChange={setDays}
            options={[{ value: 1, label: '24h' }, { value: 3, label: '3 ngày' }, { value: 7, label: '7 ngày' }, { value: 30, label: '30 ngày' }]}
          />
          <Select
            allowClear
            placeholder="Tất cả nhóm"
            style={{ width: 170 }}
            value={group}
            onChange={(g) => { setGroup(g); setPageId(undefined); }}
            options={[
              ...groups.map((g) => ({ value: g.name, label: <Tag color={groupColor(g.name)} style={{ margin: 0 }}>{g.name}</Tag> })),
              { value: '__none__', label: 'Chưa có nhóm' },
            ]}
          />
          <Select
            allowClear
            showSearch
            placeholder="Tất cả page"
            optionFilterProp="label"
            style={{ width: 220 }}
            value={pageId}
            onChange={setPageId}
            options={pageOptions.map((p) => ({ value: p.id, label: p.name }))}
          />
          {tab === 'list' && (
            <>
              <Space><Switch checked={viralOnly} onChange={setViralOnly} />Chỉ reel viral</Space>
              <Input.Search placeholder="Tìm caption..." allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />
            </>
          )}
          <Button type="text" icon={<ReloadOutlined />} onClick={() => reload()} />
        </Space>

        {tab === 'charts' && <ReelCharts reels={data} days={days} query={query} onOpenPage={setOpenPage} />}
        {tab === 'list' && (
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
              title: 'Video gốc',
              dataIndex: 'drive_file_name',
              width: 190,
              ellipsis: true,
              render: (n, r) => (r.drive_file_id ? (
                <Space size={4}>
                  <a onClick={(e) => { e.stopPropagation(); setOpenVideo({ id: r.drive_file_id, name: n }); }}>{n}</a>
                  {r.source_posts > 1 && <Tag style={{ margin: 0 }}>x{r.source_posts}</Tag>}
                </Space>
              ) : <Typography.Text type="secondary">—</Typography.Text>),
            },
            {
              title: 'Đăng lúc',
              dataIndex: 'published_at',
              width: 130,
              sorter: (a, b) => a.published_at - b.published_at,
              render: (t) => (
                <>
                  <div>{dayjs(t).format('DD/MM/YYYY HH:mm')}</div>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>{dayjs(t).fromNow()}</Typography.Text>
                </>
              ),
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
        )}
      </Card>
      {openPage && <PageDrawer pageId={openPage} reels={data} days={days} onClose={() => setOpenPage(null)} onOpenReel={setOpen} />}
      {open && <HistoryDrawer reel={open} onClose={() => setOpen(null)} onOpenVideo={setOpenVideo} />}
      {openVideo && <VideoDrawer video={openVideo} onClose={() => setOpenVideo(null)} />}
    </Space>
  );
}
