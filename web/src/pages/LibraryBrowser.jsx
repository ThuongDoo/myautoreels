import { useMemo, useState } from 'react';
import {
  Breadcrumb, Button, Input, Space, Table, Tag, Typography,
} from 'antd';
import { FolderOutlined, RightOutlined } from '@ant-design/icons';

const DIR = 'dir:';
const inDir = (f, d) => f.folder === d || f.folder.startsWith(`${d}/`);

// The files a selection stands for: picked files plus everything under picked folders.
export function filesOf(files, keys) {
  if (!keys?.length) return [];
  const ids = new Set(keys);
  const dirs = keys.filter((k) => k.startsWith(DIR)).map((k) => k.slice(DIR.length));
  return files.filter((f) => ids.has(f.id) || dirs.some((d) => inDir(f, d)));
}

// Browses an already-listed Drive folder tree (files carry their `folder` path), like the video picker.
// multiple: value = keys (file ids and `dir:<path>` for whole folders); single: value = one file id.
// columns: extra file columns; icon (an element, or a function of the file) / action: per-file icon and button (e.g. play).
export default function LibraryBrowser({
  files, value, onChange, single = false, loading, rootName, icon, action, columns = [], unit = 'file',
}) {
  const [cwd, setCwd] = useState('');
  const [search, setSearch] = useState('');

  const { subfolders, counts } = useMemo(() => {
    const subs = new Map();
    const count = new Map();
    for (const f of files) {
      const parts = f.folder ? f.folder.split('/') : [];
      parts.forEach((name, i) => {
        const parent = parts.slice(0, i).join('/');
        const path = parts.slice(0, i + 1).join('/');
        if (!subs.has(parent)) subs.set(parent, new Map());
        subs.get(parent).set(path, name);
        count.set(path, (count.get(path) || 0) + 1);
      });
    }
    return { subfolders: subs, counts: count };
  }, [files]);

  const q = search.trim().toLowerCase();
  const rows = q
    ? files.filter((f) => f.name.toLowerCase().includes(q))
    : [
      ...[...(subfolders.get(cwd) || [])]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, name]) => ({ id: `${DIR}${path}`, name, path, isFolder: true })),
      ...files.filter((f) => f.folder === cwd).sort((a, b) => a.name.localeCompare(b.name)),
    ];

  const parts = cwd ? cwd.split('/') : [];
  const keys = single ? (value ? [value] : []) : (value || []);
  const pickedDirs = keys.filter((k) => k.startsWith(DIR));
  const looseCount = keys.length - pickedDirs.length;
  // Rows inside a ticked folder show as ticked and can't be unticked on their own.
  const dirsOf = (list) => list.filter((k) => k.startsWith(DIR)).map((k) => k.slice(DIR.length));
  const coveredBy = (dirs, r) => dirs.some((d) => (r.isFolder ? r.path.startsWith(`${d}/`) : inDir(r, d)));
  const covered = new Set(rows.filter((r) => coveredBy(dirsOf(pickedDirs), r)).map((r) => r.id));
  const select = (next) => {
    if (single) return onChange?.(next.find((x) => !x.startsWith(DIR)));
    // Ticking a folder drops the files and subfolders inside it that were ticked before.
    const dirs = dirsOf(next);
    const byId = new Map(files.map((f) => [f.id, f]));
    return onChange?.(next.filter((k) => !covered.has(k)).filter((k) => (k.startsWith(DIR)
      ? !dirs.some((d) => k.slice(DIR.length).startsWith(`${d}/`))
      : !(byId.has(k) && dirs.some((d) => inDir(byId.get(k), d))))));
  };

  return (
    <div>
      <Input.Search
        allowClear
        size="small"
        placeholder={`Tìm theo tên trong tất cả ${files.length} ${unit}`}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      {!q && (
        <Breadcrumb
          style={{ marginBottom: 4 }}
          items={[rootName, ...parts].map((name, i) => ({
            title: i < parts.length ? <a onClick={() => setCwd(parts.slice(0, i).join('/'))}>{name}</a> : name,
          }))}
        />
      )}
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        showHeader={columns.length > 0}
        pagination={{ pageSize: 100, hideOnSinglePage: true, size: 'small' }}
        scroll={{ y: 260 }}
        locale={{ emptyText: q ? `Không có ${unit} nào khớp` : 'Thư mục trống' }}
        rowSelection={{
          type: single ? 'radio' : 'checkbox',
          selectedRowKeys: [...keys, ...covered],
          preserveSelectedRowKeys: true,
          onChange: select,
          getCheckboxProps: (r) => ({
            disabled: (single && r.isFolder) || covered.has(r.id),
            style: single && r.isFolder ? { display: 'none' } : undefined,
          }),
        }}
        onRow={(r) => (r.isFolder ? {
          onClick: (e) => {
            if (e.target.closest('.ant-table-selection-column')) return;
            setCwd(r.path);
          },
          style: { cursor: 'pointer' },
        } : {})}
        columns={[
          {
            title: 'Tên',
            dataIndex: 'name',
            ellipsis: true,
            render: (name, r) => (r.isFolder ? (
              <Space>
                <FolderOutlined style={{ color: '#f5a623' }} />
                {name}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{counts.get(r.path)} {unit}</Typography.Text>
                <RightOutlined style={{ fontSize: 10, color: '#999' }} />
              </Space>
            ) : (
              <Space size={4}>
                {action?.(r)}
                {typeof icon === 'function' ? icon(r) : icon}
                <span title={r.name}>{name}</span>
                {q && r.folder && <Tag style={{ margin: 0 }}>{r.folder}</Tag>}
              </Space>
            )),
          },
          ...columns.map((c) => ({ ...c, render: (v, r) => (r.isFolder ? null : c.render ? c.render(v, r) : v) })),
        ]}
      />
      {!single && keys.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <Space wrap size={[4, 8]}>
            <Typography.Text strong>Đã chọn {filesOf(files, keys).length} {unit}:</Typography.Text>
            {pickedDirs.map((k) => (
              <Tag
                key={k}
                color="gold"
                icon={<FolderOutlined />}
                closable
                onClose={(e) => { e.preventDefault(); onChange(keys.filter((x) => x !== k)); }}
              >
                {k.slice(DIR.length)} ({counts.get(k.slice(DIR.length)) || 0})
              </Tag>
            ))}
            {looseCount > 0 && (
              <Tag closable onClose={(e) => { e.preventDefault(); onChange(pickedDirs); }}>{looseCount} {unit} lẻ</Tag>
            )}
            <Button size="small" type="link" onClick={() => onChange([])}>Bỏ chọn tất cả</Button>
          </Space>
        </div>
      )}
    </div>
  );
}
