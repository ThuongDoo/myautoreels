import { useMemo, useState } from "react";
import {
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Typography,
} from "antd";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import dayjs from "dayjs";
import { fmtNum, useApi } from "../api.js";

// Single-hue magnitude charts; "emphasis" charts highlight the best bars and gray the rest.
const C = {
  series: "#2a78d6",
  seriesFill: "rgba(42,120,214,0.14)",
  muted: "#cfcdc4",
  grid: "#e1e0d9",
  axis: "#898781",
  baseline: "#c3c2b7",
};
const NO_GROUP_LABEL = "Chưa có nhóm";
const MATURE_MS = 24 * 3_600_000;
const TOP_PAGES_COLLAPSED = 10;

const compact = (v) => {
  const n = Math.abs(v);
  if (n >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
  return String(Math.round(v));
};
const pct = (v) => `${(v * 100).toFixed(1)}%`;

// The metric every chart follows. `reel` reads a reel's lifetime total, `gain` reads one
// row of /analytics/view-gains (views gained there are in `gain`).
const METRICS = {
  views: { label: "Views", reel: (r) => r.views, gain: (g) => g.gain },
  likes: { label: "Like", reel: (r) => r.likes, gain: (g) => g.likes },
  comments: {
    label: "Comment",
    reel: (r) => r.comments,
    gain: (g) => g.comments,
  },
  shares: { label: "Share", reel: (r) => r.shares, gain: (g) => g.shares },
  interactions: {
    label: "Tương tác",
    tip: "Like + comment + share",
    reel: (r) => r.likes + r.comments + r.shares,
    gain: (g) => g.likes + g.comments + g.shares,
  },
};

const xAxis = {
  tick: { fontSize: 11, fill: C.axis },
  axisLine: { stroke: C.baseline },
  tickLine: false,
};
const yAxis = {
  tick: { fontSize: 11, fill: C.axis },
  axisLine: false,
  tickLine: false,
};

function TooltipBox({ active, payload, render }) {
  if (!active || !payload?.length) return null;
  const { title, lines } = render(payload[0].payload);
  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid rgba(11,11,11,0.10)",
        borderRadius: 8,
        padding: "8px 12px",
        boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      {lines.map(([k, v]) => (
        <div key={k} style={{ color: "#52514e" }}>
          {k}: <b style={{ color: "#0b0b0b" }}>{v}</b>
        </div>
      ))}
    </div>
  );
}

// maxHeight: taller charts scroll inside the card instead of stretching the row.
function ChartCard({ title, subtitle, extra, height = 260, maxHeight, footer, empty, children }) {
  const chart = (
    <ResponsiveContainer width="100%" height={height}>
      {children}
    </ResponsiveContainer>
  );
  return (
    <Card size="small" title={title} extra={extra} style={{ height: "100%" }}>
      {subtitle && (
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 12, marginTop: -4 }}
        >
          {subtitle}
        </Typography.Paragraph>
      )}
      {empty ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Chưa có dữ liệu"
          style={{ height: height - 40 }}
        />
      ) : maxHeight && height > maxHeight ? (
        <div style={{ maxHeight, overflowY: "auto", overflowX: "hidden" }}>{chart}</div>
      ) : (
        chart
      )}
      {footer}
    </Card>
  );
}

// Page names on the "by page" chart are links that open the page's detail drawer.
function PageTick({ x, y, payload, pages, onOpen }) {
  const name = pages.find((p) => p.id === payload.value)?.name || payload.value;
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fontSize={12}
      fill={C.series}
      style={{ cursor: "pointer" }}
      onClick={() => onOpen?.(payload.value)}
    >
      <title>{name}</title>
      {name.length > 20 ? `${name.slice(0, 19)}…` : name}
    </text>
  );
}

