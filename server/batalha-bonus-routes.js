import rateLimit from "express-rate-limit";

const BATTLE_STATUS = {
  DRAFT: "DRAFT",
  REGISTRATION_OPEN: "REGISTRATION_OPEN",
  REGISTRATION_CLOSED: "REGISTRATION_CLOSED",
  CHOICES_OPEN: "CHOICES_OPEN",
  CHOICES_CLOSED: "CHOICES_CLOSED",
  ROUND_RESOLVED: "ROUND_RESOLVED",
  FINISHED: "FINISHED"
};

const ROUND_STATUS = {
  CREATED: "CREATED",
  CHOICES_OPEN: "CHOICES_OPEN",
  CHOICES_CLOSED: "CHOICES_CLOSED",
  RESOLVED: "RESOLVED"
};

const ALLOWED_SLOTS = new Set([8, 16, 32]);

function asInt(v, def = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.trunc(n);
}

function normalizeUser(name) {
  return String(name || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function safeText(v, max = 120) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.slice(0, max);
}

function normalizeCommand(v) {
  let s = String(v || "").trim().toLowerCase();
  if (!s) return "!batalha";
  if (!s.startsWith("!")) s = `!${s}`;
  s = s.replace(/[^a-z0-9!_-]/g, "");
  if (s === "!") s = "!batalha";
  return s.slice(0, 24);
}

function normalizeBonusName(v) {
  return String(v || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

function shuffle(arr) {
  const a = Array.from(arr || []);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function roundLabel(totalPlayers) {
  const n = asInt(totalPlayers, 0);
  if (n === 32) return "Top 32";
  if (n === 16) return "Oitavas";
  if (n === 8) return "Quartas";
  if (n === 4) return "Semifinal";
  if (n === 2) return "Final";
  if (n === 1) return "Campeão";
  return `Top ${n}`;
}

function mapBattleRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    entryCommand: r.entryCommand,
    maxPlayers: Number(r.maxPlayers || 0),
    status: r.status,
    currentRound: Number(r.currentRound || 1),
    currentRoundName: r.currentRoundName || "",
    championPlayerId: r.championPlayerId || null,
    championName: r.championName || null,
    createdAt: r.createdAt,
    finishedAt: r.finishedAt || null
  };
}

function mapPlayerRow(r) {
  return {
    id: r.id,
    battleId: r.battleId,
    twitchName: r.twitchName,
    twitchNameLc: r.twitchNameLc,
    displayName: r.displayName,
    joinOrder: Number(r.joinOrder || 0),
    isActive: !!r.isActive,
    eliminatedRound: r.eliminatedRound == null ? null : Number(r.eliminatedRound),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

function mapMatchRow(r) {
  return {
    id: r.id,
    battleId: r.battleId,
    roundNumber: Number(r.roundNumber || 0),
    roundName: r.roundName || "",
    matchNumber: Number(r.matchNumber || 0),
    playerAId: r.playerAId,
    playerAName: r.playerAName,
    playerADisplay: r.playerADisplay,
    playerBId: r.playerBId,
    playerBName: r.playerBName,
    playerBDisplay: r.playerBDisplay,
    bonusA: r.bonusA || "",
    bonusB: r.bonusB || "",
    valueA: Number(r.valueA || 0),
    valueB: Number(r.valueB || 0),
    winnerPlayerId: r.winnerPlayerId || null,
    winnerName: r.winnerName || null,
    status: r.status,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    resolvedAt: r.resolvedAt || null
  };
}

async function getActiveBattle(q) {
  const { rows } = await q(
    `SELECT
       b.id,
       b.name,
       b.entry_command AS "entryCommand",
       b.max_players AS "maxPlayers",
       b.status,
       b.current_round AS "currentRound",
       b.current_round_name AS "currentRoundName",
       b.champion_player_id AS "championPlayerId",
       cp.twitch_name AS "championName",
       b.created_at AS "createdAt",
       b.finished_at AS "finishedAt"
     FROM bonus_battles b
     LEFT JOIN bonus_battle_players cp ON cp.id = b.champion_player_id
     WHERE b.status <> $1
     ORDER BY b.created_at DESC
     LIMIT 1`,
    [BATTLE_STATUS.FINISHED]
  );
  return mapBattleRow(rows[0]);
}

async function getBattleById(q, battleId) {
  const { rows } = await q(
    `SELECT
       b.id,
       b.name,
       b.entry_command AS "entryCommand",
       b.max_players AS "maxPlayers",
       b.status,
       b.current_round AS "currentRound",
       b.current_round_name AS "currentRoundName",
       b.champion_player_id AS "championPlayerId",
       cp.twitch_name AS "championName",
       b.created_at AS "createdAt",
       b.finished_at AS "finishedAt"
     FROM bonus_battles b
     LEFT JOIN bonus_battle_players cp ON cp.id = b.champion_player_id
     WHERE b.id = $1
     LIMIT 1`,
    [battleId]
  );
  return mapBattleRow(rows[0]);
}

async function getPlayers(q, battleId) {
  const { rows } = await q(
    `SELECT
       id,
       battle_id AS "battleId",
       twitch_name AS "twitchName",
       twitch_name_lc AS "twitchNameLc",
       display_name AS "displayName",
       join_order AS "joinOrder",
       is_active AS "isActive",
       eliminated_round AS "eliminatedRound",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM bonus_battle_players
     WHERE battle_id = $1
     ORDER BY join_order ASC, created_at ASC`,
    [battleId]
  );
  return rows.map(mapPlayerRow);
}

async function getMatches(q, battleId) {
  const { rows } = await q(
    `SELECT
       m.id,
       m.battle_id AS "battleId",
       m.round_number AS "roundNumber",
       m.round_name AS "roundName",
       m.match_number AS "matchNumber",
       m.player_a_id AS "playerAId",
       pa.twitch_name AS "playerAName",
       pa.display_name AS "playerADisplay",
       m.player_b_id AS "playerBId",
       pb.twitch_name AS "playerBName",
       pb.display_name AS "playerBDisplay",
       m.bonus_a AS "bonusA",
       m.bonus_b AS "bonusB",
       m.value_a_cents AS "valueA",
       m.value_b_cents AS "valueB",
       m.winner_player_id AS "winnerPlayerId",
       pw.twitch_name AS "winnerName",
       m.status,
       m.created_at AS "createdAt",
       m.updated_at AS "updatedAt",
       m.resolved_at AS "resolvedAt"
     FROM bonus_battle_matches m
     LEFT JOIN bonus_battle_players pa ON pa.id = m.player_a_id
     LEFT JOIN bonus_battle_players pb ON pb.id = m.player_b_id
     LEFT JOIN bonus_battle_players pw ON pw.id = m.winner_player_id
     WHERE m.battle_id = $1
     ORDER BY m.round_number ASC, m.match_number ASC`,
    [battleId]
  );
  return rows.map(mapMatchRow);
}

async function getCurrentRoundMatches(q, battleId, roundNumber) {
  const all = await getMatches(q, battleId);
  return all.filter((m) => Number(m.roundNumber) === Number(roundNumber));
}

async function buildBattleState(q, battleId) {
  const battle = await getBattleById(q, battleId);
  if (!battle) return null;
  const participants = await getPlayers(q, battleId);
  const matches = await getMatches(q, battleId);
  const currentMatches = matches.filter((m) => Number(m.roundNumber) === Number(battle.currentRound));
  const filled = participants.length;
  const alive = participants.filter((p) => p.isActive).length;
  return {
    battle,
    participants,
    matches,
    currentMatches,
    counts: {
      filled,
      maxPlayers: battle.maxPlayers,
      alive,
      resolvedCurrentMatches: currentMatches.filter((m) => m.status === "RESOLVED").length,
      totalCurrentMatches: currentMatches.length
    }
  };
}

async function syncBattleToSheets(q, battleId) {
  const webhook = String(process.env.BATALHA_BONUS_SHEETS_WEBHOOK || "").trim();
  if (!webhook) return;
  try {
    const state = await buildBattleState(q, battleId);
    if (!state) return;
    const secret = String(process.env.BATALHA_BONUS_SHEETS_SECRET || "").trim();
    await fetch(webhook, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "X-Batalha-Secret": secret } : {})
      },
      body: JSON.stringify(state)
    });
  } catch (e) {
    console.error("batalha-bonus sheets sync:", e?.message || e);
  }
}

