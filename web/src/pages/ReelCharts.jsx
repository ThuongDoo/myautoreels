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
  Table,
  Typography,
} from "antd";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
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
    label: (m, per = "reel") => `${m.label} TB / ${per}`,
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

// Every chart card picks its own window from TOP_RANGES. 'period' follows the page-wide
// "N ngày" filter. `qs` is the API query for that window (from/to + group/page filters).
function useRange(query, days, initial = "period") {
  const [key, setKey] = useState(initial);
  const [custom, setCustom] = useState(() => [
    dayjs().startOf("day").subtract(1, "day"),
    dayjs().startOf("hour"),
  ]);
  let from;
  let to = null;
  if (key === "period") from = dayjs().startOf("hour").subtract(days * 24, "hour");
  else if (key === "custom") [from, to] = [custom[0].startOf("hour"), custom[1].startOf("hour").add(1, "hour")];
  else [from, to = null] = TOP_RANGES[key].range();
  const end = to || dayjs();

  const q = new URLSearchParams(query);
  q.delete("days");
  q.set("from", from.valueOf());
  if (to) q.set("to", to.valueOf());

  const label =
    key === "period" ? `${days} ngày qua`
      : key === "custom" ? `${from.format("HH:00 DD/MM")} – ${end.format("HH:00 DD/MM")}`
        : TOP_RANGES[key].label.toLowerCase();

  const picker = (
    <Space size={8} wrap>
      {key === "custom" && (
        <DatePicker.RangePicker
          size="small"
          showTime={{ format: "HH:00" }}
          format="DD/MM HH:00"
          allowClear={false}
          value={custom}
          onChange={(v) => v && setCustom(v)}
          disabledDate={(d) => d.isAfter(dayjs(), "day")}
        />
      )}
      <Select
        size="small"
        style={{ width: 170 }}
        value={key}
        onChange={setKey}
        options={Object.entries(TOP_RANGES).map(([value, r]) => ({
          value,
          label: value === "period" ? `Theo bộ lọc (${days} ngày)` : r.label,
        }))}
      />
    </Space>
  );

  return {
    key,
    isPeriod: key === "period",
    from,
    to,
    end,
    hours: end.diff(from, "hour", true),
    qs: q.toString(),
    label,
    picker,
  };
}

// Reels published inside a range: the page's own list for 'period', else fetched.
function useRangeReels(range, reels) {
  const { data = [], loading } = useApi(range.isPeriod ? null : `/reels?${range.qs}`);
  return { reels: range.isPeriod ? reels : data, loading: !range.isPeriod && loading };
}

// Empty buckets from..end so gaps show as zero; hourly up to 3 days, daily beyond.
function makeBuckets(range) {
  const unit = range.hours <= 72 ? "hour" : "day";
  const out = [];
  for (let t = range.from.startOf(unit); t.isBefore(range.end); t = t.add(1, unit)) out.push(t.valueOf());
  return { unit, keys: out, keyOf: (ts) => dayjs(ts).startOf(unit).valueOf() };
}

// Page growth: gain in the last window vs the window right before it, drawn as one line
// per page across both windows. `step` = hours per point, so every window has ~12-60 points.
const GROWTH_WINDOWS = {
  "6h": { label: "6 giờ", hours: 6, step: 1 },
  "24h": { label: "24 giờ", hours: 24, step: 2 },
  "3d": { label: "3 ngày", hours: 72, step: 6 },
  "7d": { label: "7 ngày", hours: 168, step: 12 },
  "30d": { label: "30 ngày", hours: 720, step: 24 },
};
// A change smaller than this (absolute) counts as flat, so 3 → 6 views isn't "+100%".
const GROWTH_MIN_DELTA = 10;
const GROWTH_CLASSES = [
  { key: "up2", label: "Tăng mạnh", tip: "≥ +50%", color: "#1a7f45" },
  { key: "up", label: "Tăng", tip: "+15% → +50%", color: "#5cb87a" },
  { key: "new", label: "Mới có view", tip: "Kỳ trước 0, kỳ này có", color: "#2a78d6" },
  { key: "flat", label: "Đi ngang", tip: `±15% hoặc chênh < ${GROWTH_MIN_DELTA}`, color: "#b9b7ad" },
  { key: "down", label: "Giảm", tip: "−15% → −50%", color: "#e8908a" },
  { key: "down2", label: "Giảm mạnh", tip: "≤ −50%", color: "#c8372d" },
  { key: "none", label: "Không có view", tip: "Cả 2 kỳ đều 0", color: "#e1e0d9" },
];
const GROWTH_BY_KEY = Object.fromEntries(GROWTH_CLASSES.map((c) => [c.key, c]));
// Line colors: the categorical palette in fixed order. A page keeps its slot while plotted.
const LINE_COLORS = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#6250d6"];
const MAX_LINES = LINE_COLORS.length;

