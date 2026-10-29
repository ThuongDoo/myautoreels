import { useMemo, useState } from "react";
import {
  App,
  Button,
  Card,
  Divider,
  Input,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import { FireOutlined, SettingOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { api, fmtNum, groupColor, useApi } from "../api.js";
import VideoDrawer from "./VideoDrawer.jsx";
import { GroupManagerModal, NewGroupInput } from "./GroupControls.jsx";

const NO_GROUP = "__none__";
const NO_GROUP_LABEL = "Chưa có nhóm";

const FILTERS = {
  all: { label: "Tất cả", test: () => true },
  posted: { label: "Đã đăng", test: (v) => v.posted > 0 },
  upcoming: { label: "Sắp đăng", test: (v) => v.upcoming > 0 },
  viral: { label: "Có reel viral", test: (v) => v.viral > 0 },
  failed: { label: "Có lỗi", test: (v) => v.failed > 0 },
};

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const avgPerPost = (r) => (r.posted ? r.views / r.posted : 0);

// Clicks on the checkbox or the inline group picker must not open the drawer.
const stop = (e) => e.stopPropagation();

export default function Videos() {
  const { message } = App.useApp();
  const { data = [], loading, reload } = useApi("/videos", {
    refreshMs: 60_000,
  });
  const { data: groupList = [], reload: reloadGroups } =
    useApi("/video-groups");
  const [filter, setFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [selected, setSelected] = useState([]);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [showGroups, setShowGroups] = useState(false);

  const setGroup = async (ids, group_name, successText) => {
    try {
      await api.post("/videos/group", { ids, group_name });
      if (successText) message.success(successText);
      reload({ silent: true });
      reloadGroups({ silent: true });
      return true;
    } catch (e) {
      message.error(e.message);
      return false;
    }
  };

  const moveToGroup = async (name) => {
    setGroupPickerOpen(false);
    if (
      await setGroup(
        selected,
        name,
        `Đã chuyển ${selected.length} video vào nhóm "${name}"`,
      )
    ) {
      setSelected([]);
    }
  };

  // One row per group (plus "no group"), summed from the video rows.
  const groupStats = useMemo(() => {
    const map = new Map(
      groupList.map((g) => [
        g.name,
        { key: g.name, name: g.name, videos: 0, posted: 0, views: 0, interactions: 0, best: 0, viral: 0, upcoming: 0 },
      ]),
    );
    for (const v of data) {
      const key = v.group_name || NO_GROUP;
      if (!map.has(key)) {
        map.set(key, { key, name: v.group_name || NO_GROUP_LABEL, videos: 0, posted: 0, views: 0, interactions: 0, best: 0, viral: 0, upcoming: 0 });
      }
      const g = map.get(key);
      g.videos++;
      g.posted += v.posted;
      g.upcoming += v.upcoming;
      g.views += v.views;
      g.interactions += v.interactions;
      g.best = Math.max(g.best, v.best_views);
      g.viral += v.viral;
    }
    return [...map.values()]
      .map((g) => ({ ...g, eng: g.views ? g.interactions / g.views : 0 }))
      .sort((a, b) => b.views - a.views);
  }, [data, groupList]);

  const ungroupedCount = data.filter((v) => !v.group_name).length;
  const groupOptions = groupList.map((g) => ({
    value: g.name,
    label: (
      <Space>
        <Tag color={groupColor(g.name)} style={{ margin: 0 }}>
          {g.name}
        </Tag>
        <Typography.Text type="secondary">{g.total} video</Typography.Text>
      </Space>
    ),
  }));

  const needle = q.toLowerCase();
  const rows = data.filter(
    (v) =>
      FILTERS[filter].test(v) &&
      (!groupFilter || (v.group_name || NO_GROUP) === groupFilter) &&
      (!needle || (v.name || "").toLowerCase().includes(needle)),
  );

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card
        size="small"
        title="Thống kê theo nhóm video"
        extra={
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => setShowGroups(true)}
          >
            Tạo / quản lý nhóm
          </Button>
        }
      >
        <Table
          rowKey="key"
          size="small"
          dataSource={groupStats}
          pagination={false}
          scroll={{ x: 850 }}
          locale={{
            emptyText:
              'Chưa có nhóm nào. Bấm "Tạo / quản lý nhóm", rồi tick chọn video bên dưới để chuyển vào nhóm.',
          }}
          onRow={(g) => ({
            onClick: () => setGroupFilter((cur) => (cur === g.key ? "" : g.key)),
            style: {
              cursor: "pointer",
              background: groupFilter === g.key ? "rgba(42,120,214,0.08)" : undefined,
            },
          })}
          columns={[
            {
              title: "Nhóm",
              dataIndex: "name",
              render: (n, g) =>
                g.key === NO_GROUP ? (
                  <Typography.Text type="secondary">{n}</Typography.Text>
                ) : (
                  <Tag color={groupColor(n)} style={{ margin: 0 }}>
                    {n}
                  </Tag>
                ),
            },
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
              render: (_, g) => (g.posted ? fmtNum(Math.round(avgPerPost(g))) : "-"),
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
        {groupStats.length > 0 && (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Bấm vào một nhóm để lọc danh sách video bên dưới.
          </Typography.Text>
        )}
      </Card>

      <Card title={`Kho video (${data.length})`}>
        <Typography.Paragraph type="secondary">
          Mỗi dòng là một video gốc trên Google Drive đã từng được lên lịch. Bấm
          vào để xem video đó đã đăng lên những page nào và kết quả từng reel.
        </Typography.Paragraph>
        <Space wrap size={[6, 8]} style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary">Nhóm:</Typography.Text>
          <Tag.CheckableTag
            checked={!groupFilter}
            onChange={() => setGroupFilter("")}
          >
            Tất cả ({data.length})
          </Tag.CheckableTag>
          {groupList.map((g) => (
            <Tag.CheckableTag
              key={g.name}
              checked={groupFilter === g.name}
              onChange={(on) => setGroupFilter(on ? g.name : "")}
            >
              {g.name} ({g.total})
            </Tag.CheckableTag>
          ))}
          {ungroupedCount > 0 && (
            <Tag.CheckableTag
              checked={groupFilter === NO_GROUP}
              onChange={(on) => setGroupFilter(on ? NO_GROUP : "")}
            >
              {NO_GROUP_LABEL} ({ungroupedCount})
            </Tag.CheckableTag>
          )}
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
        <Space wrap style={{ marginBottom: 16, display: "flex" }}>
          {selected.length > 0 ? (
            <>
              <Typography.Text strong>
                Đã chọn {selected.length} video:
              </Typography.Text>
              <Select
                placeholder="Chuyển vào nhóm..."
                style={{ width: 230 }}
                value={null}
                open={groupPickerOpen}
                onOpenChange={setGroupPickerOpen}
                options={groupOptions}
                onChange={moveToGroup}
                notFoundContent="Chưa có nhóm nào"
                popupRender={(menu) => (
                  <>
                    {menu}
                    <Divider style={{ margin: "8px 0" }} />
                    <div style={{ padding: "0 8px 4px" }}>
                      <NewGroupInput
                        apiBase="/video-groups"
                        placeholder="Tên nhóm mới, ví dụ: Hài, Mẹo vặt"
                        buttonText="Tạo & chuyển"
                        onCreated={(n) => {
                          reloadGroups({ silent: true });
                          moveToGroup(n);
                        }}
                      />
                    </div>
                  </>
                )}
              />
              <Button
                onClick={async () => {
                  if (
                    await setGroup(
                      selected,
                      null,
                      `Đã bỏ ${selected.length} video khỏi nhóm`,
                    )
                  )
                    setSelected([]);
                }}
              >
                Bỏ khỏi nhóm
              </Button>
              <Button type="link" onClick={() => setSelected([])}>
                Bỏ chọn
              </Button>
            </>
          ) : (
            <Typography.Text type="secondary">
              Tick chọn video để chuyển vào nhóm.
            </Typography.Text>
          )}
        </Space>
        <Table
          rowKey="id"
          size="middle"
          loading={loading}
          dataSource={rows}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          scroll={{ x: 1130 }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: setSelected,
            preserveSelectedRowKeys: true,
            onCell: () => ({ onClick: stop }),
          }}
          onRow={(v) => ({
            onClick: () => setOpen(v),
            style: { cursor: "pointer" },
          })}
          columns={[
            {
              title: "Video",
              dataIndex: "name",
              ellipsis: true,
              render: (n, v) => (
                <Space>
                  {v.viral > 0 && <FireOutlined style={{ color: "#f76b15" }} />}
                  <a>{n || v.id}</a>
                </Space>
              ),
            },
            {
              title: "Nhóm",
              dataIndex: "group_name",
              width: 180,
              sorter: (a, b) =>
                (a.group_name || "").localeCompare(b.group_name || ""),
              onCell: () => ({ onClick: stop }),
              render: (g, v) => (
                <Select
                  size="small"
                  variant="borderless"
                  style={{ width: "100%" }}
                  value={g || null}
                  placeholder="— Chưa có nhóm —"
                  allowClear
                  options={groupOptions}
                  labelRender={({ value }) => (
                    <Tag color={groupColor(value)} style={{ margin: 0 }}>
                      {value}
                    </Tag>
                  )}
                  onChange={(name) => setGroup([v.id], name || null)}
                />
              ),
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

      {showGroups && (
        <GroupManagerModal
          apiBase="/video-groups"
          title="Quản lý nhóm video"
          unit="video"
          placeholder="Tên nhóm mới, ví dụ: Hài, Mẹo vặt"
          help='Sau khi tạo nhóm: tick chọn video ở bảng "Kho video", rồi chọn nhóm ở ô "Chuyển vào nhóm". Mỗi video thuộc tối đa 1 nhóm.'
          groups={groupList}
          onClose={() => setShowGroups(false)}
          onChanged={() => {
            setGroupFilter("");
            reload({ silent: true });
            reloadGroups({ silent: true });
          }}
        />
      )}
    </Space>
  );
}
