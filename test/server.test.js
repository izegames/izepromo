import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../src/db.js';
import { createApp } from '../src/server.js';

const channels = {
  whatsapp: { isReady: () => true, listGroups: async () => [{ id: 'g@g.us', name: 'Grupo' }] },
  telegram: { isReady: () => false, me: async () => { throw new Error('Token do bot do Telegram não configurado'); } },
};

let server;
let base;

before(async () => {
  db.open(':memory:');
  // resolveLink falso: amzn.to -> link completo do produto
  const app = createApp({
    channels,
    resolveLink: async (u) => (u.includes('amzn.to') ? 'https://www.amazon.com.br/dp/B0ABCDEFGH' : u),
  });
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
});

const post = (p, body, headers = {}, method = 'POST') =>
  fetch(base + p, { method, headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('rejeita Origin de outro site e Host estranho', async () => {
  const r = await post('/api/config', { paused: true }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const ok = await post('/api/config', { paused: false }, { origin: base });
  assert.equal(ok.status, 200);
});

test('valida campos e preços ao adicionar oferta', async () => {
  assert.equal((await post('/api/queue', { title: 'x' })).status, 400);
  assert.equal((await post('/api/queue', { title: 'x', url: 'https://site-qualquer.com/a' })).status, 400);
  const bad = await post('/api/queue', { title: 'x', url: 'https://shope.ee/a', price: 'abc' });
  assert.equal(bad.status, 400);
  const badDate = await post('/api/queue', { title: 'x', url: 'https://shope.ee/a', scheduledAt: 'ontem' });
  assert.equal(badDate.status, 400);
});

test('preço brasileiro e agendamento são salvos; link curto é checado contra o link completo', async () => {
  db.setConfig({ amazonTag: 'meu-20' });
  const when = Date.now() + 3600 * 1000;
  const r = await post('/api/queue', {
    title: 'Fone', url: 'https://www.amazon.com.br/dp/B0ABCDEFGH', price: '1.299,90', oldPrice: '1.999,90', scheduledAt: when,
  });
  assert.equal(r.status, 200);
  const o = await r.json();
  assert.equal(o.price, 1299.9);
  assert.equal(o.oldPrice, 1999.9);
  assert.equal(o.scheduledAt, when);
  assert.equal(new URL(o.url).searchParams.get('tag'), 'meu-20');

  // o mesmo produto por link curto é detectado como repetido
  const dup = await post('/api/queue', { title: 'Fone', url: 'https://amzn.to/abc' });
  assert.equal(dup.status, 409);
  const forced = await post('/api/queue', { title: 'Fone', url: 'https://amzn.to/abc', force: true });
  assert.equal(forced.status, 200);
  assert.equal((await forced.json()).url, 'https://amzn.to/abc');
});

test('destinos: criar, desativar e remover', async () => {
  const bad = await post('/api/destinations', { channel: 'sms', target: 'x' });
  assert.equal(bad.status, 400);
  const d = await (await post('/api/destinations', { channel: 'telegram', target: '@canal' })).json();
  assert.equal(d.channel, 'telegram');

  await post(`/api/destinations/${d.id}`, { enabled: false }, {}, 'PATCH');
  let state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.destinations.find((x) => x.id === d.id).enabled, false);

  await post(`/api/destinations/${d.id}`, {}, {}, 'DELETE');
  state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.destinations.find((x) => x.id === d.id), undefined);
});

test('o token do Telegram nunca volta para o painel', async () => {
  await post('/api/config', { telegramToken: '123:SEGREDO' });
  const state = await (await fetch(base + '/api/state')).json();
  assert.equal(state.config.telegramTokenSet, true);
  assert.ok(!JSON.stringify(state).includes('SEGREDO'));
  // salvar com campo vazio mantém o token
  await post('/api/config', { telegramToken: '', amazonTag: 'x-20' });
  assert.equal(db.getConfig().telegramToken, '123:SEGREDO');
});

test('teste do Telegram devolve o erro de forma amigável', async () => {
  const r = await post('/api/telegram/test', {});
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Token/);
});