function growthClass(prev, cur) {
  if (!prev && !cur) return "none";
  if (!prev) return cur >= GROWTH_MIN_DELTA ? "new" : "flat";
  const change = (cur - prev) / prev;
  if (Math.abs(cur - prev) < GROWTH_MIN_DELTA || Math.abs(change) < 0.15) return "flat";
  if (change >= 0.5) return "up2";
  if (change > 0) return "up";
  if (change <= -0.5) return "down2";
  return "down";
}

const fmtChange = (p) =>
  p.prev ? `${p.cur >= p.prev ? "+" : ""}${Math.round(((p.cur - p.prev) / p.prev) * 100)}%` : p.cur ? "mới" : "–";

function PageGrowth({ query, M, unit, onOpenPage }) {
  const [win, setWin] = useState("24h");
  const [picked, setPicked] = useState(null);
  // Plotted pages by color slot (null = free slot); null overall = automatic pick.
  const [slots, setSlots] = useState(null);
  const filters = new URLSearchParams(query);

  // The chart always spans the last N hours up to now. Numbers only exist up to the last
  // stats refresh, so lines stop there (`dataUntil`) instead of dropping to "no views".
  const { data: overview } = useApi("/overview");
  const lastRun = overview?.statsLastRun;
  const { hours, step, label: winLabel } = GROWTH_WINDOWS[win];
  const nowHour = dayjs().startOf("hour");
  const now = dayjs().startOf("minute");
  const chartStart = nowHour.subtract(hours, "hour");
  const dataUntil = lastRun ? dayjs(Math.min(lastRun, now.valueOf())) : now;
  const stale = now.diff(dataUntil, "minute") >= 180;
  // Ranking compares two equal windows ending at the last refresh, so a refresh that is
  // simply not due yet doesn't make every page look like it dropped.
  const cmpEnd = dataUntil.startOf("hour").add(1, "hour");
  const mid = cmpEnd.subtract(hours, "hour");
  const cmpStart = mid.subtract(hours, "hour");
  const fetchFrom = cmpStart.isBefore(chartStart) ? cmpStart : chartStart;

  const q = new URLSearchParams(query);
  q.delete("days");
  q.set("from", fetchFrom.valueOf());
  const { data: gains = [], loading } = useApi(`/analytics/view-gains?${q}`);
  // Each page's total before fetchFrom: the starting point its line climbs from.
  const qBase = new URLSearchParams(q);
  qBase.set("from", 0);
  qBase.set("to", fetchFrom.valueOf());
  qBase.set("by", "page");
  const { data: baseline = [] } = useApi(`/analytics/view-gains?${qBase}`);
  const { data: pages = [] } = useApi("/pages");

  // series[i][pageId] = the page's total at t (views gained in hours before t); null after dataUntil.
  const { rows, series } = useMemo(() => {
    const group = filters.get("group");
    const pageId = filters.get("pageId");
    const map = new Map();
    for (const p of pages) {
      if (!p.enabled || (pageId && p.id !== pageId)) continue;
      if (group && (p.group_name || "__none__") !== group) continue;
      map.set(p.id, { id: p.id, name: p.name, base: 0, prev: 0, cur: 0, later: 0 });
    }
    for (const b of baseline) {
      const p = map.get(b.page_id);
      if (p) p.base = M.gain(b);
    }
    const rowsIn = gains
      .filter((g) => map.has(g.page_id) && M.gain(g))
      .sort((a, b) => a.hour - b.hour);
    for (const g of rowsIn) {
      const p = map.get(g.page_id);
      const value = M.gain(g);
      if (g.hour >= cmpStart.valueOf() && g.hour < mid.valueOf()) p.prev += value;
      else if (g.hour >= mid.valueOf() && g.hour < cmpEnd.valueOf()) p.cur += value;
      p.later += value;
    }

    // Points every `step` hours from chartStart, plus the last-refresh moment and "now".
    const ts = new Set([now.valueOf()]);
    for (let t = chartStart; t.isBefore(now); t = t.add(step, "hour")) ts.add(t.valueOf());
    const lastPoint = cmpEnd.valueOf();
    if (lastPoint > chartStart.valueOf() && lastPoint < now.valueOf()) ts.add(lastPoint);
    const running = new Map([...map.values()].map((p) => [p.id, p.base]));
    let i = 0;
    const points = [...ts].sort((a, b) => a - b).map((t) => {
      const added = {};
      for (; i < rowsIn.length && rowsIn[i].hour < t; i++) {
        const g = rowsIn[i];
        running.set(g.page_id, running.get(g.page_id) + M.gain(g));
        added[g.page_id] = (added[g.page_id] || 0) + M.gain(g);
      }
      // Hours past the last refresh have no numbers yet: leave a gap, not a flat line.
      const known = t <= lastPoint;
      return { t, added, ...Object.fromEntries([...running].map(([id, v]) => [id, known ? v : null])) };
    });
    return {
      rows: [...map.values()]
        .map((p) => ({ ...p, total: p.base + p.later, delta: p.cur - p.prev, cls: growthClass(p.prev, p.cur) }))
        .sort((a, b) => b.delta - a.delta || b.cur - a.cur),
      series: points.filter((p, idx) => idx === 0 || p.t > chartStart.valueOf()),
    };
  }, [gains, baseline, pages, query, M, chartStart.valueOf(), cmpEnd.valueOf(), now.valueOf()]); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = Object.fromEntries(GROWTH_CLASSES.map((c) => [c.key, 0]));
  for (const r of rows) counts[r.cls]++;
  const totalPrev = rows.reduce((s, r) => s + r.prev, 0);
  const totalCur = rows.reduce((s, r) => s + r.cur, 0);
  const list = rows.filter((r) => (picked ? r.cls === picked : r.cls !== "none"));
  const byId = new Map(rows.map((r) => [r.id, r]));

  // Automatic pick: the biggest risers and fallers of the current list.
  const half = MAX_LINES / 2;
  const autoIds = (list.length <= MAX_LINES ? list : [...list.slice(0, half), ...list.slice(-half)]).map((r) => r.id);
  const slotIds = slots ?? autoIds;
  const plotted = slotIds
    .map((id, i) => (id && byId.has(id) ? { ...byId.get(id), color: LINE_COLORS[i] } : null))
    .filter(Boolean);
  const colorOf = new Map(plotted.map((p) => [p.id, p.color]));
  const hasLineData = series.some((pt) => plotted.some((p) => pt[p.id] != null));
  // Axis labels on whole steps (05:00, 06:00…) plus "now", not wherever recharts lands.
  const tickEvery = Math.max(step, Math.ceil(hours / 8 / step) * step);
  const ticks = [];
  for (let t = chartStart; t.isBefore(now.subtract(tickEvery / 3, "hour")); t = t.add(tickEvery, "hour")) ticks.push(t.valueOf());
  ticks.push(now.valueOf());

  const toggle = (id) => {
    const cur = [...(slots ?? autoIds)];
    while (cur.length < MAX_LINES) cur.push(null);
    const at = cur.indexOf(id);
    if (at >= 0) cur[at] = null;
    else {
      const free = cur.indexOf(null);
      if (free < 0) return;
      cur[free] = id;
    }
    setSlots(cur);
  };
  const resetPick = () => setSlots(null);

  return (
    <Card
      size="small"
      title={`Tăng trưởng ${unit} theo page`}
      extra={
        <Segmented
          size="small"
          value={win}
          onChange={(v) => { setWin(v); setPicked(null); resetPick(); }}
          options={Object.entries(GROWTH_WINDOWS).map(([value, w]) => ({ value, label: w.label }))}
        />
      }
    >
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: -4 }}>
        Đường = tổng {unit} của page từ {chartStart.format("HH:00 DD/MM")} đến bây giờ ({now.format("HH:mm DD/MM")}). Xếp loại
        = {unit} tăng thêm {mid.format("HH:00 DD/MM")} – {cmpEnd.format("HH:00 DD/MM")} so với {winLabel} liền trước đó:{" "}
        <b>{fmtNum(totalPrev)}</b> → <b>{fmtNum(totalCur)}</b>
        {totalPrev > 0 && ` (${fmtChange({ prev: totalPrev, cur: totalCur })})`}
        {loading && " · đang tải…"}
      </Typography.Paragraph>
      {stale && (
        <Typography.Paragraph type="warning" style={{ fontSize: 12, marginTop: -6 }}>
          Số liệu cập nhật lần cuối lúc {dataUntil.format("HH:mm DD/MM")}: sau thời điểm đó chưa có số nên đường dừng lại, và
          xếp loại so sánh 2 kỳ tính đến lần cập nhật đó. Bấm "Cập nhật số liệu" để có số mới.
        </Typography.Paragraph>
      )}

      {/* Share of pages in each class; click a class to list only those pages. */}
      <div style={{ display: "flex", gap: 2, height: 10, marginBottom: 10 }}>
        {GROWTH_CLASSES.filter((c) => counts[c.key]).map((c) => (
          <div key={c.key} title={`${c.label}: ${counts[c.key]} page`} style={{ flex: counts[c.key], background: c.color, borderRadius: 3 }} />
        ))}
      </div>
      <Space wrap size={[6, 6]} style={{ marginBottom: 12 }}>
        {GROWTH_CLASSES.map((c) => {
          const active = picked === c.key;
          return (
            <Button
              key={c.key}
              size="small"
              type={active ? "primary" : "default"}
              ghost={active}
              disabled={!counts[c.key]}
              title={c.tip}
              onClick={() => { setPicked(active ? null : c.key); resetPick(); }}
            >
              <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: c.color, marginRight: 6 }} />
              {c.label} <b style={{ marginLeft: 4 }}>{counts[c.key]}</b>
            </Button>
          );
        })}
      </Space>

      {!list.length ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={picked ? "Không có page nào" : "Chưa có dữ liệu"} />
      ) : (
        <Row gutter={[16, 12]}>
          <Col xs={24} xl={14}>
            <Space wrap size={[12, 4]} style={{ marginBottom: 6, fontSize: 12 }}>
              {plotted.map((p) => (
                <a key={p.id} onClick={() => onOpenPage?.(p.id)} style={{ color: "#52514e" }} title="Mở chi tiết page">
                  <span style={{ display: "inline-block", width: 14, height: 3, borderRadius: 2, background: p.color, marginRight: 6, verticalAlign: "middle" }} />
                  {p.name} <span style={{ color: C.axis }}>({fmtChange(p)})</span>
                </a>
              ))}
              {slots && <Button size="small" type="link" onClick={resetPick}>Tự chọn lại</Button>}
            </Space>
            {!hasLineData && (
              <Typography.Text type="secondary" style={{ display: "block", textAlign: "center", fontSize: 12, marginBottom: -20, position: "relative", top: 120 }}>
                Chưa có số liệu trong {winLabel} qua (cập nhật lần cuối lúc {dataUntil.format("HH:mm DD/MM")}).
              </Typography.Text>
            )}
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={series} margin={{ top: 8, right: 36, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                {cmpEnd.isBefore(now) && (
                  <ReferenceArea x1={Math.max(cmpEnd.valueOf(), chartStart.valueOf())} x2={now.valueOf()} fill="#0b0b0b" fillOpacity={0.035} />
                )}
                {cmpEnd.isAfter(chartStart) && cmpEnd.isBefore(now) && (
                  <ReferenceLine
                    x={cmpEnd.valueOf()}
                    stroke={C.baseline}
                    strokeDasharray="4 3"
                    label={{ value: "Chưa có số liệu →", position: "insideTopLeft", fontSize: 11, fill: C.axis }}
                  />
                )}
                <XAxis
                  dataKey="t"
                  type="number"
                  domain={[chartStart.valueOf(), now.valueOf()]}
                  ticks={ticks}
                  {...xAxis}
                  tickFormatter={(t) => dayjs(t).format(hours <= 24 ? "HH:mm" : step >= 24 ? "DD/MM" : "HH:00 DD/MM")}
                  minTickGap={24}
                />
                {/* Not pinned to 0: totals sit far above it and the climb would flatten out. */}
                <YAxis {...yAxis} tickFormatter={compact} width={48} domain={[(min) => Math.max(0, Math.floor(min * 0.9)), "auto"]} />
                <Tooltip
                  cursor={{ stroke: C.axis, strokeDasharray: "3 3" }}
                  content={
                    <TooltipBox
                      render={(d) => ({
                        title: `Tổng ${unit} lúc ${dayjs(d.t).format("HH:mm DD/MM")}${d.t > cmpEnd.valueOf() ? " (chưa có số liệu)" : ""}`,
                        lines: plotted
                          .map((p) => [p.name, d[p.id], d.added?.[p.id] || 0])
                          .sort((a, b) => (b[1] ?? -1) - (a[1] ?? -1))
                          .map(([n, v, add]) => [n, v == null ? "–" : `${fmtNum(v)}${add ? ` (+${fmtNum(add)})` : ""}`]),
                      })}
                    />
                  }
                />
                {plotted.map((p) => (
                  <Line
                    key={p.id}
                    isAnimationActive={false}
                    type="monotoneX"
                    dataKey={(d) => d[p.id] ?? null}
                    name={p.name}
                    stroke={p.color}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </Col>
          <Col xs={24} xl={10}>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Tick để chọn page vẽ lên biểu đồ (tối đa {MAX_LINES}).
            </Typography.Text>
            <Table
              rowKey="id"
              size="small"
              dataSource={list}
              pagination={false}
              scroll={{ y: 300 }}
              rowSelection={{
                selectedRowKeys: plotted.map((p) => p.id),
                hideSelectAll: true,
                columnWidth: 32,
                getCheckboxProps: (r) => ({ disabled: !colorOf.has(r.id) && plotted.length >= MAX_LINES }),
                onSelect: (r) => toggle(r.id),
              }}
              columns={[
                {
                  title: "Page",
                  dataIndex: "name",
                  ellipsis: true,
                  render: (n, r) => (
                    <a onClick={() => onOpenPage?.(r.id)} style={{ color: "inherit" }}>
                      <span
                        style={{
                          display: "inline-block",
                          width: 8,
                          height: 8,
                          borderRadius: 2,
                          marginRight: 6,
                          background: colorOf.get(r.id) || "transparent",
                          border: colorOf.has(r.id) ? 0 : `1px solid ${C.grid}`,
                        }}
                      />
                      {n}
                    </a>
                  ),
                },
                { title: "Tổng", dataIndex: "total", width: 72, align: "right", render: compact, sorter: (a, b) => a.total - b.total },
                { title: <span title="Tăng thêm trong kỳ trước">+Trước</span>, dataIndex: "prev", width: 88, align: "right", render: compact, sorter: (a, b) => a.prev - b.prev },
                { title: <span title="Tăng thêm trong kỳ này">+Này</span>, dataIndex: "cur", width: 76, align: "right", render: compact, sorter: (a, b) => a.cur - b.cur },
                {
                  title: "Thay đổi",
                  dataIndex: "delta",
                  width: 92,
                  align: "right",
                  sorter: (a, b) => a.delta - b.delta,
                  render: (_, r) => (
                    <span title={GROWTH_BY_KEY[r.cls].label}>
                      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: GROWTH_BY_KEY[r.cls].color, marginRight: 4 }} />
                      {fmtChange(r)}
                    </span>
                  ),
                },
              ]}
            />
          </Col>
        </Row>
      )}
    </Card>
  );
}

