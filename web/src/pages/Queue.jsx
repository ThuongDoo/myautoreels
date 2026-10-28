import { useState } from 'react';
import {
  App, Button, Card, DatePicker, Form, Input, Modal, Popconfirm, Segmented, Select, Space, Table, Tag, Tooltip, Typography,
} from 'antd';
import { DeleteOutlined, EditOutlined, RedoOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, useApi } from '../api.js';
import { STATUS } from '../status.js';
import VideoDrawer from './VideoDrawer.jsx';

const EDITABLE = ['pending', 'uploaded', 'failed', 'canceled'];

function EditModal({ job, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const save = async (v) => {
    try {
      await api.patch(`/jobs/${job.id}`, { caption: v.caption, scheduled_at: v.scheduled_at.valueOf() });
      onSaved();
    } catch (e) {
      message.error(e.message);
    }
  };
  return (
    <Modal open title={`Sửa lịch #${job.id}`} onCancel={onClose} onOk={form.submit} okText="Lưu" destroyOnClose>
      <Form form={form} layout="vertical" onFinish={save} initialValues={{ caption: job.caption, scheduled_at: dayjs(job.scheduled_at) }}>
        <Form.Item label="Giờ đăng" name="scheduled_at">
          <DatePicker showTime={{ format: 'HH:mm' }} format="DD/MM/YYYY HH:mm" style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="Caption" name="caption">
          <Input.TextArea rows={5} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function Queue() {
  const { message } = App.useApp();
  const [status, setStatus] = useState('');
  const [pageId, setPageId] = useState();
  const [selected, setSelected] = useState([]);
  const [editing, setEditing] = useState(null);
  const [openVideo, setOpenVideo] = useState(null);
  const { data: pages = [] } = useApi('/pages');

  const query = new URLSearchParams({ ...(status && { status }), ...(pageId && { pageId }) }).toString();
  const { data, loading, reload } = useApi(`/jobs?${query}`, { refreshMs: 10_000 });
  const rows = data?.rows || [];
  const counts = data?.counts || {};
  const totalCount = Object.values(counts).reduce((a, b) => a + b, 0);

  const act = async (action, ids) => {
    try {
      const r = await api.post('/jobs/action', { action, ids });
      message.success(`Đã cập nhật ${r.changed} job`);
      setSelected([]);
      reload({ silent: true });
    } catch (e) {
      message.error(e.message);
    }
  };

  return (
    <Card title="Hàng đợi đăng bài">
      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: `Tất cả (${totalCount})` },
            ...Object.entries(STATUS).map(([k, s]) => ({ value: k, label: `${s.label} (${counts[k] || 0})` })),
          ]}
        />
        <Select
          allowClear
          showSearch
          placeholder="Lọc theo page"
          optionFilterProp="label"
          style={{ width: 220 }}
          value={pageId}
          onChange={setPageId}
          options={pages.map((p) => ({ value: p.id, label: p.name }))}
        />
      </Space>

      {selected.length > 0 && (
        <Space wrap style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary">Đã chọn {selected.length}:</Typography.Text>
          <Button icon={<SendOutlined />} onClick={() => act('publish_now', selected)}>Đăng ngay</Button>
          <Button icon={<StopOutlined />} onClick={() => act('cancel', selected)}>Huỷ</Button>
          <Button icon={<RedoOutlined />} onClick={() => act('retry', selected)}>Thử lại</Button>
          <Popconfirm title="Xoá các job đã chọn?" onConfirm={() => act('delete', selected)}>
            <Button danger icon={<DeleteOutlined />}>Xoá</Button>
          </Popconfirm>
        </Space>
      )}

      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 50, showSizeChanger: false }}
        rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
        scroll={{ x: 900 }}
        columns={[
          {
            title: 'Giờ đăng',
            dataIndex: 'scheduled_at',
            width: 150,
            sorter: (a, b) => a.scheduled_at - b.scheduled_at,
            render: (t) => (
              <Tooltip title={dayjs(t).fromNow()}>{dayjs(t).format('DD/MM HH:mm')}</Tooltip>
            ),
          },
          { title: 'Page', dataIndex: 'page_name', width: 180, ellipsis: true },
          {
            title: 'Video',
            dataIndex: 'drive_file_name',
            width: 200,
            ellipsis: true,
            render: (n, j) => <a onClick={() => setOpenVideo({ id: j.drive_file_id, name: n })}>{n}</a>,
          },
          {
            title: 'Caption',
            dataIndex: 'caption',
            ellipsis: { showTitle: false },
            render: (c) => <Tooltip title={c} placement="topLeft">{c}</Tooltip>,
          },
          {
            title: 'Trạng thái',
            dataIndex: 'status',
            width: 170,
            render: (s, j) => {
              const tag = <Tag color={STATUS[s]?.color}>{STATUS[s]?.label || s}</Tag>;
              if (s === 'done' && j.video_id) return <a href={`https://www.facebook.com/reel/${j.video_id}`} target="_blank" rel="noreferrer">{tag}</a>;
              return j.error ? <Tooltip title={`${j.error} (lần thử ${j.attempts})`}>{tag}</Tooltip> : tag;
            },
          },
          {
            title: '',
            width: 130,
            render: (_, j) => (
              <Space size={0}>
                {EDITABLE.includes(j.status) && (
                  <Tooltip title="Sửa"><Button type="text" size="small" icon={<EditOutlined />} onClick={() => setEditing(j)} /></Tooltip>
                )}
                {['pending', 'uploaded'].includes(j.status) && (
                  <Tooltip title="Đăng ngay"><Button type="text" size="small" icon={<SendOutlined />} onClick={() => act('publish_now', [j.id])} /></Tooltip>
                )}
                {['failed', 'canceled'].includes(j.status) && (
                  <Tooltip title="Thử lại"><Button type="text" size="small" icon={<RedoOutlined />} onClick={() => act('retry', [j.id])} /></Tooltip>
                )}
                {['pending', 'uploaded', 'failed'].includes(j.status) && (
                  <Tooltip title="Huỷ"><Button type="text" size="small" icon={<StopOutlined />} onClick={() => act('cancel', [j.id])} /></Tooltip>
                )}
              </Space>
            ),
          },
        ]}
      />
      {openVideo && <VideoDrawer video={openVideo} onClose={() => setOpenVideo(null)} />}
      {editing && (
        <EditModal
          job={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload({ silent: true }); }}
        />
      )}
    </Card>
  );
}
