import { useMemo, useState } from 'react';
import { Button, Card, Col, Empty, Row, Segmented, Space, Statistic, Table, Typography } from 'antd';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import dayjs from 'dayjs';
import { fmtNum, useApi } from '../api.js';

// Single-hue magnitude charts; "emphasis" charts highlight the best bars and gray the rest.
const C = {
  series: '#2a78d6',
  seriesFill: 'rgba(42,120,214,0.14)',
  muted: '#cfcdc4',
  grid: '#e1e0d9',
  axis: '#898781',
  baseline: '#c3c2b7',
};
const NO_GROUP_LABEL = 'Chưa có nhóm';
const MATURE_MS = 24 * 3_600_000;

const compact = (v) => {
  const n = Math.abs(v);
  if (n >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
};
const pct = (v) => `${(v * 100).toFixed(1)}%`;
const engagement = (r) => (r.views ? (r.likes + r.comments + r.shares) / r.views : 0);

const xAxis = { tick: { fontSize: 11, fill: C.axis }, axisLine: { stroke: C.baseline }, tickLine: false };
const yAxis = { tick: { fontSize: 11, fill: C.axis }, axisLine: false, tickLine: false };

function TooltipBox({ active, payload, render }) {
  if (!active || !payload?.length) return null;
  const { title, lines } = render(payload[0].payload);
  return (
    <div style={{
      background: '#fff', border: '1px solid rgba(11,11,11,0.10)', borderRadius: 8,
      padding: '8px 12px', boxShadow: '0 4px 14px rgba(0,0,0,0.08)', fontSize: 13,
    }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {lines.map(([k, v]) => (
        <div key={k} style={{ color: '#52514e' }}>{k}: <b style={{ color: '#0b0b0b' }}>{v}</b></div>
      ))}
    </div>
  );
}

function ChartCard({ title, subtitle, extra, height = 260, empty, children }) {
  return (
    <Card size="small" title={title} extra={extra} style={{ height: '100%' }}>
      {subtitle && <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -4 }}>{subtitle}</Typography.Paragraph>}
      {empty ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chưa có dữ liệu" style={{ height: height - 40 }} />
      ) : (
        <ResponsiveContainer width="100%" height={height}>{children}</ResponsiveContainer>
      )}
    </Card>
  );
}

const GROUP_METRICS = {
  total: { label: 'Tổng views', get: (g) => g.views, fmt: fmtNum, axis: compact },
  avg: { label: 'Views TB / reel', get: (g) => g.avg, fmt: (v) => fmtNum(Math.round(v)), axis: compact },
  eng: { label: 'Tỉ lệ tương tác', get: (g) => g.eng, fmt: pct, axis: (v) => `${Math.round(v * 100)}%` },
};