// Labels take the chosen metric's name, e.g. "Tổng like".
const GROUP_METRICS = {
  total: {
    label: (m) => `Tổng ${m.label.toLowerCase()}`,
    get: (g) => g.value,
    fmt: fmtNum,
    axis: compact,
  },
  avg: {
    label: (m) => `${m.label} TB / reel`,
    get: (g) => g.avg,
    fmt: (v) => fmtNum(Math.round(v)),
    axis: compact,
  },
  eng: {
    label: () => "Tỉ lệ tương tác",
    get: (g) => g.eng,
    fmt: pct,
    axis: (v) => `${Math.round(v * 100)}%`,
  },
};

// Windows for the top-pages chart. Starts are floored to the hour/day so the request URL
// stays stable between renders. 'period' = lifetime views of reels posted in the page filter.
const TOP_RANGES = {
  period: { label: "Tổng (theo kỳ lọc)" },
  "1h": {
    label: "1 giờ qua",
    range: () => [dayjs().startOf("hour").subtract(1, "hour")],
  },
  "6h": {
    label: "6 giờ qua",
    range: () => [dayjs().startOf("hour").subtract(6, "hour")],
  },
  "24h": {
    label: "24 giờ qua",
    range: () => [dayjs().startOf("hour").subtract(24, "hour")],
  },
  today: { label: "Hôm nay", range: () => [dayjs().startOf("day")] },
  yesterday: {
    label: "Hôm qua",
    range: () => [
      dayjs().startOf("day").subtract(1, "day"),
      dayjs().startOf("day"),
    ],
  },
  "7d": {
    label: "7 ngày qua",
    range: () => [dayjs().startOf("day").subtract(6, "day")],
  },
  "30d": {
    label: "30 ngày qua",
    range: () => [dayjs().startOf("day").subtract(29, "day")],
  },
  custom: { label: "Tùy chọn…" },
};