async function upsertRound(q, uid, battleId, roundNumber, totalPlayers, status = ROUND_STATUS.CREATED) {
  const roundName = roundLabel(totalPlayers);
  const { rows } = await q(
    `INSERT INTO bonus_battle_rounds (
       id,
       battle_id,
       round_number,
       round_name,
       status,
       opened_at,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, now(), now(), now())
     ON CONFLICT (battle_id, round_number)
     DO UPDATE SET
       round_name = EXCLUDED.round_name,
       status = EXCLUDED.status,
       updated_at = now()
     RETURNING id, round_name AS "roundName"`,
    [uid(), battleId, roundNumber, roundName, status]
  );
  return rows[0] || { roundName };
}

async function createMatchesForRound(q, uid, battleId, roundNumber, playerIds) {
  const shuffled = shuffle(playerIds);
  const totalPlayers = shuffled.length;
  const round = await upsertRound(q, uid, battleId, roundNumber, totalPlayers, ROUND_STATUS.CREATED);
  const roundName = round.roundName || roundLabel(totalPlayers);

  await q(
    `DELETE FROM bonus_battle_matches
     WHERE battle_id = $1 AND round_number = $2`,
    [battleId, roundNumber]
  );

  for (let i = 0; i < shuffled.length; i += 2) {
    const playerAId = shuffled[i];
    const playerBId = shuffled[i + 1];
    await q(
      `INSERT INTO bonus_battle_matches (
         id,
         battle_id,
         round_number,
         round_name,
         match_number,
         player_a_id,
         player_b_id,
         bonus_a,
         bonus_b,
         value_a_cents,
         value_b_cents,
         winner_player_id,
         status,
         created_at,
         updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, '', '', 0, 0, NULL, 'PENDING', now(), now())`,
      [uid(), battleId, roundNumber, roundName, (i / 2) + 1, playerAId, playerBId]
    );
  }

  await q(
    `UPDATE bonus_battles
     SET current_round = $2,
         current_round_name = $3,
         updated_at = now()
     WHERE id = $1`,
    [battleId, roundNumber, roundName]
  );

  return { roundName };
}

