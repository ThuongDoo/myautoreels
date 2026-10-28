import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, App, Breadcrumb, Button, Card, Checkbox, Col, Collapse, DatePicker, Form, Input, InputNumber, Radio, Row, Select, Space, Spin, Table,
  Tag, Tooltip, Typography,
} from 'antd';
import { FolderOutlined, RightOutlined, VideoCameraOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, fmtSize, fmtSec, groupColor, useApi } from '../api.js';
import { checkCaption, renderCaption } from '../caption.js';

const MAX_REELS_PER_DAY = 30;
const ROOT_KEY = 'autoreels.driveRoot';

const storage = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, h) => ({ value: `${String(h).padStart(2, '0')}:00` }));

// "7" | "7h" | "7:30" | "20h30" -> "07:00" / "07:30" / "20:30"
function parseSlot(s) {
  const m = String(s).trim().toLowerCase().match(/^(\d{1,2})(?:[:hg.](\d{0,2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] || 0);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}
const normalizeSlots = (list = []) => [...new Set(list.map(parseSlot).filter(Boolean))].sort();

// Posting times in the browser's timezone: daily slots from startDate, or evenly spaced from startAt.
function buildSlotTimes(v, count) {
  if (count <= 0) return [];
  if (v.timing === 'interval') {
    if (!v.startAt) return [];
    return Array.from({ length: count }, (_, i) => v.startAt.valueOf() + i * (v.intervalMinutes || 0) * 60_000);
  }
  const slots = normalizeSlots(v.slots);
  if (!slots.length) return [];
  const minAt = Date.now() + 2 * 60_000;
  const out = [];
  let day = (v.startDate || dayjs()).startOf('day');
  for (let guard = 0; out.length < count && guard < 3650; guard++, day = day.add(1, 'day')) {
    for (const s of slots) {
      const [h, m] = s.split(':').map(Number);
      const t = day.hour(h).minute(m).valueOf();
      if (t >= minAt && out.length < count) out.push(t);
    }
  }
  return out;
}

const SNIPPETS = [
  { label: 'Tên video', text: '{filename}', tip: 'Tên file video (bỏ đuôi .mp4)' },
  { label: 'Tên page', text: '{page}', tip: 'Tên page sẽ đăng' },
  { label: 'Câu mở đầu ngẫu nhiên', text: '{Xem đến cuối nhé|Hay quá trời|Đừng bỏ lỡ}', tip: 'Mỗi page nhận 1 câu ngẫu nhiên' },
  { label: 'Emoji ngẫu nhiên', text: '{😂|🤣|😍|🔥}' },
  { label: 'Hashtag mẫu', text: '\n\n#reels #{xuhuong|trending|viral}' },
];

const GUIDE_ROWS = [
  { syntax: '{filename}', meaning: 'Tên file video, bỏ phần đuôi', example: 'Clip-meo-hai.mp4 → Clip-meo-hai' },
  { syntax: '{page}', meaning: 'Tên page sẽ đăng', example: '→ Góc Giải Trí' },
  { syntax: '{A|B|C}', meaning: 'Chọn ngẫu nhiên 1 trong các lựa chọn, ngăn cách bằng |', example: '{Hay quá|Xem ngay} → Xem ngay' },
  { syntax: '{A|{B|C}}', meaning: 'Lồng nhau được', example: '{Wow|{Hay|Đỉnh} quá} → Đỉnh quá' },
  { syntax: '#hashtag', meaning: 'Gõ thẳng vào caption, nên để cuối, 3–5 cái', example: '#reels #{haihuoc|giaitri}' },
  { syntax: 'Enter', meaning: 'Xuống dòng giữ nguyên khi đăng', example: '' },
];

function CaptionHelper({ template, onInsert, sampleVideo, samplePages }) {
  const [seed, setSeed] = useState(0);
  const problems = checkCaption(template);
  const filename = (sampleVideo || 'Ten-video-mau.mp4').replace(/\.[^.]+$/, '');
  const pagesForPreview = samplePages.length ? samplePages : ['Page mẫu 1', 'Page mẫu 2', 'Page mẫu 3'];
  const samples = useMemo(
    () => (template ? pagesForPreview.slice(0, 3).map((page) => ({ page, text: renderCaption(template, { filename, page }) })) : []),
    [template, filename, pagesForPreview.join('|'), seed], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div style={{ marginBottom: 20 }}>
      <Space wrap size={[4, 4]} style={{ marginBottom: 8 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>Chèn nhanh:</Typography.Text>
        {SNIPPETS.map((s) => (
          <Tooltip key={s.label} title={s.tip || s.text}>
            <Button size="small" onClick={() => onInsert(s.text)}>{s.label}</Button>
          </Tooltip>
        ))}
      </Space>

      {problems.map((p) => <Alert key={p} type="error" showIcon message={p} style={{ marginBottom: 8 }} />)}

      <Collapse
        size="small"
        items={[
          {
            key: 'preview',
            label: 'Xem trước caption mỗi page sẽ nhận',
            extra: samples.length > 0 && (
              <Button size="small" type="link" onClick={(e) => { e.stopPropagation(); setSeed((x) => x + 1); }}>Đổi mẫu</Button>
            ),
            children: samples.length ? samples.map((s) => (
              <div key={s.page} style={{ marginBottom: 10 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>{s.page}</Typography.Text>
                <div style={{ whiteSpace: 'pre-wrap', background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 6, padding: '6px 10px' }}>
                  {s.text || <i>(trống)</i>}
                </div>
              </div>
            )) : <Typography.Text type="secondary">Nhập caption để xem trước.</Typography.Text>,
          },
          {
            key: 'guide',
            label: 'Hướng dẫn cách viết caption',
            children: (
              <>
                <Table
                  size="small"
                  pagination={false}
                  rowKey="syntax"
                  dataSource={GUIDE_ROWS}
                  columns={[
                    { title: 'Cú pháp', dataIndex: 'syntax', width: 110, render: (t) => <Typography.Text code>{t}</Typography.Text> },
                    { title: 'Ý nghĩa', dataIndex: 'meaning' },
                    { title: 'Ví dụ', dataIndex: 'example', render: (t) => <Typography.Text type="secondary">{t}</Typography.Text> },
                  ]}
                />
                <Typography.Paragraph style={{ marginTop: 12, marginBottom: 4 }} strong>Mẫu đầy đủ:</Typography.Paragraph>
                <pre style={{ background: '#fafafa', padding: 10, borderRadius: 6, whiteSpace: 'pre-wrap', margin: 0 }}>
                  {'{Xem đến cuối nhé|Hay quá trời|Đừng bỏ lỡ} {😂|🤣} {filename}\n\n#reels #{haihuoc|giaitri} #{xuhuong|trending}'}
                </pre>
                <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0, fontSize: 13 }}>
                  Mẹo: càng nhiều cụm {'{…|…}'} thì 100 page càng ít bị trùng caption. Tránh dùng {'{ }'} cho việc khác vì app sẽ hiểu là cú pháp.
                </Typography.Paragraph>
              </>
            ),
          },
        ]}
      />
    </div>
  );
}

const fmtMinutes =(m) => (m >= 60 ? `${Math.floor(m / 60)} giờ ${Math.round(m % 60)} phút` : `${Math.round(m)} phút`);

function DriveBrowser({ selectedKeys, onSelect, videoCache, folderNames, folders }) {
  const { message } = App.useApp();
  const [stack, setStack] = useState([]);
  const [data, setData] = useState({ folders: [], videos: [] });
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState(() => storage.get(ROOT_KEY) || '');

  const open = async (folderId, name, replaceStack) => {
    setLoading(true);
    try {
      const res = await api.get(`/drive/list${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`);
      res.videos.forEach((v) => { videoCache.current[v.id] = v; });
      res.folders.forEach((f) => { folderNames.current[f.id] = f.name; });
      setData(res);
      setStack((s) => (replaceStack ? [{ id: res.folderId, name }] : [...s, { id: res.folderId, name }]));
      return true;
    } catch (e) {
      message.error(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { open(storage.get(ROOT_KEY), 'Thư mục gốc', true); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const openLink = async () => {
    if (link && await open(link, 'Thư mục gốc', true)) storage.set(ROOT_KEY, link);
  };

  const goTo = async (index) => {
    const target = stack[index];
    setStack(stack.slice(0, index));
    await open(target.id, target.name);
  };

  const rows = [
    ...data.folders.map((f) => ({ ...f, isFolder: true })),
    ...data.videos,
  ];
  const folderList = Object.entries(folders);
  const looseCount = selectedKeys.filter((k) => !(k in folderNames.current)).length;

  return (
    <Card title="1. Chọn video từ Google Drive">
      <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
        <Input
          placeholder="Dán link thư mục Drive (chứa các thư mục con)"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onPressEnter={openLink}
        />
        <Button type="primary" onClick={openLink}>Mở</Button>
      </Space.Compact>
      <Breadcrumb
        style={{ marginBottom: 8 }}
        items={stack.map((f, i) => ({
          title: i < stack.length - 1 ? <a onClick={() => goTo(i)}>{f.name}</a> : f.name,
        }))}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        Tick thư mục = chọn toàn bộ video bên trong (kể cả thư mục con). Bấm vào tên thư mục để mở.
      </Typography.Text>
      <Table
        rowKey="id"
        size="small"
        loading={loading}
        dataSource={rows}
        style={{ marginTop: 8 }}
        pagination={{ pageSize: 100, hideOnSinglePage: true }}
        scroll={{ y: 380 }}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          preserveSelectedRowKeys: true,
          onChange: onSelect,
        }}
        onRow={(r) => (r.isFolder ? {
          onClick: (e) => {
            if (e.target.closest('.ant-table-selection-column')) return;
            open(r.id, r.name);
          },
          style: { cursor: 'pointer' },
        } : {})}
        columns={[
          {
            title: 'Tên',
            dataIndex: 'name',
            render: (name, r) => (
              <Space>
                {r.isFolder ? <FolderOutlined style={{ color: '#f5a623' }} /> : <VideoCameraOutlined />}
                {name}
                {r.isFolder && <RightOutlined style={{ fontSize: 10, color: '#999' }} />}
                {r.posted > 0 && <Tag color="green" style={{ margin: 0 }}>Đã đăng {r.posted}</Tag>}
                {r.upcoming > 0 && <Tag color="blue" style={{ margin: 0 }}>Sắp đăng {r.upcoming}</Tag>}
              </Space>
            ),
          },
          { title: 'Thời lượng', dataIndex: 'durationMs', width: 100, render: (v, r) => !r.isFolder && fmtSec(v) },
          { title: 'Dung lượng', dataIndex: 'size', width: 100, render: (v, r) => !r.isFolder && fmtSize(v) },
        ]}
      />

      {selectedKeys.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <Typography.Text strong>Đã chọn: </Typography.Text>
          <Space wrap size={[4, 8]}>
            {folderList.map(([id, f]) => (
              <Tag
                key={id}
                color={f.error ? 'error' : 'gold'}
                icon={<FolderOutlined />}
                closable
                onClose={(e) => { e.preventDefault(); onSelect(selectedKeys.filter((k) => k !== id)); }}
              >
                {f.name} {f.loading ? <Spin size="small" /> : f.error ? '(lỗi)' : `(${f.videos.length} video)`}
              </Tag>
            ))}
            {looseCount > 0 && (
              <Tag
                icon={<VideoCameraOutlined />}
                closable
                onClose={(e) => { e.preventDefault(); onSelect(selectedKeys.filter((k) => k in folderNames.current)); }}
              >
                {looseCount} video lẻ
              </Tag>
            )}
            <Button size="small" type="link" onClick={() => onSelect([])}>Bỏ chọn tất cả</Button>
          </Space>
        </div>
      )}
    </Card>
  );
}

export default function Schedule() {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const { data: pages = [] } = useApi('/pages');
  const videoCache = useRef({});
  const folderNames = useRef({});
  const [selectedKeys, setSelectedKeys] = useState([]);
  const [folders, setFolders] = useState({}); // id -> { name, videos, loading, error }
  const foldersRef = useRef({});
  const [submitting, setSubmitting] = useState(false);
  const values = Form.useWatch([], form) || {};

  const updateFolders = (fn) => {
    foldersRef.current = fn(foldersRef.current);
    setFolders(foldersRef.current);
  };

  // Ignores the result if the folder was deselected while loading.
  const patchFolder = (id, patch) => updateFolders((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], ...patch } } : prev));

  const loadFolder = async (id, name) => {
    try {
      const { videos } = await api.get(`/drive/folder-videos?folderId=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`);
      patchFolder(id, { videos, loading: false });
    } catch (e) {
      message.error(`Thư mục "${name}": ${e.message}`);
      patchFolder(id, { loading: false, error: e.message });
    }
  };

  const onSelect = (keys) => {
    setSelectedKeys(keys);
    const prev = foldersRef.current;
    const added = [];
    updateFolders(() => Object.fromEntries(keys
      .filter((k) => k in folderNames.current)
      .map((k) => {
        if (!prev[k]) added.push(k);
        return [k, prev[k] || { name: folderNames.current[k], videos: [], loading: true }];
      })));
    for (const k of added) loadFolder(k, folderNames.current[k]);
  };

  // Folder videos first, then individually picked ones; duplicates counted once.
  const videos = useMemo(() => {
    const map = new Map();
    for (const f of Object.values(folders)) for (const v of f.videos) map.set(v.id, v);
    for (const k of selectedKeys) if (videoCache.current[k]) map.set(k, videoCache.current[k]);
    return [...map.values()];
  }, [folders, selectedKeys]);
  const foldersLoading = Object.values(folders).some((f) => f.loading);

  const enabledPages = pages.filter((p) => p.enabled);
  const { groups, pageOptions } = useMemo(() => {
    const map = {};
    const ungrouped = [];
    for (const p of enabledPages) {
      if (p.group_name) (map[p.group_name] ||= []).push(p);
      else ungrouped.push(p);
    }
    const names = Object.keys(map).sort((a, b) => a.localeCompare(b));
    const toOptions = (list) => list.map((p) => ({ value: p.id, label: p.name }));
    return {
      groups: Object.fromEntries(names.map((g) => [g, map[g].map((p) => p.id)])),
      pageOptions: [
        ...names.map((g) => ({ label: `${g} (${map[g].length})`, title: g, options: toOptions(map[g]) })),
        ...(ungrouped.length ? [{ label: `Chưa có nhóm (${ungrouped.length})`, title: 'none', options: toOptions(ungrouped) }] : []),
      ],
    };
  }, [enabledPages]);

  const { data: settings } = useApi('/settings');
  useEffect(() => {
    if (settings?.time_slots && !form.isFieldTouched('slots')) {
      form.setFieldValue('slots', normalizeSlots(settings.time_slots.split(',')));
    }
  }, [settings, form]);

  const saveDefaultSlots = async () => {
    const slots = normalizeSlots(form.getFieldValue('slots'));
    if (!slots.length) return message.warning('Chưa có khung giờ nào');
    try {
      await api.put('/settings', { time_slots: slots.join(',') });
      message.success(`Đã lưu khung giờ mặc định: ${slots.join(', ')}`);
    } catch (e) {
      message.error(e.message);
    }
  };

  const pageIds = values.pageIds || [];
  const V = videos.length;
  const P = pageIds.length;
  const total = values.mode === 'split' ? V : V * P;
  const perPage = values.mode === 'split' ? Math.ceil(V / Math.max(P, 1)) : V;
  const slotTimes = buildSlotTimes(values, perPage);
  const postsPerSlot = values.mode === 'split' ? Math.min(P, V) : P;
  const avgGapSec = ((values.gapMinSec || 0) + (values.gapMaxSec || 0)) / 2;
  const spreadMin = (Math.max(postsPerSlot - 1, 0) * avgGapSec) / 60;
  const slotCount = normalizeSlots(values.slots).length;
  const perDay = values.timing === 'interval'
    ? Math.min(perPage, Math.floor(1440 / Math.max(values.intervalMinutes || 1, 1)))
    : Math.min(perPage, slotCount);
  // Shortest distance between two consecutive slots — the spread within one slot should fit inside it.
  const minSlotGapMin = slotTimes.length > 1
    ? Math.min(...slotTimes.slice(1).map((t, i) => (t - slotTimes[i]) / 60_000))
    : Infinity;

  // A group counts as selected when all of its pages are selected.
  const selectedGroups = Object.keys(groups).filter((g) => groups[g].every((id) => pageIds.includes(id)));
  const pickGroups = (names) => {
    const removed = selectedGroups.filter((g) => !names.includes(g)).flatMap((g) => groups[g]);
    const added = names.flatMap((g) => groups[g] || []);
    form.setFieldValue('pageIds', [...new Set([...pageIds.filter((id) => !removed.includes(id)), ...added])]);
  };

  const submit = async (v) => {
    if (foldersLoading) return message.warning('Đang tải danh sách video trong thư mục, chờ chút');
    if (!V) return message.warning('Chưa chọn video nào');
    if (slotTimes.length < perPage) return message.warning('Chưa có khung giờ / giờ bắt đầu');
    if (checkCaption(v.captionTemplate).length) return message.error('Caption đang có lỗi, xem ngay dưới ô Caption');
    setSubmitting(true);
    try {
      const r = await api.post('/jobs/bulk', {
        videos: videos.map(({ id, name }) => ({ id, name })),
        pageIds: v.pageIds,
        mode: v.mode,
        shuffle: v.shuffle,
        slotTimes,
        gapMinSec: v.gapMinSec,
        gapMaxSec: v.gapMaxSec,
        captionTemplate: v.captionTemplate,
      });
      message.success(
        <>
          Đã tạo {r.created} lịch đăng, từ {dayjs(r.firstAt).format('DD/MM HH:mm')} đến {dayjs(r.lastAt).format('DD/MM HH:mm')}.{' '}
          <a href="#queue">Xem hàng đợi →</a>
        </>,
        6,
      );
      onSelect([]);
    } catch (e) {
      message.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} xl={14}>
        <DriveBrowser
          selectedKeys={selectedKeys}
          onSelect={onSelect}
          videoCache={videoCache}
          folderNames={folderNames}
          folders={folders}
        />
      </Col>
      <Col xs={24} xl={10}>
        <Card title="2. Cài đặt lịch đăng">
          <Form
            form={form}
            layout="vertical"
            onFinish={submit}
            initialValues={{
              mode: 'all',
              shuffle: true,
              timing: 'slots',
              slots: ['07:00', '11:00', '20:00'],
              startDate: dayjs(),
              startAt: dayjs().add(30, 'minute').second(0),
              intervalMinutes: 60,
              gapMinSec: 30,
              gapMaxSec: 120,
              captionTemplate: '{filename}',
              pageIds: [],
            }}
          >
            <Form.Item
              label="Chọn theo nhóm (ngách)"
              extra={!Object.keys(groups).length && <>Chưa có nhóm nào — tạo ở trang <a href="#pages">Pages</a>.</>}
            >
              <Select
                mode="multiple"
                allowClear
                placeholder="Ví dụ: Vẽ, Yoga..."
                value={selectedGroups}
                onChange={pickGroups}
                options={Object.entries(groups).map(([g, ids]) => ({ value: g, label: `${g} (${ids.length} page)` }))}
                tagRender={({ label, value, closable, onClose }) => (
                  <Tag color={groupColor(value)} closable={closable} onClose={onClose} style={{ marginInlineEnd: 4 }}>{label}</Tag>
                )}
              />
            </Form.Item>
            <Form.Item
              label={`Pages (${P} đã chọn)`}
              name="pageIds"
              rules={[{ required: true, message: 'Chọn ít nhất 1 page' }]}
              extra={(
                <Space size={4}>
                  Có thể bỏ bớt hoặc thêm page lẻ.
                  <Button size="small" type="link" onClick={() => form.setFieldValue('pageIds', enabledPages.map((p) => p.id))}>
                    Chọn tất cả ({enabledPages.length})
                  </Button>
                  {P > 0 && <Button size="small" type="link" onClick={() => form.setFieldValue('pageIds', [])}>Bỏ chọn</Button>}
                </Space>
              )}
            >
              <Select
                mode="multiple"
                allowClear
                maxTagCount="responsive"
                placeholder="Chọn page"
                optionFilterProp="label"
                options={pageOptions}
              />
            </Form.Item>

            <Form.Item label="Cách phân bổ" name="mode">
              <Radio.Group>
                <Space direction="vertical">
                  <Radio value="all">Mỗi video đăng lên <b>tất cả</b> page đã chọn</Radio>
                  <Radio value="split">Chia đều: mỗi page nhận video <b>khác nhau</b></Radio>
                </Space>
              </Radio.Group>
            </Form.Item>
            <Form.Item name="shuffle" valuePropName="checked" style={{ marginTop: -8 }}>
              <Checkbox>Trộn ngẫu nhiên thứ tự video (mỗi page một thứ tự khác nhau)</Checkbox>
            </Form.Item>

            <Form.Item label="Thời gian đăng" name="timing">
              <Radio.Group optionType="button" buttonStyle="solid">
                <Radio value="slots">Theo khung giờ</Radio>
                <Radio value="interval">Cách đều</Radio>
              </Radio.Group>
            </Form.Item>

            {values.timing === 'interval' ? (
              <Row gutter={12}>
                <Col span={14}>
                  <Form.Item label="Bắt đầu lúc" name="startAt" rules={[{ required: true }]}>
                    <DatePicker showTime={{ format: 'HH:mm' }} format="DD/MM/YYYY HH:mm" style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col span={10}>
                  <Form.Item label="Mỗi page cách nhau" name="intervalMinutes" tooltip="Khoảng cách giữa 2 reel liên tiếp trên cùng 1 page">
                    <InputNumber min={1} addonAfter="phút" style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
            ) : (
              <>
                <Form.Item
                  label="Khung giờ hằng ngày"
                  name="slots"
                  normalize={normalizeSlots}
                  rules={[{ required: true, message: 'Thêm ít nhất 1 khung giờ' }]}
                  extra={(
                    <Space size={4}>
                      Gõ giờ rồi Enter, ví dụ <code>7h</code> <code>11:30</code> <code>20h</code>.
                      <Button size="small" type="link" onClick={saveDefaultSlots}>Lưu làm mặc định</Button>
                    </Space>
                  )}
                >
                  <Select mode="tags" options={HOUR_OPTIONS} tokenSeparators={[',', ' ']} placeholder="07:00, 11:00, 20:00" />
                </Form.Item>
                <Form.Item label="Bắt đầu từ ngày" name="startDate" extra="Khung giờ đã qua trong hôm nay sẽ được bỏ qua.">
                  <DatePicker format="DD/MM/YYYY" style={{ width: '100%' }} />
                </Form.Item>
              </>
            )}

            <Form.Item
              label="Trong cùng khung giờ, các page đăng cách nhau ngẫu nhiên"
              tooltip="Các page đăng lần lượt, mỗi page sau cách page trước một khoảng ngẫu nhiên trong khoảng này"
              style={{ marginBottom: 16 }}
            >
              <Space.Compact>
                <Form.Item name="gapMinSec" noStyle><InputNumber min={0} addonBefore="từ" /></Form.Item>
                <Form.Item name="gapMaxSec" noStyle><InputNumber min={0} addonBefore="đến" addonAfter="giây" /></Form.Item>
              </Space.Compact>
            </Form.Item>

            <Form.Item label="Caption" name="captionTemplate" style={{ marginBottom: 8 }}>
              <Input.TextArea rows={5} placeholder="Nhập caption, ví dụ: {Hay quá|Xem ngay} {filename} #reels" />
            </Form.Item>
            <CaptionHelper
              template={values.captionTemplate}
              onInsert={(snippet) => {
                const cur = form.getFieldValue('captionTemplate') || '';
                form.setFieldValue('captionTemplate', cur + (cur && !cur.endsWith('\n') && !cur.endsWith(' ') ? ' ' : '') + snippet);
              }}
              sampleVideo={videos[0]?.name}
              samplePages={enabledPages.filter((p) => pageIds.includes(p.id)).map((p) => p.name)}
            />

            {V > 0 && P > 0 && slotTimes.length > 0 && (
              <Alert
                style={{ marginBottom: 16 }}
                type={perDay > MAX_REELS_PER_DAY || spreadMin > minSlotGapMin ? 'warning' : 'info'}
                message={values.mode === 'split'
                  ? `${V} video chia cho ${P} page = ${total} lịch đăng · ~${perPage} reel/page`
                  : `${V} video × ${P} page = ${total} lịch đăng · ${perPage} reel/page`}
                description={(
                  <ul style={{ margin: 0, paddingLeft: 18 }}>
                    <li>
                      Các lượt đăng: {slotTimes.slice(0, 4).map((t) => dayjs(t).format('DD/MM HH:mm')).join(' · ')}
                      {slotTimes.length > 4 && ` … ${dayjs(slotTimes.at(-1)).format('DD/MM HH:mm')}`}
                      {' '}({slotTimes.length} lượt)
                    </li>
                    <li>Mỗi lượt: {postsPerSlot} page đăng rải trong khoảng {fmtMinutes(spreadMin)}</li>
                    <li>Mỗi page: tối đa {perDay} reel/ngày</li>
                    {spreadMin > minSlotGapMin && (
                      <li><b>Lượt trước chưa đăng xong đã tới lượt sau</b> — giảm khoảng cách giữa các page hoặc giãn khung giờ.</li>
                    )}
                    {perDay > MAX_REELS_PER_DAY && (
                      <li>Facebook giới hạn ~{MAX_REELS_PER_DAY} reel/page/24h qua API — nên giảm số lượt mỗi ngày.</li>
                    )}
                  </ul>
                )}
              />
            )}

            <Button type="primary" htmlType="submit" block size="large" loading={submitting} disabled={foldersLoading}>
              {foldersLoading ? 'Đang tải video trong thư mục...' : `Tạo lịch đăng${V ? ` (${V} video)` : ''}`}
            </Button>
          </Form>
        </Card>
      </Col>
    </Row>
  );
}
