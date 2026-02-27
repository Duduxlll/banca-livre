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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function startSorteioSync(bot) {
  let lastOpen = null;
  let lastStamp = '';

  while (true) {
    try {
      const { rows } = await q(`
        SELECT is_open, updated_at
        FROM sorteio_state
        WHERE id = 1
        LIMIT 1
      `);

      const row = rows?.[0];
      if (row) {
        const open = !!row.is_open;
        const stamp = row.updated_at ? new Date(row.updated_at).toISOString() : '';

        if (open !== lastOpen || stamp !== lastStamp) {
          lastOpen = open;
          lastStamp = stamp;

          await bot.updateSorteioMessage(open);
          console.log(`🔄 Sorteio sincronizado no Discord: ${open ? 'ABERTO' : 'FECHADO'}`);
        }
      }
    } catch (err) {
      console.error('❌ Falha na sincronização do sorteio:', err?.message || err);
    }

    await sleep(3000);
  }
}

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

  await startSorteioSync(bot);
}

main().catch((err) => {
  console.error('❌ Falha ao iniciar worker do Discord:', err?.message || err);
  process.exit(1);
});