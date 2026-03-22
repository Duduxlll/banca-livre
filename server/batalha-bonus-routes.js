import QRCode from 'qrcode';

const BATTLE_STATUS = {
  ACTIVE: 'ACTIVE',
  FINISHED: 'FINISHED'
};

const RESULT = {
  WIN: 'WIN',
  LOSE: 'LOSE'
};

const ALLOWED_SLOTS = new Set([8, 16, 32]);

function normalizeLookupName(name) {
  return String(name || '')
    .trim()
    .replace(/^@+/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function digitsOnly(v) {
  return String(v || '').replace(/\D+/g, '');
}

function centsToPixAmount(cents) {
  const n = Math.max(0, asInt(cents, 0));
  return (n / 100).toFixed(2);
}

function cleanPixText(v, max) {
  const s = String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 .\-_/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
  return max ? s.slice(0, max) : s;
}

function tlv(id, value) {
  const v = String(value ?? '');
  return `${id}${String(v.length).padStart(2, '0')}${v}`;
}

function crc16(payload) {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021) & 0xffff;
      else crc = (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function buildPixPayload({ pixKey, amountCents, battleName, championName, battleId }) {
  const key = safeText(pixKey, 160);
  if (!key) return null;

  const merchantName = cleanPixText(process.env.PIX_MERCHANT_NAME || process.env.ADMIN_USER || 'GUIZ', 25) || 'GUIZ';
  const merchantCity = cleanPixText(process.env.PIX_MERCHANT_CITY || 'BRASIL', 15) || 'BRASIL';
  const description = cleanPixText(`${battleName || 'BATALHA BONUS'} ${championName || ''}`, 72);
  const txidBase = cleanPixText(`${battleId || 'BATALHA'}${digitsOnly(amountCents).slice(0, 8)}`, 25).replace(/[^A-Z0-9]/g, '');
  const txid = txidBase || 'BATALHABONUS';

  let merchantAccount = tlv('00', 'br.gov.bcb.pix') + tlv('01', key);
  if (description) merchantAccount += tlv('02', description);

  let payload = '';
  payload += tlv('00', '01');
  payload += tlv('26', merchantAccount);
  payload += tlv('52', '0000');
  payload += tlv('53', '986');
  if (Math.max(0, asInt(amountCents, 0)) > 0) payload += tlv('54', centsToPixAmount(amountCents));
  payload += tlv('58', 'BR');
  payload += tlv('59', merchantName);
  payload += tlv('60', merchantCity);
  payload += tlv('62', tlv('05', txid));

  const base = `${payload}6304`;
  return `${base}${crc16(base)}`;
}


function asInt(v, def = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.trunc(n);
}

function safeText(v, max = 120) {
  return String(v ?? '').trim().slice(0, max);
}

function normalizeResult(v) {
  return String(v || '').trim().toUpperCase() === RESULT.WIN ? RESULT.WIN : RESULT.LOSE;
}

function roundLabel(totalPlayers) {
  const n = asInt(totalPlayers, 0);
  if (n === 32) return 'Top 32';
  if (n === 16) return 'Oitavas';
  if (n === 8) return 'Quartas';
  if (n === 4) return 'Semifinal';
  if (n === 2) return 'Final';
  return `Top ${n}`;
}

function buildRoundPlan(maxPlayers) {
  const rounds = [];
  let totalPlayers = maxPlayers;
  let roundNumber = 1;
  while (totalPlayers >= 2) {
    rounds.push({
      roundNumber,
      roundName: roundLabel(totalPlayers),
      totalPlayers,
      matchCount: totalPlayers / 2
    });
    totalPlayers = totalPlayers / 2;
    roundNumber += 1;
  }
  return rounds;
}

function mapBattleRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    maxPlayers: Number(r.maxPlayers || 0),
    prizeCents: Number(r.prizeCents || 0),
    status: r.status,
    championName: r.championName || '',
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    finishedAt: r.finishedAt || null
  };
}

function mapMatchRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    battleId: r.battleId,
    roundNumber: Number(r.roundNumber || 0),
    roundName: r.roundName || '',
    matchNumber: Number(r.matchNumber || 0),
    nextRoundNumber: r.nextRoundNumber == null ? null : Number(r.nextRoundNumber),
    nextMatchNumber: r.nextMatchNumber == null ? null : Number(r.nextMatchNumber),
    nextSlot: r.nextSlot || null,
    playerAName: r.playerAName || '',
    bonusA: r.bonusA || '',
    valueA: Number(r.valueA || 0),
    resultA: r.resultA || RESULT.LOSE,
    playerBName: r.playerBName || '',
    bonusB: r.bonusB || '',
    valueB: Number(r.valueB || 0),
    resultB: r.resultB || RESULT.LOSE,
    winnerSide: r.winnerSide || null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt
  };
}

