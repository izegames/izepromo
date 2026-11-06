import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAffiliate,
  buildMessage,
  buildTelegramMessage,
  cleanText,
  dedupeKey,
  detectStore,
  isShortLink,
  parseMoney,
} from '../src/format.js';

test('parseMoney aceita os formatos brasileiros e internacionais', () => {
  assert.equal(parseMoney('1.299,90'), 1299.9);
  assert.equal(parseMoney('R$ 1.299,90'), 1299.9);
  assert.equal(parseMoney('1299,90'), 1299.9);
  assert.equal(parseMoney('1299.90'), 1299.9);
  assert.equal(parseMoney('12,5'), 12.5);
  assert.equal(parseMoney('12.5'), 12.5);
  assert.equal(parseMoney('1.299'), 1299);
  assert.equal(parseMoney('1,299.90'), 1299.9);
  assert.equal(parseMoney(49.9), 49.9);
});

test('parseMoney rejeita valores inválidos', () => {
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney(null), null);
  assert.equal(parseMoney('abc'), null);
  assert.equal(parseMoney('0'), null);
  assert.equal(parseMoney('-5'), null);
});

test('detectStore reconhece as lojas e links curtos', () => {
  assert.equal(detectStore('https://www.amazon.com.br/dp/B0ABCDEFGH').name, 'Amazon');
  assert.equal(detectStore('https://amzn.to/abc').name, 'Amazon');
  assert.equal(detectStore('https://produto.mercadolivre.com.br/MLB-123456789-x').name, 'Mercado Livre');
  assert.equal(detectStore('https://shope.ee/abc').name, 'Shopee');
  assert.equal(detectStore('https://pt.aliexpress.com/item/1005001.html').name, 'AliExpress');
  assert.equal(detectStore('https://amazon.com.evil.xyz/dp/B0ABCDEFGH'), null);
  assert.equal(detectStore('não é url'), null);
});

test('isShortLink', () => {
  assert.ok(isShortLink('https://amzn.to/3abc'));
  assert.ok(isShortLink('https://meli.la/abc'));
  assert.ok(!isShortLink('https://www.amazon.com.br/dp/B0ABCDEFGH'));
});

test('applyAffiliate coloca a tag só em links completos da Amazon', () => {
  const out = applyAffiliate('https://www.amazon.com.br/dp/B0ABCDEFGH?tag=outro-20&x=1', 'meu-20');
  assert.equal(new URL(out).searchParams.get('tag'), 'meu-20');
  assert.equal(applyAffiliate('https://amzn.to/abc', 'meu-20'), 'https://amzn.to/abc');
  assert.equal(applyAffiliate('https://shope.ee/abc', 'meu-20'), 'https://shope.ee/abc');
  assert.equal(applyAffiliate('https://www.amazon.com.br/dp/B0ABCDEFGH', ''), 'https://www.amazon.com.br/dp/B0ABCDEFGH');
});

test('dedupeKey junta links diferentes do mesmo produto', () => {
  assert.equal(
    dedupeKey('https://www.amazon.com.br/Nome-Do-Produto/dp/B0ABCDEFGH?tag=a-20'),
    dedupeKey('https://www.amazon.com.br/dp/B0ABCDEFGH/ref=x'),
  );
  assert.equal(
    dedupeKey('https://produto.mercadolivre.com.br/MLB-3456789012-fone-bluetooth-_JM'),
    dedupeKey('https://www.mercadolivre.com.br/fone/p/MLB3456789012?x=1'),
  );
  assert.equal(
    dedupeKey('https://shopee.com.br/Produto-i.123.456789?sp=1'),
    dedupeKey('https://shopee.com.br/outro-nome-i.123.456789'),
  );
  assert.equal(
    dedupeKey('https://pt.aliexpress.com/item/1005001234.html?spm=a'),
    dedupeKey('https://www.aliexpress.com/item/1005001234.html'),
  );
  assert.notEqual(dedupeKey('https://www.amazon.com.br/dp/B0ABCDEFGH'), dedupeKey('https://www.amazon.com.br/dp/B0ZZZZZZZZ'));
});

test('cleanText tira marcadores de formatação do WhatsApp', () => {
  assert.equal(cleanText('Fone *Pro* ~novo~ `x`'), 'Fone Pro novo x');
  assert.equal(cleanText('_Super_ oferta'), 'Super oferta');
  assert.equal(cleanText('cabo_usb_c ok'), 'cabo_usb_c ok');
  assert.equal(cleanText('  muitos   espaços '), 'muitos espaços');
});

const offer = {
  title: 'Fone *Bluetooth* <Pro>',
  url: 'https://www.amazon.com.br/dp/B0ABCDEFGH?tag=x-20',
  price: '1.299,90',
  oldPrice: '1.999,90',
  coupon: 'PROMO10',
  note: 'frete grátis',
};

test('buildMessage monta o texto do WhatsApp com preço no formato brasileiro', () => {
  const msg = buildMessage(offer);
  assert.match(msg, /🔥 \*Fone Bluetooth <Pro>\*/);
  assert.match(msg, /De ~R\$\s1\.999,90~ por \*R\$\s1\.299,90\* \(35% OFF\)/);
  assert.match(msg, /Cupom: \*PROMO10\*/);
  assert.match(msg, /Amazon/);
});

test('buildMessage sem preço antigo maior mostra só o preço', () => {
  const msg = buildMessage({ ...offer, oldPrice: '1.000,00' });
  assert.match(msg, /Por \*R\$\s1\.299,90\*/);
  assert.doesNotMatch(msg, /OFF/);
});

test('buildTelegramMessage usa HTML e escapa o conteúdo', () => {
  const msg = buildTelegramMessage(offer);
  assert.match(msg, /<b>Fone Bluetooth &lt;Pro&gt;<\/b>/);
  assert.match(msg, /<s>R\$\s1\.999,90<\/s>/);
  assert.match(msg, /<a href="https:\/\/www\.amazon\.com\.br\/dp\/B0ABCDEFGH\?tag=x-20">Ver oferta<\/a>/);
});