async function closeRegistrationInternal(q, uid, battle) {
  const participants = await getPlayers(q, battle.id);
  if (participants.length !== battle.maxPlayers) {
    throw new Error("vagas_incompletas");
  }
  const activeIds = participants.map((p) => p.id);
  await createMatchesForRound(q, uid, battle.id, 1, activeIds);
  await q(
    `UPDATE bonus_battles
     SET status = $2,
         current_round = 1,
         current_round_name = $3,
         updated_at = now()
     WHERE id = $1`,
    [battle.id, BATTLE_STATUS.REGISTRATION_CLOSED, roundLabel(activeIds.length)]
  );
  await syncBattleToSheets(q, battle.id);
}

async function setRoundStatus(q, battleId, roundNumber, status) {
  await q(
    `UPDATE bonus_battle_rounds
     SET status = $3,
         updated_at = now(),
         closed_at = CASE WHEN $3 = 'CHOICES_CLOSED' THEN now() ELSE closed_at END,
         resolved_at = CASE WHEN $3 = 'RESOLVED' THEN now() ELSE resolved_at END
     WHERE battle_id = $1 AND round_number = $2`,
    [battleId, roundNumber, status]
  );
}

async function maybeMarkRoundResolved(q, battle) {
  const currentMatches = await getCurrentRoundMatches(q, battle.id, battle.currentRound);
  if (!currentMatches.length) return;
  const allResolved = currentMatches.every((m) => m.status === "RESOLVED" && m.winnerPlayerId);
  if (!allResolved) return;
  await setRoundStatus(q, battle.id, battle.currentRound, ROUND_STATUS.RESOLVED);
  await q(
    `UPDATE bonus_battles
     SET status = $2,
         updated_at = now()
     WHERE id = $1`,
    [battle.id, BATTLE_STATUS.ROUND_RESOLVED]
  );
}

