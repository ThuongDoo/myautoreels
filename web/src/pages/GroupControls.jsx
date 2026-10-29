import { useState } from 'react';
import { App, Button, Input, Modal, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { api, groupColor } from '../api.js';

// Shared by page groups (apiBase '/groups') and video groups ('/video-groups').
export function NewGroupInput({ apiBase = '/groups', onCreated, buttonText = 'Tạo nhóm', placeholder = 'Tên nhóm mới, ví dụ: Vẽ, Yoga' }) {
  const { message } = App.useApp();
  const [name, setName] = useState('');
  const create = async () => {
    const n = name.trim();
    if (!n) return;
    try {
      await api.post(apiBase, { name: n });
      setName('');
      onCreated(n);
    } catch (e) {
      message.error(e.message);
    }
  };
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input
        placeholder={placeholder}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onPressEnter={create}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <Button type="primary" icon={<PlusOutlined />} disabled={!name.trim()} onClick={create}>{buttonText}</Button>
    </Space.Compact>
  );
}

export function GroupManagerModal({
  apiBase = '/groups', title = 'Quản lý nhóm page', unit = 'page', help, placeholder, showEnabled = false,
  groups, onClose, onChanged,
}) {
  const { message } = App.useApp();
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState('');

  const stats = groups.map((g) => ({ group: g.name, total: g.total, enabled: g.enabled }));

  const rename = async (from, to) => {
    try {
      await api.post(`${apiBase}/rename`, { from, to });
      message.success(to ? `Đã đổi "${from}" thành "${to}"` : `Đã xoá nhóm "${from}"`);
      setEditing(null);
      onChanged();
    } catch (e) {
      message.error(e.message);
    }
  };

  return (
    <Modal open title={title} footer={null} onCancel={onClose} width={600}>
      <div style={{ marginBottom: 16 }}>
        <NewGroupInput apiBase={apiBase} placeholder={placeholder} onCreated={(n) => { message.success(`Đã tạo nhóm "${n}"`); onChanged(); }} />
      </div>
      {help && <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>{help}</Typography.Paragraph>}
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
          { title: `Số ${unit}`, dataIndex: 'total', width: 80, align: 'right' },
          ...(showEnabled ? [{ title: 'Đang bật', dataIndex: 'enabled', width: 90, align: 'right' }] : []),
          {
            width: 90,
            render: (_, r) => (
              <Space size={0}>
                <Button type="text" size="small" icon={<EditOutlined />} onClick={() => { setEditing(r.group); setName(r.group); }} />
                <Popconfirm
                  title={`Xoá nhóm "${r.group}"?`}
                  description={`${r.total} ${unit} sẽ về "Chưa có nhóm". ${unit === 'page' ? 'Page' : 'Video'} không bị xoá.`}
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
