import express from 'express';
import {
  getConfig,
  setConfig,
  listDestinations,
  addDestination,
  setDestinationEnabled,
  removeDestination,
  addOffer,
  getOffer,
  listQueue,
  listFailed,
  listSent,
  removeOffer,
  retryOffer,
  isDuplicate,
} from './db.js';
import { applyAffiliate, buildMessage, dedupeKey, detectStore, parseMoney } from './format.js';
import { resolveShortLink } from './links.js';
import { PUBLIC_DIR } from './paths.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Bloqueia páginas de outros sites (CSRF) e DNS rebinding: só aceita Host e Origin locais e coerentes.
export function localOnly(req, res, next) {
  const host = req.headers.host || '';
  if (!LOCAL_HOSTS.has(host.replace(/:\d+$/, ''))) return res.status(403).json({ error: 'Host não permitido.' });
  const origin = req.headers.origin;
  if (origin) {
    let ok = false;
    try {
      ok = new URL(origin).host === host;
    } catch {}
    if (!ok) return res.status(403).json({ error: 'Origem não permitida.' });
  }
  next();
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Aceita número (ms), string ISO ou vazio. Retorna { value } ou { error }.
function parseSchedule(input) {
  if (input == null || input === '') return { value: null };
  const ms = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ms)) return { error: 'Data de agendamento inválida.' };
  return { value: Math.round(ms) };
}

export function createApp({ channels, resolveLink = resolveShortLink }) {
  const app = express();
  app.use(localOnly);
  app.use(express.json({ limit: '100kb' }));
  app.use(express.static(PUBLIC_DIR));

  const publicConfig = () => {
    const { telegramToken, ...rest } = getConfig();
    return { ...rest, telegramTokenSet: Boolean(telegramToken) };
  };

  app.get('/api/state', (req, res) => {
    const config = getConfig();
    res.json({
      whatsappConnected: channels.whatsapp.isReady(),
      telegramConfigured: channels.telegram.isReady(),
      config: publicConfig(),
      destinations: listDestinations(),
      queue: listQueue().map((q) => ({ ...q, preview: buildMessage(q) })),
      failed: listFailed(),
      sent: listSent(20),
      nextSendAt: config.nextSendAt,
    });
  });

  app.get('/api/groups', wrap(async (req, res) => {
    res.json(await channels.whatsapp.listGroups());
  }));

  app.post('/api/config', (req, res) => {
    const b = req.body || {};
    const patch = {};
    if (typeof b.amazonTag === 'string') patch.amazonTag = b.amazonTag.trim();
    // token vazio = manter o atual (o painel nunca recebe o token de volta)
    if (typeof b.telegramToken === 'string' && b.telegramToken.trim()) patch.telegramToken = b.telegramToken.trim();
    if (b.clearTelegramToken === true) patch.telegramToken = '';
    if (b.minMinutes != null) patch.minMinutes = Math.max(1, Number(b.minMinutes) || 3);
    if (b.maxMinutes != null) patch.maxMinutes = Math.max(1, Number(b.maxMinutes) || 6);
    if (b.dedupeHours != null) patch.dedupeHours = Math.max(0, Number(b.dedupeHours) || 24);
    if (typeof b.paused === 'boolean') patch.paused = b.paused;
    const current = { ...getConfig(), ...patch };
    if (current.maxMinutes < current.minMinutes) patch.maxMinutes = current.minMinutes;
    setConfig(patch);
    res.json(publicConfig());
  });

  app.post('/api/telegram/test', wrap(async (req, res) => {
    try {
      const me = await channels.telegram.me();
      res.json({ ok: true, username: me.username, name: me.first_name });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));

  // ---------- destinos ----------

  app.post('/api/destinations', (req, res) => {
    const b = req.body || {};
    const channel = b.channel;
    const target = String(b.target || '').trim();
    if (!['whatsapp', 'telegram'].includes(channel)) return res.status(400).json({ error: 'Canal inválido.' });
    if (!target) return res.status(400).json({ error: 'Informe o destino (grupo ou chat).' });
    res.json(addDestination({ channel, target, name: String(b.name || target).trim() }));
  });

  app.patch('/api/destinations/:id', (req, res) => {
    const ok = setDestinationEnabled(Number(req.params.id), !!req.body?.enabled);
    res.status(ok ? 200 : 404).json({ ok });
  });

  app.delete('/api/destinations/:id', (req, res) => {
    res.json({ ok: removeDestination(Number(req.params.id)) });
  });

  // ---------- fila ----------

  app.post('/api/queue', wrap(async (req, res) => {
    const b = req.body || {};
    const config = getConfig();
    if (!b.title?.trim() || !b.url?.trim()) {
      return res.status(400).json({ error: 'Título e link são obrigatórios.' });
    }
    if (!detectStore(b.url)) {
      return res.status(400).json({
        error: 'Link não reconhecido (Amazon, Mercado Livre, Shopee ou AliExpress).',
      });
    }

    const price = parseMoney(b.price);
    const oldPrice = parseMoney(b.oldPrice);
    if (b.price && price == null) return res.status(400).json({ error: 'Preço atual inválido.' });
    if (b.oldPrice && oldPrice == null) return res.status(400).json({ error: 'Preço antigo inválido.' });

    const schedule = parseSchedule(b.scheduledAt);
    if (schedule.error) return res.status(400).json({ error: schedule.error });

    const url = applyAffiliate(b.url.trim(), config.amazonTag);
    // O link curto é seguido só para descobrir o produto; quem sai no grupo é o link que você colou.
    const key = dedupeKey(await resolveLink(url));
    if (!b.force && isDuplicate(key, config.dedupeHours)) {
      return res.status(409).json({
        error: `Esse produto já foi enviado nas últimas ${config.dedupeHours}h ou já está na fila.`,
      });
    }

    const offer = addOffer({
      key,
      title: b.title.trim(),
      url,
      price,
      oldPrice,
      coupon: b.coupon?.trim() || '',
      note: b.note?.trim() || '',
      imageUrl: b.imageUrl?.trim() || '',
      scheduledAt: schedule.value,
    });
    res.json(offer);
  }));

  app.delete('/api/queue/:id', (req, res) => {
    res.json({ ok: removeOffer(req.params.id) });
  });

  app.post('/api/queue/:id/retry', (req, res) => {
    const ok = retryOffer(req.params.id);
    if (ok) setConfig({ nextSendAt: 0 });
    res.status(ok ? 200 : 404).json({ ok, offer: ok ? getOffer(req.params.id) : null });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('Erro na API:', err.message);
    res.status(500).json({ error: 'Erro interno. Veja o terminal.' });
  });

  return app;
}

export function startServer(deps, port = 3000) {
  const app = createApp(deps);
  // Só aceita conexões do próprio computador
  const server = app.listen(port, '127.0.0.1', () => {
    console.log(`🖥️  Painel: http://localhost:${port}`);
  });
  return server;
}
