import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { AUTH_DIR } from '../paths.js';
import { buildMessage } from '../format.js';

export function createWhatsApp({ authDir = AUTH_DIR, log = console } = {}) {
  let sock = null;
  let ready = false;
  let connecting = false;
  let retries = 0;

  function dropSocket() {
    if (!sock) return;
    try {
      sock.ev.removeAllListeners('connection.update');
      sock.ev.removeAllListeners('creds.update');
      sock.end(undefined);
    } catch {}
    sock = null;
  }

  async function connect() {
    if (connecting) return;
    connecting = true;
    try {
      dropSocket(); // evita acumular sockets a cada reconexão
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();

      sock = makeWASocket({
        version,
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['Promo Bot', 'Chrome', '1.0'],
      });

      sock.ev.on('creds.update', saveCreds);
      sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          log.log('\nEscaneie o QR Code abaixo no WhatsApp (Aparelhos conectados):\n');
          qrcode.generate(qr, { small: true });
        }
        if (connection === 'open') {
          ready = true;
          retries = 0;
          log.log('✅ WhatsApp conectado');
        }
        if (connection === 'close') {
          ready = false;
          const code = lastDisconnect?.error?.output?.statusCode;
          if (code === DisconnectReason.loggedOut) {
            log.log('⚠️ Sessão encerrada. Apague a pasta "auth" e reinicie para ler o QR de novo.');
            return;
          }
          const wait = Math.min(30000, 3000 * 2 ** retries++);
          log.log(`Conexão caiu, reconectando em ${Math.round(wait / 1000)}s...`);
          setTimeout(() => connect().catch((e) => log.error('Falha ao reconectar:', e.message)), wait);
        }
      });
    } finally {
      connecting = false;
    }
  }

  async function listGroups() {
    if (!ready) return [];
    const groups = await sock.groupFetchAllParticipating();
    return Object.values(groups)
      .map((g) => ({ id: g.id, name: g.subject }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function send(jid, offer) {
    if (!ready) throw new Error('WhatsApp não conectado');
    const text = buildMessage(offer);
    if (offer.imageUrl) {
      try {
        await sock.sendMessage(jid, { image: { url: offer.imageUrl }, caption: text });
        return;
      } catch (e) {
        log.error(`Imagem falhou (${e.message}); enviando só o texto.`);
      }
    }
    await sock.sendMessage(jid, { text });
  }

  return { name: 'whatsapp', connect, isReady: () => ready, listGroups, send };
}
