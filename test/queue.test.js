import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as db from '../src/db.js';
import { createWorker } from '../src/queue.js';

const silent = { log() {}, error() {} };

function fakeChannel({ ready = true, failWith = null } = {}) {
  const sent = [];
  return {
    sent,
    ready,
    failWith,
    isReady() { return this.ready; },
    async send(target, offer) {
      if (this.failWith) throw new Error(this.failWith);
      sent.push({ target, title: offer.title });
    },
  };
}

let clock;
const now = () => clock;
const fixedRandom = (min) => min; // intervalo = mínimo

function offer(title, extra = {}) {
  return db.addOffer({ key: `k:${title}`, title, url: 'https://shope.ee/x', ...extra });
}

beforeEach(() => {
  db.open(':memory:');
  clock = Date.now();
  db.setConfig({ minMinutes: 3, maxMinutes: 3, maxAttempts: 3 });
});

test('envia a oferta para todos os destinos ativos e respeita o intervalo', async () => {
  const wa = fakeChannel();
  const tg = fakeChannel();
  db.addDestination({ channel: 'whatsapp', target: 'g1@g.us', name: 'G1' });
  db.addDestination({ channel: 'whatsapp', target: 'g2@g.us', name: 'G2' });
  db.addDestination({ channel: 'telegram', target: '@canal', name: '@canal' });
  offer('A');
  offer('B');

  const w = createWorker({ channels: { whatsapp: wa, telegram: tg }, now, log: silent, random: fixedRandom });
  await w.tick();

  assert.equal(wa.sent.length, 2);
  assert.equal(tg.sent.length, 1);
  assert.equal(db.listSent().length, 1);
  assert.equal(db.listQueue().length, 1);

  await w.tick(); // ainda dentro do intervalo
  assert.equal(db.listSent().length, 1);

  clock += 3 * 60 * 1000 + 1;
  await w.tick();
  assert.equal(db.listSent().length, 2);
});

test('destino desativado não recebe', async () => {
  const wa = fakeChannel();
  const d = db.addDestination({ channel: 'whatsapp', target: 'g1@g.us' });
  db.setDestinationEnabled(d.id, false);
  const d2 = db.addDestination({ channel: 'whatsapp', target: 'g2@g.us' });
  offer('A');
  await createWorker({ channels: { whatsapp: wa }, now, log: silent, random: fixedRandom }).tick();
  assert.deepEqual(wa.sent.map((s) => s.target), ['g2@g.us']);
  assert.ok(d2.id);
});

test('oferta agendada só sai no horário', async () => {
  const wa = fakeChannel();
  db.addDestination({ channel: 'whatsapp', target: 'g1@g.us' });
  offer('Futura', { scheduledAt: clock + 60 * 60 * 1000 });
  const w = createWorker({ channels: { whatsapp: wa }, now, log: silent, random: fixedRandom });

  await w.tick();
  assert.equal(wa.sent.length, 0);

  clock += 60 * 60 * 1000 + 1;
  await w.tick();
  assert.equal(wa.sent.length, 1);
});

test('oferta agendada mais cedo passa na frente das sem agendamento', async () => {
  const wa = fakeChannel();
  db.addDestination({ channel: 'whatsapp', target: 'g1@g.us' });
  offer('Normal');
  offer('Agendada', { scheduledAt: clock - 1000 });
  await createWorker({ channels: { whatsapp: wa }, now, log: silent, random: fixedRandom }).tick();
  assert.equal(wa.sent[0].title, 'Agendada');
});

test('um item que sempre falha não trava a fila', async () => {
  const wa = fakeChannel({ failWith: 'imagem inválida' });
  db.addDestination({ channel: 'whatsapp', target: 'g1@g.us' });
  const bad = offer('Quebrada');
  offer('Boa');
  const w = createWorker({ channels: { whatsapp: wa }, now, log: silent, random: fixedRandom });

  for (let i = 0; i < 3; i++) {
    await w.tick();
    clock += 61 * 1000;
  }
  assert.equal(db.getOffer(bad.id).status, 'failed');
  assert.match(db.getOffer(bad.id).lastError, /imagem inválida/);

  wa.failWith = null;
  clock += 60 * 1000;
  await w.tick();
  assert.deepEqual(wa.sent.map((s) => s.title), ['Boa']);
});

