import {
  getConfig,
  setConfig,
  listDestinations,
  nextDue,
  deliveryStatuses,
  recordDelivery,
  countSentDeliveries,
  markSent,
  markFailed,
  registerAttempt,
} from './db.js';

const rand = (min, max) => min + Math.random() * (max - min);

export function intervalMs(config, random = rand) {
  const min = Math.max(1, Number(config.minMinutes) || 3);
  const max = Math.max(min, Number(config.maxMinutes) || 6);
  return random(min, max) * 60 * 1000;
}

// Cria o worker que envia a próxima oferta vencida para todos os destinos ativos.
// `channels` = { whatsapp, telegram }, cada um com isReady() e send(target, offer).
export function createWorker({ channels, now = Date.now, log = console, random = rand }) {
  let sending = false;

  async function tick() {
    if (sending) return;
    const config = getConfig();
    if (config.paused || now() < config.nextSendAt) return;

    const offer = nextDue(now());
    if (!offer) return;

    const destinations = listDestinations().filter((d) => d.enabled);
    if (!destinations.length) return;

    sending = true;
    try {
      const done = deliveryStatuses(offer.id);
      let pending = 0; // canal ainda não conectado: não conta como tentativa
      let failures = 0;
      let sentNow = 0; // entregas feitas neste ciclo
      let lastError = '';

      for (const d of destinations) {
        if (done.get(d.id) === 'sent') continue;
        const channel = channels[d.channel];
        if (!channel || !channel.isReady()) {
          pending++;
          continue;
        }
        try {
          await channel.send(d.target, offer);
          recordDelivery(offer.id, d.id, 'sent');
          sentNow++;
          log.log(`📤 Enviado (${d.channel}${d.name ? ` · ${d.name}` : ''}): ${offer.title}`);
        } catch (err) {
          failures++;
          lastError = `${d.channel}: ${err.message}`;
          recordDelivery(offer.id, d.id, 'failed', err.message);
          log.error(`Erro ao enviar (${d.channel}):`, err.message);
        }
      }

      const sentCount = countSentDeliveries(offer.id);

      if (!failures && !pending) {
        markSent(offer.id);
        setConfig({ nextSendAt: now() + intervalMs(config, random) });
        return;
      }

      if (failures) {
        const attempts = registerAttempt(offer.id, lastError);
        if (attempts >= config.maxAttempts) {
          // Desiste para não travar a fila: envio parcial conta como enviado, nenhum envio vira falha.
          if (sentCount) markSent(offer.id, lastError);
          else markFailed(offer.id, lastError);
          log.error(`Desistindo de "${offer.title}" após ${attempts} tentativas.`);
          setConfig({ nextSendAt: now() + (sentCount ? intervalMs(config, random) : 30 * 1000) });
          return;
        }
      }

      // Houve envio em algum destino: respeita o intervalo; senão tenta de novo em 1 min.
      setConfig({ nextSendAt: now() + (sentNow ? intervalMs(config, random) : 60 * 1000) });
    } finally {
      sending = false;
    }
  }

  let timer = null;
  return {
    tick,
    start(everyMs = 10 * 1000) {
      timer = setInterval(() => tick().catch((e) => log.error('Erro no worker:', e.message)), everyMs);
    },
    stop() {
      clearInterval(timer);
    },
  };
}
