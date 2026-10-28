// Spintax "{a|b|c}" picks one option at random (nested allowed),
// then variables like {filename} and {page} are substituted.
// The web preview uses a copy in web/src/caption.js — keep the two in sync.
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
