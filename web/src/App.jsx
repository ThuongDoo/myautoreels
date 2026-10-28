import { useEffect, useState } from 'react';
import { Layout, Menu } from 'antd';
import { CalendarOutlined, FireOutlined, FlagOutlined, SettingOutlined, UnorderedListOutlined } from '@ant-design/icons';
import Reels from './pages/Reels.jsx';
import Schedule from './pages/Schedule.jsx';
import Queue from './pages/Queue.jsx';
import Pages from './pages/Pages.jsx';
import Settings from './pages/Settings.jsx';

const MENU = [
  { key: 'reels', icon: <FireOutlined />, label: 'Thống kê Reels', Component: Reels },
  { key: 'schedule', icon: <CalendarOutlined />, label: 'Lên lịch', Component: Schedule },
  { key: 'queue', icon: <UnorderedListOutlined />, label: 'Hàng đợi', Component: Queue },
  { key: 'pages', icon: <FlagOutlined />, label: 'Pages', Component: Pages },
  { key: 'settings', icon: <SettingOutlined />, label: 'Cài đặt', Component: Settings },
];

const currentKey = () => window.location.hash.slice(1) || 'reels';

export default function App() {
  const [key, setKey] = useState(currentKey);

  useEffect(() => {
    const onHash = () => setKey(currentKey());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const { Component } = MENU.find((m) => m.key === key) || MENU[0];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider theme="light" breakpoint="lg" collapsedWidth={0} width={210}>
        <div style={{ padding: '18px 20px', fontWeight: 700, fontSize: 18 }}>🎬 AutoReels</div>
        <Menu
          mode="inline"
          selectedKeys={[key]}
          items={MENU.map(({ Component: _, ...item }) => item)}
          onClick={(e) => { window.location.hash = e.key; }}
        />
      </Layout.Sider>
      <Layout.Content style={{ padding: 24, minWidth: 0 }}>
        <Component />
      </Layout.Content>
    </Layout>
  );
}
