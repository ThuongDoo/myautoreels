import { useState } from 'react';
import {
  Button, Col, Drawer, Row, Space, Statistic, Table, Tag, Tooltip, Typography,
} from 'antd';
import { FireOutlined, GoogleOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { fmtNum, groupColor, useApi } from '../api.js';
import { STATUS } from '../status.js';

const ACTIVE = ['pending', 'uploading', 'uploaded', 'publishing', 'processing'];
export const driveViewUrl = (id) => `https://drive.google.com/file/d/${id}/view`;

// Every post of one Drive video: which pages, when, and how each reel performed.
export default function VideoDrawer({ video, onClose }) {
  const { data: posts = [], loading } = useApi(`/videos/${video.id}/posts`);
  const done = posts.filter((p) => p.status === 'done');
  const views = done.reduce((s, p) => s + (p.views || 0), 0);
  const [previewError, setPreviewError] = useState(false);

  return (
    <Drawer open width={Math.min(1000, window.innerWidth)} onClose={onClose} title={video.name || video.id}>
      <Row gutter={[24, 16]}>
        <Col flex="0 0 260px">
          {/* Streamed through the app's Service Account: fixed 9:16 box, no Google login needed. */}
          <div style={{ width: 260, aspectRatio: '9 / 16', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
            {previewError ? (
              <div style={{ color: '#c3c2b7', padding: 16, fontSize: 13, height: '100%', display: 'flex', alignItems: 'center', textAlign: 'center' }}>
                Không phát được video (file đã bị xoá, chưa share cho Service Account, hoặc định dạng trình duyệt không hỗ trợ).
              </div>
            ) : (
              <video
                key={video.id}
                src={`/api/drive/stream/${encodeURIComponent(video.id)}`}
                controls
                preload="metadata"
                playsInline
                onError={() => setPreviewError(true)}
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
              />
            )}
          </div>
          <Button icon={<GoogleOutlined />} href={driveViewUrl(video.id)} target="_blank" block style={{ marginTop: 12 }}>Mở trên Drive</Button>
        </Col>
        <Col flex="1 1 420px" style={{ minWidth: 0 }}>
          <Space size="large" wrap style={{ marginBottom: 16 }}>
            <Statistic title="Đã đăng" value={done.length} suffix="lần" />
            <Statistic title="Sắp đăng" value={posts.filter((p) => ACTIVE.includes(p.status)).length} />
            <Statistic title="Số page" value={new Set(done.map((p) => p.page_id)).size} />
            <Statistic title="Tổng views" value={views} formatter={(v) => fmtNum(v)} />
            <Statistic
              title="Reel viral"
              value={done.filter((p) => p.viral).length}
              prefix={<FireOutlined style={{ color: '#f76b15' }} />}
            />
          </Space>
          <Table
            rowKey="job_id"
            size="small"
            loading={loading}
            dataSource={posts}
            pagination={{ pageSize: 20, hideOnSinglePage: true }}
            scroll={{ x: 700 }}
            columns={[
              {
                title: 'Page',
                dataIndex: 'page_name',
                render: (n, p) => (
                  <Space size={4} wrap>
                    {p.viral ? <FireOutlined style={{ color: '#f76b15' }} /> : null}
                    {n || p.page_id}
                    {p.group_name && <Tag color={groupColor(p.group_name)} style={{ margin: 0 }}>{p.group_name}</Tag>}
                  </Space>
                ),
              },
              {
                title: 'Thời gian',
                width: 120,
                render: (_, p) => {
                  const t = p.published_at || p.scheduled_at;
                  return <Tooltip title={dayjs(t).format('DD/MM/YYYY HH:mm')}>{dayjs(t).format('DD/MM HH:mm')}</Tooltip>;
                },
              },
              {
                title: 'Trạng thái',
                dataIndex: 'status',
                width: 130,
                render: (s, p) => {
                  const tag = <Tag color={STATUS[s]?.color}>{STATUS[s]?.label || s}</Tag>;
                  return p.error && s === 'failed' ? <Tooltip title={p.error}>{tag}</Tooltip> : tag;
                },
              },
              { title: 'Views', dataIndex: 'views', width: 90, align: 'right', sorter: (a, b) => (a.views || 0) - (b.views || 0), render: (v) => (v == null ? '-' : fmtNum(v)) },
              { title: 'Like', dataIndex: 'likes', width: 70, align: 'right', render: (v) => (v == null ? '-' : fmtNum(v)) },
              { title: 'Cmt', dataIndex: 'comments', width: 60, align: 'right', render: (v) => (v == null ? '-' : fmtNum(v)) },
              { title: 'Share', dataIndex: 'shares', width: 65, align: 'right', render: (v) => (v == null ? '-' : fmtNum(v)) },
              {
                title: '',
                width: 70,
                render: (_, p) => (p.video_id && p.status === 'done'
                  ? <a href={p.permalink || `https://www.facebook.com/reel/${p.video_id}`} target="_blank" rel="noreferrer">Xem reel</a>
                  : null),
              },
            ]}
          />
        </Col>
      </Row>
    </Drawer>
  );
}
