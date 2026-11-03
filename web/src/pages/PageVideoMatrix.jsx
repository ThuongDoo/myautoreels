import { useMemo, useState } from 'react';
import {
  Card, Empty, Segmented, Select, Space, Switch, Table, Tag, Tooltip, Typography,
} from 'antd';
import { FolderOutlined } from '@ant-design/icons';
import { fmtNum, groupColor, useApi } from '../api.js';
import { openScheduleWith } from '../prefill.js';
import VideoDrawer from './VideoDrawer.jsx';

const NO_GROUP = '__none__';

// Light tints, one per folder (header a step darker), in folder order.
const TINTS = [
  ['#eef5ff', '#d9e8ff'], ['#eefaf1', '#d6f0dd'], ['#fff6e8', '#ffe7c2'], ['#f6efff', '#e6d9ff'],
  ['#ffeef3', '#ffd6e2'], ['#eafafa', '#cdeeee'], ['#f7f7ea', '#ebebc9'], ['#f2f2f2', '#e1e1e1'],
];
const folderLabel = (f) => f || '(thư mục gốc)';
const VIDEO_COL = 86;
const byName = (a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true });

const compact = (v) => Intl.NumberFormat('vi-VN', { notation: 'compact' }).format(v);

// One cell: posts of this video on this page (plus scheduled ones still waiting) and their views.
// Clicking it opens the schedule form for this page and video.
function Cell({ c, page, video }) {
  const tip = c
    ? `${page.name} · ${video.name}\n${c.done} lần đã đăng${c.upcoming ? `, ${c.upcoming} lần sắp đăng` : ''} · ${fmtNum(c.views)} views\nBấm để lên lịch thêm`
    : `${page.name} · ${video.name}\nChưa đăng · bấm để lên lịch`;
  return (
    <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tip}</span>}>
      <div style={{ minHeight: 34, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        {c ? (
          <>
            <Space size={2}>
              {c.done > 0 && <Tag color="green" style={{ margin: 0 }}>{c.done}</Tag>}
              {c.upcoming > 0 && <Tag color="blue" style={{ margin: 0 }}>+{c.upcoming}</Tag>}
            </Space>
            {c.done > 0 && <Typography.Text type="secondary" style={{ fontSize: 11, lineHeight: 1.3 }}>{compact(c.views)} view</Typography.Text>}
          </>
        ) : <Typography.Text type="secondary">·</Typography.Text>}
      </div>
    </Tooltip>
  );
}

