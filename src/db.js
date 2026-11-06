import './check-node.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './paths.js';

// Import dinâmico de propósito: só carrega o SQLite do Node depois que check-node.js
// conferiu a versão (e escondeu o aviso "experimental"). Num import estático ele carregaria antes.
const { DatabaseSync } = await import('node:sqlite');

export const DEFAULT_CONFIG = {
  amazonTag: '',
  telegramToken: '',
  minMinutes: 3,
  maxMinutes: 6,
  dedupeHours: 24,
  maxAttempts: 3,
  paused: false,
  nextSendAt: 0,
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  target TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE (channel, target)
);
CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  price REAL,
  old_price REAL,
  coupon TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  image_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  scheduled_at INTEGER,
  added_at INTEGER NOT NULL,
  sent_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS offers_status ON offers (status, scheduled_at);
CREATE INDEX IF NOT EXISTS offers_key ON offers (key);
CREATE TABLE IF NOT EXISTS deliveries (
  offer_id TEXT NOT NULL REFERENCES offers (id) ON DELETE CASCADE,
  destination_id INTEGER NOT NULL REFERENCES destinations (id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL,
  PRIMARY KEY (offer_id, destination_id)
);
`;

let db = null;

export function open(file) {
  if (db) db.close();
  if (!file) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    file = path.join(DATA_DIR, 'izepromo.db');
  }
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  txDepth = 0;
  return db;
}

// Transação simples (aceita chamadas aninhadas: só a mais externa abre e fecha).
let txDepth = 0;
function tx(fn) {
  if (txDepth > 0) return fn();
  conn().exec('BEGIN');
  txDepth++;
  try {
    const result = fn();
    conn().exec('COMMIT');
    return result;
  } catch (e) {
    conn().exec('ROLLBACK');
    throw e;
  } finally {
    txDepth--;
  }
}

export function close() {
  if (db) db.close();
  db = null;
}

function conn() {
  if (!db) open();
  return db;
}

// ---------- configuração ----------

export function getConfig() {
  const rows = conn().prepare('SELECT key, value FROM config').all();
  const cfg = { ...DEFAULT_CONFIG };
  for (const { key, value } of rows) {
    if (key in DEFAULT_CONFIG) cfg[key] = JSON.parse(value);
  }
  return cfg;
}

export function setConfig(patch) {
  const stmt = conn().prepare(
    'INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  tx(() => {
    for (const [k, v] of Object.entries(patch)) if (k in DEFAULT_CONFIG) stmt.run(k, JSON.stringify(v));
  });
  return getConfig();
}

// ---------- destinos ----------

const destFromRow = (r) => ({ id: r.id, channel: r.channel, target: r.target, name: r.name, enabled: !!r.enabled });

export function listDestinations() {
  return conn().prepare('SELECT * FROM destinations ORDER BY id').all().map(destFromRow);
}

export function addDestination({ channel, target, name = '' }) {
  const info = conn()
    .prepare('INSERT INTO destinations (channel, target, name) VALUES (?, ?, ?) ON CONFLICT(channel, target) DO UPDATE SET name = excluded.name')
    .run(channel, target, name);
  const row = conn().prepare('SELECT * FROM destinations WHERE channel = ? AND target = ?').get(channel, target);
  return destFromRow(row ?? { id: info.lastInsertRowid, channel, target, name, enabled: 1 });
}

export function setDestinationEnabled(id, enabled) {
  return conn().prepare('UPDATE destinations SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id).changes > 0;
}

export function removeDestination(id) {
  return conn().prepare('DELETE FROM destinations WHERE id = ?').run(id).changes > 0;
}

// ---------- ofertas ----------

const offerFromRow = (r) =>
  r && {
    id: r.id,
    key: r.key,
    title: r.title,
    url: r.url,
    price: r.price,
    oldPrice: r.old_price,
    coupon: r.coupon,
    note: r.note,
    imageUrl: r.image_url,
    status: r.status,
    scheduledAt: r.scheduled_at,
    addedAt: r.added_at,
    sentAt: r.sent_at,
    attempts: r.attempts,
    lastError: r.last_error,
  };

export function addOffer(o) {
  const id = crypto.randomUUID();
  conn()
    .prepare(
      `INSERT INTO offers (id, key, title, url, price, old_price, coupon, note, image_url, scheduled_at, added_at)
       VALUES (@id, @key, @title, @url, @price, @oldPrice, @coupon, @note, @imageUrl, @scheduledAt, @addedAt)`,
    )
    .run({
      id,
      key: o.key,
      title: o.title,
      url: o.url,
      price: o.price ?? null,
      oldPrice: o.oldPrice ?? null,
      coupon: o.coupon ?? '',
      note: o.note ?? '',
      imageUrl: o.imageUrl ?? '',
      scheduledAt: o.scheduledAt ?? null,
      addedAt: Date.now(),
    });
  return getOffer(id);
}

export function getOffer(id) {
  return offerFromRow(conn().prepare('SELECT * FROM offers WHERE id = ?').get(id));
}

// Fila: ordem de envio = horário agendado (ou de entrada, se não tiver agendamento).
export function listQueue() {
  return conn()
    .prepare("SELECT * FROM offers WHERE status = 'queued' ORDER BY COALESCE(scheduled_at, added_at), added_at, rowid")
    .all()
    .map(offerFromRow);
}

export function listFailed() {
  return conn().prepare("SELECT * FROM offers WHERE status = 'failed' ORDER BY added_at DESC").all().map(offerFromRow);
}

export function listSent(limit = 20) {
  return conn()
    .prepare("SELECT * FROM offers WHERE status = 'sent' ORDER BY sent_at DESC LIMIT ?")
    .all(limit)
    .map(offerFromRow);
}

// Próxima oferta que já pode sair (sem agendamento ou com horário vencido).
export function nextDue(now = Date.now()) {
  return offerFromRow(
    conn()
      .prepare(
        `SELECT * FROM offers
         WHERE status = 'queued' AND (scheduled_at IS NULL OR scheduled_at <= ?)
         ORDER BY COALESCE(scheduled_at, added_at), added_at, rowid LIMIT 1`,
      )
      .get(now),
  );
}

export function removeOffer(id) {
  return conn().prepare("DELETE FROM offers WHERE id = ? AND status != 'sent'").run(id).changes > 0;
}

export function retryOffer(id) {
  const r = conn()
    .prepare("UPDATE offers SET status = 'queued', attempts = 0, last_error = '' WHERE id = ? AND status = 'failed'")
    .run(id);
  if (r.changes) conn().prepare("DELETE FROM deliveries WHERE offer_id = ? AND status != 'sent'").run(id);
  return r.changes > 0;
}

export function markSent(id, lastError = '') {
  conn().prepare("UPDATE offers SET status = 'sent', sent_at = ?, last_error = ? WHERE id = ?").run(Date.now(), lastError, id);
}

export function markFailed(id, error) {
  conn().prepare("UPDATE offers SET status = 'failed', last_error = ? WHERE id = ?").run(error, id);
}

export function registerAttempt(id, error) {
  conn().prepare('UPDATE offers SET attempts = attempts + 1, last_error = ? WHERE id = ?').run(error, id);
  return getOffer(id).attempts;
}

// Já enviou (ou está na fila) nas últimas `hours` horas?
export function isDuplicate(key, hours) {
  const since = Date.now() - Math.max(0, hours) * 3600 * 1000;
  const row = conn()
    .prepare(
      `SELECT 1 FROM offers WHERE key = ? AND (status = 'queued' OR (status = 'sent' AND sent_at > ?)) LIMIT 1`,
    )
    .get(key, since);
  return !!row;
}

// ---------- entregas (um registro por oferta x destino) ----------

export function deliveryStatuses(offerId) {
  const out = new Map();
  for (const r of conn().prepare('SELECT destination_id, status FROM deliveries WHERE offer_id = ?').all(offerId)) {
    out.set(r.destination_id, r.status);
  }
  return out;
}

export function recordDelivery(offerId, destinationId, status, error = '') {
  conn()
    .prepare(
      `INSERT INTO deliveries (offer_id, destination_id, status, error, at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(offer_id, destination_id) DO UPDATE SET status = excluded.status, error = excluded.error, at = excluded.at`,
    )
    .run(offerId, destinationId, status, error, Date.now());
}

export function countSentDeliveries(offerId) {
  return conn().prepare("SELECT COUNT(*) AS n FROM deliveries WHERE offer_id = ? AND status = 'sent'").get(offerId).n;
}

// ---------- migração do data/db.json da versão anterior ----------

export function migrateLegacy(dir = DATA_DIR) {
  const file = path.join(dir, 'db.json');
  if (!fs.existsSync(file)) return false;

  let old;
  try {
    old = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('db.json antigo ilegível, ignorando migração:', e.message);
    return false;
  }

  const c = old.config || {};
  tx(() => {
    setConfig({
      amazonTag: c.amazonTag ?? '',
      minMinutes: c.minMinutes ?? DEFAULT_CONFIG.minMinutes,
      maxMinutes: c.maxMinutes ?? DEFAULT_CONFIG.maxMinutes,
      dedupeHours: c.dedupeHours ?? DEFAULT_CONFIG.dedupeHours,
      paused: !!c.paused,
    });
    if (c.groupId) addDestination({ channel: 'whatsapp', target: c.groupId, name: c.groupId });

    const insert = conn().prepare(
      `INSERT OR IGNORE INTO offers (id, key, title, url, price, old_price, coupon, note, image_url, status, added_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const q of old.queue || []) {
      insert.run(q.id || crypto.randomUUID(), q.key, q.title, q.url, q.price ?? null, q.oldPrice ?? null,
        q.coupon || '', q.note || '', q.imageUrl || '', 'queued', q.addedAt || Date.now(), null);
    }
    for (const s of old.sent || []) {
      insert.run(crypto.randomUUID(), s.key, s.title, '', null, null, '', '', '', 'sent', s.at, s.at);
    }
  });

  fs.renameSync(file, `${file}.migrado`);
  console.log('📦 Dados do db.json antigo importados para o SQLite (arquivo renomeado para db.json.migrado)');
  return true;
}
