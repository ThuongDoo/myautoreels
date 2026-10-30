import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Col, Form, Input, InputNumber, Row, Space, Typography } from 'antd';
import { api, useApi } from '../api.js';
import AccountsCard from './Accounts.jsx';
import BackupsCard from './Backups.jsx';

const NUMBER_KEYS = [
  'upload_concurrency', 'preupload_minutes', 'stats_interval_minutes', 'stats_days', 'viral_multiplier', 'viral_min_views',
];

export default function Settings() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const { data, reload } = useApi('/settings');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    const values = { ...data };
    for (const k of NUMBER_KEYS) values[k] = Number(values[k]);
    form.setFieldsValue(values);
  }, [data, form]);

  const save = async (values) => {
    setSaving(true);
    try {
      await api.put('/settings', values);
      message.success('Đã lưu');
      reload({ silent: true });
    } catch (e) {
      message.error(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Form form={form} layout="vertical" onFinish={save} style={{ maxWidth: 1100 }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <AccountsCard />
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Google Drive" style={{ height: '100%' }}>
            <Form.Item label="Service Account JSON" name="google_sa_json" extra="Google Cloud → bật Drive API → tạo Service Account → Keys → tải file JSON và dán nội dung vào đây.">
              <Input.TextArea rows={4} placeholder='{"type": "service_account", ...}' />
            </Form.Item>
            {data?.service_account_email && (
              <Alert
                style={{ marginBottom: 16 }}
                type="info"
                message={(
                  <>Share thư mục Drive (quyền Người xem) cho email:{' '}
                    <Typography.Text copyable strong>{data.service_account_email}</Typography.Text>
                  </>
                )}
              />
            )}
            <Form.Item label="Thư mục video mặc định" name="drive_folder_id">
              <Input placeholder="Link hoặc ID thư mục Drive" />
            </Form.Item>
            <Form.Item
              label="Thư mục nhạc"
              name="music_folder_id"
              extra="Tên file nhạc dạng mã_tên bài (vd. C1_Chỉ có đàn tỳ bà....mp3), mã trước dấu _ phải trùng mã nhạc trong tên video. Share thư mục cho email ở trên."
            >
              <Input placeholder="Link hoặc ID thư mục Drive chứa nhạc" />
            </Form.Item>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Đăng bài" style={{ height: '100%' }}>
            <Form.Item label="Số video upload cùng lúc" name="upload_concurrency">
              <InputNumber min={1} max={20} />
            </Form.Item>
            <Form.Item label="Upload trước giờ đăng (phút)" name="preupload_minutes" extra="Video được upload sẵn, đúng giờ mới gọi Facebook đăng.">
              <InputNumber min={1} max={120} />
            </Form.Item>
            <Form.Item label="Graph API version" name="graph_version" extra="Phiên bản API Facebook, chỉ đổi khi Facebook ngừng hỗ trợ bản đang dùng.">
              <Input style={{ width: 120 }} />
            </Form.Item>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="Thống kê & viral" style={{ height: '100%' }}>
            <Space wrap size="large">
              <Form.Item label="Cập nhật mỗi (phút)" name="stats_interval_minutes"><InputNumber min={15} /></Form.Item>
              <Form.Item label="Theo dõi reel trong (ngày)" name="stats_days"><InputNumber min={1} max={90} /></Form.Item>
              <Form.Item label="Viral khi views gấp" name="viral_multiplier" tooltip="So với trung vị views của chính page đó">
                <InputNumber min={1} step={0.5} addonAfter="lần" />
              </Form.Item>
              <Form.Item label="Và tối thiểu" name="viral_min_views"><InputNumber min={0} addonAfter="views" /></Form.Item>
            </Space>
          </Card>
        </Col>
      </Row>
      <Button type="primary" htmlType="submit" size="large" loading={saving} style={{ marginTop: 16 }}>Lưu cài đặt</Button>
      {/* Outside the settings form's fields: it has its own inputs and never submits the form. */}
      <div style={{ marginTop: 24 }}><BackupsCard /></div>
    </Form>
  );
}
