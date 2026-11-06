const STORES = [
  { name: 'Amazon', emoji: '📦', test: /(^|\.)amazon\.com(\.br)?$|(^|\.)amzn\.to$/ },
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
    if (store?.name === 'Amazon' && amazonTag && /amazon\.com/.test(u.hostname)) {
      u.searchParams.set('tag', amazonTag);
      return u.toString();
    }
  } catch {}
  return url;
}

// Chave para evitar repetir o mesmo produto
export function dedupeKey(url) {
  try {
    const u = new URL(url);
    const asin = u.pathname.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/i);
    if (asin) return `amazon:${asin[1].toUpperCase()}`;
    return `${u.hostname}${u.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return url;
  }
}

const brl = (n) =>
  'R$ ' + Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildMessage(o) {
  const store = detectStore(o.url);
  const lines = [];
  lines.push(`🔥 *${o.title.trim()}*`);
  lines.push('');

  if (o.price) {
    if (o.oldPrice && Number(o.oldPrice) > Number(o.price)) {
      const off = Math.round((1 - Number(o.price) / Number(o.oldPrice)) * 100);
      lines.push(`💰 De ~${brl(o.oldPrice)}~ por *${brl(o.price)}* (${off}% OFF)`);
    } else {
      lines.push(`💰 Por *${brl(o.price)}*`);
    }
  }
  if (o.coupon) lines.push(`🎟️ Cupom: *${o.coupon.trim()}*`);
  if (o.note) lines.push(`📝 ${o.note.trim()}`);

  lines.push('');
  lines.push(`${store?.emoji || '🛒'} ${store?.name || 'Loja'}`);
  lines.push(`👉 ${o.url}`);
  lines.push('');
  lines.push('_Preço e estoque podem mudar a qualquer momento._');
  return lines.join('\n');
}