export default function ReelCharts({ reels, days, query, onOpenPage }) {
  const [metricKey, setMetricKey] = useState("views");
  const M = METRICS[metricKey];
  const unit = M.label.toLowerCase();
  const [groupMetric, setGroupMetric] = useState("total");
  const { data: gains = [] } = useApi(`/analytics/view-gains?${query}`);

  const hourly = days <= 3;
  const bucketFormat = hourly ? "DD/MM HH:00" : "DD/MM";
  const bucketKey = (ts) =>
    (hourly ? dayjs(ts).startOf("hour") : dayjs(ts).startOf("day")).valueOf();

  const stats = useMemo(() => {
    const views = reels.reduce((s, r) => s + r.views, 0);
    const interactions = reels.reduce(
      (s, r) => s + r.likes + r.comments + r.shares,
      0,
    );
    const sum = (f) => reels.reduce((s, r) => s + f(r), 0);
    return {
      views,
      count: reels.length,
      avg: reels.length ? views / reels.length : 0,
      eng: views ? interactions / views : 0,
      viral: reels.filter((r) => r.viral).length,
      likes: sum((r) => r.likes),
      comments: sum((r) => r.comments),
      shares: sum((r) => r.shares),
    };
  }, [reels]);

  // Empty buckets are kept so gaps show as zero instead of being skipped.
  const timeline = useMemo(() => {
    const unit = hourly ? "hour" : "day";
    const count = hourly ? days * 24 : days;
    const end = dayjs().startOf(unit);
    const buckets = new Map();
    for (let i = count - 1; i >= 0; i--) {
      const t = end.subtract(i, unit).valueOf();
      buckets.set(t, { t, gain: 0, posted: 0, pages: new Map() });
    }
    for (const g of gains) {
      const b = buckets.get(bucketKey(g.hour));
      const value = M.gain(g);
      if (!b || !value) continue;
      b.gain += value;
      const p = b.pages.get(g.page_id) || {
        id: g.page_id,
        name: g.page_name || g.page_id,
        gain: 0,
      };
      p.gain += value;
      b.pages.set(g.page_id, p);
    }
    for (const r of reels) {
      const b = buckets.get(bucketKey(r.published_at));
      if (b) b.posted++;
    }
    return [...buckets.values()].map((b) => ({
      ...b,
      pages: [...b.pages.values()].sort((x, y) => y.gain - x.gain),
    }));
  }, [gains, reels, days, hourly, metricKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // `value` = the chosen metric's total; `bar` = whatever the group toggle shows.
  const byGroup = useMemo(() => {
    const map = new Map();
    for (const r of reels) {
      const name = r.group_name || NO_GROUP_LABEL;
      const g = map.get(name) || {
        name,
        views: 0,
        value: 0,
        count: 0,
        interactions: 0,
      };
      g.views += r.views;
      g.value += M.reel(r);
      g.count++;
      g.interactions += r.likes + r.comments + r.shares;
      map.set(name, g);
    }
    const rows = [...map.values()].map((g) => ({
      ...g,
      avg: g.value / g.count,
      eng: g.views ? g.interactions / g.views : 0,
    }));
    const gm = GROUP_METRICS[groupMetric];
    return rows
      .sort((a, b) => gm.get(b) - gm.get(a))
      .map((g) => ({ ...g, bar: gm.get(g) }));
  }, [reels, groupMetric, metricKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const [topRange, setTopRange] = useState("period");
  const [customRange, setCustomRange] = useState(() => [
    dayjs().startOf("day").subtract(1, "day"),
    dayjs().startOf("hour"),
  ]);
  const [topFrom, topTo] =
    topRange === "custom"
      ? [
          customRange[0].startOf("hour"),
          customRange[1].startOf("hour").add(1, "hour"),
        ]
      : TOP_RANGES[topRange].range?.() || [];
  const topQuery = useMemo(() => {
    const q = new URLSearchParams(query);
    q.delete("days");
    if (topFrom) q.set("from", topFrom.valueOf());
    if (topTo) q.set("to", topTo.valueOf());
    return q.toString();
  }, [query, topFrom?.valueOf(), topTo?.valueOf()]); // eslint-disable-line react-hooks/exhaustive-deps
  const { data: topGains = [], loading: topLoading } = useApi(
    topFrom ? `/analytics/view-gains?${topQuery}` : null,
  );

  const topPages = useMemo(() => {
    const map = new Map();
    if (!topFrom) {
      for (const r of reels) {
        const p = map.get(r.page_id) || {
          id: r.page_id,
          name: r.page_name || r.page_id,
          value: 0,
          count: 0,
        };
        p.value += M.reel(r);
        p.count++;
        map.set(r.page_id, p);
      }
    } else {
      for (const g of topGains) {
        const p = map.get(g.page_id) || {
          id: g.page_id,
          name: g.page_name || g.page_id,
          value: 0,
        };
        p.value += M.gain(g);
        map.set(g.page_id, p);
      }
    }
    return [...map.values()]
      .filter((p) => p.value > 0 || !topFrom)
      .sort((a, b) => b.value - a.value);
  }, [reels, topGains, !topFrom, metricKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // Top N by default so this card stays level with the group chart beside it.
  const [showAllPages, setShowAllPages] = useState(false);
  const shownPages = showAllPages ? topPages : topPages.slice(0, TOP_PAGES_COLLAPSED);
  const hiddenPages = topPages.slice(TOP_PAGES_COLLAPSED);

  // Average views by local publish hour. Reels younger than 24h are left out when there are
  // enough older ones — they haven't had time to collect views and would drag their hour down.
  const byHour = useMemo(() => {
    const mature = reels.filter(
      (r) => Date.now() - r.published_at >= MATURE_MS,
    );
    const source = mature.length >= 10 ? mature : reels;
    const hours = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      value: 0,
      count: 0,
    }));
    for (const r of source) {
      const h = hours[dayjs(r.published_at).hour()];
      h.value += M.reel(r);
      h.count++;
    }
    const rows = hours.map((h) => ({
      ...h,
      avg: h.count ? h.value / h.count : 0,
    }));
    const best = new Set(
      rows
        .filter((h) => h.count >= 2)
        .sort((a, b) => b.avg - a.avg)
        .slice(0, 3)
        .map((h) => h.hour),
    );
    return {
      rows: rows.map((h) => ({ ...h, best: best.has(h.hour) })),
      usedMature: source === mature,
      best: [...best].sort((a, b) => a - b),
    };
  }, [reels, metricKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const groupM = GROUP_METRICS[groupMetric];
  const hasGain = timeline.some((d) => d.gain > 0);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Row gutter={[16, 16]}>
        {[
          { title: "Tổng views", value: fmtNum(stats.views) },
          { title: "Số reel", value: fmtNum(stats.count) },
          { title: "Views TB / reel", value: fmtNum(Math.round(stats.avg)) },
          {
            title: "Tỉ lệ tương tác",
            value: pct(stats.eng),
            tip: "(like + comment + share) / views",
          },
          { title: "Reel viral", value: fmtNum(stats.viral) },
          { title: "Tổng like", value: fmtNum(stats.likes) },
          { title: "Tổng comment", value: fmtNum(stats.comments) },
          { title: "Tổng share", value: fmtNum(stats.shares) },
        ].map((s) => (
          <Col flex="1 1 170px" key={s.title}>
            <Card size="small">
              <Statistic title={s.title} value={s.value} />
            </Card>
          </Col>
        ))}
      </Row>

      <Space wrap>
        <Typography.Text strong>Biểu đồ theo:</Typography.Text>
        <Segmented
          value={metricKey}
          onChange={setMetricKey}
          options={Object.entries(METRICS).map(([value, m]) => ({
            value,
            label: m.tip ? <span title={m.tip}>{m.label}</span> : m.label,
          }))}
        />
        {M.tip && <Typography.Text type="secondary">({M.tip})</Typography.Text>}
      </Space>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <ChartCard
            title={`${M.label} mới theo ${hourly ? "giờ" : "ngày"}`}
            subtitle={`Lượng ${unit} tăng thêm của các reel, tính từ các lần cập nhật số liệu.`}
            empty={!hasGain}
          >
            <AreaChart
              data={timeline}
              margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
            >
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis
                dataKey="t"
                {...xAxis}
                tickFormatter={(t) => dayjs(t).format(bucketFormat)}
                minTickGap={24}
              />
              <YAxis {...yAxis} tickFormatter={compact} width={44} />
              <Tooltip
                cursor={{ stroke: C.axis, strokeDasharray: "3 3" }}
                content={
                  <TooltipBox
                    render={(d) => ({
                      title: dayjs(d.t).format(
                        hourly ? "HH:00 DD/MM/YYYY" : "DD/MM/YYYY",
                      ),
                      lines: [
                        [`${M.label} mới`, fmtNum(d.gain)],
                        [`Page có ${unit}`, d.pages.length],
                        ["Reel đăng", d.posted],
                        ...d.pages
                          .slice(0, 5)
                          .map((p) => [`· ${p.name}`, fmtNum(p.gain)]),
                        ...(d.pages.length > 5
                          ? [[`… và ${d.pages.length - 5} page khác`, ""]]
                          : []),
                      ],
                    })}
                  />
                }
              />
              <Area
                isAnimationActive={false}
                type="monotone"
                dataKey="gain"
                stroke={C.series}
                strokeWidth={2}
                fill={C.seriesFill}
                activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }}
              />
            </AreaChart>
          </ChartCard>
        </Col>
        <Col xs={24} xl={10}>
          <ChartCard
            title={hourly ? "Số reel đăng theo giờ" : "Số reel đăng mỗi ngày"}
            empty={!reels.length}
          >
            <BarChart
              data={timeline}
              margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
            >
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis
                dataKey="t"
                {...xAxis}
                tickFormatter={(t) => dayjs(t).format(bucketFormat)}
                minTickGap={24}
              />
              <YAxis {...yAxis} allowDecimals={false} width={36} />
              <Tooltip
                cursor={{ fill: "rgba(11,11,11,0.04)" }}
                content={
                  <TooltipBox
                    render={(d) => ({
                      title: dayjs(d.t).format(
                        hourly ? "HH:00 DD/MM/YYYY" : "DD/MM/YYYY",
                      ),
                      lines: [["Reel đăng", d.posted]],
                    })}
                  />
                }
              />
              <Bar
                isAnimationActive={false}
                dataKey="posted"
                fill={C.series}
                radius={[4, 4, 0, 0]}
                maxBarSize={28}
              />
            </BarChart>
          </ChartCard>
        </Col>

        <Col xs={24} xl={12}>
          <ChartCard
            title="So sánh nhóm (ngách)"
            extra={
              <Segmented
                size="small"
                value={groupMetric}
                onChange={setGroupMetric}
                options={Object.entries(GROUP_METRICS).map(([value, m]) => ({
                  value,
                  label: m.label(M),
                }))}
              />
            }
            height={Math.max(160, byGroup.length * 36 + 40)}
            empty={!byGroup.length}
          >
            <BarChart
              data={byGroup}
              layout="vertical"
              margin={{ top: 0, right: 56, left: 0, bottom: 0 }}
              barCategoryGap={6}
            >
              <CartesianGrid stroke={C.grid} horizontal={false} />
              <XAxis type="number" {...xAxis} tickFormatter={groupM.axis} />
              <YAxis
                type="category"
                dataKey="name"
                {...yAxis}
                width={110}
                tick={{ fontSize: 12, fill: "#52514e" }}
              />
              <Tooltip
                cursor={{ fill: "rgba(11,11,11,0.04)" }}
                content={
                  <TooltipBox
                    render={(g) => ({
                      title: g.name,
                      lines: [
                        [`Tổng ${unit}`, fmtNum(g.value)],
                        ["Số reel", g.count],
                        [`${M.label} TB / reel`, fmtNum(Math.round(g.avg))],
                        ...(metricKey === "views"
                          ? []
                          : [["Tổng views", fmtNum(g.views)]]),
                        ["Tỉ lệ tương tác", pct(g.eng)],
                      ],
                    })}
                  />
                }
              />
              <Bar
                isAnimationActive={false}
                dataKey="bar"
                fill={C.series}
                radius={[0, 4, 4, 0]}
                maxBarSize={22}
                label={{
                  position: "right",
                  fontSize: 11,
                  fill: "#52514e",
                  formatter: groupM.fmt,
                }}
              />
            </BarChart>
          </ChartCard>
        </Col>
        <Col xs={24} xl={12}>
          <ChartCard
            title={`${M.label} theo page (${topPages.length} page)`}
            subtitle={
              topFrom
                ? `${M.label} mới trong khoảng ${topFrom.format("HH:00 DD/MM")} – ${(topTo || dayjs()).format(topTo ? "HH:00 DD/MM" : "HH:mm DD/MM")}${topLoading ? " · đang tải…" : ""}`
                : `Tổng ${unit} của các reel đăng trong ${days} ngày qua`
            }
            extra={
              <Space size={8} wrap>
                {topRange === "custom" && (
                  <DatePicker.RangePicker
                    size="small"
                    showTime={{ format: "HH:00" }}
                    format="DD/MM HH:00"
                    allowClear={false}
                    value={customRange}
                    onChange={(v) => v && setCustomRange(v)}
                    disabledDate={(d) => d.isAfter(dayjs(), "day")}
                  />
                )}
                <Select
                  size="small"
                  style={{ width: 190 }}
                  value={topRange}
                  onChange={setTopRange}
                  options={Object.entries(TOP_RANGES).map(([value, r]) => ({
                    value,
                    label: r.label,
                  }))}
                />
              </Space>
            }
            height={Math.max(160, shownPages.length * 32 + 40)}
            maxHeight={TOP_PAGES_COLLAPSED * 32 + 40}
            empty={!topPages.length}
            footer={
              hiddenPages.length > 0 && (
                <div style={{ textAlign: "center", marginTop: 4 }}>
                  <Button size="small" type="link" onClick={() => setShowAllPages((v) => !v)}>
                    {showAllPages
                      ? `Thu gọn về top ${TOP_PAGES_COLLAPSED}`
                      : `Xem tất cả ${topPages.length} page (còn ${hiddenPages.length} page · ${compact(hiddenPages.reduce((s, p) => s + p.value, 0))} ${unit})`}
                  </Button>
                </div>
              )
            }
          >
            <BarChart
              data={shownPages}
              layout="vertical"
              margin={{ top: 0, right: 56, left: 0, bottom: 0 }}
              barCategoryGap={6}
            >
              <CartesianGrid stroke={C.grid} horizontal={false} />
              <XAxis type="number" {...xAxis} tickFormatter={compact} />
              <YAxis
                type="category"
                dataKey="id"
                {...yAxis}
                width={140}
                tick={<PageTick pages={topPages} onOpen={onOpenPage} />}
              />
              <Tooltip
                cursor={{ fill: "rgba(11,11,11,0.04)" }}
                content={
                  <TooltipBox
                    render={(p) => ({
                      title: p.name,
                      lines: p.count
                        ? [
                            [`Tổng ${unit}`, fmtNum(p.value)],
                            ["Số reel", p.count],
                            [
                              `${M.label} TB / reel`,
                              fmtNum(Math.round(p.value / p.count)),
                            ],
                          ]
                        : [[`${M.label} mới`, fmtNum(p.value)]],
                    })}
                  />
                }
              />
              <Bar
                isAnimationActive={false}
                dataKey="value"
                fill={C.series}
                radius={[0, 4, 4, 0]}
                maxBarSize={20}
                style={{ cursor: "pointer" }}
                onClick={(d) => onOpenPage?.((d.payload ?? d).id)}
                label={{
                  position: "right",
                  fontSize: 11,
                  fill: "#52514e",
                  formatter: compact,
                }}
              />
            </BarChart>
          </ChartCard>
        </Col>

        <Col xs={24}>
          <ChartCard
            title="Giờ đăng hiệu quả nhất"
            subtitle={
              <>
                {M.label} trung bình mỗi reel theo giờ đăng
                {byHour.usedMature ? " (chỉ tính reel đã đăng hơn 24 giờ)" : ""}
                .
                {byHour.best.length > 0 && (
                  <>
                    {" "}
                    Cột xanh là 3 giờ tốt nhất:{" "}
                    <b>
                      {byHour.best
                        .map((h) => `${String(h).padStart(2, "0")}h`)
                        .join(", ")}
                    </b>{" "}
                    — nên dùng làm khung giờ đăng.
                  </>
                )}
              </>
            }
            height={240}
            empty={!reels.length}
          >
            <BarChart
              data={byHour.rows}
              margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
              barCategoryGap={3}
            >
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis
                dataKey="hour"
                {...xAxis}
                tickFormatter={(h) => `${h}h`}
                interval={0}
              />
              <YAxis {...yAxis} tickFormatter={compact} width={44} />
              <Tooltip
                cursor={{ fill: "rgba(11,11,11,0.04)" }}
                content={
                  <TooltipBox
                    render={(h) => ({
                      title: `${String(h.hour).padStart(2, "0")}:00 – ${String(h.hour).padStart(2, "0")}:59`,
                      lines: [
                        [`${M.label} TB / reel`, fmtNum(Math.round(h.avg))],
                        ["Số reel", h.count],
                      ],
                    })}
                  />
                }
              />
              <Bar
                isAnimationActive={false}
                dataKey="avg"
                radius={[4, 4, 0, 0]}
              >
                {byHour.rows.map((h) => (
                  <Cell
                    key={h.hour}
                    fill={h.best || !byHour.best.length ? C.series : C.muted}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartCard>
        </Col>
      </Row>
    </Space>
  );
}
