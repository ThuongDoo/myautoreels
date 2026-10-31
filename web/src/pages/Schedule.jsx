import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, App, Breadcrumb, Button, Card, Checkbox, Col, Collapse, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Popover, Radio, Row, Select,
  Slider, Space, Spin, Table, Tag, Tooltip, Typography,
} from 'antd';
import {
  CustomerServiceOutlined, DeleteOutlined, EyeOutlined, FolderOutlined, PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, RightOutlined, SaveOutlined, SoundOutlined, ThunderboltOutlined, VideoCameraOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, fmtSize, fmtSec, groupColor, useApi } from '../api.js';
import { checkCaption, renderCaption } from '../caption.js';
import { Preview as HookPreview } from './Hooks.jsx';
import LibraryBrowser, { filesOf } from './LibraryBrowser.jsx';

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
const SPARE_SLOTS = 500;

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

function CaptionTemplates({ template, onPick }) {
  const { message } = App.useApp();
  const { data: list = [], reload } = useApi('/caption-templates');
  const [currentId, setCurrentId] = useState();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const current = list.find((t) => t.id === currentId);

  const pick = (id) => {
    setCurrentId(id);
    const t = list.find((x) => x.id === id);
    if (t) onPick(t.template);
  };

  const save = async () => {
    try {
      const t = await api.post('/caption-templates', { name, template });
      message.success(`Đã lưu mẫu "${t.name}"`);
      setSaving(false);
      await reload({ silent: true });
      setCurrentId(t.id);
    } catch (e) {
      message.error(e.message);
    }
  };

  const remove = async () => {
    try {
      await api.del(`/caption-templates/${currentId}`);
      message.success(`Đã xoá mẫu "${current.name}"`);
      setCurrentId(undefined);
      reload({ silent: true });
    } catch (e) {
      message.error(e.message);
    }
  };

  return (
    <Space.Compact style={{ width: '100%', marginBottom: 8 }}>
      <Select
        allowClear
        showSearch
        optionFilterProp="label"
        placeholder={list.length ? `Dùng mẫu đã lưu (${list.length})` : 'Chưa có mẫu nào'}
        style={{ flex: 1, minWidth: 0 }}
        value={currentId}
        onChange={pick}
        options={list.map((t) => ({ value: t.id, label: t.name }))}
        optionRender={(o) => {
          const t = list.find((x) => x.id === o.value);
          return (
            <div>
              <div>{t.name}</div>
              <Typography.Text type="secondary" ellipsis style={{ fontSize: 12, maxWidth: '100%' }}>{t.template}</Typography.Text>
            </div>
          );
        }}
      />
      <Popover
        trigger="click"
        open={saving}
        onOpenChange={(o) => { setSaving(o); if (o) setName(current?.name || ''); }}
        title="Lưu caption làm mẫu"
        content={(
          <Space direction="vertical" style={{ width: 260 }}>
            <Input autoFocus placeholder="Tên mẫu, ví dụ: Vẽ tranh - hashtag" value={name} onChange={(e) => setName(e.target.value)} onPressEnter={save} />
            {list.some((t) => t.name === name.trim()) && (
              <Typography.Text type="warning" style={{ fontSize: 12 }}>Trùng tên: mẫu cũ sẽ bị ghi đè.</Typography.Text>
            )}
            <Button type="primary" block onClick={save} disabled={!name.trim()}>Lưu</Button>
          </Space>
        )}
      >
        <Tooltip title="Lưu caption hiện tại làm mẫu">
          <Button icon={<SaveOutlined />} disabled={!template?.trim()}>Lưu mẫu</Button>
        </Tooltip>
      </Popover>
      {current && (
        <Popconfirm title={`Xoá mẫu "${current.name}"?`} onConfirm={remove}>
          <Tooltip title="Xoá mẫu đang chọn"><Button danger icon={<DeleteOutlined />} /></Tooltip>
        </Popconfirm>
      )}
    </Space.Compact>
  );
}

// Form fields a saved schedule config keeps. Videos and start dates change every time, so they're left out.
const PRESET_FIELDS = [
  'pageIds', 'skipUsed', 'mode', 'shuffle', 'timing', 'slots', 'intervalMinutes', 'gapMinSec', 'gapMaxSec', 'captionTemplate',
  'hookMode', 'hookVisual', 'hookKeys', 'audioMode', 'musicPick', 'musicFileId', 'musicKeys', 'origVolume',
];
const PRESET_KEY = 'autoreels.schedulePreset';

