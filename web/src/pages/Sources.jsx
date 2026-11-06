import { useState } from 'react';
import {
  App, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography,
} from 'antd';
import {
  DeleteOutlined, EditOutlined, FolderOutlined, PlusOutlined,
} from '@ant-design/icons';
import { api, useApi } from '../api.js';

// Add / edit one source. `source` is null when adding.
function SourceModal({
  source, folderOptions, onClose, onSaved,
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const save = async (v) => {
    setSaving(true);
    try {
      if (source) await api.put(`/video-sources/${source.id}`, v);
      else await api.post('/video-sources', v);
      onSaved();
    } catch (e) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      title={source ? 'Sửa nguồn video' : 'Thêm nguồn video'}
      okText="Lưu"
      cancelText="Huỷ"
      confirmLoading={saving}
      onOk={form.submit}
      onCancel={onClose}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={save}
        initialValues={{ name: source?.name || '', url: source?.url || '', folders: source?.folders || [] }}
      >
        <Form.Item label="Tên nguồn" name="name" rules={[{ required: true, whitespace: true, message: 'Nhập tên nguồn' }]}>
          <Input autoFocus maxLength={200} placeholder="Ví dụ: Kênh TikTok ABC" />
        </Form.Item>
        <Form.Item label="Link" name="url">
          <Input maxLength={1000} placeholder="https://..." />
        </Form.Item>
        <Form.Item
          label="Thư mục video lấy ý tưởng từ nguồn này"
          name="folders"
          extra="Lấy từ thư mục video mặc định trên Google Drive, chọn được nhiều thư mục."
        >
          <Select mode="multiple" allowClear placeholder="Chọn thư mục" optionFilterProp="label" options={folderOptions} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// Where video ideas come from: a name, a link, and the Drive folders made from that source.
export default function Sources() {
  const { message } = App.useApp();
  const { data = [], loading, reload } = useApi('/video-sources');
  const { data: folders } = useApi('/video-folders');
  // null = closed, {} = adding, a source = editing.
  const [editing, setEditing] = useState(null);

  const videoCount = new Map((folders || []).map((f) => [f.path, f.videos]));
  const folderOptions = (folders || [])
    .filter((f) => f.path)
    .map((f) => ({ value: f.path, label: `${f.path} (${f.videos} video)` }));

  const remove = async (s) => {
    try {
      await api.del(`/video-sources/${s.id}`);
      reload();
    } catch (e) {
      message.error(e.message);
    }
  };

  return (
    <Card
      title={`Nguồn video (${data.length})`}
      extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({})}>Thêm nguồn</Button>}
    >
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={data}
        pagination={{ pageSize: 50, showSizeChanger: false, hideOnSinglePage: true }}
        scroll={{ x: 800 }}
        locale={{ emptyText: 'Chưa có nguồn nào' }}
        columns={[
          {
            title: 'Tên nguồn',
            dataIndex: 'name',
            width: 240,
            defaultSortOrder: 'ascend',
            sorter: (a, b) => a.name.localeCompare(b.name, 'vi', { numeric: true }),
          },
          {
            title: 'Link',
            dataIndex: 'url',
            width: 280,
            ellipsis: true,
            render: (u) => (u ? <a href={u} target="_blank" rel="noreferrer" title={u}>{u}</a> : '-'),
          },
          {
            title: 'Thư mục video',
            dataIndex: 'folders',
            render: (list) => (list.length ? (
              <Space wrap size={[4, 4]}>
                {list.map((path) => {
                  const count = videoCount.get(path);
                  // Only say a folder is gone once the Drive list has actually loaded.
                  const gone = folders && count === undefined;
                  return (
                    <Tag key={path} icon={<FolderOutlined />} color={gone ? 'default' : 'gold'} style={{ margin: 0 }}>
                      {path}{gone ? ' (không còn trên Drive)' : count !== undefined ? ` (${count})` : ''}
                    </Tag>
                  );
                })}
              </Space>
            ) : <Typography.Text type="secondary">Chưa chọn</Typography.Text>),
          },
          {
            title: '',
            key: 'actions',
            width: 90,
            render: (_, s) => (
              <Space size={4}>
                <Button size="small" type="text" icon={<EditOutlined />} title="Sửa" onClick={() => setEditing(s)} />
                <Popconfirm title={`Xóa nguồn "${s.name}"?`} okText="Xóa" cancelText="Huỷ" onConfirm={() => remove(s)}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />} title="Xóa" />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {editing && (
        <SourceModal
          source={editing.id ? editing : null}
          folderOptions={folderOptions}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      )}
    </Card>
  );
}
