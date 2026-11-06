import { load } from './store.js';
import { connect } from './whatsapp.js';
import { startServer } from './server.js';
import { startWorker } from './queue.js';

load();
startServer(Number(process.env.PORT) || 3000);
startWorker();
connect().catch((e) => console.error('Falha ao conectar:', e));
