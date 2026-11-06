import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('data');
const FILE = path.join(DIR, 'db.json');

const DEFAULT = {
  config: {
    groupId: '',
    amazonTag: '',
    minMinutes: 3,
    maxMinutes: 6,
    dedupeHours: 24,
    paused: false,
  },
  queue: [],
  sent: [],
};

let db = null;

export function load() {
  fs.mkdirSync(DIR, { recursive: true });
  if (fs.existsSync(FILE)) {
    const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    db = { ...DEFAULT, ...saved, config: { ...DEFAULT.config, ...saved.config } };
  } else {
    db = structuredClone(DEFAULT);
    save();
  }
  return db;
}

export function save() {
  fs.writeFileSync(FILE, JSON.stringify(db, null, 2));
}

export function get() {
  if (!db) load();
  return db;
}