async function getActiveBattle(q) {
  const { rows } = await q(
    `SELECT
       id,
       name,
       max_players AS "maxPlayers",
       prize_cents AS "prizeCents",
       status,
       champion_name AS "championName",
       created_at AS "createdAt",
       updated_at AS "updatedAt",
       finished_at AS "finishedAt"
     FROM bonus_manual_battles
     WHERE status <> $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [BATTLE_STATUS.FINISHED]
  );
  return mapBattleRow(rows[0]);
}

async function getBattleById(q, battleId) {
  const { rows } = await q(
    `SELECT
       id,
       name,
       max_players AS "maxPlayers",
       prize_cents AS "prizeCents",
       status,
       champion_name AS "championName",
       created_at AS "createdAt",
       updated_at AS "updatedAt",
       finished_at AS "finishedAt"
     FROM bonus_manual_battles
     WHERE id = $1
     LIMIT 1`,
    [battleId]
  );
  return mapBattleRow(rows[0]);
}

async function getMatches(q, battleId) {
  const { rows } = await q(
    `SELECT
       id,
       battle_id AS "battleId",
       round_number AS "roundNumber",
       round_name AS "roundName",
       match_number AS "matchNumber",
       next_round_number AS "nextRoundNumber",
       next_match_number AS "nextMatchNumber",
       next_slot AS "nextSlot",
       player_a_name AS "playerAName",
       bonus_a AS "bonusA",
       value_a_cents AS "valueA",
       result_a AS "resultA",
       player_b_name AS "playerBName",
       bonus_b AS "bonusB",
       value_b_cents AS "valueB",
       result_b AS "resultB",
       winner_side AS "winnerSide",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM bonus_manual_matches
     WHERE battle_id = $1
     ORDER BY round_number ASC, match_number ASC`,
    [battleId]
  );
  return rows.map(mapMatchRow);
}

async function getMatchById(q, matchId) {
  const { rows } = await q(
    `SELECT
       id,
       battle_id AS "battleId",
       round_number AS "roundNumber",
       round_name AS "roundName",
       match_number AS "matchNumber",
       next_round_number AS "nextRoundNumber",
       next_match_number AS "nextMatchNumber",
       next_slot AS "nextSlot",
       player_a_name AS "playerAName",
       bonus_a AS "bonusA",
       value_a_cents AS "valueA",
       result_a AS "resultA",
       player_b_name AS "playerBName",
       bonus_b AS "bonusB",
       value_b_cents AS "valueB",
       result_b AS "resultB",
       winner_side AS "winnerSide",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM bonus_manual_matches
     WHERE id = $1
     LIMIT 1`,
    [matchId]
  );
  return mapMatchRow(rows[0]);
}

async function getMatchByRoundMatch(q, battleId, roundNumber, matchNumber) {
  const { rows } = await q(
    `SELECT
       id,
       battle_id AS "battleId",
       round_number AS "roundNumber",
       round_name AS "roundName",
       match_number AS "matchNumber",
       next_round_number AS "nextRoundNumber",
       next_match_number AS "nextMatchNumber",
       next_slot AS "nextSlot",
       player_a_name AS "playerAName",
       bonus_a AS "bonusA",
       value_a_cents AS "valueA",
       result_a AS "resultA",
       player_b_name AS "playerBName",
       bonus_b AS "bonusB",
       value_b_cents AS "valueB",
       result_b AS "resultB",
       winner_side AS "winnerSide",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM bonus_manual_matches
     WHERE battle_id = $1 AND round_number = $2 AND match_number = $3
     LIMIT 1`,
    [battleId, roundNumber, matchNumber]
  );
  return mapMatchRow(rows[0]);
}

async function updateChampionFromFinal(q, battleId) {
  const { rows } = await q(
    `SELECT
       player_a_name AS "playerAName",
       player_b_name AS "playerBName",
       winner_side AS "winnerSide"
     FROM bonus_manual_matches
     WHERE battle_id = $1
     ORDER BY round_number DESC, match_number DESC
     LIMIT 1`,
    [battleId]
  );
  const finalMatch = rows[0];
  let championName = '';
  if (finalMatch) {
    if (finalMatch.winnerSide === 'A') championName = safeText(finalMatch.playerAName, 60);
    if (finalMatch.winnerSide === 'B') championName = safeText(finalMatch.playerBName, 60);
  }
  await q(
    `UPDATE bonus_manual_battles
     SET champion_name = $2,
         updated_at = now()
     WHERE id = $1`,
    [battleId, championName || null]
  );
}

async function syncForward(q, battleId, roundNumber, matchNumber) {
  const current = await getMatchByRoundMatch(q, battleId, roundNumber, matchNumber);
  if (!current) return;

  if (!current.nextRoundNumber || !current.nextMatchNumber || !current.nextSlot) {
    await updateChampionFromFinal(q, battleId);
    return;
  }

  const slot = String(current.nextSlot || '').toUpperCase() === 'B' ? 'B' : 'A';
  let name = '';
  let bonus = '';

  if (current.winnerSide === 'A') {
    name = safeText(current.playerAName, 60);
    bonus = safeText(current.bonusA, 60);
  } else if (current.winnerSide === 'B') {
    name = safeText(current.playerBName, 60);
    bonus = safeText(current.bonusB, 60);
  }

  if (slot === 'A') {
    await q(
      `UPDATE bonus_manual_matches
       SET player_a_name = $4,
           bonus_a = $5,
           value_a_cents = 0,
           result_a = 'LOSE',
           winner_side = CASE WHEN winner_side = 'A' AND $4 = '' THEN NULL ELSE winner_side END,
           updated_at = now()
       WHERE battle_id = $1 AND round_number = $2 AND match_number = $3`,
      [battleId, current.nextRoundNumber, current.nextMatchNumber, name, bonus]
    );
  } else {
    await q(
      `UPDATE bonus_manual_matches
       SET player_b_name = $4,
           bonus_b = $5,
           value_b_cents = 0,
           result_b = 'LOSE',
           winner_side = CASE WHEN winner_side = 'B' AND $4 = '' THEN NULL ELSE winner_side END,
           updated_at = now()
       WHERE battle_id = $1 AND round_number = $2 AND match_number = $3`,
      [battleId, current.nextRoundNumber, current.nextMatchNumber, name, bonus]
    );
  }

  const nextMatch = await getMatchByRoundMatch(q, battleId, current.nextRoundNumber, current.nextMatchNumber);
  if (!nextMatch) {
    await updateChampionFromFinal(q, battleId);
    return;
  }

  let winnerSide = nextMatch.winnerSide;
  let resultA = nextMatch.resultA;
  let resultB = nextMatch.resultB;

  if (winnerSide === 'A' && !safeText(nextMatch.playerAName, 60)) {
    winnerSide = null;
    resultA = RESULT.LOSE;
    resultB = RESULT.LOSE;
  }

  if (winnerSide === 'B' && !safeText(nextMatch.playerBName, 60)) {
    winnerSide = null;
    resultA = RESULT.LOSE;
    resultB = RESULT.LOSE;
  }

  if (winnerSide == null) {
    resultA = RESULT.LOSE;
    resultB = RESULT.LOSE;
  }

  await q(
    `UPDATE bonus_manual_matches
     SET winner_side = $4,
         result_a = $5,
         result_b = $6,
         updated_at = now()
     WHERE battle_id = $1 AND round_number = $2 AND match_number = $3`,
    [battleId, current.nextRoundNumber, current.nextMatchNumber, winnerSide, resultA, resultB]
  );

  await syncForward(q, battleId, current.nextRoundNumber, current.nextMatchNumber);
}

async function buildChampionPayout(q, battle) {
  const championName = safeText(battle?.championName, 60);
  if (!championName) return null;

  const twitchNameLc = normalizeLookupName(championName);
  if (!twitchNameLc) {
    return {
      championName,
      status: 'SEM_CADASTRO',
      approved: false,
      pixKey: null,
      pixType: null,
      qrCodeDataUrl: null,
      emv: null,
      amountCents: Math.max(0, asInt(battle?.prizeCents, 0)),
      reason: null
    };
  }

  const { rows } = await q(
    `SELECT
       id,
       twitch_name AS "twitchName",
       pix_type AS "pixType",
       pix_key AS "pixKey",
       status,
       reason,
       screenshot_data_url IS NOT NULL AS "hasScreenshot",
       updated_at AS "updatedAt",
       decided_at AS "decidedAt"
     FROM cashback_submissions
     WHERE twitch_name_lc = $1
     ORDER BY updated_at DESC, created_at DESC
     LIMIT 1`,
    [twitchNameLc]
  );

  const row = rows[0];
  const amountCents = Math.max(0, asInt(battle?.prizeCents, 0));
  if (!row) {
    return {
      championName,
      status: 'SEM_CADASTRO',
      approved: false,
      pixKey: null,
      pixType: null,
      qrCodeDataUrl: null,
      emv: null,
      amountCents,
      reason: null
    };
  }

  const approved = String(row.status || '').toUpperCase() === 'APROVADO';
  let emv = null;
  let qrCodeDataUrl = null;

  if (approved && row.pixKey && amountCents > 0) {
    emv = buildPixPayload({
      pixKey: row.pixKey,
      amountCents,
      battleName: battle?.name,
      championName,
      battleId: battle?.id
    });

    if (emv) {
      qrCodeDataUrl = await QRCode.toDataURL(emv, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 360
      });
    }
  }

  return {
    submissionId: row.id,
    championName,
    twitchName: row.twitchName || championName,
    status: String(row.status || '').toUpperCase() || 'PENDENTE',
    approved,
    pixKey: row.pixKey || null,
    pixType: row.pixType || null,
    hasScreenshot: !!row.hasScreenshot,
    updatedAt: row.updatedAt || null,
    decidedAt: row.decidedAt || null,
    reason: row.reason || null,
    amountCents,
    emv,
    qrCodeDataUrl
  };
}

function computeOverview(battle, matches) {
  const roundsMap = new Map();
  for (const match of matches) {
    const key = String(match.roundNumber);
    if (!roundsMap.has(key)) {
      roundsMap.set(key, {
        roundNumber: match.roundNumber,
        roundName: match.roundName,
        matches: []
      });
    }
    roundsMap.get(key).matches.push(match);
  }

  const rounds = Array.from(roundsMap.values()).sort((a, b) => a.roundNumber - b.roundNumber);
  for (const round of rounds) {
    round.matches.sort((a, b) => a.matchNumber - b.matchNumber);
    round.resolvedMatches = round.matches.filter((m) => !!m.winnerSide).length;
    round.totalMatches = round.matches.length;
  }

  const firstRound = rounds[0] || { matches: [] };
  const filledSlots = firstRound.matches.reduce((acc, match) => {
    if (safeText(match.playerAName, 60)) acc += 1;
    if (safeText(match.playerBName, 60)) acc += 1;
    return acc;
  }, 0);

  const totalMatches = matches.length;
  const resolvedMatches = matches.filter((m) => !!m.winnerSide).length;
  const currentRound = rounds.find((round) => round.matches.some((m) => !m.winnerSide)) || rounds[rounds.length - 1] || null;

  return {
    rounds,
    counts: {
      filledSlots,
      maxPlayers: battle.maxPlayers,
      totalMatches,
      resolvedMatches,
      remainingMatches: Math.max(0, totalMatches - resolvedMatches)
    },
    currentRoundName: currentRound?.roundName || '',
    currentRoundNumber: currentRound?.roundNumber || 1
  };
}

async function buildBattleState(q, battleId) {
  const battle = await getBattleById(q, battleId);
  if (!battle) return null;
  const matches = await getMatches(q, battleId);
  const overview = computeOverview(battle, matches);
  const championPayout = await buildChampionPayout(q, battle);
  return {
    battle: {
      ...battle,
      currentRoundName: overview.currentRoundName,
      currentRoundNumber: overview.currentRoundNumber
    },
    rounds: overview.rounds,
    matches,
    counts: overview.counts,
    championPayout
  };
}

export async function ensureBatalhaBonusTables(q) {
  await q(`
    CREATE TABLE IF NOT EXISTS bonus_manual_battles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      max_players INT NOT NULL,
      prize_cents INT NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      champion_name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ
    )
  `);

  await q(`ALTER TABLE bonus_manual_battles ADD COLUMN IF NOT EXISTS prize_cents INT NOT NULL DEFAULT 0`);

  await q(`
    CREATE TABLE IF NOT EXISTS bonus_manual_matches (
      id TEXT PRIMARY KEY,
      battle_id TEXT NOT NULL REFERENCES bonus_manual_battles(id) ON DELETE CASCADE,
      round_number INT NOT NULL,
      round_name TEXT NOT NULL,
      match_number INT NOT NULL,
      next_round_number INT,
      next_match_number INT,
      next_slot TEXT,
      player_a_name TEXT NOT NULL DEFAULT '',
      bonus_a TEXT NOT NULL DEFAULT '',
      value_a_cents INT NOT NULL DEFAULT 0,
      result_a TEXT NOT NULL DEFAULT 'LOSE',
      player_b_name TEXT NOT NULL DEFAULT '',
      bonus_b TEXT NOT NULL DEFAULT '',
      value_b_cents INT NOT NULL DEFAULT 0,
      result_b TEXT NOT NULL DEFAULT 'LOSE',
      winner_side TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (battle_id, round_number, match_number)
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS bonus_manual_battles_status_idx ON bonus_manual_battles(status, created_at DESC)`);
  await q(`CREATE INDEX IF NOT EXISTS bonus_manual_matches_round_idx ON bonus_manual_matches(battle_id, round_number, match_number)`);
}

export function registerBatalhaBonusRoutes({ app, q, uid, requireAppKey, requireAdmin, sseSendAll }) {
  app.get('/api/batalha-bonus/state', requireAppKey, async (_req, res) => {
    try {
      return res.json({ active: false, manualOnly: true });
    } catch (e) {
      console.error('batalha-bonus/state:', e?.message || e);
      return res.status(500).json({ error: 'falha_state' });
    }
  });

  app.post('/api/batalha-bonus/join', requireAppKey, async (_req, res) => {
    return res.status(410).json({ error: 'manual_only' });
  });

  app.post('/api/batalha-bonus/bonus', requireAppKey, async (_req, res) => {
    return res.status(410).json({ error: 'manual_only' });
  });

  app.get('/api/batalha-bonus/admin/state', requireAdmin, async (_req, res) => {
    try {
      const battle = await getActiveBattle(q);
      if (!battle) return res.json({ active: false, state: null });
      const state = await buildBattleState(q, battle.id);
      return res.json({ active: true, state });
    } catch (e) {
      console.error('batalha-bonus/admin/state:', e?.message || e);
      return res.status(500).json({ error: 'falha_state' });
    }
  });

  app.post('/api/batalha-bonus/admin/create', requireAdmin, async (req, res) => {
    try {
      const current = await getActiveBattle(q);
      if (current) return res.status(409).json({ error: 'ja_existe_ativa' });

      const name = safeText(req.body?.name, 60);
      const maxPlayers = asInt(req.body?.maxPlayers, 0);
      const prizeCents = Math.max(0, asInt(req.body?.prizeCents, 0));
      if (!name) return res.status(400).json({ error: 'nome_obrigatorio' });
      if (!ALLOWED_SLOTS.has(maxPlayers)) return res.status(400).json({ error: 'vagas_invalidas' });
      if (prizeCents <= 0) return res.status(400).json({ error: 'premiacao_obrigatoria' });

      const battleId = uid();
      await q(
        `INSERT INTO bonus_manual_battles (
           id,
           name,
           max_players,
           prize_cents,
           status,
           champion_name,
           created_at,
           updated_at
         )
         VALUES ($1, $2, $3, $4, $5, NULL, now(), now())`,
        [battleId, name, maxPlayers, prizeCents, BATTLE_STATUS.ACTIVE]
      );

      const plan = buildRoundPlan(maxPlayers);
      for (const round of plan) {
        for (let matchNumber = 1; matchNumber <= round.matchCount; matchNumber += 1) {
          const nextRoundNumber = round.roundNumber < plan.length ? round.roundNumber + 1 : null;
          const nextMatchNumber = nextRoundNumber ? Math.ceil(matchNumber / 2) : null;
          const nextSlot = nextRoundNumber ? (matchNumber % 2 === 1 ? 'A' : 'B') : null;
          await q(
            `INSERT INTO bonus_manual_matches (
               id,
               battle_id,
               round_number,
               round_name,
               match_number,
               next_round_number,
               next_match_number,
               next_slot,
               player_a_name,
               bonus_a,
               value_a_cents,
               result_a,
               player_b_name,
               bonus_b,
               value_b_cents,
               result_b,
               winner_side,
               created_at,
               updated_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '', '', 0, 'LOSE', '', '', 0, 'LOSE', NULL, now(), now())`,
            [uid(), battleId, round.roundNumber, round.roundName, matchNumber, nextRoundNumber, nextMatchNumber, nextSlot]
          );
        }
      }

      sseSendAll?.('batalha-bonus-changed', { reason: 'create', battleId });
      return res.json(await buildBattleState(q, battleId));
    } catch (e) {
      console.error('batalha-bonus/admin/create:', e?.message || e);
      return res.status(500).json({ error: 'falha_create' });
    }
  });

  app.patch('/api/batalha-bonus/admin/matches/:id', requireAdmin, async (req, res) => {
    try {
      const matchId = safeText(req.params?.id, 80);
      const match = await getMatchById(q, matchId);
      if (!match) return res.status(404).json({ error: 'nao_encontrado' });

      const battle = await getBattleById(q, match.battleId);
      if (!battle) return res.status(404).json({ error: 'nao_encontrada' });
      if (battle.status === BATTLE_STATUS.FINISHED) return res.status(400).json({ error: 'batalha_finalizada' });

      let resultA = normalizeResult(req.body?.resultA);
      let resultB = normalizeResult(req.body?.resultB);

      if (resultA === RESULT.WIN && resultB === RESULT.WIN) {
        return res.status(400).json({ error: 'duplo_win' });
      }

      let winnerSide = null;
      if (resultA === RESULT.WIN) {
        winnerSide = 'A';
        resultB = RESULT.LOSE;
      } else if (resultB === RESULT.WIN) {
        winnerSide = 'B';
        resultA = RESULT.LOSE;
      } else {
        resultA = RESULT.LOSE;
        resultB = RESULT.LOSE;
      }

      await q(
        `UPDATE bonus_manual_matches
         SET player_a_name = $2,
             bonus_a = $3,
             value_a_cents = $4,
             result_a = $5,
             player_b_name = $6,
             bonus_b = $7,
             value_b_cents = $8,
             result_b = $9,
             winner_side = $10,
             updated_at = now()
         WHERE id = $1`,
        [
          matchId,
          safeText(req.body?.playerAName, 60),
          safeText(req.body?.bonusA, 60),
          Math.max(0, asInt(req.body?.valueA, 0)),
          resultA,
          safeText(req.body?.playerBName, 60),
          safeText(req.body?.bonusB, 60),
          Math.max(0, asInt(req.body?.valueB, 0)),
          resultB,
          winnerSide
        ]
      );

      await syncForward(q, battle.id, match.roundNumber, match.matchNumber);
      await updateChampionFromFinal(q, battle.id);
      await q(
        `UPDATE bonus_manual_battles
         SET updated_at = now()
         WHERE id = $1`,
        [battle.id]
      );

      sseSendAll?.('batalha-bonus-changed', { reason: 'match_update', battleId: battle.id, matchId });
      return res.json(await buildBattleState(q, battle.id));
    } catch (e) {
      console.error('batalha-bonus/admin/match:', e?.message || e);
      return res.status(500).json({ error: 'falha_match_update' });
    }
  });

  app.post('/api/batalha-bonus/admin/finalize', requireAdmin, async (_req, res) => {
    try {
      const battle = await getActiveBattle(q);
      if (!battle) return res.status(404).json({ error: 'nao_encontrada' });

      await updateChampionFromFinal(q, battle.id);
      await q(
        `UPDATE bonus_manual_battles
         SET status = $2,
             finished_at = now(),
             updated_at = now()
         WHERE id = $1`,
        [battle.id, BATTLE_STATUS.FINISHED]
      );

      sseSendAll?.('batalha-bonus-changed', { reason: 'finish', battleId: battle.id });
      return res.json(await buildBattleState(q, battle.id));
    } catch (e) {
      console.error('batalha-bonus/admin/finalize:', e?.message || e);
      return res.status(500).json({ error: 'falha_finalize' });
    }
  });
}
