import { Select, Tag } from 'antd';
import { groupColor } from '../api.js';

// Picks tags out of those used by `pages`, each shown with its page count.
export default function TagFilter({
  pages, value, onChange, placeholder = 'Tất cả tag', style, disabled,
}) {
  const counts = new Map();
  for (const p of pages) for (const t of p.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  const options = [...counts]
    .sort(([a], [b]) => a.localeCompare(b, 'vi', { numeric: true }))
    .map(([t, n]) => ({ value: t, label: `${t} (${n})` }));
  return (
    <Select
      mode="multiple"
      allowClear
      maxTagCount="responsive"
      placeholder={placeholder}
      optionFilterProp="label"
      notFoundContent="Chưa có tag nào, gắn ở trang Pages"
      style={style}
      disabled={disabled}
      value={value}
      onChange={onChange}
      options={options}
      tagRender={({ value: t, closable, onClose }) => (
        <Tag color={groupColor(t)} closable={closable} onClose={onClose} style={{ marginInlineEnd: 4 }}>{t}</Tag>
      )}
    />
  );
}
