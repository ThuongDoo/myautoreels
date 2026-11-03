import { useMemo, useState } from 'react';
import {
  Card, Empty, Segmented, Select, Space, Switch, Table, Tag, Tooltip, Typography,
} from 'antd';
import { FolderOutlined } from '@ant-design/icons';
import { fmtNum, groupColor, useApi } from '../api.js';

const NO_GROUP = '__none__';

// Light row tints, one per folder (header row a step darker), in folder order.
const TINTS = [
  ['#eef5ff', '#d9e8ff'], ['#eefaf1', '#d6f0dd'], ['#fff6e8', '#ffe7c2'], ['#f6efff', '#e6d9ff'],
  ['#ffeef3', '#ffd6e2'], ['#eafafa', '#cdeeee'], ['#f7f7ea', '#ebebc9'], ['#f2f2f2', '#e1e1e1'],
];
const folderLabel = (f) => f || '(thư mục gốc)';

// One cell: posts of this video on this page, plus scheduled ones still waiting.
function Cell({ c }) {
  if (!c) return <Typography.Text type="secondary">·</Typography.Text>;
  return (
    <Tooltip title={`${c.done} lần đã đăng${c.upcoming ? `, ${c.upcoming} lần sắp đăng` : ''} · ${fmtNum(c.views)} views`}>
      <Space size={2}>
        {c.done > 0 && <Tag color="green" style={{ margin: 0 }}>{c.done}</Tag>}
        {c.upcoming > 0 && <Tag color="blue" style={{ margin: 0 }}>+{c.upcoming}</Tag>}
      </Space>
    </Tooltip>
  );
}

