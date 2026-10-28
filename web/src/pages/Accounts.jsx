import { useState } from 'react';
import { App, Button, Card, Form, Input, Modal, Popconfirm, Space, Table, Typography } from 'antd';
import { CheckCircleOutlined, DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { api, useApi } from '../api.js';

function AccountModal({ account, onClose, onSaved }) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const isNew = !account;

  const save = async (v) => {
    setSaving(true);
    try {
      if (isNew) {
        const r = await api.post('/accounts', v);
        message.success(`Đã thêm "${v.name}" — System User: ${r.systemUser}. Sang trang Pages bấm Đồng bộ để lấy page.`, 6);
      } else {
        const r = await api.patch(`/accounts/${account.id}`, v);
        message.success(r.synced != null ? `Đã lưu token mới và đồng bộ lại ${r.synced} page` : 'Đã lưu');
      }
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
      title={isNew ? 'Thêm tài khoản BM' : `Sửa "${account.name}"`}
      okText={isNew ? 'Thêm' : 'Lưu'}
      confirmLoading={saving}
      onOk={form.submit}
      onCancel={onClose}
      destroyOnClose
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={save}
        initialValues={isNew ? {} : { name: account.name, business_id: account.business_id }}
      >
        <Form.Item label="Tên gợi nhớ" name="name" rules={[{ required: true, message: 'Ví dụ: BM Vẽ, BM Yoga' }]}>
          <Input placeholder="Ví dụ: BM Vẽ" />
        </Form.Item>
        <Form.Item
          label="System User Token"
          name="token"
          rules={isNew ? [{ required: true, message: 'Dán System User Token của BM này' }] : []}
          extra={isNew
            ? 'Business Settings của BM này → System Users → Tạo token (không hết hạn) với quyền pages_show_list, pages_manage_posts, pages_read_engagement, read_insights, business_management.'
            : `Đang dùng: ${account.token_hint}. Để trống nếu không đổi token.`}
        >
          <Input.Password placeholder="EAAG..." />
        </Form.Item>
        <Form.Item
          label="Business ID"
          name="business_id"
          extra="Số sau business_id= trên thanh địa chỉ của Business Settings. Cần cho nút Gán tất cả page."
        >
          <Input placeholder="123456789012345" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function AccountsCard() {
  const { message } = App.useApp();
  const { data = [], loading, reload } = useApi('/accounts');
  const [editing, setEditing] = useState(null); // null = closed, 'new', or an account
  const [testing, setTesting] = useState(null);

  const test = async (a) => {
    setTesting(a.id);
    try {
      const r = await api.post(`/accounts/${a.id}/test`);
      message.success(`"${a.name}" hoạt động — System User ${r.systemUser}, thấy ${r.pages} page`);
    } catch (e) {
      message.error(`"${a.name}": ${e.message}`);
    } finally {
      setTesting(null);
    }
  };

  const remove = async (a) => {
    try {
      const r = await api.del(`/accounts/${a.id}`);
      message.success(`Đã xoá "${a.name}" (${r.pages} page, huỷ ${r.jobs} lịch chưa đăng)`);
      reload({ silent: true });
    } catch (e) {
      message.error(e.message);
    }
  };

  return (
    <Card
      title="Tài khoản Facebook (BM)"
      style={{ height: '100%' }}
      extra={<Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setEditing('new')}>Thêm BM</Button>}
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 13 }}>
        Mỗi BM dùng System User token riêng. Page của BM nào sẽ đăng bằng token của BM đó.
      </Typography.Paragraph>
      <Table
        size="small"
        rowKey="id"
        loading={loading}
        pagination={false}
        dataSource={data}
        locale={{ emptyText: 'Chưa có tài khoản — bấm "Thêm BM"' }}
        columns={[
          {
            title: 'Tên',
            dataIndex: 'name',
            render: (n, a) => (
              <>
                <Typography.Text strong>{n}</Typography.Text>
                <div><Typography.Text type="secondary" style={{ fontSize: 12 }}>{a.business_id ? `BM ${a.business_id}` : 'Chưa có Business ID'}</Typography.Text></div>
              </>
            ),
          },
          { title: 'Page', dataIndex: 'pages', width: 60, align: 'right' },
          {
            width: 110,
            render: (_, a) => (
              <Space size={0}>
                <Button type="text" size="small" icon={<CheckCircleOutlined />} loading={testing === a.id} title="Kiểm tra token" onClick={() => test(a)} />
                <Button type="text" size="small" icon={<EditOutlined />} title="Sửa" onClick={() => setEditing(a)} />
                <Popconfirm
                  title={`Xoá "${a.name}"?`}
                  description={`${a.pages} page của BM này sẽ bị gỡ khỏi app và các lịch chưa đăng bị huỷ. Không ảnh hưởng gì trên Facebook.`}
                  okButtonProps={{ danger: true }}
                  onConfirm={() => remove(a)}
                >
                  <Button type="text" size="small" danger icon={<DeleteOutlined />} title="Xoá" />
                </Popconfirm>
              </Space>
            ),
          },
        ]}
      />
      {editing && (
        <AccountModal
          account={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload({ silent: true }); }}
        />
      )}
    </Card>
  );
}
