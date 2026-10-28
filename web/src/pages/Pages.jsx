import { useEffect, useState } from 'react';
import {
  App, Avatar, Button, Card, Divider, Dropdown, Input, Modal, Popconfirm, Select, Space, Switch, Table, Tag, Typography,
} from 'antd';
import { DeleteOutlined, DownOutlined, EditOutlined, PictureOutlined, PlusOutlined, SettingOutlined, SyncOutlined } from '@ant-design/icons';
import { api, groupColor, useApi } from '../api.js';
import AvatarBulkModal from './AvatarBulk.jsx';
import TaskProgressModal, { LOG_COLORS } from './TaskProgress.jsx';

const NO_GROUP = '__none__';

function NewGroupInput({ onCreated, buttonText = 'Tạo nhóm' }) {
  const { message } = App.useApp();
  const [name, setName] = useState('');
  const create = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      await api.post('/groups', { name: n });
      setName('');
      onCreated(n);
    } catch (e) {
      message.error(e.message);
    }
  };
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input
        placeholder="Tên nhóm mới, ví dụ: Vẽ, Yoga"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onPressEnter={create}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <Button type="primary" icon={<PlusOutlined />} disabled={!name.trim()} onClick={create}>{buttonText}</Button>
    </Space.Compact>
  );
}

function GroupManagerModal({ groups, onClose, onChanged }) {
  const { message } = App.useApp();
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');

  const stats = groups.map((g) => ({ group: g.name, total: g.total, enabled: g.enabled }));

  const rename = async (from, to) => {
    try {
      await api.post('/groups/rename', { from, to });
      message.success(to ? `Đã đổi "${from}" thành "${to}"` : `Đã xoá nhóm "${from}"`);
      setEditing(null);
      onChanged();
    } catch (e) {
      message.error(e.message);
    }
  };

  return (
    <Modal open title="Quản lý nhóm page" footer={null} onCancel={onClose} width={600}>
      <div style={{ marginBottom: 16 }}>
        <NewGroupInput onCreated={(n) => { message.success(`Đã tạo nhóm "${n}"`); onChanged(); }} />
      </div>
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        Sau khi tạo nhóm: tick chọn page ở bảng bên ngoài, rồi chọn nhóm ở ô "Chuyển vào nhóm". Mỗi page thuộc tối đa 1 nhóm.
      </Typography.Paragraph>
      <Table
        size="small"
        rowKey="group"
        pagination={false}
        dataSource={stats}
        locale={{ emptyText: 'Chưa có nhóm nào' }}
        columns={[
          {
            title: 'Nhóm',
            dataIndex: 'group',
            render: (g) => (editing === g ? (
              <Space.Compact>
                <Input size="small" value={name} onChange={(e) => setName(e.target.value)} onPressEnter={() => name.trim() && rename(g, name)} autoFocus />
                <Button size="small" type="primary" disabled={!name.trim()} onClick={() => rename(g, name)}>Lưu</Button>
                <Button size="small" onClick={() => setEditing(null)}>Huỷ</Button>
              </Space.Compact>
            ) : <Tag color={groupColor(g)}>{g}</Tag>),
          },
          { title: 'Số page', dataIndex: 'total', width: 80, align: 'right' },
          { title: 'Đang bật', dataIndex: 'enabled', width: 90, align: 'right' },
          {
            width: 90,
            render: (_, r) => (
              <Space size={0}>
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => { setEditing(r.group); setName(r.group); }} />
                <Popconfirm
                  title={`Xoá nhóm "${r.group}"?`}
                  description={`${r.total} page sẽ về "Chưa có nhóm". Page không bị xoá.`}
                  onConfirm={() => rename(r.group, null)}
                >
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
    </Modal>
  );
}
export default function Pages() {
  const { message } = App.useApp();
  const { data = [], loading, reload } = useApi('/pages');
  const { data: groupList = [], reload: reloadGroups } = useApi('/groups');
  const { data: accounts = [] } = useApi('/accounts');
  const [accountFilter, setAccountFilter] = useState();
  const [showAssign, setShowAssign] = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [showAvatarProgress, setShowAvatarProgress] = useState(false);
  const [selected, setSelected] = useState([]);
  const [q, setQ] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [syncing, setSyncing] = useState(false);

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

  const needle = q.toLowerCase();
  const rows = data.filter((p) => (!groupFilter || (p.group_name || NO_GROUP) === groupFilter)
    && (!accountFilter || p.account_id === accountFilter)
    && (!needle
      || p.name.toLowerCase().includes(needle)
      || p.id.includes(needle)
      || (p.group_name || '').toLowerCase().includes(needle)));

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
        <Input.Search placeholder="Tìm tên, ID, nhóm..." allowClear onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
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
            <Button icon={<PictureOutlined />} onClick={() => setShowAvatarPicker(true)}>Đổi avatar</Button>
            <Button onClick={() => update(selected, { enabled: true })}>Bật</Button>
            <Button onClick={() => update(selected, { enabled: false })}>Tắt</Button>
            <Button type="link" onClick={() => setSelected([])}>Bỏ chọn</Button>
          </>
        ) : (
          <Typography.Text type="secondary">Tick chọn page để chuyển vào nhóm (ngách).</Typography.Text>
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
            render: (name, p) => <Space><Avatar src={p.picture} size="small" />{name}</Space>,
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
      {showAvatarPicker && (
        <AvatarBulkModal
          pages={data.filter((p) => selected.includes(p.id))}
          onClose={() => setShowAvatarPicker(false)}
          onStarted={() => { setShowAvatarPicker(false); setShowAvatarProgress(true); }}
        />
      )}
      {showAvatarProgress && (
        <TaskProgressModal
          statusUrl="/avatars/status"
          cancelUrl="/avatars/cancel"
          title={(t) => (t.test ? 'Đổi avatar — thử 1 page' : 'Đổi avatar hàng loạt')}
          stopDescription="Các page chưa đổi sẽ giữ avatar cũ."
          stats={(t) => [
            { label: 'Tổng', value: `${t.todo} page` },
            { label: 'Đã đổi', value: t.changed, color: LOG_COLORS.success },
          ]}
          onClose={() => { setShowAvatarProgress(false); reload({ silent: true }); }}
        />
      )}
      {showGroups && (
        <GroupManagerModal
          groups={groupList}
          onClose={() => setShowGroups(false)}
          onChanged={() => { setGroupFilter(''); reload({ silent: true }); reloadGroups({ silent: true }); }}
        />
      )}
    </Card>
  );
}
