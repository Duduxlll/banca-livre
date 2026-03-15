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

let bot = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function TLV(id, value) {
  const v = String(value ?? "");
  const len = String(v.length).padStart(2, "0");
  return `${id}${len}${v}`;
}

function crc16_ccitt(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) crc = (crc << 1) ^ 0x1021;
      else crc <<= 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function toASCIIUpper(s = "") {
  return String(s || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^A-Za-z0-9 .-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function cleanPixKey(key) {
  return String(key || "").trim();
}

function formatPixPhoneForPayload(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (!d.startsWith("55")) {
    if (d.length >= 10 && d.length <= 11) d = "55" + d;
  }
  return "+" + d;
}

function buildPixBRCode({ chave, valorCents, nome, cidade = "BRASILIA", txid = "***", tipo = null }) {
  let chaveOK;

  if (tipo === "phone") {
    chaveOK = formatPixPhoneForPayload(chave);
  } else if (tipo === "cpf") {
    chaveOK = String(chave || "").replace(/\D/g, "");
  } else {
    chaveOK = cleanPixKey(chave);
  }

  const nomeOK = toASCIIUpper(nome || "RECEBEDOR").slice(0, 25) || "RECEBEDOR";
  const cidadeOK = toASCIIUpper(cidade || "BRASILIA").slice(0, 15) || "BRASILIA";

  const txidOK =
    txid === "***"
      ? "***"
      : String(txid).replace(/[^A-Za-z0-9.-]/g, "").slice(0, 25) || "***";

  const mai = TLV("26", TLV("00", "br.gov.bcb.pix") + TLV("01", String(chaveOK)));

  const payloadSemCRC =
    TLV("00", "01") +
    TLV("01", "11") +
    mai +
    TLV("52", "0000") +
    TLV("53", "986") +
    TLV("54", (Number(valorCents || 0) / 100).toFixed(2)) +
    TLV("58", "BR") +
    TLV("59", nomeOK) +
    TLV("60", cidadeOK) +
    TLV("62", TLV("05", txidOK)) +
    "6304";

  const crc = crc16_ccitt(payloadSemCRC);
  return payloadSemCRC + crc;
}

const fmtBRL = (c) => (Number(c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const shortId = (id) => (id ? String(id).slice(0, 6) + "…" : "—");

function buildGorjetaStatusEmbed({ isOpen, roundId, totalCents, remainingCents, participants, last3 }) {
  if (!isOpen) {
    return {
      title: "🎁 Gorjeta",
      description: "Status: **FECHADA**\nA gorjeta está temporariamente fechada.",
      fields: [
        { name: "Como entrar", value: "Quando abrir: `!gorjeta`", inline: false },
      ],
    };
  }

  const last3Text = last3?.length ? last3.map(n => `• ${n}`).join("\n") : "—";

  return {
    title: "🎁 Gorjeta",
    description: `Status: **ABERTA** • Rodada **${shortId(roundId)}**`,
    fields: [
      { name: "Saldo", value: `**${fmtBRL(remainingCents)}**`, inline: true },
      { name: "Total", value: fmtBRL(totalCents), inline: true },
      { name: "Participantes", value: String(participants || 0), inline: true },
      { name: "Últimos 3", value: last3Text, inline: false },
      { name: "Entrar", value: "`!gorjeta`", inline: true },
    ],
  };
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

async function startGorjetaSync(bot) {
  let lastStatusSig = "";
  let lastBatchId = null;

  while (true) {
    try {
      const rr = await q(`
        SELECT id, total_cents, remaining_cents
          FROM gorjeta_rounds
         WHERE is_open=true
         ORDER BY created_at DESC
         LIMIT 1
      `);

      const round = rr?.rows?.[0] || null;

      if (!round) {
  const sig = "closed";
  if (sig !== lastStatusSig) {
    lastStatusSig = sig;

    await bot.clearGorjetaBatchSummaries().catch(() => {});

    const embed = buildGorjetaStatusEmbed({ isOpen: false });
    await bot.ensureGorjetaPublicMessage("gorjeta-main", {
      embeds: [embed],
      components: []
    });
  }

  lastBatchId = null;
  await sleep(3000);
  continue;
}

      const roundId = String(round.id);

      const cc = await q(`SELECT COUNT(*)::int AS n FROM gorjeta_entries WHERE round_id=$1`, [roundId]);
      const participants = cc?.rows?.[0]?.n || 0;

      const lastQ = await q(
        `SELECT twitch_name
           FROM gorjeta_entries
          WHERE round_id=$1
          ORDER BY joined_at DESC
          LIMIT 3`,
        [roundId]
      );
      const last3 = (lastQ?.rows || []).map(r => String(r.twitch_name || "").trim()).filter(Boolean);

      const statusSig = `open:${roundId}:${round.total_cents}:${round.remaining_cents}:${participants}:${last3.join(",")}`;
      if (statusSig !== lastStatusSig) {
        lastStatusSig = statusSig;

        const embed = buildGorjetaStatusEmbed({
          isOpen: true,
          roundId,
          totalCents: Number(round.total_cents || 0),
          remainingCents: Number(round.remaining_cents || 0),
          participants,
          last3
        });

        await bot.ensureGorjetaPublicMessage("gorjeta-main", {
          embeds: [embed],
          components: [
            {
              type: 1,
              components: [
                {
                  type: 2,
                  style: 2,
                  label: "Ver mais",
                  custom_id: `gorjeta_ver_mais:${roundId}`
                }
              ]
            }
          ]
        });
      }

      const bb = await q(`
        SELECT id, per_winner_cents, winners_count, confirmed_count, disqualified_count, spent_cents, remaining_after_cents
          FROM gorjeta_batches
         WHERE round_id=$1
         ORDER BY created_at DESC
         LIMIT 1
      `, [roundId]);

      const batch = bb?.rows?.[0] || null;
      if (batch) {
  const batchId = String(batch.id);

  if (batchId !== lastBatchId) {
    lastBatchId = batchId;

    const rr = await q(`
      SELECT twitch_name, status, reason, valor_cents, pix_type, pix_key, pagamento_id
        FROM gorjeta_batch_results
       WHERE batch_id=$1
       ORDER BY id ASC
    `, [batchId]);

    const resultados = (rr?.rows || []).map(row => ({
      twitch_name: row.twitch_name,
      status: row.status,
      reason: row.reason,
      valor_cents: row.valor_cents,
      pix_type: row.pix_type,
      pix_key: row.pix_key,
      pagamento_id: row.pagamento_id
    }));

    await bot.sendGorjetaBatchSummary({
      roundId,
      batchId,
      perWinnerCents: Number(batch.per_winner_cents || 0),
      winnersCountReq: Number(batch.winners_count || 1),
      confirmedCount: Number(batch.confirmed_count || 0),
      disqCount: Number(batch.disqualified_count || 0),
      spentCents: Number(batch.spent_cents || 0),
      remainingCents: Number(batch.remaining_after_cents || 0),
      results: resultados
    });

    const confirmados = resultados
      .filter(row => String(row.status || "").toUpperCase() === "CONFIRMADO" && String(row.pix_key || "").trim())
      .map(row => {
        const payload = buildPixBRCode({
          chave: row.pix_key,
          tipo: row.pix_type || null,
          valorCents: row.valor_cents,
          nome: row.twitch_name,
          cidade: "BRASILIA",
          txid: "***"
        });

        return {
          twitch_name: row.twitch_name,
          valor_cents: row.valor_cents,
          pix_type: row.pix_type,
          pix_key: row.pix_key,
          pagamento_id: row.pagamento_id,
          pix_payload: payload
        };
      });

    await bot.sendGorjetaPaymentsQR(confirmados);
  }
}
    } catch (err) {
      console.error('❌ Falha na sincronização da gorjeta:', err?.message || err);
    }

    await sleep(3000);
  }
}

async function main() {
  await pool.query('SELECT 1');
  console.log('🗄️ Postgres conectado no worker do Discord');

  bot = initDiscordBot({
    q,
    uid,
    onLog: console,
    sseSendAll
  });

  if (!bot) {
    throw new Error('Discord bot não inicializado');
  }

  startSorteioSync(bot);
  startGorjetaSync(bot);

  console.log("✅ Loops do Discord runner iniciados (sorteio + gorjeta).");
}

async function shutdown(signal) {
  console.log(`🛑 Recebido ${signal}.`);

  try {
    await bot?.client?.destroy?.();
  } catch {}

  try {
    await pool.end();
  } catch {}

  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch((err) => {
  console.error('❌ Falha ao iniciar worker do Discord:', err?.message || err);
  process.exit(1);
});