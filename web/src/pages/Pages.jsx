import { useEffect, useRef, useState } from 'react';
import {
  Alert, App, Avatar, Button, Card, Divider, Input, Modal, Popconfirm, Progress, Select, Space, Switch, Table, Tag, Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, LoadingOutlined, PlusOutlined, SettingOutlined, SyncOutlined } from '@ant-design/icons';
import { api, groupColor, useApi } from '../api.js';

const NO_GROUP = '__none__';
const STALL_MS = 90_000;

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
const LOG_COLORS = { success: '#2f9e44', error: '#e5484d', warning: '#d9480f', info: undefined };

const elapsed = (from, to) => {
  const s = Math.max(0, Math.round((to - from) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function AssignProgressModal({ onClose }) {
  const { data: task, reload } = useApi('/pages/assign-all/status');
  const [now, setNow] = useState(Date.now());
  const logEnd = useRef(null);

  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      reload({ silent: true });
    }, 1000);
    return () => clearInterval(t);
  }, [reload]);

  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'nearest' }); }, [task?.log?.length]);

  if (!task || task.idle) return null;

  const running = task.running;
  const waiting = running && task.waitUntil;
  const stalled = running && !waiting && now - task.updatedAt > STALL_MS;
  const stop = () => api.post('/pages/assign-all/cancel').then(() => reload({ silent: true }));
  const percent = task.todo ? Math.round((task.done / task.todo) * 100) : (running ? 0 : 100);
  let status = 'active';
  if (task.error) status = 'exception';
  else if (!running) status = task.failed.length ? 'normal' : 'success';

  return (
    <Modal
      open
      width={680}
      title={(
        <Space>
          {running && <LoadingOutlined />}
          Gán page cho System User
        </Space>
      )}
      onCancel={onClose}
      maskClosable={!running}
      footer={(
        <Space>
          {running && (
            <Popconfirm title="Dừng gán page?" description="Lần sau bấm gán lại sẽ chạy tiếp các page còn thiếu." onConfirm={stop}>
              <Button danger disabled={task.cancel}>{task.cancel ? 'Đang dừng...' : 'Dừng'}</Button>
            </Popconfirm>
          )}
          <Button type={running ? 'default' : 'primary'} onClick={onClose}>{running ? 'Ẩn (vẫn chạy nền)' : 'Đóng'}</Button>
        </Space>
      )}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <div>
          <Typography.Text strong>{task.phase}</Typography.Text>
          {task.current && <Typography.Text type="secondary"> — {task.current}</Typography.Text>}
          <Typography.Text type="secondary" style={{ float: 'right' }}>
            {elapsed(task.startedAt, task.finishedAt || now)}
          </Typography.Text>
        </div>

        <Progress percent={percent} status={status} format={() => `${task.done}/${task.todo}`} />

        <Space size="large" wrap>
          <span>Tổng page BM: <b>{task.total}</b></span>
          <span>Đã gán sẵn: <b>{task.alreadyAssigned}</b></span>
          <span style={{ color: LOG_COLORS.success }}>Vừa gán: <b>{task.newlyAssigned}</b></span>
          <span style={{ color: task.failed.length ? LOG_COLORS.error : undefined }}>Lỗi: <b>{task.failed.length}</b></span>
          {task.synced != null && <span>App hiện có: <b>{task.synced}</b> page</span>}
        </Space>

        {waiting && (
          <Alert
            type="warning"
            showIcon
            message={`Facebook tạm chặn vì thao tác nhanh — tự thử lại sau ${elapsed(now, task.waitUntil)}`}
            description={`Sẽ chạy tiếp lúc ${new Date(task.waitUntil).toLocaleTimeString('vi-VN')}. App vẫn đang hoạt động, không cần làm gì. Đừng gán page thủ công trên BM trong lúc này, sẽ bị chặn lâu hơn.`}
          />
        )}
        {stalled && (
          <Alert
            type="warning"
            showIcon
            message={`Đã ${Math.round((now - task.updatedAt) / 1000)}s không có tiến triển`}
            description="Facebook đang phản hồi chậm. Mỗi lần gọi tối đa 60s rồi sẽ tự báo lỗi và chạy tiếp, không cần làm gì."
          />
        )}
        {task.error && <Alert type="error" showIcon message="Đã dừng vì lỗi" description={task.error} />}

        <div
          style={{
            height: 260, overflowY: 'auto', background: '#fafafa', border: '1px solid #f0f0f0',
            borderRadius: 8, padding: '8px 12px', fontFamily: 'Consolas, monospace', fontSize: 12,
          }}
        >
          {task.log.map((l, i) => (
            <div key={i} style={{ color: LOG_COLORS[l.type] }}>
              <span style={{ color: '#999' }}>{new Date(l.ts).toLocaleTimeString('vi-VN')} </span>{l.text}
            </div>
          ))}
          <div ref={logEnd} />
        </div>
      </Space>
    </Modal>
  );
}

export default function Pages() {
  const { message } = App.useApp();
  const { data = [], loading, reload } = useApi('/pages');
  const { data: groupList = [], reload: reloadGroups } = useApi('/groups');
  const [showAssign, setShowAssign] = useState(false);
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
      message.success(`Đã đồng bộ ${r.synced} page`);
      reload();
    } catch (e) {
      message.error(e.message);
    } finally {
      setSyncing(false);
    }
  };

  // Reopen the progress dialog if an assign task is still running (e.g. after a page reload).
  useEffect(() => {
    api.get('/pages/assign-all/status').then((t) => { if (t.running) setShowAssign(true); }).catch(() => {});
  }, []);

  const assignAll = async () => {
    try {
      await api.post('/pages/assign-all');
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
    && (!needle
      || p.name.toLowerCase().includes(needle)
      || p.id.includes(needle)
      || (p.group_name || '').toLowerCase().includes(needle)));

  return (
    <Card
      title={`Pages (${data.filter((p) => p.enabled).length}/${data.length} đang bật)`}
      extra={(
        <Space>
          <Popconfirm
            title="Gán tất cả page của BM cho System User?"
            description="Có thể mất 1–2 phút với 100 page."
            onConfirm={assignAll}
          >
            <Button>Gán tất cả page của BM</Button>
          </Popconfirm>
          <Button type="primary" icon={<SyncOutlined />} loading={syncing} onClick={sync}>Đồng bộ từ Facebook</Button>
        </Space>
      )}
    >
      <Space wrap size={[6, 8]} style={{ marginBottom: 12 }}>
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
          {
            title: 'Bật',
            dataIndex: 'enabled',
            width: 80,
            render: (v, p) => <Switch size="small" checked={!!v} onChange={(on) => update([p.id], { enabled: on })} />,
          },
        ]}
      />
      {showAssign && <AssignProgressModal onClose={() => { setShowAssign(false); reload({ silent: true }); }} />}
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