export default function ReelCharts({ reels, days, query, onOpenPage }) {
  const [metricKey, setMetricKey] = useState("views");
  const M = METRICS[metricKey];
  const unit = M.label.toLowerCase();
  const [groupMetric, setGroupMetric] = useState("total");

  // One time window per card.
  const gainRange = useRange(query, days);
  const postedRange = useRange(query, days);
  const groupRange = useRange(query, days);
  const hourRange = useRange(query, days);
  const { data: gains = [], loading: gainsLoading } = useApi(`/analytics/view-gains?${gainRange.qs}`);
  const { data: groupGains = [] } = useApi(groupRange.isPeriod ? null : `/analytics/view-gains?${groupRange.qs}`);
  const posted = useRangeReels(postedRange, reels);
  const hourReels = useRangeReels(hourRange, reels);
  const fmtBucket = (unit, full) => (unit === "hour" ? (full ? "HH:00 DD/MM/YYYY" : "DD/MM HH:00") : full ? "DD/MM/YYYY" : "DD/MM");

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

  const gainBuckets = makeBuckets(gainRange);
  const timeline = useMemo(() => {
    const buckets = new Map(gainBuckets.keys.map((t) => [t, { t, gain: 0, pages: new Map() }]));
    for (const g of gains) {
      const b = buckets.get(gainBuckets.keyOf(g.hour));
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
    return [...buckets.values()].map((b) => ({
      ...b,
      pages: [...b.pages.values()].sort((x, y) => y.gain - x.gain),
    }));
  }, [gains, gainBuckets.keys.join(), metricKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const postedBuckets = makeBuckets(postedRange);
  const postedTimeline = useMemo(() => {
    const buckets = new Map(postedBuckets.keys.map((t) => [t, { t, posted: 0 }]));
    for (const r of posted.reels) {
      const b = buckets.get(postedBuckets.keyOf(r.published_at));
      if (b) b.posted++;
    }
    return [...buckets.values()];
  }, [posted.reels, postedBuckets.keys.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  // `value` = the chosen metric's total; `bar` = whatever the group toggle shows.
  // 'period' compares the lifetime numbers of reels posted in the filter; any other window
  // compares what each group gained inside it (so "per reel" becomes "per page").
  const byGroup = useMemo(() => {
    const map = new Map();
    const gm = GROUP_METRICS[groupMetric];
    if (!groupRange.isPeriod) {
      for (const g of groupGains) {
        const name = g.group_name || NO_GROUP_LABEL;
        const row = map.get(name) || { name, views: 0, value: 0, interactions: 0, pages: new Set() };
        row.views += g.gain;
        row.value += M.gain(g);
        row.interactions += g.likes + g.comments + g.shares;
        if (M.gain(g)) row.pages.add(g.page_id);
        map.set(name, row);
      }
      return [...map.values()]
        .map((g) => ({ ...g, count: g.pages.size, avg: g.pages.size ? g.value / g.pages.size : 0, eng: g.views ? g.interactions / g.views : 0 }))
        .filter((g) => g.value > 0)
        .sort((a, b) => gm.get(b) - gm.get(a))
        .map((g) => ({ ...g, bar: gm.get(g) }));
    }
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
    return rows
      .sort((a, b) => gm.get(b) - gm.get(a))
      .map((g) => ({ ...g, bar: gm.get(g) }));
  }, [reels, groupGains, groupRange.isPeriod, groupMetric, metricKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const perGroupUnit = groupRange.isPeriod ? "reel" : "page";

  // 'period' = lifetime totals of reels posted in the filter; other windows = gains inside them.
  const topRange = useRange(query, days);
  const topFrom = topRange.isPeriod ? null : topRange.from;
  const { data: topGains = [], loading: topLoading } = useApi(
    topFrom ? `/analytics/view-gains?${topRange.qs}` : null,
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
    const all = hourReels.reels;
    const mature = all.filter(
      (r) => Date.now() - r.published_at >= MATURE_MS,
    );
    const source = mature.length >= 10 ? mature : all;
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
      usedMature: source === mature && mature.length < all.length,
      best: [...best].sort((a, b) => a - b),
      count: all.length,
    };
  }, [hourReels.reels, metricKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
            title={`${M.label} mới theo ${gainBuckets.unit === "hour" ? "giờ" : "ngày"}`}
            subtitle={`Lượng ${unit} tăng thêm của các reel trong ${gainRange.label}: ${fmtNum(timeline.reduce((s, d) => s + d.gain, 0))}${gainsLoading ? " · đang tải…" : ""}`}
            extra={gainRange.picker}
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
                tickFormatter={(t) => dayjs(t).format(fmtBucket(gainBuckets.unit))}
                minTickGap={24}
              />
              <YAxis {...yAxis} tickFormatter={compact} width={44} />
              <Tooltip
                cursor={{ stroke: C.axis, strokeDasharray: "3 3" }}
                content={
                  <TooltipBox
                    render={(d) => ({
                      title: dayjs(d.t).format(fmtBucket(gainBuckets.unit, true)),
                      lines: [
                        [`${M.label} mới`, fmtNum(d.gain)],
                        [`Page có ${unit}`, d.pages.length],
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
            title={postedBuckets.unit === "hour" ? "Số reel đăng theo giờ" : "Số reel đăng mỗi ngày"}
            subtitle={`${fmtNum(posted.reels.length)} reel đăng trong ${postedRange.label}${posted.loading ? " · đang tải…" : ""}`}
            extra={postedRange.picker}
            empty={!posted.reels.length}
          >
            <BarChart
              data={postedTimeline}
              margin={{ top: 8, right: 24, left: 0, bottom: 0 }}
            >
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis
                dataKey="t"
                {...xAxis}
                tickFormatter={(t) => dayjs(t).format(fmtBucket(postedBuckets.unit))}
                minTickGap={24}
              />
              <YAxis {...yAxis} allowDecimals={false} width={36} />
              <Tooltip
                cursor={{ fill: "rgba(11,11,11,0.04)" }}
                content={
                  <TooltipBox
                    render={(d) => ({
                      title: dayjs(d.t).format(fmtBucket(postedBuckets.unit, true)),
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

        <Col xs={24}>
          <PageGrowth query={query} M={M} unit={unit} onOpenPage={onOpenPage} />
        </Col>

        <Col xs={24} xl={12}>
          <ChartCard
            title="So sánh nhóm (ngách)"
            subtitle={
              <Space wrap size={8}>
                <Segmented
                  size="small"
                  value={groupMetric}
                  onChange={setGroupMetric}
                  options={Object.entries(GROUP_METRICS).map(([value, m]) => ({
                    value,
                    label: m.label(M, perGroupUnit),
                  }))}
                />
                <span>
                  {groupRange.isPeriod
                    ? `Reel đăng trong ${groupRange.label}`
                    : `${M.label} mới trong ${groupRange.label}`}
                </span>
              </Space>
            }
            extra={groupRange.picker}
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
                        [groupRange.isPeriod ? `Tổng ${unit}` : `${M.label} mới`, fmtNum(g.value)],
                        [groupRange.isPeriod ? "Số reel" : `Số page có ${unit}`, g.count],
                        [`${M.label} TB / ${perGroupUnit}`, fmtNum(Math.round(g.avg))],
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
                ? `${M.label} mới trong ${topRange.label}${topLoading ? " · đang tải…" : ""}`
                : `Tổng ${unit} của các reel đăng trong ${topRange.label}`
            }
            extra={topRange.picker}
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
                {M.label} trung bình mỗi reel theo giờ đăng, {fmtNum(byHour.count)} reel đăng trong {hourRange.label}
                {byHour.usedMature ? " (chỉ tính reel đã đăng hơn 24 giờ)" : ""}
                {hourReels.loading ? " · đang tải…" : ""}.
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
            extra={hourRange.picker}
            height={240}
            empty={!byHour.count}
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
