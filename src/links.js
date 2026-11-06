import { isShortLink } from './format.js';

// Segue o redirecionamento de links curtos (amzn.to, meli.la, shope.ee...) só para descobrir o produto
// e gerar a chave de antirrepetição. O link enviado no grupo continua sendo o original (com seu afiliado).
export async function resolveShortLink(url, { fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (!isShortLink(url)) return url;
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; IzePromo/2.0)' },
    });
    res.body?.cancel?.().catch?.(() => {});
    return res.url || url;
  } catch {
    return url;
  }
}
