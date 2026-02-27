console.log('🚀 discord-runner iniciou');
import 'dotenv/config';
import pg from 'pg';
import crypto from 'node:crypto';
import { initDiscordBot } from './discord-bot.js';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function q(text, params = []) {
  return pool.query(text, params);
}

function uid() {
  return crypto.randomUUID();
}

function sseSendAll() {}

async function main() {
  await pool.query('SELECT 1');
  console.log('🗄️ Postgres conectado no worker do Discord');

  const bot = initDiscordBot({
    q,
    uid,
    onLog: console,
    sseSendAll
  });

  if (!bot) {
    throw new Error('Discord bot não inicializado');
  }
}

main().catch((err) => {
  console.error('❌ Falha ao iniciar worker do Discord:', err?.message || err);
  process.exit(1);
});