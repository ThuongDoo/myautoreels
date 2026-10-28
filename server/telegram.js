import { getSetting } from './db.js';

export async function notify(text, { throwOnError = false } = {}) {
  const token = getSetting('telegram_bot_token');
  const chatId = getSetting('telegram_chat_id');
  if (!token || !chatId) {
    if (throwOnError) throw new Error('Chưa cấu hình Telegram');
    return;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.description || 'Telegram error');
  } catch (e) {
    if (throwOnError) throw e;
    console.error('[telegram]', e.message);
  }
}
