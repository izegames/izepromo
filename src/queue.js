import { get, save } from './store.js';
import { isReady, sendOffer } from './whatsapp.js';
import { buildMessage } from './format.js';

let nextSendAt = 0;
let sending = false;

const rand = (min, max) => min + Math.random() * (max - min);

export function getNextSendAt() {
  return nextSendAt;
}

export function recentlySent(key) {
  const db = get();
  const limit = Date.now() - db.config.dedupeHours * 3600 * 1000;
  return db.sent.some((s) => s.key === key && s.at > limit) || db.queue.some((q) => q.key === key);
}

async function tick() {
  const db = get();
  const { config } = db;
  if (sending || config.paused || !isReady() || !config.groupId) return;
  if (!db.queue.length || Date.now() < nextSendAt) return;

  sending = true;
  const item = db.queue[0];
  try {
    await sendOffer(config.groupId, buildMessage(item), item.imageUrl);
    db.queue.shift();
    db.sent.unshift({ key: item.key, title: item.title, at: Date.now() });
    db.sent = db.sent.slice(0, 500);
    console.log(`📤 Enviado: ${item.title}`);
    const min = Math.max(1, Number(config.minMinutes) || 3);
    const max = Math.max(min, Number(config.maxMinutes) || 6);
    nextSendAt = Date.now() + rand(min, max) * 60 * 1000;
  } catch (err) {
    console.error('Erro ao enviar:', err.message);
    nextSendAt = Date.now() + 60 * 1000; // tenta de novo em 1 min
  } finally {
    save();
    sending = false;
  }
}

export function startWorker() {
  setInterval(tick, 10 * 1000);
}