// Saved schedule configs. The one used last is applied again when the page opens (once `ready`).
function SchedulePresets({ form, pageIds, ready }) {
  const { message } = App.useApp();
  const { data: list, reload } = useApi('/schedule-presets');
  const [currentId, setCurrentId] = useState();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const restored = useRef(false);
  const nameInput = useRef(null);
  const current = list?.find((p) => p.id === currentId);

  const apply = (p, quiet) => {
    const config = Object.fromEntries(PRESET_FIELDS.filter((k) => k in p.config).map((k) => [k, p.config[k]]));
    // Pages deleted or turned off since the config was saved are dropped.
    if (config.pageIds) config.pageIds = config.pageIds.filter((id) => pageIds.has(id));
    form.setFieldsValue(config);
    setCurrentId(p.id);
    storage.set(PRESET_KEY, String(p.id));
    if (!quiet) message.success(`Đã áp dụng cấu hình "${p.name}"`);
  };

  useEffect(() => {
    if (restored.current || !ready || !list) return;
    restored.current = true;
    const last = list.find((p) => String(p.id) === storage.get(PRESET_KEY));
    if (last) apply(last, true);
  }, [ready, list]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const all = form.getFieldsValue(true);
    try {
      const p = await api.post('/schedule-presets', { name, config: Object.fromEntries(PRESET_FIELDS.map((k) => [k, all[k]])) });
      message.success(`Đã lưu cấu hình "${p.name}"`);
      setSaving(false);
      await reload({ silent: true });
      setCurrentId(p.id);
      storage.set(PRESET_KEY, String(p.id));
    } catch (e) {
      message.error(e.message);
    }
  };

  const remove = async () => {
    try {
      await api.del(`/schedule-presets/${currentId}`);
      message.success(`Đã xoá cấu hình "${current.name}"`);
      setCurrentId(undefined);
      storage.set(PRESET_KEY, '');
      reload({ silent: true });
    } catch (e) {
      message.error(e.message);
    }
  };

  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
        <Typography.Text strong>Cấu hình lên lịch:</Typography.Text>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder={list?.length ? `Chọn cấu hình đã lưu (${list.length})` : 'Chưa lưu cấu hình nào'}
          style={{ width: 280, maxWidth: '100%' }}
          value={currentId}
          onChange={(id) => {
            const p = list.find((x) => x.id === id);
            if (p) apply(p);
            else { setCurrentId(undefined); storage.set(PRESET_KEY, ''); }
          }}
          options={(list || []).map((p) => ({ value: p.id, label: p.name }))}
          optionRender={(o) => {
            const p = list.find((x) => x.id === o.value);
            return (
              <div>
                <div>{p.name}</div>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {p.config.pageIds?.length || 0} page · {p.config.timing === 'interval' ? `cách ${p.config.intervalMinutes} phút` : (p.config.slots || []).join(', ')}
                  {p.config.hookMode === 'random' && ' · hook'}
                  {p.config.audioMode && p.config.audioMode !== 'keep' && ' · nhạc'}
                </Typography.Text>
              </div>
            );
          }}
        />
        <Popover
          trigger="click"
          open={saving}
          onOpenChange={(o) => { setSaving(o); if (o) setName(current?.name || ''); }}
          title="Lưu cấu hình lên lịch"
          afterOpenChange={(o) => o && nameInput.current?.focus()}
          content={(
            <Space direction="vertical" style={{ width: 280 }}>
              <Input ref={nameInput} placeholder="Tên, ví dụ: Vẽ tranh - tối" value={name} onChange={(e) => setName(e.target.value)} onPressEnter={() => name.trim() && save()} />
              {list?.some((p) => p.name === name.trim()) && (
                <Typography.Text type="warning" style={{ fontSize: 12 }}>Trùng tên: cấu hình cũ sẽ được cập nhật.</Typography.Text>
              )}
              <Button type="primary" block onClick={save} disabled={!name.trim()}>Lưu</Button>
            </Space>
          )}
        >
          <Button icon={<SaveOutlined />}>{current ? 'Lưu / cập nhật' : 'Lưu cấu hình'}</Button>
        </Popover>
        {current && (
          <Popconfirm title={`Xoá cấu hình "${current.name}"?`} onConfirm={remove}>
            <Tooltip title="Xoá cấu hình đang chọn"><Button danger icon={<DeleteOutlined />} /></Tooltip>
          </Popconfirm>
        )}
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Lưu page, cách phân bổ, khung giờ, caption, hook và nhạc (không lưu video và ngày bắt đầu). Mở trang sẽ tự dùng cấu hình chọn lần trước.
        </Typography.Text>
      </div>
    </Card>
  );
}

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

