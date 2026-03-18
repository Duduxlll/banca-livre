import rateLimit from "express-rate-limit";
import crypto from "node:crypto";
import QRCode from "qrcode";

const RL_PUBLIC = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 800,
  standardHeaders: true,
  legacyHeaders: false,
});

function normalizeTwitchName(name) {
  return String(name || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function asInt(v, def = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.trunc(n);
}

function pickRandomUnique(arr, count) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.max(0, Math.min(count, a.length)));
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

function formatPixPhoneForPayload(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55")) return `+${d}`;
  return `+55${d}`;
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

function dayRangeSQL() {
  return {
    start: "date_trunc('day', now())",
    end: "date_trunc('day', now()) + interval '1 day'",
  };
}

export async function ensureGorjetaTables(q) {
  await q(`
    CREATE TABLE IF NOT EXISTS gorjeta_rounds (
      id TEXT PRIMARY KEY,
      is_open BOOLEAN NOT NULL DEFAULT false,
      total_cents INTEGER NOT NULL DEFAULT 0,
      remaining_cents INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ
    )
  `);

  await q(`ALTER TABLE gorjeta_rounds ADD COLUMN IF NOT EXISTS remaining_cents INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await q(`ALTER TABLE gorjeta_rounds ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ`).catch(() => {});

  await q(`
    CREATE TABLE IF NOT EXISTS gorjeta_entries (
      id BIGSERIAL PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES gorjeta_rounds(id) ON DELETE CASCADE,
      twitch_name TEXT NOT NULL,
      twitch_name_lc TEXT NOT NULL,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      source TEXT NOT NULL DEFAULT 'twitch',
      UNIQUE (round_id, twitch_name_lc)
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS gorjeta_batches (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES gorjeta_rounds(id) ON DELETE CASCADE,
      per_winner_cents INTEGER NOT NULL DEFAULT 0,
      winners_count INTEGER NOT NULL DEFAULT 1,
      picked_count INTEGER NOT NULL DEFAULT 0,
      confirmed_count INTEGER NOT NULL DEFAULT 0,
      disqualified_count INTEGER NOT NULL DEFAULT 0,
      spent_cents INTEGER NOT NULL DEFAULT 0,
      remaining_after_cents INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`ALTER TABLE gorjeta_batches ADD COLUMN IF NOT EXISTS picked_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await q(`ALTER TABLE gorjeta_batches ADD COLUMN IF NOT EXISTS confirmed_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await q(`ALTER TABLE gorjeta_batches ADD COLUMN IF NOT EXISTS disqualified_count INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await q(`ALTER TABLE gorjeta_batches ADD COLUMN IF NOT EXISTS spent_cents INTEGER NOT NULL DEFAULT 0`).catch(() => {});
  await q(`ALTER TABLE gorjeta_batches ADD COLUMN IF NOT EXISTS remaining_after_cents INTEGER NOT NULL DEFAULT 0`).catch(() => {});

  await q(`
    CREATE TABLE IF NOT EXISTS gorjeta_batch_results (
      id BIGSERIAL PRIMARY KEY,
      batch_id TEXT NOT NULL REFERENCES gorjeta_batches(id) ON DELETE CASCADE,
      round_id TEXT NOT NULL REFERENCES gorjeta_rounds(id) ON DELETE CASCADE,
      twitch_name TEXT NOT NULL,
      twitch_name_lc TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT,
      valor_cents INTEGER NOT NULL DEFAULT 0,
      pix_type TEXT,
      pix_key TEXT,
      pagamento_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS gorjeta_discord (
      round_id TEXT PRIMARY KEY,
      public_channel_id TEXT,
      public_message_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

export function registerGorjetaRoutes({
  app,
  q,
  requireAppKey,
  requireAuth,
  requireAdmin,
  sseSendAll,
  discordBot,
}) {
  const areaAuth = [requireAuth, requireAdmin];

  app.get("/api/gorjeta/active", ...areaAuth, async (req, res) => {
    const r = await q(`
      SELECT id,
             is_open as "isOpen",
             total_cents as "totalCents",
             remaining_cents as "remainingCents",
             created_at as "createdAt"
        FROM gorjeta_rounds
       WHERE is_open=true
       ORDER BY created_at DESC
       LIMIT 1
    `);
    if (!r.rows.length) return res.json({ isOpen: false });
    res.json({ isOpen: true, round: r.rows[0] });
  });

  app.post("/api/gorjeta/rounds", ...areaAuth, async (req, res) => {
    const totalCents = asInt(req.body?.totalCents, 0);
    if (totalCents <= 0) return res.status(400).json({ error: "valores_invalidos" });

    const openExisting = await q(`SELECT id FROM gorjeta_rounds WHERE is_open=true LIMIT 1`);
    if (openExisting.rows.length) return res.status(400).json({ error: "ja_existe_rodada_aberta" });

    const id = crypto.randomUUID();
    await q(
      `INSERT INTO gorjeta_rounds (id, is_open, total_cents, remaining_cents)
       VALUES ($1, true, $2, $2)`,
      [id, totalCents]
    );

    sseSendAll?.("gorjeta-changed", { reason: "create-open", id });
    res.json({ ok: true, id });
  });

  app.post("/api/gorjeta/rounds/:id/close", ...areaAuth, async (req, res) => {
    await q(
      `UPDATE gorjeta_rounds
          SET is_open=false,
              closed_at=now(),
              updated_at=now()
        WHERE id=$1`,
      [req.params.id]
    );

    try {
      await discordBot?.clearGorjetaSorteioMessages?.();
    } catch {}

    sseSendAll?.("gorjeta-changed", { reason: "close", id: req.params.id });
    res.json({ ok: true });
  });

  app.get("/api/gorjeta/rounds/:id/entries", ...areaAuth, async (req, res) => {
    const { rows } = await q(
      `SELECT
         e.twitch_name as "twitchName",
         e.joined_at as "joinedAt",
         e.source,
         CASE
           WHEN EXISTS (
             SELECT 1
               FROM cashback_submissions cs
              WHERE cs.twitch_name_lc = e.twitch_name_lc
                AND upper(cs.status) = 'APROVADO'
           ) OR EXISTS (
             SELECT 1
               FROM cashbacks cb
              WHERE lower(cb.twitch_nick) = e.twitch_name_lc
                AND lower(cb.status) = 'aprovado'
           )
           THEN 'APROVADO'
           ELSE 'NAO_APROVADO'
         END as "approvalStatus"
       FROM gorjeta_entries e
      WHERE e.round_id = $1
      ORDER BY e.joined_at ASC`,
      [req.params.id]
    );

    res.json(rows);
  });

  app.get("/api/gorjeta/rounds/:id/batches", ...areaAuth, async (req, res) => {
    const { rows } = await q(
      `SELECT id,
              per_winner_cents as "perWinnerCents",
              winners_count as "winnersCount",
              picked_count as "pickedCount",
              confirmed_count as "confirmedCount",
              disqualified_count as "disqualifiedCount",
              spent_cents as "spentCents",
              remaining_after_cents as "remainingAfterCents",
              created_at as "createdAt"
         FROM gorjeta_batches
        WHERE round_id = $1
        ORDER BY created_at DESC
        LIMIT 30`,
      [req.params.id]
    );
    res.json(rows);
  });

  app.get("/api/gorjeta/batches/:batchId/results", ...areaAuth, async (req, res) => {
    const { rows } = await q(
      `SELECT twitch_name as "twitchName",
              status,
              reason,
              valor_cents as "valorCents",
              pagamento_id as "pagamentoId",
              created_at as "createdAt"
         FROM gorjeta_batch_results
        WHERE batch_id = $1
        ORDER BY id ASC`,
      [req.params.batchId]
    );
    res.json(rows);
  });

  async function discordUpsertPublic(roundId, text) {
    const publicChannelId = String(process.env.DISCORD_GORJETA_PUBLIC_CHANNEL_ID || "").trim();
    if (!publicChannelId || !discordBot?.client) return;

    const ch = await discordBot.client.channels.fetch(publicChannelId).catch(() => null);
    if (!ch) return;

    const prev = await q(`SELECT public_message_id as mid FROM gorjeta_discord WHERE round_id=$1`, [roundId]);
    const mid = prev.rows[0]?.mid || null;

    if (!mid) {
      const msg = await ch.send({ content: text }).catch(() => null);
      if (!msg) return;
      await q(
        `INSERT INTO gorjeta_discord (round_id, public_channel_id, public_message_id, updated_at)
         VALUES ($1,$2,$3,now())
         ON CONFLICT (round_id) DO UPDATE SET public_channel_id=$2, public_message_id=$3, updated_at=now()`,
        [roundId, publicChannelId, String(msg.id)]
      );
      return;
    }

    const msg = await ch.messages.fetch(mid).catch(() => null);
    if (!msg) {
      const msg2 = await ch.send({ content: text }).catch(() => null);
      if (!msg2) return;
      await q(
        `UPDATE gorjeta_discord SET public_channel_id=$2, public_message_id=$3, updated_at=now() WHERE round_id=$1`,
        [roundId, publicChannelId, String(msg2.id)]
      );
      return;
    }

    await msg.edit({ content: text }).catch(() => null);
    await q(`UPDATE gorjeta_discord SET updated_at=now() WHERE round_id=$1`, [roundId]);
  }

  app.post("/api/gorjeta/join", RL_PUBLIC, requireAppKey, async (req, res) => {
    const user = normalizeTwitchName(req.body?.user || req.body?.twitch || "");
    if (!user) return res.status(400).json({ error: "user_invalido" });

    const r = await q(`SELECT id, total_cents, remaining_cents FROM gorjeta_rounds WHERE is_open=true ORDER BY created_at DESC LIMIT 1`);
    if (!r.rows.length) return res.status(400).json({ error: "rodada_fechada" });

    const roundId = r.rows[0].id;

    const ins = await q(
      `INSERT INTO gorjeta_entries (round_id, twitch_name, twitch_name_lc, source)
       VALUES ($1,$2,$3,'twitch')
       ON CONFLICT (round_id, twitch_name_lc) DO NOTHING
       RETURNING id`,
      [roundId, user, user]
    );

    const alreadyJoined = !ins.rows.length;

    if (!alreadyJoined) {
      try {
        const c = await q(`SELECT COUNT(*)::int as n FROM gorjeta_entries WHERE round_id=$1`, [roundId]);
        const total = Number(r.rows[0].total_cents || 0);
        const rem = Number(r.rows[0].remaining_cents || 0);
        const n = c.rows[0]?.n || 0;
        const text = `🎁 **GORJETA ABERTA**\nRodada: \`${roundId}\`\nSaldo: R$ ${(rem / 100).toFixed(2)} / Total: R$ ${(total / 100).toFixed(2)}\nParticipantes: **${n}**\nPara entrar: \`!gorjeta\``;
        await discordUpsertPublic(roundId, text);
      } catch {}
    }

    res.json({ ok: true, roundId, alreadyJoined });
  });

  app.get("/api/gorjeta/status", RL_PUBLIC, requireAppKey, async (req, res) => {
    const r = await q(`SELECT id, total_cents, remaining_cents FROM gorjeta_rounds WHERE is_open=true ORDER BY created_at DESC LIMIT 1`);
    if (!r.rows.length) return res.json({ isOpen: false });

    const roundId = r.rows[0].id;
    const c = await q(`SELECT COUNT(*)::int as n FROM gorjeta_entries WHERE round_id=$1`, [roundId]);

    res.json({
      isOpen: true,
      roundId,
      participants: c.rows[0]?.n || 0,
      totalCents: Number(r.rows[0].total_cents || 0),
      remainingCents: Number(r.rows[0].remaining_cents || 0),
    });
  });

  app.post("/api/gorjeta/rounds/:id/draw", ...areaAuth, async (req, res) => {
    const roundId = req.params.id;
    const perWinnerCents = asInt(req.body?.perWinnerCents, 0);
    const winnersCountReq = Math.max(1, asInt(req.body?.winnersCount, 1));

    if (perWinnerCents <= 0) return res.status(400).json({ error: "valores_invalidos" });

    const roundQ = await q(`SELECT id, is_open, total_cents, remaining_cents FROM gorjeta_rounds WHERE id=$1`, [roundId]);
    if (!roundQ.rows.length) return res.status(404).json({ error: "not_found" });

    const round = roundQ.rows[0];
    if (!round.is_open) return res.status(400).json({ error: "rodada_fechada" });

    const remaining = Number(round.remaining_cents || 0);
    if (remaining <= 0) return res.status(400).json({ error: "saldo_zerado" });

    const maxAffordable = Math.max(1, Math.floor(remaining / perWinnerCents));
    const winnersCount = Math.min(winnersCountReq, maxAffordable);

    const entriesQ = await q(
      `SELECT
         e.twitch_name,
         e.twitch_name_lc,
         COALESCE(cs.pix_type, cb.pix_type) AS pix_type,
         COALESCE(
           NULLIF(TRIM(cs.pix_key), ''),
           NULLIF(TRIM(cb.pix_key), '')
         ) AS pix_key,
         CASE
           WHEN UPPER(COALESCE(cs.status, '')) = 'APROVADO' THEN true
           WHEN LOWER(COALESCE(cb.status, '')) = 'aprovado' THEN true
           ELSE false
         END AS is_approved
       FROM gorjeta_entries e
       LEFT JOIN LATERAL (
         SELECT twitch_name_lc, pix_type, pix_key, status, updated_at, created_at
           FROM cashback_submissions
          WHERE twitch_name_lc = e.twitch_name_lc
          ORDER BY updated_at DESC NULLS LAST, created_at DESC
          LIMIT 1
       ) cs ON true
       LEFT JOIN LATERAL (
         SELECT twitch_nick, pix_type, pix_key, status, updated_at, created_at
           FROM cashbacks
          WHERE lower(twitch_nick) = e.twitch_name_lc
          ORDER BY updated_at DESC NULLS LAST, created_at DESC
          LIMIT 1
       ) cb ON true
       WHERE e.round_id = $1`,
      [roundId]
    );

    const entries = entriesQ.rows;
    if (!entries.length) return res.status(400).json({ error: "sem_participantes" });

    const chosen = pickRandomUnique(entries, winnersCount);
    const batchId = crypto.randomUUID();

    const confirmed = [];
    const disqualified = [];

    await q("BEGIN");
    try {
      await q(
        `INSERT INTO gorjeta_batches
           (id, round_id, per_winner_cents, winners_count, picked_count, confirmed_count, disqualified_count, spent_cents, remaining_after_cents)
         VALUES ($1,$2,$3,$4,$5,0,0,0,$6)`,
        [batchId, roundId, perWinnerCents, winnersCountReq, chosen.length, remaining]
      );

      for (const e of chosen) {
        const nick = e.twitch_name;
        const nickLc = e.twitch_name_lc;
        const pixKey = String(e.pix_key || "").trim();
        const pixType = String(e.pix_type || "").trim() || null;

        const addResult = async (status, reason = null, pixTypeValue = null, pixKeyValue = null, pagamentoId = null) => {
          await q(
            `INSERT INTO gorjeta_batch_results
               (batch_id, round_id, twitch_name, twitch_name_lc, status, reason, valor_cents, pix_type, pix_key, pagamento_id)
             VALUES
               ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
              batchId,
              roundId,
              nick,
              nickLc,
              status,
              reason,
              perWinnerCents,
              pixTypeValue,
              pixKeyValue,
              pagamentoId,
            ]
          );
        };

        if (!e.is_approved || !pixKey) {
          const reason = !e.is_approved ? "não aprovado" : "sem Pix cadastrado";
          await addResult("DESCLASSIFICADO", reason);
          disqualified.push({
            twitchName: nick,
            reason,
            valorCents: perWinnerCents,
          });
          continue;
        }

        const pagamentoId = crypto.randomUUID();
        const message = `Gorjeta • Rodada ${roundId}`;

        await q(
          `INSERT INTO pagamentos (id, nome, pagamento_cents, pix_type, pix_key, message, status, created_at, paid_at)
           VALUES ($1,$2,$3,$4,$5,$6,'nao_pago', now(), null)`,
          [pagamentoId, nick, perWinnerCents, pixType, pixKey, message]
        );

        await addResult("CONFIRMADO", null, pixType, pixKey, pagamentoId);
        confirmed.push({
          twitchName: nick,
          valorCents: perWinnerCents,
          pagamentoId,
          pixType,
          pixKey,
        });
      }

      const spentCents = confirmed.length * perWinnerCents;
      const newRemaining = Math.max(0, remaining - spentCents);

      await q(
        `UPDATE gorjeta_batches
            SET confirmed_count=$2,
                disqualified_count=$3,
                spent_cents=$4,
                remaining_after_cents=$5
          WHERE id=$1`,
        [batchId, confirmed.length, disqualified.length, spentCents, newRemaining]
      );

      await q(`UPDATE gorjeta_rounds SET remaining_cents=$2, updated_at=now() WHERE id=$1`, [roundId, newRemaining]);

      if (newRemaining <= 0) {
        await q(`UPDATE gorjeta_rounds SET is_open=false, closed_at=now(), updated_at=now() WHERE id=$1`, [roundId]);
      }

      await q("COMMIT");

      sseSendAll?.("gorjeta-changed", { reason: "draw", id: roundId, batchId });

      try {
        const publicChannelId = String(process.env.DISCORD_GORJETA_PUBLIC_CHANNEL_ID || "").trim();
        const payChannelId = String(process.env.DISCORD_GORJETA_PAGAMENTOS_CHANNEL_ID || "").trim();

        const fmtBRL = (c) =>
          (Number(c || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

        if (discordBot?.client && publicChannelId) {
          const ch = await discordBot.client.channels.fetch(publicChannelId).catch(() => null);
          if (ch) {
            const text =
              `🎁 **GORJETA — SORTEIO**\nRodada: \`${roundId}\` • Lote: \`${batchId}\`\n` +
              `Por ganhador: ${fmtBRL(perWinnerCents)} • Pedidos: ${winnersCountReq}\n` +
              `Confirmados: **${confirmed.length}** • Desclassificados: **${disqualified.length}**\n` +
              `Gasto: ${fmtBRL(spentCents)} • Saldo: ${fmtBRL(newRemaining)}`;
            await ch.send({ content: text }).catch(() => null);
          }
        }

        if (discordBot?.client && payChannelId) {
          const ch = await discordBot.client.channels.fetch(payChannelId).catch(() => null);
          if (ch) {
            for (const w of confirmed) {
              const payload = buildPixBRCode({
                chave: w.pixKey,
                tipo: w.pixType,
                valorCents: w.valorCents,
                nome: w.twitchName,
                cidade: "BRASILIA",
                txid: "***",
              });

              const png = await QRCode.toBuffer(payload, { width: 360, margin: 1 });

              await ch.send({
                content:
                  `💸 **Gorjeta aprovada**\n` +
                  `Nick: **${w.twitchName}**\n` +
                  `Valor: **${fmtBRL(w.valorCents)}**\n` +
                  `Pagamento ID: \`${w.pagamentoId}\`\n` +
                  `PIX copia e cola:\n\`\`\`\n${payload}\n\`\`\``,
                files: [{ attachment: png, name: `gorjeta-${w.twitchName}.png` }],
              }).catch(() => null);
            }
          }
        }
      } catch {}

      return res.json({
        ok: true,
        batchId,
        picked: chosen.length,
        confirmedCount: confirmed.length,
        disqualifiedCount: disqualified.length,
        spentCents,
        remainingCents: newRemaining,
        confirmed,
        disqualified,
      });
    } catch (e) {
      await q("ROLLBACK");
      console.error("gorjeta draw:", e);
      return res.status(500).json({ error: "draw_failed" });
    }
  });
}