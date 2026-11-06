import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { get, save } from './store.js';
import { isReady, listGroups } from './whatsapp.js';
import { applyAffiliate, buildMessage, dedupeKey, detectStore } from './format.js';
import { getNextSendAt, recentlySent } from './queue.js';

export function startServer(port = 3000) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.resolve('public')));

  app.get('/api/state', (req, res) => {
    const db = get();
    res.json({
      connected: isReady(),
      config: db.config,
      queue: db.queue.map((q) => ({ ...q, preview: buildMessage(q) })),
      sent: db.sent.slice(0, 20),
      nextSendAt: getNextSendAt(),
    });
  });

  app.get('/api/groups', async (req, res) => {
    res.json(await listGroups());
  });

  app.post('/api/config', (req, res) => {
    const db = get();
    const b = req.body || {};
    if (typeof b.groupId === 'string') db.config.groupId = b.groupId;
    if (typeof b.amazonTag === 'string') db.config.amazonTag = b.amazonTag.trim();
    if (b.minMinutes != null) db.config.minMinutes = Math.max(1, Number(b.minMinutes) || 3);
    if (b.maxMinutes != null) db.config.maxMinutes = Math.max(1, Number(b.maxMinutes) || 6);
    if (b.dedupeHours != null) db.config.dedupeHours = Math.max(0, Number(b.dedupeHours) || 24);
    if (typeof b.paused === 'boolean') db.config.paused = b.paused;
    save();
    res.json(db.config);
  });

  app.post('/api/queue', (req, res) => {
    const db = get();
    const b = req.body || {};
    if (!b.title?.trim() || !b.url?.trim()) {
      return res.status(400).json({ error: 'Título e link são obrigatórios.' });
    }
    if (!detectStore(b.url)) {
      return res.status(400).json({
        error: 'Link não reconhecido (Amazon, Mercado Livre, Shopee ou AliExpress).',
      });
    }
    const url = applyAffiliate(b.url.trim(), db.config.amazonTag);
    const key = dedupeKey(url);
    if (!b.force && recentlySent(key)) {
      return res.status(409).json({
        error: `Esse produto já foi enviado nas últimas ${db.config.dedupeHours}h ou já está na fila.`,
      });
    }
    const item = {
      id: crypto.randomUUID(),
      key,
      title: b.title.trim(),
      url,
      price: b.price ? Number(String(b.price).replace(',', '.')) : null,
      oldPrice: b.oldPrice ? Number(String(b.oldPrice).replace(',', '.')) : null,
      coupon: b.coupon?.trim() || '',
      note: b.note?.trim() || '',
      imageUrl: b.imageUrl?.trim() || '',
      addedAt: Date.now(),
    };
    db.queue.push(item);
    save();
    res.json(item);
  });

  app.delete('/api/queue/:id', (req, res) => {
    const db = get();
    db.queue = db.queue.filter((q) => q.id !== req.params.id);
    save();
    res.json({ ok: true });
  });

  // Só aceita conexões do próprio computador
  app.listen(port, '127.0.0.1', () => {
    console.log(`🖥️  Painel: http://localhost:${port}`);
  });
}
