import { useMemo, useState } from 'react';
import {
  Alert, Button, Card, Col, Collapse, Empty, Row, Segmented, Space, Statistic, Table, Tag, Typography,
} from 'antd';
import { FireOutlined, ReloadOutlined } from '@ant-design/icons';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtNum, groupColor, musicFileFor, parseVideoName, useApi } from '../api.js';

const UNKNOWN = '(không rõ)';
const compact = (v) => Intl.NumberFormat('vi-VN', { notation: 'compact' }).format(v);
const pct = (v) => `${(v * 100).toFixed(1)}%`;

const CHART_METRICS = {
  views: { label: 'Tổng views', get: (m) => m.views },
  avg: { label: 'Views TB / reel', get: (m) => m.avg },
  reels: { label: 'Số reel', get: (m) => m.reels },
};

function Player({ file }) {
  return (
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio controls preload="none" style={{ height: 30, width: 220 }} src={`/api/drive/stream/${encodeURIComponent(file.id)}`} />
  );
}

// Reels grouped by the music code in their source video's name (see parseVideoName).
export default function MusicStats({ reels, days, onOpenReel }) {
  // `fresh` skips the server's cache of the music folder.
  const [fresh, setFresh] = useState(0);
  const { data: music, loading: musicLoading, error: musicError } = useApi(fresh ? `/music?fresh=${fresh}` : '/music');
  const files = music?.files || [];
  const [chartMetric, setChartMetric] = useState('views');

  const rows = useMemo(() => {
    const map = new Map();
    for (const r of reels) {
      const info = parseVideoName(r.drive_file_name);
      const code = (r.drive_file_name && info.music) || UNKNOWN;
      const key = code.toLowerCase();
      const m = map.get(key) || {
        code, views: 0, reels: 0, likes: 0, comments: 0, shares: 0, viral: 0,
        pages: new Set(), groups: new Set(), videos: new Map(), list: [],
      };
      m.views += r.views;
      m.reels++;
      m.likes += r.likes;
      m.comments += r.comments;
      m.shares += r.shares;
      if (r.viral) m.viral++;
      m.pages.add(r.page_id);
      if (info.group) m.groups.add(info.group);
      const vid = r.drive_file_id || r.video_id;
      const v = m.videos.get(vid) || { id: vid, name: r.drive_file_name || r.caption || '(không rõ)', ...info, reels: 0, views: 0 };
      v.reels++;
      v.views += r.views;
      m.videos.set(vid, v);
      m.list.push(r);
      map.set(key, m);
    }
    return [...map.values()]
      .map((m) => ({
        ...m,
        file: m.code === UNKNOWN ? null : musicFileFor(m.code, files),
        avg: m.views / m.reels,
        eng: m.views ? (m.likes + m.comments + m.shares) / m.views : 0,
        videoList: [...m.videos.values()].sort((a, b) => b.views - a.views),
        groupList: [...m.groups].sort(),
      }))
      .sort((a, b) => b.views - a.views);
  }, [reels, files]);

  const known = rows.filter((m) => m.code !== UNKNOWN);
  const usedFiles = new Set(known.map((m) => m.file?.id).filter(Boolean));
  const unused = files.filter((f) => !usedFiles.has(f.id));
  const CM = CHART_METRICS[chartMetric];
  const chart = [...known].sort((a, b) => CM.get(b) - CM.get(a)).slice(0, 20);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {musicError && <Alert type="error" showIcon message={`Không đọc được thư mục nhạc: ${musicError.message}`} />}
      {music && !music.configured && (
        <Alert
          type="info"
          showIcon
          message="Chưa có thư mục nhạc. Vào Cài đặt → Google Drive → Thư mục nhạc để ghép mã nhạc với file nhạc và nghe thử."
        />
      )}

      <Row gutter={[16, 16]}>
        {[
          { title: 'Số nhạc đã dùng', value: known.length },
          { title: 'Nhạc trong thư mục', value: music?.configured ? files.length : '-' },
          { title: `Nhạc chưa dùng (${days} ngày)`, value: music?.configured ? unused.length : '-' },
          { title: 'Mã nhạc không có file', value: music?.configured ? known.filter((m) => !m.file).length : '-' },
        ].map((s) => (
          <Col flex="1 1 170px" key={s.title}>
            <Card size="small"><Statistic title={s.title} value={s.value} formatter={(v) => fmtNum(v)} /></Card>
          </Col>
        ))}
      </Row>

      <Card
        size="small"
        title={`Top nhạc theo ${CM.label.toLowerCase()}`}
        extra={(
          <Segmented
            size="small"
            value={chartMetric}
            onChange={setChartMetric}
            options={Object.entries(CHART_METRICS).map(([value, m]) => ({ value, label: m.label }))}
          />
        )}
      >
        {chart.length ? (
          <ResponsiveContainer width="100%" height={Math.max(160, chart.length * 30 + 40)}>
            <BarChart data={chart} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap={6}>
              <CartesianGrid stroke="#e1e0d9" horizontal={false} />
              <XAxis type="number" tickFormatter={compact} tick={{ fontSize: 11, fill: '#898781' }} />
              <YAxis type="category" dataKey="code" width={90} tick={{ fontSize: 12, fill: '#52514e' }} axisLine={false} tickLine={false} />
              <Tooltip
                formatter={(v) => fmtNum(Math.round(v))}
                labelFormatter={(code, p) => {
                  const m = p?.[0]?.payload;
                  return m ? `${code}${m.file ? ` · ${m.file.name}` : ''} — ${m.reels} reel, ${m.videos.size} video` : code;
                }}
              />
              <Bar
                isAnimationActive={false}
                dataKey={(m) => CM.get(m)}
                name={CM.label}
                fill="#2a78d6"
                radius={[0, 4, 4, 0]}
                maxBarSize={20}
                label={{ position: 'right', fontSize: 11, fill: '#52514e', formatter: (v) => compact(Math.round(v)) }}
              />
            </BarChart>
          </ResponsiveContainer>
        ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có reel nào có mã nhạc trong tên video" />}
      </Card>

      <Card
        size="small"
        title="Chi tiết theo nhạc"
        extra={<Button size="small" type="text" icon={<ReloadOutlined />} loading={musicLoading} onClick={() => setFresh(Date.now())}>Tải lại thư mục nhạc</Button>}
      >
        <Table
          rowKey="code"
          size="small"
          dataSource={rows}
          pagination={{ pageSize: 30, showSizeChanger: false }}
          scroll={{ x: 1100 }}
          expandable={{
            expandedRowRender: (m) => (
              <Table
                rowKey="id"
                size="small"
                pagination={false}
                dataSource={m.videoList}
                columns={[
                  { title: 'Nhóm', dataIndex: 'group', width: 120, render: (g) => (g ? <Tag color={groupColor(g)}>{g}</Tag> : '-') },
                  { title: 'STT', dataIndex: 'index', width: 70 },
                  { title: 'Video', dataIndex: 'name', ellipsis: true },
                  { title: 'Số reel', dataIndex: 'reels', width: 80, align: 'right' },
                  { title: 'Views', dataIndex: 'views', width: 100, align: 'right', render: fmtNum },
                  { title: 'TB / reel', key: 'avg', width: 100, align: 'right', render: (_, v) => fmtNum(Math.round(v.views / v.reels)) },
                  {
                    title: 'Reel tốt nhất',
                    key: 'best',
                    width: 110,
                    render: (_, v) => {
                      const best = m.list.filter((r) => (r.drive_file_id || r.video_id) === v.id).sort((a, b) => b.views - a.views)[0];
                      return best ? <a onClick={() => onOpenReel(best)}>{fmtNum(best.views)} views</a> : '-';
                    },
                  },
                ]}
              />
            ),
          }}
          columns={[
            {
              title: 'Mã nhạc',
              dataIndex: 'code',
              width: 110,
              fixed: 'left',
              render: (c) => (c === UNKNOWN ? <Typography.Text type="secondary">{c}</Typography.Text> : <Typography.Text strong>{c}</Typography.Text>),
            },
            {
              title: 'File nhạc',
              key: 'file',
              width: 260,
              render: (_, m) => {
                if (m.code === UNKNOWN) return <Typography.Text type="secondary">Reel đăng ngoài app hoặc tên video sai mẫu</Typography.Text>;
                if (!music?.configured) return '-';
                if (!m.file) return <Typography.Text type="warning">Không tìm thấy trong thư mục</Typography.Text>;
                return (
                  <Space direction="vertical" size={2}>
                    <Typography.Text ellipsis style={{ maxWidth: 240 }} title={m.file.name}>{m.file.name}</Typography.Text>
                    <Player file={m.file} />
                  </Space>
                );
              },
            },
            {
              title: 'Nhóm video',
              key: 'groups',
              width: 160,
              render: (_, m) => m.groupList.map((g) => <Tag key={g} color={groupColor(g)} style={{ marginBottom: 2 }}>{g}</Tag>),
            },
            { title: 'Video', key: 'videos', width: 70, align: 'right', sorter: (a, b) => a.videos.size - b.videos.size, render: (_, m) => m.videos.size },
            { title: 'Reel', dataIndex: 'reels', width: 70, align: 'right', sorter: (a, b) => a.reels - b.reels },
            { title: 'Page', key: 'pages', width: 70, align: 'right', sorter: (a, b) => a.pages.size - b.pages.size, render: (_, m) => m.pages.size },
            { title: 'Tổng views', dataIndex: 'views', width: 110, align: 'right', defaultSortOrder: 'descend', sorter: (a, b) => a.views - b.views, render: fmtNum },
            { title: 'TB / reel', dataIndex: 'avg', width: 100, align: 'right', sorter: (a, b) => a.avg - b.avg, render: (v) => fmtNum(Math.round(v)) },
            { title: 'Tương tác', dataIndex: 'eng', width: 90, align: 'right', sorter: (a, b) => a.eng - b.eng, render: pct },
            {
              title: 'Viral',
              dataIndex: 'viral',
              width: 70,
              align: 'right',
              sorter: (a, b) => a.viral - b.viral,
              render: (n) => (n ? <Space size={4}><FireOutlined style={{ color: '#f76b15' }} />{n}</Space> : 0),
            },
          ]}
        />
      </Card>

      {music?.configured && unused.length > 0 && (
        <Collapse
          size="small"
          items={[{
            key: 'unused',
            label: `Nhạc chưa có reel nào trong ${days} ngày qua (${unused.length})`,
            children: (
              <Table
                rowKey="id"
                size="small"
                pagination={{ pageSize: 20, showSizeChanger: false }}
                dataSource={unused}
                columns={[
                  { title: 'File nhạc', dataIndex: 'name', ellipsis: true },
                  { title: 'Thư mục', dataIndex: 'folder', width: 180, ellipsis: true },
                  { title: 'Nghe', key: 'play', width: 240, render: (_, f) => <Player file={f} /> },
                ]}
              />
            ),
          }]}
        />
      )}
    </Space>
  );
}