test('falha parcial não reenvia para quem já recebeu', async () => {
  const wa = fakeChannel();
  const tg = fakeChannel({ failWith: 'chat not found' });
  db.addDestination({ channel: 'whatsapp', target: 'g1@g.us' });
  db.addDestination({ channel: 'telegram', target: '@x' });
  const o = offer('A');
  const w = createWorker({ channels: { whatsapp: wa, telegram: tg }, now, log: silent, random: fixedRandom });

  await w.tick();
  assert.equal(wa.sent.length, 1);
  assert.equal(db.getOffer(o.id).status, 'queued');

  tg.failWith = null;
  clock += 4 * 60 * 1000;
  await w.tick();
  assert.equal(wa.sent.length, 1, 'WhatsApp não pode receber duas vezes');
  assert.equal(tg.sent.length, 1);
  assert.equal(db.getOffer(o.id).status, 'sent');
});

test('canal desconectado só espera, sem gastar tentativas', async () => {
  const wa = fakeChannel({ ready: false });
  db.addDestination({ channel: 'whatsapp', target: 'g1@g.us' });
  const o = offer('A');
  const w = createWorker({ channels: { whatsapp: wa }, now, log: silent, random: fixedRandom });

  for (let i = 0; i < 5; i++) {
    await w.tick();
    clock += 61 * 1000;
  }
  assert.equal(db.getOffer(o.id).attempts, 0);
  assert.equal(db.getOffer(o.id).status, 'queued');

  wa.ready = true;
  await w.tick();
  assert.equal(db.getOffer(o.id).status, 'sent');
});

test('o horário do próximo envio é salvo no banco', async () => {
  const wa = fakeChannel();
  db.addDestination({ channel: 'whatsapp', target: 'g1@g.us' });
  offer('A');
  await createWorker({ channels: { whatsapp: wa }, now, log: silent, random: fixedRandom }).tick();
  assert.equal(db.getConfig().nextSendAt, clock + 3 * 60 * 1000);
});

test('pausado e sem destinos não enviam', async () => {
  const wa = fakeChannel();
  offer('A');
  const w = createWorker({ channels: { whatsapp: wa }, now, log: silent, random: fixedRandom });
  await w.tick(); // sem destinos
  db.addDestination({ channel: 'whatsapp', target: 'g1@g.us' });
  db.setConfig({ paused: true });
  await w.tick();
  assert.equal(wa.sent.length, 0);
});

test('retryOffer recoloca uma oferta com falha na fila', async () => {
  const wa = fakeChannel({ failWith: 'x' });
  db.addDestination({ channel: 'whatsapp', target: 'g1@g.us' });
  const o = offer('A');
  db.setConfig({ maxAttempts: 1 });
  await createWorker({ channels: { whatsapp: wa }, now, log: silent, random: fixedRandom }).tick();
  assert.equal(db.getOffer(o.id).status, 'failed');
  assert.ok(db.retryOffer(o.id));
  assert.equal(db.getOffer(o.id).status, 'queued');
  assert.equal(db.getOffer(o.id).attempts, 0);
});

test('isDuplicate considera fila e enviados dentro da janela', () => {
  const o = offer('A');
  assert.ok(db.isDuplicate(o.key, 24));
  db.markSent(o.id);
  assert.ok(db.isDuplicate(o.key, 24));
  assert.ok(!db.isDuplicate(o.key, 0));
  assert.ok(!db.isDuplicate('outra-chave', 24));
});

test('migra o db.json da versão anterior', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'izepromo-'));
  fs.writeFileSync(
    path.join(dir, 'db.json'),
    JSON.stringify({
      config: { groupId: '123@g.us', amazonTag: 'meu-20', minMinutes: 2, maxMinutes: 5, dedupeHours: 12, paused: true },
      queue: [{ id: 'q1', key: 'amazon:B0ABCDEFGH', title: 'Item', url: 'https://www.amazon.com.br/dp/B0ABCDEFGH', price: 10, oldPrice: 20, coupon: '', note: '', imageUrl: '', addedAt: 1000 }],
      sent: [{ key: 'amazon:B0ZZZZZZZZ', title: 'Antigo', at: Date.now() }],
    }),
  );
  assert.equal(db.migrateLegacy(dir), true);
  assert.equal(db.getConfig().amazonTag, 'meu-20');
  assert.equal(db.getConfig().paused, true);
  assert.deepEqual(db.listDestinations().map((d) => d.target), ['123@g.us']);
  assert.equal(db.listQueue()[0].title, 'Item');
  assert.ok(db.isDuplicate('amazon:B0ZZZZZZZZ', 24));
  assert.ok(fs.existsSync(path.join(dir, 'db.json.migrado')));
  assert.equal(db.migrateLegacy(dir), false);
});
