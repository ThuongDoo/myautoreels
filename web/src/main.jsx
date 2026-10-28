import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp } from 'antd';
import viVN from 'antd/locale/vi_VN';
import dayjs from 'dayjs';
import 'dayjs/locale/vi';
import relativeTime from 'dayjs/plugin/relativeTime';
import App from './App.jsx';

dayjs.extend(relativeTime);
dayjs.locale('vi');

ReactDOM.createRoot(document.getElementById('root')).render(
  <ConfigProvider locale={viVN} theme={{ token: { colorPrimary: '#e5484d', borderRadius: 8 } }}>
    <AntApp>
      <App />
    </AntApp>
  </ConfigProvider>,
);
