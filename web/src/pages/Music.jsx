import { useState } from 'react';
import {
  Button, Card, Segmented, Select, Space, Tag,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { groupColor, useApi } from '../api.js';
import MusicStats from './MusicStats.jsx';
import { HistoryDrawer } from './Reels.jsx';
import VideoDrawer from './VideoDrawer.jsx';

// "Tất cả" = every reel the app knows about.
const ALL_DAYS = 3650;

export default function Music() {
  const [days, setDays] = useState(30);
  const [group, setGroup] = useState();
  const [open, setOpen] = useState(null);
  const [openVideo, setOpenVideo] = useState(null);

  const { data: groups = [] } = useApi('/groups');
  const query = new URLSearchParams({ days, ...(group && { group }) }).toString();
  const { data = [], reload } = useApi(`/reels?${query}`, { refreshMs: 60_000 });

  return (
    <Card title="Kho nhạc">
      <Space wrap style={{ marginBottom: 16 }}>
        <Segmented
          value={days}
          onChange={setDays}
          options={[
            { value: 7, label: '7 ngày' },
            { value: 30, label: '30 ngày' },
            { value: 90, label: '90 ngày' },
            { value: ALL_DAYS, label: 'Tất cả' },
          ]}
        />
        <Select
          allowClear
          placeholder="Tất cả nhóm page"
          style={{ width: 190 }}
          value={group}
          onChange={setGroup}
          options={[
            ...groups.map((g) => ({ value: g.name, label: <Tag color={groupColor(g.name)} style={{ margin: 0 }}>{g.name}</Tag> })),
            { value: '__none__', label: 'Chưa có nhóm' },
          ]}
        />
        <Button type="text" icon={<ReloadOutlined />} onClick={() => reload()} />
      </Space>
      <MusicStats reels={data} periodLabel={days === ALL_DAYS ? 'từ trước đến nay' : `${days} ngày qua`} onOpenReel={setOpen} />
      {open && <HistoryDrawer reel={open} onClose={() => setOpen(null)} onOpenVideo={setOpenVideo} />}
      {openVideo && <VideoDrawer video={openVideo} onClose={() => setOpenVideo(null)} />}
    </Card>
  );
}