// Pages down the side, videos across the top grouped under their folder.
export default function PageVideoMatrix() {
  const [openVideo, setOpenVideo] = useState(null);
  const { data: folders = [] } = useApi('/video-folders');
  const { data: groups = [] } = useApi('/groups');
  const [folder, setFolder] = useState('');
  const [group, setGroup] = useState('');
  const [postedOnly, setPostedOnly] = useState(false);
  const [sortBy, setSortBy] = useState('name');
  const query = new URLSearchParams({ folder, group }).toString();
  const { data, loading } = useApi(`/videos/page-matrix?${query}`);

  const { rows, folderCols, videoTotals, folderTotals, grand } = useMemo(() => {
    const cells = new Map((data?.cells || []).map((c) => [`${c.page}|${c.video}`, c]));
    const videoTotals = {};
    for (const c of data?.cells || []) videoTotals[c.video] = (videoTotals[c.video] || 0) + c.done;

    // Folders in name order, each with its videos (only posted ones when the switch is on).
    const names = [...new Set((data?.videos || []).map((v) => v.folder))].sort((a, b) => a.localeCompare(b, 'vi'));
    const folderCols = names
      .map((name, i) => ({
        name,
        tint: TINTS[i % TINTS.length],
        videos: data.videos
          .filter((v) => v.folder === name && (!postedOnly || videoTotals[v.id]))
          .sort(byName),
      }))
      .filter((f) => f.videos.length);
    const folderTotals = {};
    for (const f of folderCols) folderTotals[f.name] = f.videos.reduce((s, v) => s + (videoTotals[v.id] || 0), 0);

    const list = (data?.pages || []).map((p) => {
      const row = { ...p, cells: {}, byFolder: {}, done: 0, videosPosted: 0 };
      for (const f of folderCols) {
        let sum = 0;
        for (const v of f.videos) {
          const c = cells.get(`${p.id}|${v.id}`);
          if (!c) continue;
          row.cells[v.id] = c;
          sum += c.done;
          if (c.done) row.videosPosted++;
        }
        row.byFolder[f.name] = sum;
        row.done += sum;
      }
      return row;
    });
    list.sort(sortBy === 'done' ? (a, b) => b.done - a.done || byName(a, b) : byName);
    return {
      rows: list,
      folderCols,
      videoTotals,
      folderTotals,
      grand: list.reduce((s, p) => s + p.done, 0),
    };
  }, [data, postedOnly, sortBy]);

  const folderOptions = folders.map((f) => ({
    value: f.path,
    label: (
      <Space size={6}>
        <FolderOutlined style={{ color: '#f5a623' }} />
        {f.path || 'Tất cả thư mục'}
        <Typography.Text type="secondary">({f.videos})</Typography.Text>
      </Space>
    ),
  }));
  const groupOptions = [
    { value: '', label: 'Tất cả page' },
    ...groups.map((g) => ({ value: g.name, label: <Tag color={groupColor(g.name)} style={{ margin: 0 }}>{g.name}</Tag> })),
    { value: NO_GROUP, label: 'Chưa có nhóm' },
  ];

  const headTint = (color) => () => ({ style: { background: color } });
  const cellTint = (color) => () => ({ style: { background: color } });

  const columns = [
    {
      title: 'Page',
      dataIndex: 'name',
      fixed: 'left',
      width: 200,
      ellipsis: true,
      render: (n) => <Tooltip title={n}>{n}</Tooltip>,
    },
    {
      title: 'Tổng',
      dataIndex: 'done',
      fixed: 'left',
      width: 90,
      align: 'center',
      render: (n, p) => (
        <Tooltip title={`${n} lần, ${p.videosPosted} video khác nhau`}>
          <b>{n}</b> <Typography.Text type="secondary" style={{ fontSize: 12 }}>({p.videosPosted})</Typography.Text>
        </Tooltip>
      ),
    },
    ...folderCols.map((f) => ({
      key: `folder:${f.name}`,
      title: (
        <Space size={6}>
          <FolderOutlined style={{ color: '#d48806' }} />
          <b>{folderLabel(f.name)}</b>
          <Typography.Text type="secondary" style={{ fontWeight: 400 }}>({f.videos.length} video)</Typography.Text>
        </Space>
      ),
      onHeaderCell: headTint(f.tint[1]),
      children: [
        {
          key: `sum:${f.name}`,
          title: <b>Tổng</b>,
          width: 70,
          align: 'center',
          onHeaderCell: headTint(f.tint[1]),
          onCell: cellTint(f.tint[1]),
          render: (_, p) => (p.byFolder[f.name] ? <b>{p.byFolder[f.name]}</b> : <Typography.Text type="secondary">0</Typography.Text>),
        },
        ...f.videos.map((v) => ({
          key: v.id,
          title: (
            <Tooltip title={`${folderLabel(f.name)} / ${v.name}`}>
              <a
                onClick={() => setOpenVideo({ id: v.id, name: v.name })}
                style={{ display: 'block', maxWidth: VIDEO_COL - 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {v.name.replace(/\.[^.]+$/, '')}
              </a>
            </Tooltip>
          ),
          width: VIDEO_COL,
          align: 'center',
          onHeaderCell: headTint(f.tint[0]),
          onCell: (p) => ({
            style: { background: f.tint[0], cursor: 'pointer', padding: 2 },
            onClick: () => openScheduleWith({ pageIds: [p.id], videos: [v] }),
          }),
          render: (_, p) => <Cell c={p.cells[v.id]} page={p} video={v} />,
        })),
      ],
    })),
  ];
  const videoCount = folderCols.reduce((s, f) => s + f.videos.length, 0);

  return (
    <Card title="Page × video: page nào đã đăng video nào">
      <Space wrap style={{ marginBottom: 12 }}>
        <Typography.Text>Thư mục:</Typography.Text>
        <Select style={{ width: 260 }} value={folder} onChange={setFolder} options={folderOptions} showSearch optionFilterProp="value" />
        <Typography.Text>Nhóm page:</Typography.Text>
        <Select style={{ width: 200 }} value={group} onChange={setGroup} options={groupOptions} />
        <Segmented
          value={sortBy}
          onChange={setSortBy}
          options={[{ value: 'name', label: 'Page theo tên' }, { value: 'done', label: 'Page đăng nhiều nhất' }]}
        />
        <Space><Switch checked={postedOnly} onChange={setPostedOnly} />Chỉ video đã đăng</Space>
      </Space>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Mỗi dòng là một page, mỗi cột là một video (gom và tô màu theo thư mục). Ô <Tag color="green" style={{ margin: 0 }}>2</Tag> là
        số lần page đã đăng video đó (kèm tổng views bên dưới), <Tag color="blue" style={{ margin: 0 }}>+1</Tag> là số lần đang chờ
        đăng. Cột "Tổng" bên trái ghi tổng số lần đăng của page và (số video khác nhau); cột "Tổng" đầu mỗi thư mục là tổng của
        thư mục đó. <b>Bấm vào một ô để lên lịch video đó cho page đó</b>; bấm tên video để xem chi tiết.
      </Typography.Paragraph>
      {!loading && data && (!data.pages.length || !videoCount) ? (
        <Empty description={!data.pages.length ? 'Nhóm này không có page nào' : 'Thư mục này không có video'} />
      ) : (
        <Table
          rowKey="id"
          size="small"
          bordered
          loading={loading}
          dataSource={rows}
          columns={columns}
          pagination={false}
          scroll={{ x: 290 + folderCols.length * 70 + videoCount * VIDEO_COL, y: 620 }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><b>Tổng theo video</b></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="center"><b>{grand}</b></Table.Summary.Cell>
                {(() => {
                  let i = 2;
                  return folderCols.flatMap((f) => [
                    <Table.Summary.Cell key={`sum:${f.name}`} index={i++} align="center">
                      <b>{folderTotals[f.name]}</b>
                    </Table.Summary.Cell>,
                    ...f.videos.map((v) => (
                      <Table.Summary.Cell key={v.id} index={i++} align="center">
                        {videoTotals[v.id] ? <b>{videoTotals[v.id]}</b> : <Typography.Text type="secondary">0</Typography.Text>}
                      </Table.Summary.Cell>
                    )),
                  ]);
                })()}
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      )}
      {openVideo && <VideoDrawer video={openVideo} onClose={() => setOpenVideo(null)} />}
    </Card>
  );
}
