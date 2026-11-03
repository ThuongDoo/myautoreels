import { useMemo, useState } from "react";
import {
  Card,
  Input,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import {
  FireOutlined, FolderOutlined, TableOutlined, UnorderedListOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import { fmtNum, useApi } from "../api.js";
import VideoDrawer from "./VideoDrawer.jsx";
import PageVideoMatrix from "./PageVideoMatrix.jsx";

// Scheduled videos the server couldn't find under the default Drive folder (moved, deleted,
// or scheduled from another folder).
const NO_FOLDER = "__none__";
const NO_FOLDER_LABEL = "Không rõ thư mục";

const FILTERS = {
  all: { label: "Tất cả", test: () => true },
  posted: { label: "Đã đăng", test: (v) => v.posted > 0 },
  upcoming: { label: "Sắp đăng", test: (v) => v.upcoming > 0 },
  unused: { label: "Chưa dùng", test: (v) => !v.posted && !v.upcoming },
  viral: { label: "Có reel viral", test: (v) => v.viral > 0 },
  failed: { label: "Có lỗi", test: (v) => v.failed > 0 },
};

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const avgPerPost = (r) => (r.posted ? r.views / r.posted : 0);
const folderKey = (v) => v.folder || NO_FOLDER;

function FolderName({ name }) {
  return name === NO_FOLDER_LABEL ? (
    <Typography.Text type="secondary">{name}</Typography.Text>
  ) : (
    <Space size={6}>
      <FolderOutlined style={{ color: "#f5a623" }} />
      {name}
    </Space>
  );
}

export default function Videos() {
  const { data = [], loading } = useApi("/videos", { refreshMs: 60_000 });
  const [filter, setFilter] = useState("all");
  const [folderFilter, setFolderFilter] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [view, setView] = useState("library");

  // One row per Drive folder the videos came from, summed from the video rows.
  const folderStats = useMemo(() => {
    const map = new Map();
    for (const v of data) {
      const key = folderKey(v);
      const f = map.get(key) || {
        key, name: v.folder || NO_FOLDER_LABEL, videos: 0, posted: 0, views: 0, interactions: 0, best: 0, viral: 0, upcoming: 0,
      };
      f.videos++;
      f.posted += v.posted;
      f.upcoming += v.upcoming;
      f.views += v.views;
      f.interactions += v.interactions;
      f.best = Math.max(f.best, v.best_views);
      f.viral += v.viral;
      map.set(key, f);
    }
    return [...map.values()]
      .map((f) => ({ ...f, eng: f.views ? f.interactions / f.views : 0 }))
      .sort((a, b) => b.views - a.views);
  }, [data]);

  const needle = q.toLowerCase();
  const rows = data.filter(
    (v) =>
      FILTERS[filter].test(v) &&
      (!folderFilter || folderKey(v) === folderFilter) &&
      (!needle || (v.name || "").toLowerCase().includes(needle)),
  );

  const tabs = (
    <Segmented
      value={view}
      onChange={setView}
      options={[
        { value: "library", label: "Kho video", icon: <UnorderedListOutlined /> },
        { value: "matrix", label: "Page × video", icon: <TableOutlined /> },
      ]}
    />
  );

  if (view === "matrix") {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {tabs}
        <PageVideoMatrix onOpenVideo={setOpen} />
        {open && <VideoDrawer video={open} onClose={() => setOpen(null)} />}
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {tabs}
      <Card size="small" title="Thống kê theo thư mục">
        <Table
          rowKey="key"
          size="small"
          dataSource={folderStats}
          pagination={false}
          scroll={{ x: 850 }}
          locale={{ emptyText: "Chưa có video nào" }}
          onRow={(f) => ({
            onClick: () => setFolderFilter((cur) => (cur === f.key ? "" : f.key)),
            style: {
              cursor: "pointer",
              background: folderFilter === f.key ? "rgba(42,120,214,0.08)" : undefined,
            },
          })}
          columns={[
            { title: "Thư mục", dataIndex: "name", render: (n) => <FolderName name={n} /> },
            { title: "Số video", dataIndex: "videos", width: 90, align: "right", sorter: (a, b) => a.videos - b.videos },
            { title: "Đã đăng", dataIndex: "posted", width: 95, align: "right", sorter: (a, b) => a.posted - b.posted, render: (n) => `${n} lần` },
            { title: "Sắp đăng", dataIndex: "upcoming", width: 95, align: "right", sorter: (a, b) => a.upcoming - b.upcoming, render: (n) => n || "-" },
            {
              title: "Tổng views",
              dataIndex: "views",
              width: 115,
              align: "right",
              sorter: (a, b) => a.views - b.views,
              render: (n) => <b>{fmtNum(n)}</b>,
            },
            {
              title: "Views TB / lần",
              width: 125,
              align: "right",
              sorter: (a, b) => avgPerPost(a) - avgPerPost(b),
              render: (_, f) => (f.posted ? fmtNum(Math.round(avgPerPost(f))) : "-"),
            },
            { title: "Reel tốt nhất", dataIndex: "best", width: 115, align: "right", sorter: (a, b) => a.best - b.best, render: fmtNum },
            {
              title: <Tooltip title="(like + comment + share) / views">Tương tác</Tooltip>,
              dataIndex: "eng",
              width: 100,
              align: "right",
              sorter: (a, b) => a.eng - b.eng,
              render: pct,
            },
            {
              title: "Viral",
              dataIndex: "viral",
              width: 70,
              align: "right",
              sorter: (a, b) => a.viral - b.viral,
              render: (n) => (n ? <Tag color="volcano" style={{ margin: 0 }}>{n}</Tag> : "-"),
            },
          ]}
        />
        {folderStats.length > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Thư mục tính theo thư mục video mặc định trong Cài đặt. Bấm vào một thư mục để lọc danh sách bên dưới.
          </Typography.Text>
        )}
      </Card>

      <Card title={`Kho video (${data.length})`}>
        <Typography.Paragraph type="secondary">
          Tất cả video trong thư mục video mặc định trên Google Drive (kể cả thư mục con), cùng các video từng
          lên lịch nhưng đã bị xóa/chuyển khỏi thư mục. Bấm vào để xem video đó đã đăng lên những page nào và kết quả từng reel.
        </Typography.Paragraph>
        <Space wrap size={[6, 8]} style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary">Thư mục:</Typography.Text>
          <Tag.CheckableTag checked={!folderFilter} onChange={() => setFolderFilter("")}>
            Tất cả ({data.length})
          </Tag.CheckableTag>
          {folderStats.map((f) => (
            <Tag.CheckableTag
              key={f.key}
              checked={folderFilter === f.key}
              onChange={(on) => setFolderFilter(on ? f.key : "")}
            >
              {f.name} ({f.videos})
            </Tag.CheckableTag>
          ))}
        </Space>
        <Space wrap style={{ marginBottom: 16 }}>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={Object.entries(FILTERS).map(([value, f]) => ({
              value,
              label: `${f.label} (${data.filter(f.test).length})`,
            }))}
          />
          <Input.Search
            placeholder="Tìm tên video..."
            allowClear
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 240 }}
          />
        </Space>
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={rows}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          scroll={{ x: 1130 }}
          onRow={(v) => ({
            onClick: () => setOpen(v),
            style: { cursor: "pointer" },
          })}
          columns={[
            {
              title: "Video",
              dataIndex: "name",
              ellipsis: true,
              // numeric: true so "video 2" sorts before "video 10".
              sorter: (a, b) =>
                (a.name || a.id).localeCompare(b.name || b.id, "vi", {
                  numeric: true,
                }),
              render: (n, v) => (
                <Space>
                  {v.viral > 0 && <FireOutlined style={{ color: "#f76b15" }} />}
                  <a>{n || v.id}</a>
                </Space>
              ),
            },
            {
              title: "Thư mục",
              dataIndex: "folder",
              width: 200,
              ellipsis: true,
              sorter: (a, b) => (a.folder || "").localeCompare(b.folder || "", "vi"),
              render: (f) => <FolderName name={f || NO_FOLDER_LABEL} />,
            },
            {
              title: "Đã đăng",
              dataIndex: "posted",
              width: 100,
              align: "right",
              sorter: (a, b) => a.posted - b.posted,
              render: (n, v) => (
                <Tooltip title={`Trên ${v.pages} page`}>{n} lần</Tooltip>
              ),
            },
            {
              title: "Sắp đăng",
              dataIndex: "upcoming",
              width: 105,
              align: "right",
              sorter: (a, b) => a.upcoming - b.upcoming,
              render: (n) => n || "-",
            },
            {
              title: "Tổng views",
              dataIndex: "views",
              width: 110,
              align: "right",
              sorter: (a, b) => a.views - b.views,
              defaultSortOrder: "descend",
              render: fmtNum,
            },
            {
              title: "Views TB / lần",
              width: 135,
              align: "right",
              sorter: (a, b) => avgPerPost(a) - avgPerPost(b),
              render: (_, v) =>
                v.posted ? fmtNum(Math.round(avgPerPost(v))) : "-",
            },
            {
              title: "Reel tốt nhất",
              dataIndex: "best_views",
              width: 130,
              align: "right",
              sorter: (a, b) => a.best_views - b.best_views,
              render: fmtNum,
            },
            {
              title: "Viral",
              dataIndex: "viral",
              width: 70,
              align: "right",
              sorter: (a, b) => a.viral - b.viral,
              render: (n) =>
                n ? (
                  <Tag color="volcano" style={{ margin: 0 }}>
                    {n}
                  </Tag>
                ) : (
                  "-"
                ),
            },
            {
              title: "Đăng gần nhất",
              dataIndex: "last_posted",
              width: 130,
              sorter: (a, b) => (a.last_posted || 0) - (b.last_posted || 0),
              render: (t) => (t ? dayjs(t).fromNow() : "-"),
            },
          ]}
        />
        {open && <VideoDrawer video={open} onClose={() => setOpen(null)} />}
      </Card>
    </Space>
  );
}
