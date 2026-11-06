const STORES = [
  { name: 'Amazon', emoji: '📦', test: /(^|\.)amazon\.com(\.br)?$|(^|\.)amzn\.to$|(^|\.)a\.co$/ },
  { name: 'Mercado Livre', emoji: '🛍️', test: /mercadolivre\.com(\.br)?$|(^|\.)meli\.la$/ },
  { name: 'Shopee', emoji: '🧡', test: /shopee\.com(\.br)?$|(^|\.)shope\.ee$/ },
  { name: 'AliExpress', emoji: '🌏', test: /aliexpress\.com$|(^|\.)s\.click\.aliexpress\.com$/ },
];

export function detectStore(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return STORES.find((s) => s.test.test(host)) || null;
  } catch {
    return null;
  }
}

// Amazon: coloca/substitui a tag de associado. Outras lojas: use o link já gerado no painel de afiliados.
export function applyAffiliate(url, amazonTag) {
  try {
    const u = new URL(url);
    const store = detectStore(url);
    if (store?.name === 'Amazon' && amazonTag && /(^|\.)amazon\.com(\.br)?$/.test(u.hostname)) {
      u.searchParams.set('tag', amazonTag);
      return u.toString();
    }
  } catch {}
  return url;
}

// Links curtos precisam ser seguidos até o destino para gerar a chave de antirrepetição (ver links.js).
export const SHORT_HOSTS = /(^|\.)(amzn\.to|a\.co|meli\.la|shope\.ee|s\.click\.aliexpress\.com)$/;

export function isShortLink(url) {
  try {
    return SHORT_HOSTS.test(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

// Chave para evitar repetir o mesmo produto, mesmo com links diferentes para ele.
export function dedupeKey(url) {
  try {
    const u = new URL(url);
    const asin = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (asin) return `amazon:${asin[1].toUpperCase()}`;
    const ml = u.pathname.match(/\bMLB-?(\d{6,})/i);
    if (ml) return `mercadolivre:MLB${ml[1]}`;
    const shopeeA = u.pathname.match(/-i\.(\d+)\.(\d+)/);
    const shopeeB = u.pathname.match(/\/product\/(\d+)\/(\d+)/);
    const shopee = shopeeA || shopeeB;
    if (shopee && /shopee/i.test(u.hostname)) return `shopee:${shopee[1]}.${shopee[2]}`;
    const ali = u.pathname.match(/\/item\/(\d+)\.html/);
    if (ali && /aliexpress/i.test(u.hostname)) return `aliexpress:${ali[1]}`;
    return `${u.hostname}${u.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return url;
  }
}

// Aceita "1.299,90", "R$ 1299,90", "1299.90", "12,5". Retorna null se não for um número válido.
export function parseMoney(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? input : null;
  let s = String(input).replace(/[R$\s]/gi, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // o separador que aparece por último é o decimal
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    s = s.replace(',', '.');
  } else if (lastDot > -1) {
    // "1.299" (milhar) vs "12.5" (decimal): 3 dígitos depois do ponto = milhar
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Tira os caracteres que o WhatsApp interpreta como formatação (*negrito*, ~tachado~, `código`, _itálico_).
export function cleanText(s) {
  return String(s ?? '')
    .replace(/[*~`]/g, '')
    .replace(/(^|\s)_+/g, '$1')
    .replace(/_+(?=\s|$)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const brl = (n) =>
  'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parts(o) {
  const store = detectStore(o.url);
  const price = parseMoney(o.price);
  const oldPrice = parseMoney(o.oldPrice);
  const off = price && oldPrice && oldPrice > price ? Math.round((1 - price / oldPrice) * 100) : null;
  return {
    title: cleanText(o.title),
    coupon: cleanText(o.coupon),
    note: cleanText(o.note),
    storeName: store?.name || 'Loja',
    emoji: store?.emoji || '🛒',
    price,
    oldPrice: off ? oldPrice : null,
    off,
    url: o.url,
  };
}

// Texto para WhatsApp (*negrito*, ~tachado~, _itálico_)
export function buildMessage(o) {
  const p = parts(o);
  const lines = [`🔥 *${p.title}*`, ''];
  if (p.price) {
    lines.push(
      p.oldPrice
        ? `💰 De ~${brl(p.oldPrice)}~ por *${brl(p.price)}* (${p.off}% OFF)`
        : `💰 Por *${brl(p.price)}*`,
    );
  }
  if (p.coupon) lines.push(`🎟️ Cupom: *${p.coupon}*`);
  if (p.note) lines.push(`📝 ${p.note}`);
  lines.push('', `${p.emoji} ${p.storeName}`, `👉 ${p.url}`, '', '_Preço e estoque podem mudar a qualquer momento._');
  return lines.join('\n');
}

const html = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Texto para Telegram (parse_mode HTML)
export function buildTelegramMessage(o) {
  const p = parts(o);
  const lines = [`🔥 <b>${html(p.title)}</b>`, ''];
  if (p.price) {
    lines.push(
      p.oldPrice
        ? `💰 De <s>${brl(p.oldPrice)}</s> por <b>${brl(p.price)}</b> (${p.off}% OFF)`
        : `💰 Por <b>${brl(p.price)}</b>`,
    );
  }
  if (p.coupon) lines.push(`🎟️ Cupom: <b>${html(p.coupon)}</b>`);
  if (p.note) lines.push(`📝 ${html(p.note)}`);
  lines.push(
    '',
    `${p.emoji} ${html(p.storeName)}`,
    `👉 <a href="${html(p.url).replace(/"/g, '&quot;')}">Ver oferta</a>`,
    '',
    '<i>Preço e estoque podem mudar a qualquer momento.</i>',
  );
  return lines.join('\n');
}
