// Same rules as server/caption.js — keep the two in sync.
export const CAPTION_VARS = ['filename', 'page'];

export function renderCaption(template, vars) {
  let text = template || '';
  const spin = /\{([^{}]*\|[^{}]*)\}/;
  let m;
  while ((m = spin.exec(text))) {
    const options = m[1].split('|');
    text = text.slice(0, m.index) + options[Math.floor(Math.random() * options.length)] + text.slice(m.index + m[0].length);
  }
  return text.replace(/\{(\w+)\}/g, (all, key) => (key in vars ? vars[key] : all)).trim();
}

export function checkCaption(template) {
  const problems = [];
  const text = template || '';
  let depth = 0;
  for (const ch of text) {
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth < 0) break;
  }
  if (depth !== 0) problems.push('Dấu ngoặc { } chưa khớp — mỗi { phải có một } đóng lại.');

  for (const [, inner] of text.matchAll(/\{([^{}|]*)\}/g)) {
    if (!CAPTION_VARS.includes(inner.trim())) {
      problems.push(`{${inner}} không phải biến hợp lệ. Dùng {filename}, {page}, hoặc {lựa chọn 1|lựa chọn 2} để chọn ngẫu nhiên.`);
    }
  }
  for (const [all] of text.matchAll(/\{[^{}]*\|[^{}]*\}/g)) {
    if (all.split('|').some((o) => !o.replace(/[{}]/g, '').trim())) {
      problems.push(`${all} có lựa chọn rỗng (thừa dấu |) — sẽ có page nhận chữ trống.`);
    }
  }
  return problems;
}
