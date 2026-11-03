import { useEffect, useState } from 'react';
import { Layout, Menu } from 'antd';
import {
  AppstoreOutlined, CalendarOutlined, CustomerServiceOutlined, FireOutlined, TableOutlined, FlagOutlined, PlaySquareOutlined, SettingOutlined, ThunderboltOutlined, UnorderedListOutlined,
} from '@ant-design/icons';
import Reels from './pages/Reels.jsx';
import Schedule from './pages/Schedule.jsx';
import Queue from './pages/Queue.jsx';
import Calendar from './pages/Calendar.jsx';
import Pages from './pages/Pages.jsx';
import Videos from './pages/Videos.jsx';
import PageVideoMatrix from './pages/PageVideoMatrix.jsx';
import Music from './pages/Music.jsx';
import Hooks from './pages/Hooks.jsx';
import Settings from './pages/Settings.jsx';

const MENU = [
  { key: 'reels', icon: <FireOutlined />, label: 'Thống kê Reels', Component: Reels },
  { key: 'schedule', icon: <CalendarOutlined />, label: 'Lên lịch', Component: Schedule },
  { key: 'calendar', icon: <TableOutlined />, label: 'Lịch tổng quan', Component: Calendar },
  { key: 'queue', icon: <UnorderedListOutlined />, label: 'Hàng đợi', Component: Queue },
  { key: 'videos', icon: <PlaySquareOutlined />, label: 'Kho video', Component: Videos },
  { key: 'matrix', icon: <AppstoreOutlined />, label: 'Page × video', Component: PageVideoMatrix },
  { key: 'music', icon: <CustomerServiceOutlined />, label: 'Kho nhạc', Component: Music },
  { key: 'hooks', icon: <ThunderboltOutlined />, label: 'Kho hook', Component: Hooks },
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

  // Collapsed = icons only; remembered per browser.
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sider_collapsed') === '1'; } catch { return false; }
  });
  const toggle = (value) => {
    setCollapsed(value);
    try { localStorage.setItem('sider_collapsed', value ? '1' : '0'); } catch { /* private mode */ }
  };

  const { Component } = MENU.find((m) => m.key === key) || MENU[0];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Sider
        theme="light"
        width={210}
        collapsedWidth={64}
        collapsible
        collapsed={collapsed}
        onCollapse={toggle}
        breakpoint="lg"
        onBreakpoint={(small) => small && setCollapsed(true)}
        style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
      >
        <div style={{ padding: collapsed ? '18px 0' : '18px 20px', textAlign: collapsed ? 'center' : 'left', fontWeight: 700, fontSize: 18, whiteSpace: 'nowrap' }}>
          {collapsed ? '🎬' : '🎬 AutoReels'}
        </div>
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
