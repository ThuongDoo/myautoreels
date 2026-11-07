import { useEffect, useState } from 'react';
import {
  App, Avatar, Button, Card, Divider, Dropdown, Input, Popconfirm, Select, Space, Switch, Table, Tag, Tooltip, Typography,
} from 'antd';
import {
  DownOutlined, ExportOutlined, PictureOutlined, SettingOutlined, SyncOutlined,
} from '@ant-design/icons';
import { api, fmtNum, groupColor, useApi } from '../api.js';
import AvatarBulkModal, { IMAGE_KINDS } from './AvatarBulk.jsx';
import TaskProgressModal, { LOG_COLORS } from './TaskProgress.jsx';
import PageDrawer from './PageDrawer.jsx';
import { HistoryDrawer } from './Reels.jsx';
import VideoDrawer from './VideoDrawer.jsx';
import { GroupManagerModal, NewGroupInput } from './GroupControls.jsx';
import TagFilter from './TagFilter.jsx';

const NO_GROUP = '__none__';

export default function Pages() {
  const { message } = App.useApp();
  const { data = [], loading, reload } = useApi('/pages');
  const { data: groupList = [], reload: reloadGroups } = useApi('/groups');
  const { data: accounts = [] } = useApi('/accounts');
  const [accountFilter, setAccountFilter] = useState();
  const [showAssign, setShowAssign] = useState(false);
  const [imagePicker, setImagePicker] = useState(null); // 'avatar' | 'cover'
  const [showAvatarProgress, setShowAvatarProgress] = useState(false);
  const [selected, setSelected] = useState([]);
  const [q, setQ] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [tagFilter, setTagFilter] = useState([]);
  const [bulkTags, setBulkTags] = useState([]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [openPage, setOpenPage] = useState(null);
  const [openReel, setOpenReel] = useState(null);
  const [openVideo, setOpenVideo] = useState(null);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.post('/pages/sync');
      const failed = r.results.filter((x) => x.error);
      const ok = r.results.filter((x) => !x.error).map((x) => `${x.account}: ${x.synced}`).join(' · ');
      if (ok) message.success(`Đã đồng bộ ${r.synced} page (${ok})`, 5);
      for (const x of failed) message.error(`${x.account}: ${x.error}`, 8);
      reload();
      reloadGroups({ silent: true });
    } catch (e) {
      message.error(e.message);
    } finally {
      setSyncing(false);
    }
  };

  // Reopen the progress dialog if an assign task is still running (e.g. after a page reload).
  useEffect(() => {
    api.get('/pages/assign-all/status').then((t) => { if (t.running) setShowAssign(true); }).catch(() => {});
    api.get('/avatars/status').then((t) => { if (t.running) setShowAvatarProgress(true); }).catch(() => {});
  }, []);

  const assignAll = async (accountId) => {
    try {
      await api.post('/pages/assign-all', { accountId });
      setShowAssign(true);
    } catch (e) {
      message.error(e.message);
    }
  };

  const update = async (ids, patch, successText) => {
    try {
      await api.post('/pages/update', { ids, ...patch });
      if (successText) message.success(successText);
      reload({ silent: true });
      reloadGroups({ silent: true });
      return true;
    } catch (e) {
      message.error(e.message);
      return false;
    }
  };

  const changeTags = async (ids, add, remove, successText) => {
    try {
      await api.post('/pages/tags', { ids, add, remove });
      if (successText) message.success(successText);
      reload({ silent: true });
      return true;
    } catch (e) {
      message.error(e.message);
      return false;
    }
  };

  const bulkTag = async (add, remove, successText) => {
    if (await changeTags(selected, add, remove, successText)) setBulkTags([]);
  };

  const moveToGroup = async (name) => {
    setGroupPickerOpen(false);
    if (await update(selected, { group_name: name }, `Đã chuyển ${selected.length} page vào nhóm "${name}"`)) {
      setSelected([]);
    }
  };

  const ungroupedCount = data.filter((p) => !p.group_name).length;
  const groupOptions = groupList.map((g) => ({
    value: g.name,
    label: <Space><Tag color={groupColor(g.name)} style={{ margin: 0 }}>{g.name}</Tag><Typography.Text type="secondary">{g.total} page</Typography.Text></Space>,
  }));

  // Every tag in use with its page count, in name order.
  const tagCounts = [...data.flatMap((p) => p.tags).reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map())]
    .sort(([a], [b]) => a.localeCompare(b, 'vi', { numeric: true }));
  const tagOptions = tagCounts.map(([t]) => ({ value: t, label: t }));
  const renderTag = ({ value, closable, onClose }) => (
    <Tag color={groupColor(value)} closable={closable} onClose={onClose} style={{ marginInlineEnd: 4 }}>{value}</Tag>
  );

  // Tag order: by the tags' names, pages without a tag always at the bottom.
  const sortByTags = (a, b, order) => {
    if (!a.tags.length !== !b.tags.length) return (a.tags.length ? -1 : 1) * (order === 'descend' ? -1 : 1);
    return a.tags.join(', ').localeCompare(b.tags.join(', '), 'vi', { numeric: true });
  };

  const needle = q.toLowerCase();
  const rows = data.filter((p) => (!groupFilter || (p.group_name || NO_GROUP) === groupFilter)
    && (!accountFilter || p.account_id === accountFilter)
    && (!tagFilter.length || tagFilter.some((t) => p.tags.includes(t)))
    && (!needle
      || p.name.toLowerCase().includes(needle)
      || p.id.includes(needle)
      || (p.group_name || '').toLowerCase().includes(needle)
      || p.tags.some((t) => t.toLowerCase().includes(needle))));

  return (
    <Card
      title={`Pages (${data.filter((p) => p.enabled).length}/${data.length} đang bật)`}
      extra={(
        <Space>
          {accounts.length <= 1 ? (
            <Popconfirm
              title="Gán tất cả page của BM cho System User?"
              description="Có thể mất 1–2 phút với 100 page."
              disabled={!accounts.length}
              onConfirm={() => assignAll(accounts[0]?.id)}
            >
              <Button disabled={!accounts.length}>Gán tất cả page của BM</Button>
            </Popconfirm>
          ) : (
            <Dropdown
              trigger={['click']}
              menu={{
                items: accounts.map((a) => ({ key: String(a.id), label: `${a.name} (${a.pages} page)` })),
                onClick: ({ key }) => assignAll(Number(key)),
              }}
            >
              <Button>Gán tất cả page của BM <DownOutlined /></Button>
            </Dropdown>
          )}
          <Button type="primary" icon={<SyncOutlined />} loading={syncing} onClick={sync}>Đồng bộ từ Facebook</Button>
        </Space>
      )}
    >
      <Space wrap size={[6, 8]} style={{ marginBottom: 12 }}>
        {accounts.length > 1 && (
          <Select
            size="small"
            allowClear
            placeholder="Tất cả BM"
            value={accountFilter}
            onChange={setAccountFilter}
            style={{ width: 170 }}
            options={accounts.map((a) => ({ value: a.id, label: `${a.name} (${a.pages})` }))}
          />
        )}
        <Typography.Text type="secondary">Nhóm:</Typography.Text>
        <Tag.CheckableTag checked={!groupFilter} onChange={() => setGroupFilter('')}>Tất cả ({data.length})</Tag.CheckableTag>
        {groupList.map((g) => (
          <Tag.CheckableTag key={g.name} checked={groupFilter === g.name} onChange={(on) => setGroupFilter(on ? g.name : '')}>
            {g.name} ({g.total})
          </Tag.CheckableTag>
        ))}
        {ungroupedCount > 0 && (
          <Tag.CheckableTag checked={groupFilter === NO_GROUP} onChange={(on) => setGroupFilter(on ? NO_GROUP : '')}>
            Chưa có nhóm ({ungroupedCount})
          </Tag.CheckableTag>
        )}
        <Button size="small" icon={<SettingOutlined />} onClick={() => setShowGroups(true)}>Tạo / quản lý nhóm</Button>
      </Space>

      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search placeholder="Tìm tên, ID, nhóm, tag..." allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
        <TagFilter pages={data} value={tagFilter} onChange={setTagFilter} placeholder="Lọc theo tag" style={{ width: 220 }} />
        {selected.length > 0 ? (
          <>
            <Typography.Text strong>Đã chọn {selected.length} page:</Typography.Text>
            <Select
              placeholder="Chuyển vào nhóm..."
              style={{ width: 230 }}
              value={null}
              open={groupPickerOpen}
              onOpenChange={setGroupPickerOpen}
              options={groupOptions}
              onChange={moveToGroup}
              notFoundContent="Chưa có nhóm nào"
              popupRender={(menu) => (
                <>
                  {menu}
                  <Divider style={{ margin: '8px 0' }} />
                  <div style={{ padding: '0 8px 4px' }}>
                    <NewGroupInput
                      buttonText="Tạo & chuyển"
                      onCreated={(n) => { reloadGroups({ silent: true }); moveToGroup(n); }}
                    />
                  </div>
                </>
              )}
            />
            <Button onClick={() => update(selected, { group_name: null }, `Đã bỏ ${selected.length} page khỏi nhóm`)}>Bỏ khỏi nhóm</Button>
            <Space.Compact>
              <Select
                mode="tags"
                placeholder="Nhập hoặc chọn tag..."
                style={{ width: 230 }}
                value={bulkTags}
                onChange={setBulkTags}
                options={tagOptions}
                tokenSeparators={[',']}
                tagRender={renderTag}
              />
              <Button
                disabled={!bulkTags.length}
                onClick={() => bulkTag(bulkTags, [], `Đã gắn ${bulkTags.length} tag cho ${selected.length} page`)}
              >
                Gắn tag
              </Button>
              <Button
                disabled={!bulkTags.length}
                onClick={() => bulkTag([], bulkTags, `Đã gỡ ${bulkTags.length} tag khỏi ${selected.length} page`)}
              >
                Gỡ tag
              </Button>
            </Space.Compact>
            <Button icon={<PictureOutlined />} onClick={() => setImagePicker('avatar')}>Đổi avatar</Button>
            <Button icon={<PictureOutlined />} onClick={() => setImagePicker('cover')}>Đổi ảnh bìa</Button>
            <Button onClick={() => update(selected, { enabled: true })}>Bật</Button>
            <Button onClick={() => update(selected, { enabled: false })}>Tắt</Button>
            <Button type="link" onClick={() => setSelected([])}>Bỏ chọn</Button>
          </>
        ) : (
          <Typography.Text type="secondary">Tick chọn page để chuyển vào nhóm (ngách) hoặc gắn tag.</Typography.Text>
        )}
      </Space>
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 100, showSizeChanger: false, hideOnSinglePage: true }}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected, preserveSelectedRowKeys: true }}
        columns={[
          {
            title: 'Page',
            dataIndex: 'name',
            sorter: (a, b) => a.name.localeCompare(b.name),
            // The name opens the page's detail; the arrow opens it on Facebook in a new tab.
            render: (name, p) => (
              <Space>
                <a onClick={() => setOpenPage(p.id)} title="Xem chi tiết page">
                  <Space><Avatar src={p.picture} size="small" />{name}</Space>
                </a>
                <a href={`https://www.facebook.com/${p.id}`} target="_blank" rel="noreferrer" title="Mở page trên Facebook (tab mới)">
                  <ExportOutlined style={{ fontSize: 11, color: '#999' }} />
                </a>
                {p.fb_hidden ? <Tag color="red" style={{ margin: 0 }}>Đã ẩn trên FB</Tag> : null}
              </Space>
            ),
          },
          { title: 'ID', dataIndex: 'id', render: (id) => <Typography.Text copyable type="secondary">{id}</Typography.Text> },
          {
            title: 'Nhóm',
            dataIndex: 'group_name',
            width: 200,
            sorter: (a, b) => (a.group_name || '').localeCompare(b.group_name || ''),
            render: (g, p) => (
              <Select
                size="small"
                variant="borderless"
                style={{ width: '100%' }}
                value={g || null}
                placeholder="— Chưa có nhóm —"
                allowClear
                options={groupOptions}
                labelRender={({ value }) => <Tag color={groupColor(value)} style={{ margin: 0 }}>{value}</Tag>}
                onChange={(v) => update([p.id], { group_name: v || null })}
              />
            ),
          },
          {
            title: 'Tag',
            dataIndex: 'tags',
            width: 260,
            sorter: sortByTags,
            render: (tags, p) => (
              <Select
                mode="tags"
                size="small"
                variant="borderless"
                style={{ width: '100%' }}
                value={tags}
                placeholder="Thêm tag..."
                options={tagOptions}
                tokenSeparators={[',']}
                tagRender={renderTag}
                onChange={(next) => changeTags([p.id], next.filter((t) => !tags.includes(t)), tags.filter((t) => !next.includes(t)))}
              />
            ),
          },
          {
            title: <Tooltip title="Tổng view các reel của page mà app đang theo dõi (lấy từ trang Thống kê)">Tổng view</Tooltip>,
            dataIndex: 'views',
            width: 120,
            align: 'right',
            sorter: (a, b) => a.views - b.views,
            sortDirections: ['descend', 'ascend'],
            render: (v, p) => <Tooltip title={`${p.reels} reel`}>{fmtNum(v)}</Tooltip>,
          },
          ...(accounts.length > 1 ? [{
            title: 'BM',
            dataIndex: 'account_name',
            width: 130,
            sorter: (a, b) => (a.account_name || '').localeCompare(b.account_name || ''),
            render: (n) => n || <Typography.Text type="secondary">—</Typography.Text>,
          }] : []),
          {
            title: 'Bật',
            dataIndex: 'enabled',
            width: 80,
            render: (v, p) => <Switch size="small" checked={!!v} onChange={(on) => update([p.id], { enabled: on })} />,
          },
        ]}
      />
      {showAssign && (
        <TaskProgressModal
          statusUrl="/pages/assign-all/status"
          cancelUrl="/pages/assign-all/cancel"
          title={(t) => `Gán page cho System User${t.account ? ` — ${t.account}` : ''}`}
          stopDescription="Lần sau bấm gán lại sẽ chạy tiếp các page còn thiếu."
          stats={(t) => [
            { label: 'Tổng page BM', value: t.total },
            { label: 'Đã gán sẵn', value: t.alreadyAssigned },
            { label: 'Vừa gán', value: t.newlyAssigned, color: LOG_COLORS.success },
            t.synced != null && { label: 'App hiện có', value: `${t.synced} page` },
          ]}
          onClose={() => { setShowAssign(false); reload({ silent: true }); }}
        />
      )}
      {imagePicker && (
        <AvatarBulkModal
          kind={imagePicker}
          pages={data.filter((p) => selected.includes(p.id))}
          onClose={() => setImagePicker(null)}
          onStarted={() => { setImagePicker(null); setShowAvatarProgress(true); }}
        />
      )}
      {showAvatarProgress && (
        <TaskProgressModal
          statusUrl="/avatars/status"
          cancelUrl="/avatars/cancel"
          title={(t) => `Đổi ${IMAGE_KINDS[t.kind || 'avatar'].label} ${t.test ? '— thử 1 page' : 'hàng loạt'}`}
          stopDescription="Các page chưa đổi sẽ giữ ảnh cũ."
          stats={(t) => [
            { label: 'Tổng', value: `${t.todo} page` },
            { label: 'Đã đổi', value: t.changed, color: LOG_COLORS.success },
          ]}
          onClose={() => { setShowAvatarProgress(false); reload({ silent: true }); }}
        />
      )}
      {showGroups && (
        <GroupManagerModal
          showEnabled
          help='Sau khi tạo nhóm: tick chọn page ở bảng bên ngoài, rồi chọn nhóm ở ô "Chuyển vào nhóm". Mỗi page thuộc tối đa 1 nhóm.'
          groups={groupList}
          onClose={() => setShowGroups(false)}
          onChanged={() => { setGroupFilter(''); reload({ silent: true }); reloadGroups({ silent: true }); }}
        />
      )}
      {openPage && (
        <PageDrawer
          pageId={openPage}
          onClose={() => setOpenPage(null)}
          onOpenReel={setOpenReel}
          onChanged={() => reload({ silent: true })}
        />
      )}
      {openReel && <HistoryDrawer reel={openReel} onClose={() => setOpenReel(null)} onOpenVideo={setOpenVideo} />}
      {openVideo && <VideoDrawer video={openVideo} onClose={() => setOpenVideo(null)} />}
    </Card>
  );
}