export default function PageVideoMatrix({ onOpenVideo }) {
  const { data: folders = [] } = useApi('/video-folders');
  const { data: groups = [] } = useApi('/groups');
  const [folder, setFolder] = useState('');
  const [group, setGroup] = useState('');
  const [postedOnly, setPostedOnly] = useState(false);
  const [sortBy, setSortBy] = useState('name');
  const query = new URLSearchParams({ folder, group }).toString();
  const { data, loading } = useApi(`/videos/page-matrix?${query}`);

  const { rows, pages, pageTotals, grand } = useMemo(() => {
    const cellMap = new Map((data?.cells || []).map((c) => [`${c.video}|${c.page}`, c]));
    const list = (data?.videos || []).map((v) => {
      let done = 0;
      let pagesPosted = 0;
      const cells = {};
      for (const p of data.pages) {
        const c = cellMap.get(`${v.id}|${p.id}`);
        if (!c) continue;
        cells[p.id] = c;
        done += c.done;
        if (c.done) pagesPosted++;
      }
      return { ...v, cells, done, pagesPosted };
    });
    const totals = {};
    for (const c of data?.cells || []) totals[c.page] = (totals[c.page] || 0) + c.done;

    // Rows grouped by folder: a header row (folder name + its per-page totals) followed by
    // the folder's videos, sorted inside the folder.
    const byName = (a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true });
    const sorter = sortBy === 'done' ? (a, b) => b.done - a.done || byName(a, b) : byName;
    const folders = [...new Set(list.map((v) => v.folder))].sort((a, b) => a.localeCompare(b, 'vi'));
    const grouped = [];
    folders.forEach((folder, i) => {
      const [tint, headTint] = TINTS[i % TINTS.length];
      const all = list.filter((v) => v.folder === folder);
      const shown = (postedOnly ? all.filter((v) => v.done > 0) : all).sort(sorter);
      if (!shown.length) return;
      const cells = {};
      for (const v of all) {
        for (const [page, c] of Object.entries(v.cells)) {
          const t = cells[page] || { done: 0, upcoming: 0, views: 0 };
          t.done += c.done;
          t.upcoming += c.upcoming;
          t.views += c.views;
          cells[page] = t;
        }
      }
      grouped.push({
        id: `folder:${folder}`,
        header: true,
        name: folderLabel(folder),
        count: all.length,
        done: all.reduce((s, v) => s + v.done, 0),
        pagesPosted: Object.values(cells).filter((c) => c.done).length,
        cells,
        tint: headTint,
      });
      for (const v of shown) grouped.push({ ...v, tint });
    });
    return {
      rows: grouped,
      pages: data?.pages || [],
      pageTotals: totals,
      grand: list.reduce((s, v) => s + v.done, 0),
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

  // Every cell gets the row's folder tint (a row style wouldn't reach the fixed columns).
  const tinted = (v) => ({ style: { background: v.tint, ...(v.header && { fontWeight: 600 }) } });
  const columns = [
    {
      title: 'Video',
      dataIndex: 'name',
      fixed: 'left',
      width: 260,
      ellipsis: true,
      onCell: tinted,
      render: (n, v) => (v.header ? (
        <Space size={6}>
          <FolderOutlined style={{ color: '#d48806' }} />
          {n}
          <Typography.Text type="secondary" style={{ fontWeight: 400 }}>({v.count} video)</Typography.Text>
        </Space>
      ) : (
        <Tooltip title={`${folderLabel(v.folder)} / ${n}`}>
          <a style={{ paddingLeft: 20 }} onClick={() => onOpenVideo({ id: v.id, name: n })}>{n}</a>
        </Tooltip>
      )),
    },
    {
      title: 'Tổng',
      dataIndex: 'done',
      fixed: 'left',
      width: 90,
      align: 'center',
      onCell: tinted,
      render: (n, v) => (
        <Tooltip title={`${n} lần trên ${v.pagesPosted}/${pages.length} page`}>
          <b>{n}</b> <Typography.Text type="secondary" style={{ fontSize: 12 }}>({v.pagesPosted})</Typography.Text>
        </Tooltip>
      ),
    },
    ...pages.map((p) => ({
      key: p.id,
      title: <Tooltip title={p.name}><div style={{ maxWidth: 76, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div></Tooltip>,
      width: 90,
      align: 'center',
      onCell: tinted,
      render: (_, v) => (v.header
        ? (v.cells[p.id]?.done ? <b>{v.cells[p.id].done}</b> : <Typography.Text type="secondary">0</Typography.Text>)
        : <Cell c={v.cells[p.id]} />),
    })),
  ];

  return (
    <Card title="Page đã đăng video nào">
      <Space wrap style={{ marginBottom: 12 }}>
        <Typography.Text>Thư mục:</Typography.Text>
        <Select style={{ width: 260 }} value={folder} onChange={setFolder} options={folderOptions} showSearch optionFilterProp="value" />
        <Typography.Text>Nhóm page:</Typography.Text>
        <Select style={{ width: 200 }} value={group} onChange={setGroup} options={groupOptions} />
        <Segmented
          value={sortBy}
          onChange={setSortBy}
          options={[{ value: 'name', label: 'Theo tên' }, { value: 'done', label: 'Đăng nhiều nhất' }]}
        />
        <Space><Switch checked={postedOnly} onChange={setPostedOnly} />Chỉ video đã đăng</Space>
      </Space>
      <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
        Mỗi ô là số lần page đó đã đăng video đó (<Tag color="green" style={{ margin: 0 }}>2</Tag>) và số lần đang chờ đăng
        (<Tag color="blue" style={{ margin: 0 }}>+1</Tag>). Cột "Tổng" ghi tổng số lần đăng và (số page đã đăng).
        Video được gom và tô màu theo thư mục; dòng in đậm đầu mỗi nhóm là tổng của thư mục đó. Rê chuột vào ô để xem views.
      </Typography.Paragraph>
      {!loading && data && (!pages.length || !data.videos.length) ? (
        <Empty description={!data.videos.length ? 'Thư mục này không có video' : 'Nhóm này không có page nào'} />
      ) : (
        <Table
          rowKey="id"
          size="small"
          bordered
          loading={loading}
          dataSource={rows}
          columns={columns}
          pagination={false}
          scroll={{ x: 350 + pages.length * 90, y: 600 }}
          summary={() => (
            <Table.Summary fixed>
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><b>Tổng theo page</b></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="center"><b>{grand}</b></Table.Summary.Cell>
                {pages.map((p, i) => (
                  <Table.Summary.Cell key={p.id} index={i + 2} align="center">
                    {pageTotals[p.id] ? <b>{pageTotals[p.id]}</b> : <Typography.Text type="secondary">0</Typography.Text>}
                  </Table.Summary.Cell>
                ))}
              </Table.Summary.Row>
            </Table.Summary>
          )}
        />
      )}
    </Card>
  );
}