const MUSIC_PICKS = [
  { value: 'one', label: 'Một bài cho tất cả' },
  { value: 'random', label: 'Ngẫu nhiên' },
  { value: 'sequence', label: 'Lần lượt từng bài' },
  { value: 'least_used', label: 'Ưu tiên bài lâu chưa dùng' },
  { value: 'top_views', label: 'Ưu tiên bài nhiều view' },
];

const MUSIC_PICK_HELP = {
  random: 'Mỗi lịch đăng nhận một bài ngẫu nhiên.',
  sequence: 'Lần lượt theo tên bài: hết danh sách thì quay lại từ đầu.',
  least_used: 'Bài lâu chưa dùng (hoặc chưa dùng bao giờ) được chọn trước.',
  top_views: 'Bài có views trung bình / reel càng cao thì càng hay được chọn.',
};

const pickOne = (list) => list[Math.floor(Math.random() * list.length)];

// Builds one of the picked videos with a random hook / song from the picked ones, exactly like the
// worker will before posting, and plays it. Nothing is scheduled or posted.
function MergePreview({ values, videos, hooks, music }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({});
  const useHook = values.hookMode === 'random';
  const useMusic = values.audioMode && values.audioMode !== 'keep';
  if (!useHook && !useMusic) return null;

  const enabledHooks = (hooks?.files || []).filter((h) => !h.disabled);
  const hookPool = values.hookKeys?.length ? filesOf(enabledHooks, values.hookKeys) : enabledHooks;
  const songs = music?.files || [];
  const musicPool = values.musicPick === 'one'
    ? songs.filter((m) => m.id === values.musicFileId)
    : (values.musicKeys?.length ? filesOf(songs, values.musicKeys) : songs);
  const problem = !videos.length ? 'Chọn ít nhất 1 video ở mục 1'
    : useHook && !hookPool.length ? 'Chưa có hook nào để ghép'
      : useMusic && !musicPool.length ? (values.musicPick === 'one' ? 'Chưa chọn bài nhạc' : 'Chưa có bài nhạc nào để ghép')
        : null;

  const run = async () => {
    const pick = { video: pickOne(videos), hook: useHook ? pickOne(hookPool) : null, song: useMusic ? pickOne(musicPool) : null };
    setOpen(true);
    setState({ loading: true, ...pick });
    try {
      const r = await api.post('/preview', {
        videoFileId: pick.video.id,
        hookFileId: pick.hook?.id,
        hookVisual: values.hookVisual,
        audioMode: values.audioMode,
        musicFileId: pick.song?.id,
        origVolume: values.origVolume,
      });
      setState({ ...pick, ...r });
    } catch (e) {
      setState({ ...pick, error: e.message });
    }
  };

  return (
    <>
      <Tooltip title={problem}>
        <Button block icon={<EyeOutlined />} disabled={!!problem} onClick={run} style={{ marginBottom: 8 }}>
          Xem thử 1 video sau khi ghép {[useHook && 'hook', useMusic && 'nhạc'].filter(Boolean).join(' + ')}
        </Button>
      </Tooltip>
      <Modal
        open={open}
        title="Xem thử video sau khi ghép"
        width={400}
        destroyOnClose
        onCancel={() => setOpen(false)}
        footer={[
          <Button key="close" onClick={() => setOpen(false)}>Đóng</Button>,
          <Button key="again" type="primary" icon={<ReloadOutlined />} loading={state.loading} onClick={run}>Thử video khác</Button>,
        ]}
      >
        <div
          style={{
            width: '100%', aspectRatio: '9 / 16', maxHeight: '60vh', margin: '0 auto', background: '#000', borderRadius: 8, overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', textAlign: 'center', padding: state.id ? 0 : 24,
          }}
        >
          {state.loading && (
            <Space direction="vertical">
              <Spin />
              <span>Đang tải và ghép video...</span>
              <Typography.Text style={{ color: '#aaa', fontSize: 12 }}>
                {useHook ? 'Có hook nên phải mã hoá lại hình, thường mất 20–60 giây.' : 'Chỉ ghép nhạc, thường vài giây.'}
              </Typography.Text>
            </Space>
          )}
          {state.error && <Typography.Text style={{ color: '#ff7875' }}>{state.error}</Typography.Text>}
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          {state.id && <video key={state.id} controls autoPlay src={`/api/preview/${state.id}`} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />}
        </div>
        {state.video && (
          <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.8 }}>
            <div><VideoCameraOutlined /> Video: {state.video.name}</div>
            {state.hook && (
              <div>
                <ThunderboltOutlined /> Hook: {state.hook.name}
                {(values.hookVisual === 'tail' || state.hook.kind === 'audio') && <Typography.Text type="secondary"> (hình lấy từ cuối video)</Typography.Text>}
              </div>
            )}
            {state.song && (
              <div>
                <CustomerServiceOutlined /> Nhạc: {state.song.name}
                <Typography.Text type="secondary"> ({values.audioMode === 'mix' ? `trộn tiếng gốc ${values.origVolume}%` : 'bỏ tiếng gốc'})</Typography.Text>
              </div>
            )}
            {state.id && (
              <Typography.Text type="secondary">
                Ghép mất {(state.ms / 1000).toFixed(0)} giây trên máy này · {fmtSize(state.size)}
              </Typography.Text>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}

// "Hook mở đầu" card; its fields belong to the schedule Form that wraps the whole page.
function HookCard({ values, hooks, loading }) {
  const [preview, setPreview] = useState(null);
  const enabled = useMemo(() => (hooks?.files || []).filter((h) => !h.disabled), [hooks]);
  const on = values.hookMode === 'random';
  const picked = values.hookKeys?.length ? filesOf(enabled, values.hookKeys).length : enabled.length;

  return (
    <Card title="2. Hook mở đầu">
      <Form.Item name="hookMode" style={{ marginBottom: on ? 16 : 0 }}>
        <Radio.Group>
          <Radio value="none">Không ghép hook</Radio>
          <Radio value="random" disabled={hooks && !hooks.configured}>Ghép ngẫu nhiên 1 hook vào đầu mỗi video</Radio>
        </Radio.Group>
      </Form.Item>
      {hooks && !hooks.configured && (
        <Alert type="info" showIcon style={{ marginTop: 12 }} message={<>Chưa có thư mục hook, thêm ở trang <a href="#settings">Cài đặt</a>.</>} />
      )}
      {on && (
        <Form.Item
          label="Hình của đoạn hook"
          name="hookVisual"
          extra={values.hookVisual === 'tail'
            ? 'Cắt đoạn cuối video, dài bằng hook, đưa lên đầu; hook chỉ dùng tiếng. Ví dụ: tranh đã vẽ xong + voice "hướng dẫn vẽ tranh cho bé…". Hook là file âm thanh (mp3, m4a) luôn dùng cách này.'
            : 'Dùng nguyên hình và tiếng của file hook. Hook là file âm thanh vẫn lấy hình từ đoạn cuối video.'}
        >
          <Radio.Group>
            <Radio value="tail">Lấy đoạn cuối của video</Radio>
            <Radio value="own">Dùng hình trong file hook</Radio>
          </Radio.Group>
        </Form.Item>
      )}
      {on && (
        <Form.Item
          label="Chọn hook"
          tooltip="Tick thư mục = lấy toàn bộ hook bên trong (kể cả thư mục con). Không tick gì = tất cả hook đang bật."
          name="hookKeys"
          style={{ marginBottom: 0 }}
          extra={(
            <>
              Hook giữ nguyên tiếng của nó, nhạc nền (nếu có) chỉ phủ phần video chính. Một page không bị lặp lại hook trong 3 lần đăng gần nhất.
              Hook tắt ở <a href="#hooks">Kho hook</a> không hiện ở đây.{' '}
              <Typography.Text type={picked ? 'secondary' : 'danger'}>Sẽ chọn ngẫu nhiên trong {picked} hook.</Typography.Text>
            </>
          )}
        >
          <LibraryBrowser
            files={enabled}
            loading={loading}
            rootName="Thư mục hook"
            unit="hook"
            icon={(h) => (h.kind === 'audio' ? <SoundOutlined /> : <VideoCameraOutlined />)}
            action={(h) => <Button type="text" size="small" icon={<PlayCircleOutlined />} onClick={() => setPreview(h)} />}
            columns={[
              { title: 'Thời lượng', dataIndex: 'durationMs', width: 100, render: (v, h) => (h.kind === 'audio' ? <Tag color="purple" style={{ margin: 0 }}>Chỉ tiếng</Tag> : fmtSec(v)) },
              {
                title: 'Đã dùng',
                key: 'used',
                width: 130,
                render: (_, h) => (
                  <Space size={2}>
                    {h.posted > 0 && <Tag color="green" style={{ margin: 0 }}>Đăng {h.posted}</Tag>}
                    {h.upcoming > 0 && <Tag color="blue" style={{ margin: 0 }}>Chờ {h.upcoming}</Tag>}
                  </Space>
                ),
              },
            ]}
          />
        </Form.Item>
      )}
      {preview && <HookPreview hook={preview} onClose={() => setPreview(null)} />}
    </Card>
  );
}

// "Nhạc nền" card; its fields belong to the schedule Form that wraps the whole page.
function MusicCard({ values, music, loading }) {
  const [listening, setListening] = useState(null);
  const files = music?.files || [];
  const mode = values.audioMode || 'keep';
  const picked = values.musicKeys?.length ? filesOf(files, values.musicKeys).length : files.length;
  const browser = {
    files,
    loading,
    rootName: 'Thư mục nhạc',
    unit: 'bài',
    icon: <CustomerServiceOutlined />,
    action: (f) => (
      <Button
        type="text"
        size="small"
        icon={listening?.id === f.id ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
        onClick={() => setListening(listening?.id === f.id ? null : f)}
      />
    ),
    columns: [{ title: 'Dung lượng', dataIndex: 'size', width: 100, render: (v) => (v ? fmtSize(v) : '') }],
  };

  return (
    <Card title="3. Nhạc nền">
      <Form.Item
        name="audioMode"
        style={{ marginBottom: mode === 'keep' ? 0 : 16 }}
        extra={mode !== 'keep' && 'Nhạc được ghép vào video ngay trước khi upload: dài hơn video thì cắt, ngắn hơn thì lặp lại, tự nhỏ dần ở cuối.'}
      >
        <Radio.Group>
          <Radio value="keep">Giữ nguyên âm thanh của video</Radio>
          <Radio value="replace" disabled={music && !music.configured}>Thay bằng nhạc (bỏ tiếng gốc)</Radio>
          <Radio value="mix" disabled={music && !music.configured}>Trộn nhạc với tiếng gốc</Radio>
        </Radio.Group>
      </Form.Item>
      {music && !music.configured && (
        <Alert type="info" showIcon style={{ marginTop: 12 }} message={<>Chưa có thư mục nhạc, thêm ở trang <a href="#settings">Cài đặt</a> để chọn nhạc riêng.</>} />
      )}

      {mode !== 'keep' && (
        <>
          <Row gutter={16}>
            <Col xs={24} md={12}>
              <Form.Item label="Cách chọn nhạc" name="musicPick">
                <Select options={MUSIC_PICKS} />
              </Form.Item>
            </Col>
            {mode === 'mix' && (
              <Col xs={24} md={12}>
                <Form.Item label="Âm lượng tiếng gốc" name="origVolume">
                  <Slider min={0} max={100} step={5} tooltip={{ formatter: (v) => `${v}%` }} marks={{ 0: '0%', 30: '30%', 100: '100%' }} />
                </Form.Item>
              </Col>
            )}
          </Row>
          {values.musicPick === 'one' ? (
            <Form.Item
              label="Chọn 1 bài"
              name="musicFileId"
              rules={[{ required: true, message: 'Chọn một bài nhạc' }]}
              style={{ marginBottom: 0 }}
            >
              <LibraryBrowser single {...browser} />
            </Form.Item>
          ) : (
            <Form.Item
              label="Chọn nhạc"
              tooltip="Tick thư mục = lấy toàn bộ bài bên trong (kể cả thư mục con). Không tick gì = tất cả bài trong thư mục nhạc."
              name="musicKeys"
              style={{ marginBottom: 0 }}
              extra={(
                <>
                  {MUSIC_PICK_HELP[values.musicPick]} Một page không bị lặp lại bài trong 3 lần đăng gần nhất.{' '}
                  <Typography.Text type={picked ? 'secondary' : 'danger'}>Sẽ chọn trong {picked} bài.</Typography.Text>
                </>
              )}
            >
              <LibraryBrowser {...browser} />
            </Form.Item>
          )}
          {listening && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
              <Typography.Text type="secondary" ellipsis style={{ flex: '0 1 auto', minWidth: 0 }}>Đang nghe: {listening.name}</Typography.Text>
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio key={listening.id} autoPlay controls style={{ height: 30, flex: '0 0 280px' }} src={`/api/drive/stream/${encodeURIComponent(listening.id)}`} onEnded={() => setListening(null)} />
            </div>
          )}
        </>
      )}
    </Card>
  );
}

const fmtMinutes =(m) => (m >= 60 ? `${Math.floor(m / 60)} giờ ${Math.round(m % 60)} phút` : `${Math.round(m)} phút`);

// "Đã đăng 12/40" next to a folder: videos (subfolders included) with at least one done post.
function FolderUsage({ u }) {
  if (!u) return <Spin size="small" />;
  if (u.error || !u.total) return null;
  const all = u.posted === u.total;
  return (
    <>
      <Tag color={all ? 'green' : u.posted ? 'lime' : 'default'} style={{ margin: 0 }}>
        Đã đăng {u.posted}/{u.total}
      </Tag>
      {u.upcoming > 0 && <Tag color="blue" style={{ margin: 0 }}>Sắp đăng {u.upcoming}</Tag>}
    </>
  );
}

function DriveBrowser({ selectedKeys, onSelect, videoCache, folderNames, folders }) {
  const { message } = App.useApp();
  const [stack, setStack] = useState([]);
  const [data, setData] = useState({ folders: [], videos: [] });
  const [loading, setLoading] = useState(false);
  const [link, setLink] = useState(() => storage.get(ROOT_KEY) || '');
  // folderId -> { total, posted, upcoming } for the subfolders on screen; loaded after the listing.
  const [usage, setUsage] = useState({});

  const loadUsage = async (list) => {
    if (!list.length) return;
    try {
      const res = await api.get(`/drive/folder-usage?ids=${list.map((f) => f.id).join(',')}`);
      setUsage((u) => ({ ...u, ...res }));
    } catch { /* counts are optional */ }
  };

  const open = async (folderId, name, replaceStack) => {
    setLoading(true);
    try {
      const res = await api.get(`/drive/list${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ''}`);
      res.videos.forEach((v) => { videoCache.current[v.id] = v; });
      res.folders.forEach((f) => { folderNames.current[f.id] = f.name; });
      setData(res);
      loadUsage(res.folders);
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
                {r.isFolder && <FolderUsage u={usage[r.id]} />}
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
  const { data: pagesLoaded } = useApi('/pages');
  const pages = pagesLoaded || [];
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
  const pickedVideos = useMemo(() => {
    const map = new Map();
    for (const f of Object.values(folders)) for (const v of f.videos) map.set(v.id, v);
    for (const k of selectedKeys) if (videoCache.current[k]) map.set(k, videoCache.current[k]);
    return [...map.values()];
  }, [folders, selectedKeys]);
  const isUsed = (v) => (values.skipUsed === 'posted' && v.posted > 0)
    || (values.skipUsed === 'used' && (v.posted > 0 || v.upcoming > 0));
  const videos = pickedVideos.filter((v) => !isUsed(v));
  const skippedCount = pickedVideos.length - videos.length;
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
  const { data: music, loading: musicLoading } = useApi('/music');
  const { data: hooks, loading: hooksLoading } = useApi('/hooks');
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
    if (!V) return message.warning(skippedCount ? 'Tất cả video đã chọn đều đã từng đăng' : 'Chưa chọn video nào');
    if (slotTimes.length < perPage) return message.warning('Chưa có khung giờ / giờ bắt đầu');
    if (checkCaption(v.captionTemplate).length) return message.error('Caption đang có lỗi, xem ngay dưới ô Caption');
    setSubmitting(true);
    try {
      const r = await api.post('/jobs/bulk', {
        videos: videos.map(({ id, name }) => ({ id, name })),
        pageIds: v.pageIds,
        mode: v.mode,
        shuffle: v.shuffle,
        // Spare slots so the server can skip slots where a page already has a post.
        slotTimes: buildSlotTimes(values, perPage + SPARE_SLOTS),
        gapMinSec: v.gapMinSec,
        gapMaxSec: v.gapMaxSec,
        captionTemplate: v.captionTemplate,
        audioMode: v.audioMode,
        musicPick: v.musicPick,
        musicFileId: v.musicFileId,
        // Picked files ([] = all); a ticked folder stands for every file inside it.
        musicFileIds: filesOf(music?.files || [], v.musicKeys).map((m) => m.id),
        origVolume: v.origVolume,
        hookMode: v.hookMode,
        hookVisual: v.hookVisual,
        hookFileIds: filesOf((hooks?.files || []).filter((h) => !h.disabled), v.hookKeys).map((h) => h.id),
      });
      message.success(
        <>
          Đã tạo {r.created} lịch đăng, từ {dayjs(r.firstAt).format('DD/MM HH:mm')} đến {dayjs(r.lastAt).format('DD/MM HH:mm')}.{' '}
          {r.skipped > 0 && `Bỏ qua ${r.skipped} khung giờ page đã có lịch. `}
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

  // One Form across both columns. component={false}: no <form> element, so Enter in a search box
  // (Drive link, hook / music search) does not submit the schedule.
  return (
    <Form
      form={form}
      component={false}
      layout="vertical"
      onFinish={submit}
      initialValues={{
        mode: 'all',
        shuffle: true,
        skipUsed: 'none',
        timing: 'slots',
        slots: ['07:00', '11:00', '20:00'],
        startDate: dayjs(),
        startAt: dayjs().add(30, 'minute').second(0),
        intervalMinutes: 60,
        gapMinSec: 30,
        gapMaxSec: 120,
        captionTemplate: '{filename}',
        pageIds: [],
        audioMode: 'keep',
        musicPick: 'least_used',
        musicKeys: [],
        origVolume: 30,
        hookMode: 'none',
        hookKeys: [],
        hookVisual: 'tail',
      }}
    >
      <SchedulePresets
        form={form}
        pageIds={new Set(enabledPages.map((p) => p.id))}
        ready={!!pagesLoaded && !!settings}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <DriveBrowser
              selectedKeys={selectedKeys}
              onSelect={onSelect}
              videoCache={videoCache}
              folderNames={folderNames}
              folders={folders}
            />
            <HookCard values={values} hooks={hooks} loading={hooksLoading} />
            <MusicCard values={values} music={music} loading={musicLoading} />
          </div>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="4. Cài đặt lịch đăng">
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

            <Form.Item
              label="Video đã từng dùng"
              name="skipUsed"
              extra={skippedCount > 0 && (
                <Typography.Text type="warning">
                  Bỏ qua {skippedCount}/{pickedVideos.length} video, còn {V} video sẽ được lên lịch.
                </Typography.Text>
              )}
            >
              <Radio.Group>
                <Radio value="none">Vẫn đăng</Radio>
                <Radio value="posted">Bỏ video đã đăng</Radio>
                <Radio value="used">Bỏ video đã đăng hoặc đang chờ đăng</Radio>
              </Radio.Group>
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

            <CaptionTemplates
              template={values.captionTemplate}
              onPick={(t) => form.setFieldValue('captionTemplate', t)}
            />
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
                    {values.hookMode === 'random' && <li>Mỗi video được ghép 1 hook ngẫu nhiên ở đầu</li>}
                    {values.audioMode && values.audioMode !== 'keep' && (
                      <li>
                        Nhạc: {MUSIC_PICKS.find((m) => m.value === values.musicPick)?.label.toLowerCase()},{' '}
                        {values.audioMode === 'mix' ? `trộn với tiếng gốc ${values.origVolume}%` : 'bỏ tiếng gốc'}
                      </li>
                    )}
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

            <MergePreview values={values} videos={videos} hooks={hooks} music={music} />
            <Button type="primary" onClick={form.submit} block size="large" loading={submitting} disabled={foldersLoading}>
              {foldersLoading ? 'Đang tải video trong thư mục...' : `Tạo lịch đăng${V ? ` (${V} video)` : ''}`}
            </Button>
          </Card>
        </Col>
      </Row>
    </Form>
  );
}