async function finishBattle(q, battleId, championPlayerId = null) {
  await q(
    `UPDATE bonus_battles
     SET status = $2,
         champion_player_id = $3,
         finished_at = now(),
         updated_at = now()
     WHERE id = $1`,
    [battleId, BATTLE_STATUS.FINISHED, championPlayerId]
  );
}

export async function ensureBatalhaBonusTables(q) {
  await q(`
    CREATE TABLE IF NOT EXISTS bonus_battles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      entry_command TEXT NOT NULL,
      max_players INT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      current_round INT NOT NULL DEFAULT 1,
      current_round_name TEXT NOT NULL DEFAULT 'Quartas',
      champion_player_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS bonus_battle_players (
      id TEXT PRIMARY KEY,
      battle_id TEXT NOT NULL REFERENCES bonus_battles(id) ON DELETE CASCADE,
      twitch_name TEXT NOT NULL,
      twitch_name_lc TEXT NOT NULL,
      display_name TEXT,
      join_order INT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT true,
      eliminated_round INT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (battle_id, twitch_name_lc)
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS bonus_battle_rounds (
      id TEXT PRIMARY KEY,
      battle_id TEXT NOT NULL REFERENCES bonus_battles(id) ON DELETE CASCADE,
      round_number INT NOT NULL,
      round_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CREATED',
      opened_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (battle_id, round_number)
    )
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS bonus_battle_matches (
      id TEXT PRIMARY KEY,
      battle_id TEXT NOT NULL REFERENCES bonus_battles(id) ON DELETE CASCADE,
      round_number INT NOT NULL,
      round_name TEXT NOT NULL,
      match_number INT NOT NULL,
      player_a_id TEXT NOT NULL REFERENCES bonus_battle_players(id) ON DELETE CASCADE,
      player_b_id TEXT NOT NULL REFERENCES bonus_battle_players(id) ON DELETE CASCADE,
      bonus_a TEXT NOT NULL DEFAULT '',
      bonus_b TEXT NOT NULL DEFAULT '',
      value_a_cents INT NOT NULL DEFAULT 0,
      value_b_cents INT NOT NULL DEFAULT 0,
      winner_player_id TEXT REFERENCES bonus_battle_players(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      resolved_at TIMESTAMPTZ
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS bonus_battles_status_idx ON bonus_battles(status, created_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS bonus_battle_players_battle_idx ON bonus_battle_players(battle_id, join_order ASC)`);
  await q(`CREATE INDEX IF NOT EXISTS bonus_battle_players_active_idx ON bonus_battle_players(battle_id, is_active)`);
  await q(`CREATE INDEX IF NOT EXISTS bonus_battle_matches_round_idx ON bonus_battle_matches(battle_id, round_number, match_number)`);
}

