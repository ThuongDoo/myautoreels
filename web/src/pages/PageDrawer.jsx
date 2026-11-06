import { useEffect, useMemo, useState } from 'react';
import {
  Alert, Avatar, Button, Card, Col, Descriptions, Drawer, Empty, List, Row, Segmented, Space, Statistic, Table, Tag, Typography,
} from 'antd';
import { FireOutlined } from '@ant-design/icons';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import dayjs from 'dayjs';
import { fmtNum, fmtSec, groupColor, useApi } from '../api.js';

const STATUS = {
  pending: 'Chờ đăng',
  uploading: 'Đang tải lên',
  uploaded: 'Đã tải lên',
  publishing: 'Đang đăng',
  processing: 'Đang xử lý',
};
const compact = (v) => Intl.NumberFormat('vi-VN', { notation: 'compact' }).format(v);
const pct = (v) => `${(v * 100).toFixed(1)}%`;

// Periods offered when the drawer loads the page's reels itself. 3650 = everything.
const PERIODS = [
  { value: 7, label: '7 ngày' },
  { value: 30, label: '30 ngày' },
  { value: 90, label: '90 ngày' },
  { value: 3650, label: 'Tất cả' },
];

// Whether the page is public on Facebook, read live. `onChanged` fires once it is known, since
// the server remembers it for the page list. Facebook's API can't change it on new-experience
// Pages, so hiding a page is done on Facebook itself.
function FacebookVisibility({ pageId, onChanged }) {
  const { data, error, loading } = useApi(`/pages/${pageId}/fb-status`);
  const published = data?.published;
  useEffect(() => { if (published !== undefined) onChanged?.(); }, [published]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={`Không đọc được trạng thái trên Facebook: ${error.message}`} />;
  return (
    <Space style={{ marginBottom: 16 }}>
      <Typography.Text strong>Trên Facebook:</Typography.Text>
      {published === undefined
        ? <Typography.Text type="secondary">{loading ? 'đang kiểm tra...' : '-'}</Typography.Text>
        : <Tag color={published ? 'green' : 'red'}>{published ? 'Đang hiện công khai' : 'Đã ẩn'}</Tag>}
    </Space>
  );
}

// Detail of one page: totals for a period, all-time numbers and the upcoming queue from the
// server, and the page's reels. `reels` already filtered by the parent, or left out to load
// the page's reels here with a period picker. `onChanged` fires once the Facebook status is read.
export default function PageDrawer({
  pageId, reels, periodLabel, onClose, onOpenReel, onChanged,
}) {
  const { data: s } = useApi(`/pages/${pageId}/summary`);
  const [days, setDays] = useState(30);
  const { data: loaded = [], loading } = useApi(reels ? null : `/reels?days=${days}&pageId=${encodeURIComponent(pageId)}`);
  const source = reels || loaded;
  const label = periodLabel || (days === 3650 ? 'từ trước đến nay' : `${days} ngày qua`);
  const own = useMemo(
    () => source.filter((r) => r.page_id === pageId).sort((a, b) => a.published_at - b.published_at),
    [source, pageId],
  );

  const stats = useMemo(() => {
    const sum = (f) => own.reduce((t, r) => t + f(r), 0);
    const views = sum((r) => r.views);
    const interactions = sum((r) => r.likes + r.comments + r.shares);
    const perDay = new Set(own.map((r) => dayjs(r.published_at).format('YYYY-MM-DD'))).size;
    return {
      views,
      avg: own.length ? views / own.length : 0,
      eng: views ? interactions / views : 0,
      viral: own.filter((r) => r.viral).length,
      likes: sum((r) => r.likes),
      comments: sum((r) => r.comments),
      shares: sum((r) => r.shares),
      perDay: perDay ? own.length / perDay : 0,
    };
  }, [own]);

  // Most used publish hours, e.g. "07h (5) · 11h (4)".
  const hours = useMemo(() => {
    const count = new Map();
    for (const r of own) {
      const h = dayjs(r.published_at).hour();
      count.set(h, (count.get(h) || 0) + 1);
    }
    return [...count].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [own]);

  const chart = own.map((r) => ({ ...r, t: dayjs(r.published_at).format('DD/MM HH:mm') }));
  const page = s?.page;

  return (
    <Drawer
      open
      width={920}
      onClose={onClose}
      title={(
        <Typography.Text>
          {page?.picture && <Avatar src={page.picture} size="small" style={{ marginRight: 8 }} />}
          {page?.name || pageId}
        </Typography.Text>
      )}
      extra={<Button type="link" href={`https://www.facebook.com/${pageId}`} target="_blank">Mở page →</Button>}
    >
      <FacebookVisibility pageId={pageId} onChanged={onChanged} />

      <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
        <Descriptions.Item label="Nhóm">
          {page?.group_name ? <Tag color={groupColor(page.group_name)}>{page.group_name}</Tag> : 'Chưa có nhóm'}
        </Descriptions.Item>
        <Descriptions.Item label="Trạng thái">
          {page ? (page.enabled ? <Tag color="green">Đang bật</Tag> : <Tag>Đã tắt</Tag>) : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="Tài khoản BM">{page?.account_name || '-'}</Descriptions.Item>
        <Descriptions.Item label="Tổng reel (mọi lúc)">{fmtNum(s?.totals.reels)}</Descriptions.Item>
        <Descriptions.Item label="Reel đầu tiên">
          {s?.totals.first_at ? dayjs(s.totals.first_at).format('DD/MM/YYYY HH:mm') : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="Đăng gần nhất">
          {s?.totals.last_at ? `${dayjs(s.totals.last_at).format('DD/MM HH:mm')} (${dayjs(s.totals.last_at).fromNow()})` : '-'}
        </Descriptions.Item>
        <Descriptions.Item label="Lịch chờ đăng">{fmtNum(s?.jobs.upcoming)}</Descriptions.Item>
        <Descriptions.Item label="Lịch lỗi">
          <Typography.Text type={s?.jobs.failed ? 'danger' : undefined}>{fmtNum(s?.jobs.failed)}</Typography.Text>
        </Descriptions.Item>
      </Descriptions>

      <Space style={{ marginBottom: 8 }} wrap>
        <Typography.Title level={5} style={{ margin: 0 }}>{label.charAt(0).toUpperCase() + label.slice(1)}</Typography.Title>
        {!reels && <Segmented size="small" value={days} onChange={setDays} options={PERIODS} />}
      </Space>
      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        {[
          { title: 'Số reel', value: fmtNum(own.length) },
          { title: 'Reel / ngày đăng', value: stats.perDay.toFixed(1) },
          { title: 'Tổng views', value: fmtNum(stats.views) },
          { title: 'Views TB / reel', value: fmtNum(Math.round(stats.avg)) },
          { title: 'Tỉ lệ tương tác', value: pct(stats.eng) },
          { title: 'Reel viral', value: fmtNum(stats.viral) },
          { title: 'Like', value: fmtNum(stats.likes) },
          { title: 'Comment · Share', value: `${fmtNum(stats.comments)} · ${fmtNum(stats.shares)}` },
        ].map((x) => (
          <Col span={6} key={x.title}>
            <Card size="small"><Statistic title={x.title} value={x.value} valueStyle={{ fontSize: 18 }} /></Card>
          </Col>
        ))}
      </Row>

      <Typography.Paragraph>
        <Typography.Text strong>Giờ đăng hay dùng: </Typography.Text>
        {hours.length
          ? hours.map(([h, n]) => `${String(h).padStart(2, '0')}h (${n})`).join(' · ')
          : <Typography.Text type="secondary">chưa có reel</Typography.Text>}
      </Typography.Paragraph>

      <Typography.Title level={5}>Views từng reel theo thời gian đăng</Typography.Title>
      {chart.length ? (
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#e1e0d9" />
            <XAxis dataKey="t" tick={{ fontSize: 11 }} minTickGap={30} />
            <YAxis tickFormatter={compact} width={44} tick={{ fontSize: 11 }} />
            <Tooltip formatter={(v) => fmtNum(v)} labelFormatter={(t, p) => `${t} · ${p?.[0]?.payload.drive_file_name || ''}`} />
            <Bar dataKey="views" name="Views" maxBarSize={24} radius={[3, 3, 0, 0]} onClick={(d) => onOpenReel(d.payload ?? d)} style={{ cursor: 'pointer' }}>
              {chart.map((r) => <Cell key={r.video_id} fill={r.viral ? '#f76b15' : '#2a78d6'} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có reel trong khoảng này" />}

      <Typography.Title level={5} style={{ marginTop: 16 }}>Lịch sắp đăng</Typography.Title>
      {s?.next.length ? (
        <List
          size="small"
          dataSource={s.next}
          renderItem={(j) => (
            <List.Item extra={<Tag>{STATUS[j.status] || j.status}</Tag>}>
              <Typography.Text strong style={{ width: 110, display: 'inline-block' }}>{dayjs(j.scheduled_at).format('DD/MM HH:mm')}</Typography.Text>
              <Typography.Text ellipsis style={{ maxWidth: 440 }}>{j.drive_file_name}</Typography.Text>
            </List.Item>
          )}
          footer={s.jobs.upcoming > s.next.length ? <Typography.Text type="secondary">… và {s.jobs.upcoming - s.next.length} lịch khác</Typography.Text> : null}
        />
      ) : <Typography.Text type="secondary">Không có lịch nào đang chờ</Typography.Text>}

      <Typography.Title level={5} style={{ marginTop: 16 }}>Reel đã đăng ({own.length})</Typography.Title>
      <Table
        rowKey="video_id"
        size="small"
        loading={!reels && loading}
        dataSource={own}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        onRow={(r) => ({ onClick: () => onOpenReel(r), style: { cursor: 'pointer' } })}
        columns={[
          {
            title: 'Đăng lúc',
            dataIndex: 'published_at',
            width: 110,
            defaultSortOrder: 'descend',
            sorter: (a, b) => a.published_at - b.published_at,
            render: (t) => dayjs(t).format('DD/MM HH:mm'),
          },
          {
            title: 'Video',
            key: 'name',
            ellipsis: true,
            render: (_, r) => (
              <>
                {r.viral ? <FireOutlined style={{ color: '#f76b15', marginRight: 4 }} /> : null}
                {r.drive_file_name || r.caption || '(không caption)'}
              </>
            ),
          },
          { title: 'Views', dataIndex: 'views', width: 90, align: 'right', sorter: (a, b) => a.views - b.views, render: fmtNum },
          { title: 'Like', dataIndex: 'likes', width: 70, align: 'right', sorter: (a, b) => a.likes - b.likes, render: fmtNum },
          { title: 'Cmt', dataIndex: 'comments', width: 60, align: 'right', render: fmtNum },
          { title: 'Share', dataIndex: 'shares', width: 65, align: 'right', render: fmtNum },
          { title: 'Xem TB', dataIndex: 'avg_watch_ms', width: 70, align: 'right', render: fmtSec },
          {
            title: 'Viral',
            dataIndex: 'viral_score',
            width: 70,
            align: 'right',
            sorter: (a, b) => (a.viral_score || 0) - (b.viral_score || 0),
            render: (v, r) => (v == null ? '-' : <Tag color={r.viral ? 'volcano' : 'default'} style={{ margin: 0 }}>x{v.toFixed(1)}</Tag>),
          },
          {
            title: '',
            key: 'fb',
            width: 50,
            render: (_, r) => <a href={r.permalink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Mở</a>,
          },
        ]}
      />
    </Drawer>
  );
}