export default function ReelCharts({ reels, days, query }) {
  const [groupMetric, setGroupMetric] = useState('total');
  const { data: gains = [] } = useApi(`/analytics/view-gains?${query}`);

  const hourly = days <= 3;
  const bucketFormat = hourly ? 'DD/MM HH:00' : 'DD/MM';
  const bucketKey = (ts) => (hourly ? dayjs(ts).startOf('hour') : dayjs(ts).startOf('day')).valueOf();

  const stats = useMemo(() => {
    const views = reels.reduce((s, r) => s + r.views, 0);
    const interactions = reels.reduce((s, r) => s + r.likes + r.comments + r.shares, 0);
    return {
      views,
      count: reels.length,
      avg: reels.length ? views / reels.length : 0,
      eng: views ? interactions / views : 0,
      viral: reels.filter((r) => r.viral).length,
    };
  }, [reels]);

  // Empty buckets are kept so gaps show as zero instead of being skipped.
  const timeline = useMemo(() => {
    const unit = hourly ? 'hour' : 'day';
    const count = hourly ? days * 24 : days;
    const end = dayjs().startOf(unit);
    const buckets = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const t = end.subtract(i, unit).valueOf();
      buckets.set(t, { t, gain: 0, posted: 0, pages: new Map() });
    }
    for (const g of gains) {
      const b = buckets.get(bucketKey(g.hour));
      if (!b) continue;
      b.gain += g.gain;
      const p = b.pages.get(g.page_id) || { id: g.page_id, name: g.page_name || g.page_id, gain: 0 };
      p.gain += g.gain;
      b.pages.set(g.page_id, p);
    }
    for (const r of reels) {
      const b = buckets.get(bucketKey(r.published_at));
      if (b) b.posted++;
    }
    return [...buckets.values()].map((b) => ({ ...b, pages: [...b.pages.values()].sort((x, y) => y.gain - x.gain) }));
  }, [gains, reels, days, hourly]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clicked bucket on the views chart, or null = whole period.
  const [picked, setPicked] = useState(null);
  const pickedBucket = timeline.find((b) => b.t === picked);
  const pagesInRange = useMemo(() => {
    if (pickedBucket) return pickedBucket.pages;
    const map = new Map();
    for (const b of timeline) {
      for (const p of b.pages) {
        const cur = map.get(p.id) || { ...p, gain: 0 };
        cur.gain += p.gain;
        map.set(p.id, cur);
      }
    }
    return [...map.values()].sort((x, y) => y.gain - x.gain);
  }, [timeline, pickedBucket]);
  const rangeLabel = pickedBucket
    ? (hourly
      ? `${dayjs(pickedBucket.t).format('HH:00')} – ${dayjs(pickedBucket.t).add(1, 'hour').format('HH:00')} ngày ${dayjs(pickedBucket.t).format('DD/MM')}`
      : `ngày ${dayjs(pickedBucket.t).format('DD/MM/YYYY')}`)
    : `${days} ngày qua`;

  const byGroup = useMemo(() => {
    const map = new Map();
    for (const r of reels) {
      const name = r.group_name || NO_GROUP_LABEL;
      const g = map.get(name) || { name, views: 0, count: 0, interactions: 0 };
      g.views += r.views;
      g.count++;
      g.interactions += r.likes + r.comments + r.shares;
      map.set(name, g);
    }
    const rows = [...map.values()].map((g) => ({ ...g, avg: g.views / g.count, eng: g.views ? g.interactions / g.views : 0 }));
    const metric = GROUP_METRICS[groupMetric];
    return rows.sort((a, b) => metric.get(b) - metric.get(a)).map((g) => ({ ...g, value: metric.get(g) }));
  }, [reels, groupMetric]);

  const topPages = useMemo(() => {
    const map = new Map();
    for (const r of reels) {
      const name = r.page_name || r.page_id;
      const p = map.get(name) || { name, views: 0, count: 0 };
      p.views += r.views;
      p.count++;
      map.set(name, p);
    }
    return [...map.values()].sort((a, b) => b.views - a.views).slice(0, 10);
  }, [reels]);

  // Average views by local publish hour. Reels younger than 24h are left out when there are
  // enough older ones — they haven't had time to collect views and would drag their hour down.
  const byHour = useMemo(() => {
    const mature = reels.filter((r) => Date.now() - r.published_at >= MATURE_MS);
    const source = mature.length >= 10 ? mature : reels;
    const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, views: 0, count: 0 }));
    for (const r of source) {
      const h = hours[dayjs(r.published_at).hour()];
      h.views += r.views;
      h.count++;
    }
    const rows = hours.map((h) => ({ ...h, avg: h.count ? h.views / h.count : 0 }));
    const best = new Set(rows.filter((h) => h.count >= 2).sort((a, b) => b.avg - a.avg).slice(0, 3).map((h) => h.hour));
    return { rows: rows.map((h) => ({ ...h, best: best.has(h.hour) })), usedMature: source === mature, best: [...best].sort((a, b) => a - b) };
  }, [reels]);

  const metric = GROUP_METRICS[groupMetric];
  const hasViews = timeline.some((d) => d.gain > 0);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        {[
          { title: 'Tổng views', value: fmtNum(stats.views) },
          { title: 'Số reel', value: fmtNum(stats.count) },
          { title: 'Views TB / reel', value: fmtNum(Math.round(stats.avg)) },
          { title: 'Tỉ lệ tương tác', value: pct(stats.eng), tip: '(like + comment + share) / views' },
          { title: 'Reel viral', value: fmtNum(stats.viral) },
        ].map((s) => (
          <Col flex="1 1 170px" key={s.title}>
            <Card size="small"><Statistic title={s.title} value={s.value} /></Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <ChartCard
            title={hourly ? 'Views mới theo giờ' : 'Views mới theo ngày'}
            subtitle={`Lượng views tăng thêm của các reel, tính từ các lần cập nhật số liệu. Bấm vào một ${hourly ? 'giờ' : 'ngày'} để xem page nào có views.`}
            empty={!hasViews}
          >
            <AreaChart
              data={timeline}
              margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
              style={{ cursor: 'pointer' }}
              onClick={(s) => {
                const t = timeline[Number(s?.activeIndex)]?.t ?? Number(s?.activeLabel);
                if (t) setPicked((cur) => (cur === t ? null : t));
              }}
            >
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="t" {...xAxis} tickFormatter={(t) => dayjs(t).format(bucketFormat)} minTickGap={24} />
              <YAxis {...yAxis} tickFormatter={compact} width={44} />
              <Tooltip
                cursor={{ stroke: C.axis, strokeDasharray: '3 3' }}
                content={<TooltipBox render={(d) => ({
                  title: dayjs(d.t).format(hourly ? 'HH:00 DD/MM/YYYY' : 'DD/MM/YYYY'),
                  lines: [
                    ['Views mới', fmtNum(d.gain)],
                    ['Page có views', d.pages.length],
                    ['Reel đăng', d.posted],
                    ...d.pages.slice(0, 5).map((p) => [`· ${p.name}`, fmtNum(p.gain)]),
                    ...(d.pages.length > 5 ? [[`… và ${d.pages.length - 5} page khác`, '']] : []),
                  ],
                })}
                />}
              />
              {pickedBucket && <ReferenceLine x={pickedBucket.t} stroke={C.series} strokeDasharray="4 3" />}
              <Area isAnimationActive={false} type="monotone" dataKey="gain" stroke={C.series} strokeWidth={2} fill={C.seriesFill} activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }} />
            </AreaChart>
          </ChartCard>
        </Col>
        <Col xs={24} xl={10}>
          <ChartCard
            title={hourly ? 'Số reel đăng theo giờ' : 'Số reel đăng mỗi ngày'}
            empty={!reels.length}
          >
            <BarChart data={timeline} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="t" {...xAxis} tickFormatter={(t) => dayjs(t).format(bucketFormat)} minTickGap={24} />
              <YAxis {...yAxis} allowDecimals={false} width={36} />
              <Tooltip
                cursor={{ fill: 'rgba(11,11,11,0.04)' }}
                content={<TooltipBox render={(d) => ({ title: dayjs(d.t).format(hourly ? 'HH:00 DD/MM/YYYY' : 'DD/MM/YYYY'), lines: [['Reel đăng', d.posted]] })} />}
              />
              <Bar isAnimationActive={false} dataKey="posted" fill={C.series} radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ChartCard>
        </Col>

        {hasViews && (
          <Col xs={24}>
            <Card
              size="small"
              title={`Page có views mới · ${rangeLabel}`}
              extra={(
                <Space>
                  <Typography.Text type="secondary">
                    {pagesInRange.length} page · {fmtNum(pagesInRange.reduce((s, p) => s + p.gain, 0))} views
                  </Typography.Text>
                  {pickedBucket && <Button size="small" onClick={() => setPicked(null)}>Xem cả {days} ngày</Button>}
                </Space>
              )}
            >
              <Table
                rowKey="id"
                size="small"
                dataSource={pagesInRange}
                pagination={pagesInRange.length > 20 ? { pageSize: 20, showSizeChanger: false } : false}
                locale={{ emptyText: 'Không có page nào có views mới trong khoảng này' }}
                columns={[
                  { title: '#', width: 48, render: (_, __, i) => i + 1 },
                  { title: 'Page', dataIndex: 'name', ellipsis: true },
                  {
                    title: 'Views mới',
                    dataIndex: 'gain',
                    width: 280,
                    sorter: (a, b) => a.gain - b.gain,
                    defaultSortOrder: 'descend',
                    render: (g) => (
                      <Space style={{ width: '100%' }}>
                        <div style={{ width: 160, height: 8, background: C.grid, borderRadius: 4 }}>
                          <div style={{ width: `${(g / (pagesInRange[0]?.gain || 1)) * 100}%`, height: '100%', background: C.series, borderRadius: 4 }} />
                        </div>
                        <b>{fmtNum(g)}</b>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>
          </Col>
        )}

        <Col xs={24} xl={12}>
          <ChartCard
            title="So sánh nhóm (ngách)"
            extra={(
              <Segmented
                size="small"
                value={groupMetric}
                onChange={setGroupMetric}
                options={Object.entries(GROUP_METRICS).map(([value, m]) => ({ value, label: m.label }))}
              />
            )}
            height={Math.max(160, byGroup.length * 36 + 40)}
            empty={!byGroup.length}
          >
            <BarChart data={byGroup} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap={6}>
              <CartesianGrid stroke={C.grid} horizontal={false} />
              <XAxis type="number" {...xAxis} tickFormatter={metric.axis} />
              <YAxis type="category" dataKey="name" {...yAxis} width={110} tick={{ fontSize: 12, fill: '#52514e' }} />
              <Tooltip
                cursor={{ fill: 'rgba(11,11,11,0.04)' }}
                content={<TooltipBox render={(g) => ({
                  title: g.name,
                  lines: [['Tổng views', fmtNum(g.views)], ['Số reel', g.count], ['Views TB / reel', fmtNum(Math.round(g.avg))], ['Tương tác', pct(g.eng)]],
                })}
                />}
              />
              <Bar
                isAnimationActive={false}
                dataKey="value"
                fill={C.series}
                radius={[0, 4, 4, 0]}
                maxBarSize={22}
                label={{ position: 'right', fontSize: 11, fill: '#52514e', formatter: metric.fmt }}
              />
            </BarChart>
          </ChartCard>
        </Col>
        <Col xs={24} xl={12}>
          <ChartCard title="Top 10 page nhiều views nhất" height={Math.max(160, topPages.length * 32 + 40)} empty={!topPages.length}>
            <BarChart data={topPages} layout="vertical" margin={{ top: 0, right: 56, left: 0, bottom: 0 }} barCategoryGap={6}>
              <CartesianGrid stroke={C.grid} horizontal={false} />
              <XAxis type="number" {...xAxis} tickFormatter={compact} />
              <YAxis
                type="category"
                dataKey="name"
                {...yAxis}
                width={140}
                tick={{ fontSize: 12, fill: '#52514e' }}
                tickFormatter={(n) => (n.length > 20 ? `${n.slice(0, 19)}…` : n)}
              />
              <Tooltip
                cursor={{ fill: 'rgba(11,11,11,0.04)' }}
                content={<TooltipBox render={(p) => ({
                  title: p.name,
                  lines: [['Tổng views', fmtNum(p.views)], ['Số reel', p.count], ['Views TB / reel', fmtNum(Math.round(p.views / p.count))]],
                })}
                />}
              />
              <Bar isAnimationActive={false} dataKey="views" fill={C.series} radius={[0, 4, 4, 0]} maxBarSize={20} label={{ position: 'right', fontSize: 11, fill: '#52514e', formatter: compact }} />
            </BarChart>
          </ChartCard>
        </Col>

        <Col xs={24}>
          <ChartCard
            title="Giờ đăng hiệu quả nhất"
            subtitle={(
              <>
                Views trung bình mỗi reel theo giờ đăng
                {byHour.usedMature ? ' (chỉ tính reel đã đăng hơn 24 giờ)' : ''}.
                {byHour.best.length > 0 && (
                  <> Cột xanh là 3 giờ tốt nhất: <b>{byHour.best.map((h) => `${String(h).padStart(2, '0')}h`).join(', ')}</b> — nên dùng làm khung giờ đăng.</>
                )}
              </>
            )}
            height={240}
            empty={!reels.length}
          >
            <BarChart data={byHour.rows} margin={{ top: 8, right: 24, left: 0, bottom: 0 }} barCategoryGap={3}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="hour" {...xAxis} tickFormatter={(h) => `${h}h`} interval={0} />
              <YAxis {...yAxis} tickFormatter={compact} width={44} />
              <Tooltip
                cursor={{ fill: 'rgba(11,11,11,0.04)' }}
                content={<TooltipBox render={(h) => ({
                  title: `${String(h.hour).padStart(2, '0')}:00 – ${String(h.hour).padStart(2, '0')}:59`,
                  lines: [['Views TB / reel', fmtNum(Math.round(h.avg))], ['Số reel', h.count]],
                })}
                />}
              />
              <Bar isAnimationActive={false} dataKey="avg" radius={[4, 4, 0, 0]}>
                {byHour.rows.map((h) => <Cell key={h.hour} fill={h.best || !byHour.best.length ? C.series : C.muted} />)}
              </Bar>
            </BarChart>
          </ChartCard>
        </Col>
      </Row>
    </Space>
  );
}
