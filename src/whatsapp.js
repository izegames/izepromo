import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';

let sock = null;
let ready = false;

export const isReady = () => ready;

export async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
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
      console.log('\nEscaneie o QR Code abaixo no WhatsApp (Aparelhos conectados):\n');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      ready = true;
      console.log('✅ WhatsApp conectado');
    }
    if (connection === 'close') {
      ready = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut) {
        console.log('⚠️ Sessão encerrada. Apague a pasta "auth" e reinicie para ler o QR de novo.');
      } else {
        console.log('Conexão caiu, reconectando em 3s...');
        setTimeout(connect, 3000);
      }
    }
  });
}

export async function listGroups() {
  if (!ready) return [];
  const groups = await sock.groupFetchAllParticipating();
  return Object.values(groups)
    .map((g) => ({ id: g.id, name: g.subject }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function sendOffer(jid, text, imageUrl) {
  if (!ready) throw new Error('WhatsApp não conectado');
  if (imageUrl) {
    await sock.sendMessage(jid, { image: { url: imageUrl }, caption: text });
  } else {
    await sock.sendMessage(jid, { text });
  }
}
