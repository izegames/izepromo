import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Raiz do projeto, independente de onde o `npm start` foi chamado.
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = process.env.IZEPROMO_DATA ? path.resolve(process.env.IZEPROMO_DATA) : path.join(ROOT, 'data');
export const AUTH_DIR = path.join(ROOT, 'auth');
export const PUBLIC_DIR = path.join(ROOT, 'public');