export function registerBatalhaBonusRoutes({ app, q, uid, requireAppKey, requireAdmin, sseSendAll, announce }) {
  const joinLimiter = rateLimit({
    windowMs: 10 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "rate_limited" }
  });

  app.get("/api/batalha-bonus/state", requireAppKey, async (req, res) => {
    try {
      const battle = await getActiveBattle(q);
      if (!battle) return res.json({ active: false });
      const state = await buildBattleState(q, battle.id);
      return res.json({
        active: true,
        battle: {
          id: state.battle.id,
          name: state.battle.name,
          entryCommand: state.battle.entryCommand,
          maxPlayers: state.battle.maxPlayers,
          status: state.battle.status,
          currentRound: state.battle.currentRound,
          currentRoundName: state.battle.currentRoundName
        },
        counts: state.counts
      });
    } catch (e) {
      console.error("batalha-bonus/state:", e?.message || e);
      res.status(500).json({ error: "falha_state" });
    }
  });

  app.get("/api/batalha-bonus/admin/state", requireAdmin, async (req, res) => {
    try {
      const battle = await getActiveBattle(q);
      if (!battle) return res.json({ active: false, state: null });
      const state = await buildBattleState(q, battle.id);
      res.json({ active: true, state });
    } catch (e) {
      console.error("batalha-bonus/admin/state:", e?.message || e);
      res.status(500).json({ error: "falha_state" });
    }
  });

  app.post("/api/batalha-bonus/admin/create", requireAdmin, async (req, res) => {
    try {
      const current = await getActiveBattle(q);
      if (current) return res.status(409).json({ error: "ja_existe_ativa" });

      const name = safeText(req.body?.name, 60);
      const entryCommand = normalizeCommand(req.body?.entryCommand || "!batalha");
      const maxPlayers = asInt(req.body?.maxPlayers, 0);

      if (!name) return res.status(400).json({ error: "nome_obrigatorio" });
      if (!ALLOWED_SLOTS.has(maxPlayers)) return res.status(400).json({ error: "vagas_invalidas" });

      const battleId = uid();
      await q(
        `INSERT INTO bonus_battles (
           id,
           name,
           entry_command,
           max_players,
           status,
           current_round,
           current_round_name,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, 1, $6, now(), now())`,
        [battleId, name, entryCommand, maxPlayers, BATTLE_STATUS.DRAFT, roundLabel(maxPlayers)]
      );

      const state = await buildBattleState(q, battleId);
      sseSendAll?.("batalha-bonus-changed", { reason: "create", battleId });
      await syncBattleToSheets(q, battleId);
      res.json(state);
    } catch (e) {
      console.error("batalha-bonus/admin/create:", e?.message || e);
      res.status(500).json({ error: "falha_create" });
    }
  });

  app.post("/api/batalha-bonus/admin/open-registration", requireAdmin, async (req, res) => {
    try {
      const battle = await getActiveBattle(q);
      if (!battle) return res.status(404).json({ error: "nao_encontrada" });
      if (battle.status !== BATTLE_STATUS.DRAFT) return res.status(400).json({ error: "status_invalido" });

      await q(
        `UPDATE bonus_battles
         SET status = $2,
             updated_at = now()
         WHERE id = $1`,
        [battle.id, BATTLE_STATUS.REGISTRATION_OPEN]
      );

      sseSendAll?.("batalha-bonus-changed", { reason: "open_registration", battleId: battle.id });
      await syncBattleToSheets(q, battle.id);
      if (announce) {
        const msg = `⚔️ ${battle.name} aberta! Digite ${battle.entryCommand} para entrar. Vagas: ${battle.maxPlayers}.`;
        announce(msg).catch(() => {});
      }
      res.json(await buildBattleState(q, battle.id));
    } catch (e) {
      console.error("batalha-bonus/admin/open-registration:", e?.message || e);
      res.status(500).json({ error: "falha_open_registration" });
    }
  });

  app.post("/api/batalha-bonus/admin/close-registration", requireAdmin, async (req, res) => {
    try {
      const battle = await getActiveBattle(q);
      if (!battle) return res.status(404).json({ error: "nao_encontrada" });
      if (battle.status !== BATTLE_STATUS.REGISTRATION_OPEN) return res.status(400).json({ error: "status_invalido" });
      await closeRegistrationInternal(q, uid, battle);
      sseSendAll?.("batalha-bonus-changed", { reason: "close_registration", battleId: battle.id });
      res.json(await buildBattleState(q, battle.id));
    } catch (e) {
      const msg = e?.message || e;
      if (msg === "vagas_incompletas") return res.status(400).json({ error: "vagas_incompletas" });
      console.error("batalha-bonus/admin/close-registration:", msg);
      res.status(500).json({ error: "falha_close_registration" });
    }
  });

  app.post("/api/batalha-bonus/admin/open-choices", requireAdmin, async (req, res) => {
    try {
      const battle = await getActiveBattle(q);
      if (!battle) return res.status(404).json({ error: "nao_encontrada" });
      if (![BATTLE_STATUS.REGISTRATION_CLOSED].includes(battle.status)) return res.status(400).json({ error: "status_invalido" });

      await q(
        `UPDATE bonus_battles
         SET status = $2,
             updated_at = now()
         WHERE id = $1`,
        [battle.id, BATTLE_STATUS.CHOICES_OPEN]
      );
      await setRoundStatus(q, battle.id, battle.currentRound, ROUND_STATUS.CHOICES_OPEN);
      sseSendAll?.("batalha-bonus-changed", { reason: "open_choices", battleId: battle.id });
      await syncBattleToSheets(q, battle.id);
      if (announce) {
        const msg = `🎯 ${battle.name} ${battle.currentRoundName} aberta. Classificados: mandem !bonus NOME_DO_BONUS.`;
        announce(msg).catch(() => {});
      }
      res.json(await buildBattleState(q, battle.id));
    } catch (e) {
      console.error("batalha-bonus/admin/open-choices:", e?.message || e);
      res.status(500).json({ error: "falha_open_choices" });
    }
  });

  app.post("/api/batalha-bonus/admin/close-choices", requireAdmin, async (req, res) => {
    try {
      const battle = await getActiveBattle(q);
      if (!battle) return res.status(404).json({ error: "nao_encontrada" });
      if (battle.status !== BATTLE_STATUS.CHOICES_OPEN) return res.status(400).json({ error: "status_invalido" });

      await q(
        `UPDATE bonus_battles
         SET status = $2,
             updated_at = now()
         WHERE id = $1`,
        [battle.id, BATTLE_STATUS.CHOICES_CLOSED]
      );
      await setRoundStatus(q, battle.id, battle.currentRound, ROUND_STATUS.CHOICES_CLOSED);
      sseSendAll?.("batalha-bonus-changed", { reason: "close_choices", battleId: battle.id });
      await syncBattleToSheets(q, battle.id);
      res.json(await buildBattleState(q, battle.id));
    } catch (e) {
      console.error("batalha-bonus/admin/close-choices:", e?.message || e);
      res.status(500).json({ error: "falha_close_choices" });
    }
  });

  app.post("/api/batalha-bonus/admin/next-round", requireAdmin, async (req, res) => {
    try {
      const battle = await getActiveBattle(q);
      if (!battle) return res.status(404).json({ error: "nao_encontrada" });
      if (battle.status !== BATTLE_STATUS.ROUND_RESOLVED) return res.status(400).json({ error: "status_invalido" });

      const currentMatches = await getCurrentRoundMatches(q, battle.id, battle.currentRound);
      if (!currentMatches.length) return res.status(400).json({ error: "sem_confrontos" });

      const winnerIds = currentMatches.map((m) => m.winnerPlayerId).filter(Boolean);
      if (winnerIds.length !== currentMatches.length) return res.status(400).json({ error: "fase_nao_resolvida" });

      const loserIds = [];
      for (const match of currentMatches) {
        if (match.playerAId && match.playerAId !== match.winnerPlayerId) loserIds.push(match.playerAId);
        if (match.playerBId && match.playerBId !== match.winnerPlayerId) loserIds.push(match.playerBId);
      }

      if (loserIds.length) {
        await q(
          `UPDATE bonus_battle_players
           SET is_active = false,
               eliminated_round = $2,
               updated_at = now()
           WHERE id = ANY($1::text[])`,
          [loserIds, battle.currentRound]
        );
      }

      if (winnerIds.length === 1) {
        await finishBattle(q, battle.id, winnerIds[0]);
        sseSendAll?.("batalha-bonus-changed", { reason: "finish", battleId: battle.id });
        await syncBattleToSheets(q, battle.id);
        if (announce) {
          const state = await buildBattleState(q, battle.id);
          const champ = state?.battle?.championName || "campeão";
          announce(`🏆 ${battle.name} finalizada. Campeão: ${champ}.`).catch(() => {});
        }
        return res.json(await buildBattleState(q, battle.id));
      }

      const nextRound = battle.currentRound + 1;
      await createMatchesForRound(q, uid, battle.id, nextRound, winnerIds);
      await q(
        `UPDATE bonus_battles
         SET status = $2,
             current_round = $3,
             current_round_name = $4,
             updated_at = now()
         WHERE id = $1`,
        [battle.id, BATTLE_STATUS.REGISTRATION_CLOSED, nextRound, roundLabel(winnerIds.length)]
      );
      sseSendAll?.("batalha-bonus-changed", { reason: "next_round", battleId: battle.id, round: nextRound });
      await syncBattleToSheets(q, battle.id);
      res.json(await buildBattleState(q, battle.id));
    } catch (e) {
      console.error("batalha-bonus/admin/next-round:", e?.message || e);
      res.status(500).json({ error: "falha_next_round" });
    }
  });

  app.post("/api/batalha-bonus/admin/finalize", requireAdmin, async (req, res) => {
    try {
      const battle = await getActiveBattle(q);
      if (!battle) return res.status(404).json({ error: "nao_encontrada" });
      const championPlayerId = safeText(req.body?.championPlayerId, 80) || null;
      await finishBattle(q, battle.id, championPlayerId);
      sseSendAll?.("batalha-bonus-changed", { reason: "finish", battleId: battle.id });
      await syncBattleToSheets(q, battle.id);
      res.json(await buildBattleState(q, battle.id));
    } catch (e) {
      console.error("batalha-bonus/admin/finalize:", e?.message || e);
      res.status(500).json({ error: "falha_finalize" });
    }
  });

  app.patch("/api/batalha-bonus/admin/matches/:id", requireAdmin, async (req, res) => {
    try {
      const matchId = safeText(req.params?.id, 80);
      const { rows } = await q(
        `SELECT
           m.id,
           m.battle_id AS "battleId",
           m.round_number AS "roundNumber",
           m.player_a_id AS "playerAId",
           m.player_b_id AS "playerBId",
           m.status
         FROM bonus_battle_matches m
         WHERE m.id = $1
         LIMIT 1`,
        [matchId]
      );
      const match = rows[0];
      if (!match) return res.status(404).json({ error: "nao_encontrado" });

      const battle = await getBattleById(q, match.battleId);
      if (!battle) return res.status(404).json({ error: "nao_encontrada" });
      if (battle.status === BATTLE_STATUS.FINISHED) return res.status(400).json({ error: "batalha_finalizada" });

      const valueA = Math.max(0, asInt(req.body?.valueA, 0));
      const valueB = Math.max(0, asInt(req.body?.valueB, 0));
      const mode = safeText(req.body?.winnerMode, 20).toLowerCase() || "auto";
      const manualWinner = safeText(req.body?.winnerPlayerId, 80) || null;

      let winnerPlayerId = null;
      if (mode === "manual") {
        if (![match.playerAId, match.playerBId].includes(manualWinner)) {
          return res.status(400).json({ error: "winner_invalido" });
        }
        winnerPlayerId = manualWinner;
      } else {
        if (valueA === valueB) return res.status(400).json({ error: "empate_manual" });
        winnerPlayerId = valueA > valueB ? match.playerAId : match.playerBId;
      }

      await q(
        `UPDATE bonus_battle_matches
         SET value_a_cents = $2,
             value_b_cents = $3,
             winner_player_id = $4,
             status = 'RESOLVED',
             resolved_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [matchId, valueA, valueB, winnerPlayerId]
      );

      await maybeMarkRoundResolved(q, battle);
      sseSendAll?.("batalha-bonus-changed", { reason: "match_update", battleId: battle.id, matchId });
      await syncBattleToSheets(q, battle.id);
      res.json(await buildBattleState(q, battle.id));
    } catch (e) {
      console.error("batalha-bonus/admin/match:", e?.message || e);
      res.status(500).json({ error: "falha_match_update" });
    }
  });

  app.post("/api/batalha-bonus/join", joinLimiter, requireAppKey, async (req, res) => {
    try {
      const battle = await getActiveBattle(q);
      if (!battle) return res.status(404).json({ error: "nao_encontrada" });
      if (battle.status !== BATTLE_STATUS.REGISTRATION_OPEN) return res.status(400).json({ error: "inscricoes_fechadas" });

      const user = safeText(req.body?.user, 60);
      const displayName = safeText(req.body?.displayName || req.body?.user, 60);
      const userLc = normalizeUser(user);
      if (!userLc) return res.status(400).json({ error: "usuario_invalido" });

      const existing = await q(
        `SELECT id FROM bonus_battle_players WHERE battle_id = $1 AND twitch_name_lc = $2 LIMIT 1`,
        [battle.id, userLc]
      );
      if (existing.rows[0]) {
        return res.json({ ok: true, alreadyJoined: true, battleId: battle.id, user: userLc });
      }

      const countRes = await q(`SELECT COUNT(*)::int AS total FROM bonus_battle_players WHERE battle_id = $1`, [battle.id]);
      const totalBefore = Number(countRes.rows[0]?.total || 0);
      if (totalBefore >= battle.maxPlayers) return res.status(400).json({ error: "limite_atingido" });

      await q(
        `INSERT INTO bonus_battle_players (
           id,
           battle_id,
           twitch_name,
           twitch_name_lc,
           display_name,
           join_order,
           is_active,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, true, now(), now())`,
        [uid(), battle.id, userLc, userLc, displayName || userLc, totalBefore + 1]
      );

      const totalNow = totalBefore + 1;
      if (totalNow >= battle.maxPlayers) {
        await closeRegistrationInternal(q, uid, battle);
      } else {
        await syncBattleToSheets(q, battle.id);
      }

      sseSendAll?.("batalha-bonus-changed", { reason: "join", battleId: battle.id, user: userLc });
      res.json({ ok: true, alreadyJoined: false, battleId: battle.id, user: userLc, total: totalNow, maxPlayers: battle.maxPlayers, autoClosed: totalNow >= battle.maxPlayers });
    } catch (e) {
      console.error("batalha-bonus/join:", e?.message || e);
      res.status(500).json({ error: "falha_join" });
    }
  });

  app.post("/api/batalha-bonus/bonus", joinLimiter, requireAppKey, async (req, res) => {
    try {
      const battle = await getActiveBattle(q);
      if (!battle) return res.status(404).json({ error: "nao_encontrada" });
      if (battle.status !== BATTLE_STATUS.CHOICES_OPEN) return res.status(400).json({ error: "escolhas_fechadas" });

      const user = safeText(req.body?.user, 60);
      const userLc = normalizeUser(user);
      const bonusName = normalizeBonusName(req.body?.bonusName);
      if (!userLc) return res.status(400).json({ error: "usuario_invalido" });
      if (!bonusName) return res.status(400).json({ error: "bonus_invalido" });

      const { rows } = await q(
        `SELECT
           m.id,
           m.player_a_id AS "playerAId",
           m.player_b_id AS "playerBId",
           m.bonus_a AS "bonusA",
           m.bonus_b AS "bonusB",
           pa.twitch_name_lc AS "playerALc",
           pb.twitch_name_lc AS "playerBLc"
         FROM bonus_battle_matches m
         JOIN bonus_battle_players pa ON pa.id = m.player_a_id
         JOIN bonus_battle_players pb ON pb.id = m.player_b_id
         WHERE m.battle_id = $1
           AND m.round_number = $2
           AND (pa.twitch_name_lc = $3 OR pb.twitch_name_lc = $3)
         LIMIT 1`,
        [battle.id, battle.currentRound, userLc]
      );

      const match = rows[0];
      if (!match) return res.status(403).json({ error: "nao_classificado" });

      if (match.playerALc === userLc) {
        if (String(match.bonusA || "").trim()) return res.json({ ok: true, alreadyChosen: true, matchId: match.id });
        await q(
          `UPDATE bonus_battle_matches
           SET bonus_a = $2,
               updated_at = now()
           WHERE id = $1`,
          [match.id, bonusName]
        );
      } else {
        if (String(match.bonusB || "").trim()) return res.json({ ok: true, alreadyChosen: true, matchId: match.id });
        await q(
          `UPDATE bonus_battle_matches
           SET bonus_b = $2,
               updated_at = now()
           WHERE id = $1`,
          [match.id, bonusName]
        );
      }

      sseSendAll?.("batalha-bonus-changed", { reason: "bonus", battleId: battle.id, user: userLc });
      await syncBattleToSheets(q, battle.id);
      res.json({ ok: true, alreadyChosen: false, battleId: battle.id, user: userLc, bonusName });
    } catch (e) {
      console.error("batalha-bonus/bonus:", e?.message || e);
      res.status(500).json({ error: "falha_bonus" });
    }
  });
}
