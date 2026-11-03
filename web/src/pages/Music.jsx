import { useState } from 'react';
import { Button, Card, Segmented, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useApi } from '../api.js';
import MusicStats from './MusicStats.jsx';
import { HistoryDrawer } from './Reels.jsx';
import VideoDrawer from './VideoDrawer.jsx';

// "Tất cả" = every reel the app knows about.
const ALL_DAYS = 3650;

export default function Music() {
  const [days, setDays] = useState(30);
  const [open, setOpen] = useState(null);
  const [openVideo, setOpenVideo] = useState(null);

  const { data = [], reload } = useApi(`/reels?days=${days}`, { refreshMs: 60_000 });

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
        <Button type="text" icon={<ReloadOutlined />} onClick={() => reload()} />
      </Space>
      <MusicStats reels={data} periodLabel={days === ALL_DAYS ? 'từ trước đến nay' : `${days} ngày qua`} onOpenReel={setOpen} />
      {open && <HistoryDrawer reel={open} onClose={() => setOpen(null)} onOpenVideo={setOpenVideo} />}
      {openVideo && <VideoDrawer video={openVideo} onClose={() => setOpenVideo(null)} />}
    </Card>
  );
}
