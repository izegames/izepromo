import './check-node.js';
import { open, close, migrateLegacy, getConfig } from './db.js';
import { createWhatsApp } from './channels/whatsapp.js';
import { createTelegram } from './channels/telegram.js';
import { startServer } from './server.js';
import { createWorker } from './queue.js';

open();
migrateLegacy();

const whatsapp = createWhatsApp();
const telegram = createTelegram(() => getConfig().telegramToken);
const channels = { whatsapp, telegram };

const server = startServer({ channels }, Number(process.env.PORT) || 3000);
const worker = createWorker({ channels });
worker.start();
whatsapp.connect().catch((e) => console.error('Falha ao conectar:', e));

function shutdown() {
  worker.stop();
  server.close();
  close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
