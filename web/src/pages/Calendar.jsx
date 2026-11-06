import {
  memo, useMemo, useState, useSyncExternalStore,
} from 'react';
import { Button, Card, DatePicker, Select, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { groupColor, useApi } from '../api.js';
import { openScheduleWith } from '../prefill.js';
import { createSelection } from '../selection.js';
import { STATUS } from '../status.js';

const NO_GROUP = '__none__';
const MAX_DAYS = 62;

// Cell color: red if anything failed, green once everything is posted, blue while still waiting.
function cellStyle(jobs) {
  if (!jobs?.length) return { background: '#fff1f0', color: '#cf1322' };
  if (jobs.some((j) => j.status === 'failed')) return { background: '#ff7875', color: '#fff' };
  if (jobs.every((j) => j.status === 'done')) return { background: '#95de64', color: '#135200' };
  return { background: '#69b1ff', color: '#fff' };
}

const dayCell = (pageId, day) => ({ key: `${pageId}|${day}`, pageId, day });

// One page on one day. `pickable` cells select / unselect on click, for scheduling.
const DayCell = memo(({ list, pageId, day, pickable, sel }) => {
  const key = `${pageId}|${day}`;
  const on = useSyncExternalStore((fn) => sel.subscribeCell(key, fn), () => sel.has(key));
  const body = (
    <div
      onClick={pickable ? () => sel.toggle([dayCell(pageId, day)]) : undefined}
      style={{
        padding: '8px 0',
        fontWeight: list ? 600 : undefined,
        cursor: pickable ? 'pointer' : 'default',
        ...(on ? { background: '#bae0ff', color: '#0958d9', boxShadow: 'inset 0 0 0 2px #1677ff' } : null),
      }}
    >
      {list ? list.length : '–'}
    </div>
  );
  if (!list) return body;
  return (
    <Tooltip
      title={list.map((j) => (
        <div key={j.id}>
          {dayjs(j.scheduled_at).format('HH:mm')} ·{' '}
          {j.external
            ? <>Đăng trên Facebook · {(j.drive_file_name || '(không caption)').replace(/\s+/g, ' ').slice(0, 50)}</>
            : <>{STATUS[j.status]?.label || j.status} · {j.drive_file_name}</>}
        </div>
      ))}
    >
      {body}
    </Tooltip>
  );
});

// "Đã chọn N ô" + schedule button; re-renders on its own when the selection changes.
function SelectionBar({ sel }) {
  useSyncExternalStore(sel.subscribeAll, sel.version);
  const items = sel.items();
  const pageIds = [...new Set(items.map((c) => c.pageId))];
  const dayCount = new Set(items.map((c) => c.day)).size;
  return (
    <div
      style={{
        marginBottom: 12, padding: '8px 12px', borderRadius: 8,
        background: items.length ? '#e6f4ff' : '#fafafa', border: `1px solid ${items.length ? '#91caff' : '#f0f0f0'}`,
      }}
    >
      <Space wrap>
        {items.length
          ? <Typography.Text strong>Đã chọn {items.length} ô ({pageIds.length} page, {dayCount} ngày)</Typography.Text>
          : <Typography.Text type="secondary">Bấm vào ô để chọn. Bấm tên page hoặc ngày để chọn các ô trống của dòng / cột đó.</Typography.Text>}
        <Button
          type="primary"
          icon={<CalendarOutlined />}
          disabled={!items.length}
          onClick={() => openScheduleWith({ pageIds, cells: items.map(({ pageId, day }) => ({ pageId, day })) })}
        >
          Đặt lịch {items.length ? `${items.length} ô` : ''}
        </Button>
        {items.length > 0 && <Button onClick={sel.clear}>Bỏ chọn</Button>}
      </Space>
    </div>
  );
}

export default function Calendar() {
  // Kept while changing the date range or filters.
  const [sel] = useState(createSelection);
  const [range, setRange] = useState(() => [dayjs().startOf('day'), dayjs().add(13, 'day').startOf('day')]);
  const [groupFilter, setGroupFilter] = useState('');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [showDisabled, setShowDisabled] = useState(false);

  const from = range[0].startOf('day');
  const to = range[1].endOf('day');
  const days = useMemo(() => {
    const out = [];
    for (let d = from; d.isBefore(to) && out.length < MAX_DAYS; d = d.add(1, 'day')) out.push(d);
    return out;
  }, [from.valueOf(), to.valueOf()]);

  const { data: pages = [] } = useApi('/pages');
  const { data: groupList = [] } = useApi('/groups');
  const { data: jobs = [], loading } = useApi(
    `/jobs/calendar?from=${from.valueOf()}&to=${to.valueOf() + 1}`, { refreshMs: 30_000 });

  // pageId -> 'YYYY-MM-DD' -> jobs[]
  const byPage = useMemo(() => {
    const m = new Map();
    for (const j of jobs) {
      const day = dayjs(j.scheduled_at).format('YYYY-MM-DD');
      if (!m.has(j.page_id)) m.set(j.page_id, {});
      (m.get(j.page_id)[day] ||= []).push(j);
    }
    return m;
  }, [jobs]);

  const rows = pages
    .filter((p) => showDisabled || p.enabled)
    .filter((p) => !groupFilter || (p.group_name || NO_GROUP) === groupFilter)
    .map((p) => {
      const cells = byPage.get(p.id) || {};
      const missing = days.filter((d) => !cells[d.format('YYYY-MM-DD')]).length;
      return { ...p, cells, missing };
    })
    .filter((p) => !onlyMissing || p.missing > 0);

  const pagesPerDay = days.map((d) => rows.filter((r) => r.cells[d.format('YYYY-MM-DD')]).length);
  const missingPages = rows.filter((r) => r.missing > 0).length;

  // Days already over can't be scheduled, nor can pages that are switched off.
  const pickable = (p, d) => !!p.enabled && !d.isBefore(dayjs(), 'day');
  const emptyCells = (list) => list
    .filter(([p, d]) => pickable(p, d) && !p.cells[d.format('YYYY-MM-DD')])
    .map(([p, d]) => dayCell(p.id, d.format('YYYY-MM-DD')));

  const columns = [
    {
      title: 'Page',
      dataIndex: 'name',
      fixed: 'left',
      width: 220,
      ellipsis: true,
      sorter: (a, b) => a.name.localeCompare(b.name),
      render: (n, p) => (
        <Space size={4}>
          <Typography.Text
            ellipsis
            title={`${n} · bấm để chọn các ô trống`}
            style={{ maxWidth: 140, cursor: 'pointer' }}
            type={p.enabled ? undefined : 'secondary'}
            onClick={() => sel.toggle(emptyCells(days.map((d) => [p, d])))}
          >
            {n}
          </Typography.Text>
          {p.group_name && <Tag color={groupColor(p.group_name)} style={{ margin: 0 }}>{p.group_name}</Tag>}
        </Space>
      ),
    },
    {
      title: 'Thiếu',
      dataIndex: 'missing',
      fixed: 'left',
      width: 70,
      align: 'center',
      sorter: (a, b) => a.missing - b.missing,
      render: (m) => (m ? <Typography.Text type="danger" strong>{m}</Typography.Text> : <Typography.Text type="success">✓</Typography.Text>),
    },
    ...days.map((d) => {
      const key = d.format('YYYY-MM-DD');
      const weekend = d.day() === 0 || d.day() === 6;
      const today = d.isSame(dayjs(), 'day');
      return {
        key,
        width: 52,
        align: 'center',
        title: (
          <div
            title="Bấm để chọn các ô trống của ngày này"
            onClick={() => sel.toggle(emptyCells(rows.map((p) => [p, d])))}
            style={{ lineHeight: 1.2, cursor: 'pointer', fontWeight: today ? 700 : 400, color: today ? '#1677ff' : weekend ? '#cf1322' : undefined }}
          >
            <div style={{ fontSize: 11 }}>{['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.day()]}</div>
            <div>{d.format('DD/MM')}</div>
          </div>
        ),
        onCell: (p) => ({ style: { ...cellStyle(p.cells[key]), padding: 0 } }),
        render: (_, p) => <DayCell list={p.cells[key]} pageId={p.id} day={key} pickable={pickable(p, d)} sel={sel} />,
      };
    }),
  ];

  return (
    <Card
      title="Lịch tổng quan"
      extra={(
        <Typography.Text type={missingPages ? 'danger' : 'success'}>
          {missingPages ? `${missingPages}/${rows.length} page thiếu lịch` : `Tất cả ${rows.length} page đều có lịch`}
        </Typography.Text>
      )}
    >
      <Space wrap style={{ marginBottom: 16 }}>
        <DatePicker.RangePicker
          value={range}
          format="DD/MM/YYYY"
          allowClear={false}
          onChange={(v) => v && setRange(v)}
          disabledDate={(d) => range[0] && Math.abs(d.diff(range[0], 'day')) >= MAX_DAYS}
        />
        <Button onClick={() => setRange([dayjs().subtract(6, 'day').startOf('day'), dayjs().startOf('day')])}>7 ngày qua</Button>
        <Button onClick={() => setRange([dayjs().startOf('day'), dayjs().add(6, 'day')])}>7 ngày tới</Button>
        <Button onClick={() => setRange([dayjs().startOf('day'), dayjs().add(13, 'day')])}>14 ngày tới</Button>
        <Button onClick={() => setRange([dayjs().startOf('day'), dayjs().add(29, 'day')])}>30 ngày tới</Button>
        <Select
          style={{ width: 180 }}
          value={groupFilter}
          onChange={setGroupFilter}
          options={[
            { value: '', label: 'Tất cả nhóm' },
            ...groupList.map((g) => ({ value: g.name, label: g.name })),
            { value: NO_GROUP, label: 'Chưa có nhóm' },
          ]}
        />
        <Space size={4}><Switch size="small" checked={onlyMissing} onChange={setOnlyMissing} /> Chỉ page thiếu lịch</Space>
        <Space size={4}><Switch size="small" checked={showDisabled} onChange={setShowDisabled} /> Hiện page đang tắt</Space>
      </Space>

      <Space wrap style={{ marginBottom: 12 }}>
        <Tag color="#69b1ff">Có lịch, chờ đăng</Tag>
        <Tag color="#95de64" style={{ color: '#135200' }}>Đã đăng hết</Tag>
        <Tag color="#ff7875">Có video lỗi</Tag>
        <Tag style={{ background: '#fff1f0', color: '#cf1322' }}>– Không có lịch</Tag>
        <Typography.Text type="secondary">
          Số trong ô = số reel trong ngày, kể cả reel đăng thẳng trên Facebook (hiện sau khi lên sóng và cập nhật số liệu).
          Rê chuột để xem chi tiết.
        </Typography.Text>
      </Space>

      <SelectionBar sel={sel} />

      <Table
        rowKey="id"
        size="small"
        bordered
        loading={loading}
        dataSource={rows}
        columns={columns}
        pagination={false}
        scroll={{ x: 290 + days.length * 52, y: 'calc(100vh - 390px)' }}
        summary={() => (
          <Table.Summary fixed>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={2}><b>Số page có lịch</b></Table.Summary.Cell>
              {pagesPerDay.map((n, i) => (
                <Table.Summary.Cell key={i} index={i + 2} align="center">
                  <Typography.Text type={n < rows.length ? 'danger' : 'success'} strong>{n}</Typography.Text>
                </Table.Summary.Cell>
              ))}
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />
    </Card>
  );
}
