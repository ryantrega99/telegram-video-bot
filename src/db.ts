import Database from 'better-sqlite3';
import { format } from 'date-fns';

const db = new Database('bot.db');

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    telegram_id TEXT UNIQUE,
    daily_count INTEGER DEFAULT 0,
    last_reset TEXT
  );

  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT,
    job_id TEXT,
    status TEXT,
    model TEXT,
    prompt TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export interface User {
  id: number;
  telegram_id: string;
  daily_count: number;
  last_reset: string;
}

export function getUser(telegramId: string): User {
  const today = format(new Date(), 'yyyy-MM-dd');
  let user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as User | undefined;

  if (!user) {
    db.prepare('INSERT INTO users (telegram_id, daily_count, last_reset) VALUES (?, 0, ?)').run(telegramId, today);
    user = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as User;
  } else if (user.last_reset !== today) {
    db.prepare('UPDATE users SET daily_count = 0, last_reset = ? WHERE telegram_id = ?').run(today, telegramId);
    user.daily_count = 0;
    user.last_reset = today;
  }

  return user;
}

export function incrementUserCount(telegramId: string) {
  db.prepare('UPDATE users SET daily_count = daily_count + 1 WHERE telegram_id = ?').run(telegramId);
}

export function saveJob(telegramId: string, jobId: string, model: string, prompt: string) {
  db.prepare('INSERT INTO jobs (telegram_id, job_id, status, model, prompt) VALUES (?, ?, ?, ?, ?)').run(
    telegramId,
    jobId,
    'pending',
    model,
    prompt
  );
}

export default db;
