import {
  memo, useMemo, useState, useSyncExternalStore,
} from 'react';
import {
  Button, Card, Empty, Segmented, Select, Space, Switch, Table, Tag, Tooltip, Typography,
} from 'antd';
import { CalendarOutlined, FolderOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { fmtNum, groupColor, useApi } from '../api.js';
import { openScheduleWith } from '../prefill.js';
import { createSelection } from '../selection.js';
import TagFilter from './TagFilter.jsx';
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

const compactFmt = Intl.NumberFormat('vi-VN', { notation: 'compact' });
const compact = (v) => compactFmt.format(v);
// Plain spans styled like antd's green / blue Tag: the table can hold thousands of cells.
const badge = (color, bg, border) => ({
  display: 'inline-block', padding: '0 6px', margin: '0 1px', fontSize: 12, lineHeight: '20px',
  color, background: bg, border: `1px solid ${border}`, borderRadius: 4,
});
const BADGE = { done: badge('#389e0d', '#f6ffed', '#b7eb8f'), upcoming: badge('#0958d9', '#e6f4ff', '#91caff') };

const matrixCell = (page, video) => ({ key: `${page.id}|${video.id}`, page, video });

// One cell: posts of this video on this page (plus scheduled ones still waiting) and their views.
// Clicking it selects / unselects it for scheduling. It fills the whole table cell.
const Cell = memo(({ c, page, video, tint, sel }) => {
  const key = `${page.id}|${video.id}`;
  const on = useSyncExternalStore((fn) => sel.subscribeCell(key, fn), () => sel.has(key));
  const tip = `${page.name} · ${video.name}\n${c
    ? `${c.done} lần đã đăng${c.upcoming ? `, ${c.upcoming} lần sắp đăng` : ''} · ${fmtNum(c.views)} views${
      c.last_at ? `\nĐăng gần nhất: ${dayjs(c.last_at).format('HH:mm DD/MM/YYYY')} (${dayjs(c.last_at).fromNow()})` : ''}`
    : 'Chưa đăng'}\n${on ? 'Đang chọn · bấm để bỏ chọn' : 'Bấm để chọn'}`;
  return (
    <div
      title={tip}
      onClick={() => sel.toggle([matrixCell(page, video)])}
      style={{
        minHeight: 38, padding: 2, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', background: on ? '#bae0ff' : tint, boxShadow: on ? 'inset 0 0 0 2px #1677ff' : undefined,
      }}
    >
      {c ? (
        <>
          <span>
            {c.done > 0 && <span style={BADGE.done}>{c.done}</span>}
            {c.upcoming > 0 && <span style={BADGE.upcoming}>+{c.upcoming}</span>}
          </span>
          {c.done > 0 && <span style={{ fontSize: 11, lineHeight: 1.3, color: 'rgba(0,0,0,0.45)' }}>{compact(c.views)} view</span>}
          {c.last_at && <span style={{ fontSize: 10, lineHeight: 1.3, color: 'rgba(0,0,0,0.45)' }}>{dayjs(c.last_at).format('HH:mm DD/MM')}</span>}
        </>
      ) : <span style={{ color: 'rgba(0,0,0,0.25)' }}>·</span>}
    </div>
  );
});

// "Đã chọn N ô" + schedule button; re-renders on its own when the selection changes.
function SelectionBar({ sel }) {
  useSyncExternalStore(sel.subscribeAll, sel.version);
  const items = sel.items();
  const pages = new Set(items.map((s) => s.page.id));
  const videos = new Map(items.map((s) => [s.video.id, s.video]));
  const schedule = () => openScheduleWith({
    pageIds: [...pages],
    videos: [...videos.values()],
    pairs: items.map((s) => ({ pageId: s.page.id, videoId: s.video.id })),
  });
  return (
    <div
      style={{
        position: 'sticky', top: 0, zIndex: 5, marginBottom: 12, padding: '8px 12px', borderRadius: 8,
        background: items.length ? '#e6f4ff' : '#fafafa', border: `1px solid ${items.length ? '#91caff' : '#f0f0f0'}`,
      }}
    >
      <Space wrap>
        {items.length
          ? <Typography.Text strong>Đã chọn {items.length} ô ({pages.size} page, {videos.size} video)</Typography.Text>
          : <Typography.Text type="secondary">Chưa chọn ô nào</Typography.Text>}
        <Button type="primary" icon={<CalendarOutlined />} disabled={!items.length} onClick={schedule}>
          Đặt lịch {items.length ? `${items.length} lượt` : ''}
        </Button>
        {items.length > 0 && <Button onClick={sel.clear}>Bỏ chọn</Button>}
      </Space>
    </div>
  );
}

// Pages down the side, videos across the top grouped under their folder.
export default function PageVideoMatrix() {
  const [openVideo, setOpenVideo] = useState(null);
  // Kept while changing folder / group.
  const [sel] = useState(createSelection);
  const { data: folders = [] } = useApi('/video-folders');
  const { data: groups = [] } = useApi('/groups');
  const { data: allPages = [] } = useApi('/pages');
  const [folder, setFolder] = useState('');
  const [group, setGroup] = useState('');
  const [tags, setTags] = useState([]);
  const [postedOnly, setPostedOnly] = useState(false);
  const [sortBy, setSortBy] = useState('name');
  const query = new URLSearchParams({ folder, group, tags: tags.join(',') }).toString();
  const { data, loading } = useApi(`/videos/page-matrix?${query}`);

  const { rows, folderCols, videoTotals, videoUpcoming, folderTotals, grand } = useMemo(() => {
    const cells = new Map((data?.cells || []).map((c) => [`${c.page}|${c.video}`, c]));
    const videoTotals = {};
    const videoUpcoming = {};
    for (const c of data?.cells || []) {
      videoTotals[c.video] = (videoTotals[c.video] || 0) + c.done;
      videoUpcoming[c.video] = (videoUpcoming[c.video] || 0) + c.upcoming;
    }

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
    // 'group': pages of a group together (groups by name, ungrouped last), by name inside.
    const byGroup = (a, b) => (!a.group_name - !b.group_name)
      || (a.group_name || '').localeCompare(b.group_name || '', 'vi') || byName(a, b);
    list.sort({ done: (a, b) => b.done - a.done || byName(a, b), group: byGroup }[sortBy] || byName);
    return {
      rows: list,
      folderCols,
      videoTotals,
      videoUpcoming,
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

  // Rebuilt only when the data or filters change, never on a selection click.
  const columns = useMemo(() => [
    {
      title: 'Page',
      dataIndex: 'name',
      fixed: 'left',
      width: 250,
      // Clicking the page name selects / unselects every visible video in its row.
      render: (n, p) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <a
            title={`${n} · bấm để chọn cả dòng`}
            onClick={() => sel.toggle(folderCols.flatMap((f) => f.videos.map((v) => matrixCell(p, v))))}
            style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
          >
            {n}
          </a>
          {p.group_name && (
            <Tag color={groupColor(p.group_name)} style={{ margin: 0, flexShrink: 0, maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {p.group_name}
            </Tag>
          )}
        </div>
      ),
    },
    {
      title: 'Tổng',
      dataIndex: 'done',
      fixed: 'left',
      width: 90,
      align: 'center',
      render: (n, p) => (
        <span title={`${n} lần, ${p.videosPosted} video khác nhau`}>
          <b>{n}</b> <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>({p.videosPosted})</span>
        </span>
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
          render: (_, p) => (p.byFolder[f.name] ? <b>{p.byFolder[f.name]}</b> : <span style={{ color: 'rgba(0,0,0,0.25)' }}>0</span>),
        },
        ...f.videos.map((v) => ({
          key: v.id,
          title: (
            <>
              <Tooltip title={`${folderLabel(f.name)} / ${v.name}`}>
                <a
                  onClick={() => setOpenVideo({ id: v.id, name: v.name })}
                  style={{ display: 'block', maxWidth: VIDEO_COL - 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                  {v.name.replace(/\.[^.]+$/, '')}
                </a>
              </Tooltip>
              {/* Scheduled / posted times of this video, over the pages shown. */}
              <div style={{ fontSize: 11, fontWeight: 400, lineHeight: 1.4 }} title="Số lần sắp đăng / đã đăng">
                {videoUpcoming[v.id] || videoTotals[v.id] ? (
                  <>
                    <span style={{ color: videoUpcoming[v.id] ? '#0958d9' : 'rgba(0,0,0,0.35)' }}>{videoUpcoming[v.id] || 0} sắp</span>
                    {' / '}
                    <span style={{ color: videoTotals[v.id] ? '#389e0d' : 'rgba(0,0,0,0.35)' }}>{videoTotals[v.id] || 0} đã</span>
                  </>
                ) : <span style={{ color: 'rgba(0,0,0,0.35)' }}>chưa đăng</span>}
              </div>
            </>
          ),
          width: VIDEO_COL,
          align: 'center',
          onHeaderCell: headTint(f.tint[0]),
          onCell: () => ({ style: { padding: 0 } }),
          render: (_, p) => <Cell c={p.cells[v.id]} page={p} video={v} tint={f.tint[0]} sel={sel} />,
        })),
      ],
    })),
  ], [folderCols, videoTotals, videoUpcoming, sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const videoCount = folderCols.reduce((s, f) => s + f.videos.length, 0);

  return (
    <Card title="Page × video: page nào đã đăng video nào">
      <Space wrap style={{ marginBottom: 12 }}>
        <Typography.Text>Thư mục:</Typography.Text>
        <Select style={{ width: 260 }} value={folder} onChange={setFolder} options={folderOptions} showSearch optionFilterProp="value" />
        <Typography.Text>Nhóm page:</Typography.Text>
        <Select style={{ width: 200 }} value={group} onChange={setGroup} options={groupOptions} />
        <Typography.Text>Tag:</Typography.Text>
        <TagFilter pages={allPages} value={tags} onChange={setTags} style={{ width: 200 }} />
        <Segmented
          value={sortBy}
          onChange={setSortBy}
          options={[{ value: 'name', label: 'Page theo tên' }, { value: 'group', label: 'Theo nhóm' }, { value: 'done', label: 'Page đăng nhiều nhất' }]}
        />
        <Space><Switch checked={postedOnly} onChange={setPostedOnly} />Chỉ video đã đăng</Space>
      </Space>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Mỗi dòng là một page, mỗi cột là một video (gom và tô màu theo thư mục). Ô <Tag color="green" style={{ margin: 0 }}>2</Tag> là
        số lần page đã đăng video đó (kèm tổng views bên dưới), <Tag color="blue" style={{ margin: 0 }}>+1</Tag> là số lần đang chờ
        đăng. Cột "Tổng" bên trái ghi tổng số lần đăng của page và (số video khác nhau); cột "Tổng" đầu mỗi thư mục là tổng của
        thư mục đó. <b>Bấm vào ô để chọn</b> (chọn được nhiều ô, bấm tên page để chọn cả dòng), rồi bấm <b>Đặt lịch</b>; bấm tên video
        để xem chi tiết.
      </Typography.Paragraph>
      <SelectionBar sel={sel} />
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
          scroll={{ x: 340 + folderCols.length * 70 + videoCount * VIDEO_COL, y: 620 }}
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
