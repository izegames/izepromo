import { buildTelegramMessage } from '../format.js';

const CAPTION_LIMIT = 1024;

// Canal do Telegram via Bot API oficial (sem dependências).
// `getToken` é uma função para o token poder ser trocado no painel sem reiniciar.
export function createTelegram(getToken, { fetchImpl = fetch, log = console } = {}) {
  async function api(method, body = {}) {
    const token = getToken();
    if (!token) throw new Error('Token do bot do Telegram não configurado');
    let res;
    try {
      res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      throw new Error(`Falha de rede ao falar com o Telegram (${e.name})`);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.description || `Telegram respondeu HTTP ${res.status}`);
    return data.result;
  }

  async function send(chatId, offer) {
    const text = buildTelegramMessage(offer);
    if (offer.imageUrl && text.length <= CAPTION_LIMIT) {
      try {
        await api('sendPhoto', { chat_id: chatId, photo: offer.imageUrl, caption: text, parse_mode: 'HTML' });
        return;
      } catch (e) {
        log.error(`Imagem falhou no Telegram (${e.message}); enviando só o texto.`);
      }
    }
    await api('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' });
  }

  return {
    name: 'telegram',
    isReady: () => Boolean(getToken()),
    send,
    me: () => api('getMe'),
  };
}
