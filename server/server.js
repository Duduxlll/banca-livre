import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import QRCode from 'qrcode';
import pkg from 'pg';
import { initDiscordBot } from "./discord-bot.js";

import { ensureTorneioTables, registerTorneioRoutes } from "./torneio-routes.js";

import { ensureCashbackTables, registerCashbackRoutes } from './cashback-routes.js';
import { ensureGorjetaTables, registerGorjetaRoutes } from "./gorjeta-routes.js";
import { ensureBatalhaBonusTables, registerBatalhaBonusRoutes } from "./batalha-bonus-routes.js";

import { initTwitchBot } from "./twitch-bot.js";


let discordBot = null;

const { Pool } = pkg;

const {
  PORT = 3000,
  ORIGIN = `http://localhost:3000`,
  STATIC_ROOT,
  ADMIN_USER = 'admin',
  ADMIN_PASSWORD_HASH,
  JWT_SECRET,
  DATABASE_URL
} = process.env;

const PROD = process.env.NODE_ENV === 'production';

const APP_PUBLIC_KEY     = (process.env.APP_PUBLIC_KEY || "").trim();
const OVERLAY_PUBLIC_KEY = (process.env.OVERLAY_PUBLIC_KEY || "").trim();

['ADMIN_USER','ADMIN_PASSWORD_HASH','JWT_SECRET'].forEach(k=>{
  if(!process.env[k]) {
    console.error(`❌ Falta ${k} no .env (login)`);
    process.exit(1);
  }
});

if (!DATABASE_URL) {
  console.error('❌ Falta DATABASE_URL no .env');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const PUBLIC_ROOT  = path.resolve(__dirname, '..', 'public');
const PRIVATE_ROOT = path.resolve(__dirname, '..', 'private');
const REACT_APP_INDEX = path.join(PUBLIC_ROOT, 'app', 'index.html');

const ROOT = PUBLIC_ROOT;

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});
const q = (text, params) => pool.query(text, params);

function uid(){
  return Date.now().toString(36) + Math.random().toString(36).slice(2,7);
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));

app.use((req, res, next) => {
  if (req.url.includes('/.git')) {
    return res.status(403).send('Forbidden');
  }
  next();
});

app.use((req, res, next) => {
  const p = (req.path || '').toLowerCase();
  if (
    p === '/' ||
    p === '/index.html' ||
    p === '/assets/js/app.js' ||
    p === '/assets/css/style.css' ||
    p === '/assets/css/pix.css' ||
    p === '/assets/img/panel.png'
  ) {
    return res.status(410).send('Página removida');
  }
  return next();
});

app.use((req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), usb=()"
  );
  next();
});


app.use((req, res, next) => {
  const p = (req.path || '').toLowerCase();
  if (
    p === '/cashback-publico.html' ||
    p === '/cashback-publico' ||
    p === '/assets/js/cashback-publico.js' ||
    p === '/assets/css/cashback-publico.css'
  ) {
    return res.status(410).send('Página removida');
  }

  return next();
});

app.use((req, res, next) => {
  const p = (req.path || '').toLowerCase();

  if (
    p === '/sorteio-publico.html' ||
    p === '/sorteio-publico' ||
    p === '/assets/js/sorteio-publico.js' ||
    p === '/assets/css/sorteio-publico.css'
  ) {
    return res.status(410).send('Página removida');
  }

  return next();
});



app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": [
          "'self'",
          "data:",
          "blob:",
          "https://res.cloudinary.com",
          "https://cdn.discordapp.com",
          "https://media.discordapp.net"
        ]
      }
    }
  })
);



app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));

app.use(express.json({ limit: '8mb' }));

app.use(cookieParser());
app.use(cors({ origin: ORIGIN, credentials: true }));
app.use((req, res, next) => {
  const pathOnly = req.path || '';

  if (pathOnly === '/login' || pathOnly === '/login.html') {
    return res.redirect(302, '/area/login');
  }

  if (pathOnly.startsWith('/app') && !pathOnly.startsWith('/app/assets/')) {
    const suffix = pathOnly.slice('/app'.length);
    const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const target = suffix ? `/area${suffix}` : '/area';
    return res.redirect(301, `${target}${search}`);
  }

  return next();
});
app.use(express.static(ROOT, { extensions: ['html'] }));

app.get(/^\/area(?:\/.*)?$/, (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  return res.sendFile(REACT_APP_INDEX, (err) => {
    if (!err) return;
    if (err.code === 'ENOENT') {
      return res
        .status(503)
        .send('Frontend React indisponivel. Rode o build da pasta frontend.');
    }
    return next(err);
  });
});

app.get('/area.html', (req, res) => res.redirect(301, '/area'));


const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

function signSession(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });
}
function verifySession(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}
function randomHex(n=32){
  return crypto.randomBytes(n).toString('hex');
}

function setAuthCookies(res, token) {
  const common = {
    sameSite: 'strict',
    secure: PROD,
    maxAge: 2 * 60 * 60 * 1000,
    path: '/'
  };
  res.cookie('session', token, { ...common, httpOnly: true });
  res.cookie('csrf',    randomHex(16), { ...common, httpOnly: false });
}
function clearAuthCookies(res){
  const common = { sameSite: 'strict', secure: PROD, path: '/' };
  res.clearCookie('session', { ...common, httpOnly:true });
  res.clearCookie('csrf',    { ...common });
}

function requireAuth(req, res, next){
  const token = req.cookies?.session;
  const data = token && verifySession(token);
  if (!data) return res.status(401).json({ error: 'unauthorized' });

  if (['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    const csrfHeader = req.get('X-CSRF-Token');
    const csrfCookie = req.cookies?.csrf;
    if (!csrfHeader || csrfHeader !== csrfCookie) {
      return res.status(403).json({ error: 'invalid_csrf' });
    }
  }
  req.user = data;
  next();
}

function requireAdmin(req, res, next) {
  return requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({ error: 'forbidden_admin' });
    }
    next();
  });
}

const sseClients = new Set();
function sseSendAll(event, payload = {}) {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const msg = `event: ${event}\ndata: ${data}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch {}
  }
}

function requireAppKey(req, res, next){
  if (!APP_PUBLIC_KEY) return res.status(403).json({ error:'public_off' });
  const key =
    req.get('X-APP-KEY') ||
    req.get('X-Palpite-Key') ||
    req.query?.key;
  if (!key || key !== APP_PUBLIC_KEY) return res.status(401).json({ error:'unauthorized' });
  next();
}

function requireOverlayKey(req, res, next){
  if (!OVERLAY_PUBLIC_KEY) {
    return res.status(403).json({ error: "overlay_off" });
  }

  const key = String(req.query?.key || req.get("X-OVERLAY-KEY") || "").trim();
  if (!key || key !== OVERLAY_PUBLIC_KEY) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}




function parseMoneyToCents(v){
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v * 100);

  const s = String(v).trim();
  if (!s) return null;

  const cleaned = s.replace(/[^\d,.\-]/g, '');
  if (!cleaned) return null;

  let numStr = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    numStr = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    numStr = cleaned.replace(',', '.');
  }

  const n = Number.parseFloat(numStr);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function normalizeNick(v){
  const s = String(v || '').trim();
  if (!s) return '';
  const noAt = s.startsWith('@') ? s.slice(1) : s;
  return noAt.slice(0, 30);
}

function mapCashbackRow(row){
  if (!row) return null;
  return {
    id: row.id,
    twitchNick: row.twitch_nick,
    pixType: row.pix_type,
    pixKey: row.pix_key,
    proofUrl: row.proof_url,
    status: row.status,
    motivo: row.motivo,
    payoutPrazoHoras: row.payout_prazo_horas,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at
  };
}

const PALPITE = {
  roundId: null,
  isOpen: false,
  buyValueCents: 0,
  winnersCount: 3,
  createdAt: null,
  actualResultCents: null,
  winners: [],
  winnersAt: null
};

const palpiteSseClients = new Set();
function palpiteSendAll(event, payload = {}) {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const msg = `event: ${event}\ndata: ${data}\n\n`;
  for (const res of palpiteSseClients) {
    try { res.write(msg); } catch {}
  }
}

const palpiteAdminSseClients = new Set();
function palpiteAdminSendAll(event, payload = {}) {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  const msg = `event: ${event}\ndata: ${data}\n\n`;
  for (const res of palpiteAdminSseClients) {
    try { res.write(msg); } catch {}
  }
}

async function palpiteLoadFromDB(){
  try{
    const { rows } = await q(
      `select id,
              is_open      as "isOpen",
              buy_value_cents as "buyValueCents",
              winners_count as "winnersCount",
              created_at   as "createdAt"
         from palpite_rounds
        order by created_at desc
        limit 1`
    );
    if (rows.length){
      const r = rows[0];
      PALPITE.roundId = r.id;
      PALPITE.isOpen = !!r.isOpen;
      PALPITE.buyValueCents = Number(r.buyValueCents || 0) | 0;
      PALPITE.winnersCount = Number(r.winnersCount || 3) | 0;
      PALPITE.createdAt = r.createdAt || null;
    }
  }catch(e){
    console.error('palpiteLoadFromDB:', e.message);
  }
}

async function palpiteGetEntries(limit = 300){
  if (!PALPITE.roundId) return [];
  const lim = Math.min(Math.max(parseInt(limit,10)||300, 1), 1000);
  const { rows } = await q(
    `select user_name  as "user",
            guess_cents as "guessCents",
            raw_text    as "rawText",
            created_at  as "createdAt",
            updated_at  as "updatedAt"
       from palpite_entries
      where round_id = $1
      order by updated_at desc, created_at desc
      limit ${lim}`,
    [PALPITE.roundId]
  );
  return rows;
}

async function palpiteCountEntries(){
  if (!PALPITE.roundId) return 0;
  const { rows } = await q(
    `select count(*)::int as c from palpite_entries where round_id = $1`,
    [PALPITE.roundId]
  );
  return rows?.[0]?.c ?? 0;
}

async function palpiteStatePayload(){
  const entries = await palpiteGetEntries(500);
  const total = await palpiteCountEntries();
  return {
    roundId: PALPITE.roundId,
    isOpen: PALPITE.isOpen,
    buyValueCents: PALPITE.buyValueCents,
    winnersCount: PALPITE.winnersCount,
    createdAt: PALPITE.createdAt,
    total,
    entries,
    actualResultCents: PALPITE.actualResultCents,
    winners: PALPITE.winners,
    winnersAt: PALPITE.winnersAt
  };
}

async function palpiteAdminCompactState(){
  const entries = await palpiteGetEntries(60);
  const lastGuesses = entries.slice(0, 24).map(e => ({
    name: e.user,
    value: (e.guessCents || 0) / 100
  }));
  return {
    open: PALPITE.isOpen,
    buyValue: (PALPITE.buyValueCents || 0) / 100,
    totalGuesses: await palpiteCountEntries(),
    lastGuesses
  };
}

app.use('/api', (req, res, next) => {
  const openRoutes = [
    '/api/auth/login',
    '/api/auth/logout',
    '/api/auth/me',
    '/api/sorteio/inscrever',
    '/api/palpite/stream',
    '/api/palpite/guess',
    '/api/palpite/state-public',
    '/api/cashbacks/submit',
    '/api/cashbacks/status',
    '/api/cashback/submit',
    '/api/cashback/status',
    '/api/cashback/ranking',
    '/api/torneio/state',
    '/api/torneio/join',
    '/api/gorjeta/join',
    '/api/gorjeta/status',
    '/api/sorteio/state-public',
    
  ];

  if (openRoutes.some(r => req.path.startsWith(r.replace('/api','')))) {
    return next();
  }

  const token = req.cookies?.session;
  const data  = token && verifySession(token);

  if (!data) {
    return res.status(401).json({ error: 'unauthorized_global' });
  }

  req.user = data;
  next();
});

app.get('/api/stream', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  res.flushHeaders?.();
  sseClients.add(res);

  const ping = setInterval(() => {
    try { res.write(`event: ping\ndata: {}\n\n`); } catch {}
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
    try { res.end(); } catch {}
  });
});

app.get("/api/palpite/stream", requireOverlayKey, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  res.flushHeaders?.();
  palpiteSseClients.add(res);

  try{
    const state = await palpiteStatePayload();
    res.write(`event: palpite-init\ndata: ${JSON.stringify(state)}\n\n`);
  }catch{}

  const ping = setInterval(() => {
    try { res.write(`event: ping\ndata: {}\n\n`); } catch {}
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    palpiteSseClients.delete(res);
    try { res.end(); } catch {}
  });
});

app.get("/api/palpite/state-public", requireOverlayKey, async (req, res) => {
  const state = await palpiteStatePayload();
  res.json(state);
});

app.get('/api/palpite/admin/stream', requireAuth, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');

  res.flushHeaders?.();
  palpiteAdminSseClients.add(res);

  try{
    const st = await palpiteAdminCompactState();
    res.write(`event: state\ndata: ${JSON.stringify(st)}\n\n`);
  }catch{}

  const ping = setInterval(() => {
    try { res.write(`event: ping\ndata: {}\n\n`); } catch {}
  }, 25000);

  req.on('close', () => {
    clearInterval(ping);
    palpiteAdminSseClients.delete(res);
    try { res.end(); } catch {}
  });
});

app.get('/api/palpite/admin/state', requireAuth, async (req, res) => {
  const st = await palpiteAdminCompactState();
  res.json(st);
});

app.post('/api/palpite/guess', requireAppKey, async (req, res) => {
  try{
    if (!PALPITE.roundId) return res.status(409).json({ error:'no_round' });
    if (!PALPITE.isOpen)  return res.status(409).json({ error:'palpite_closed' });

    const user =
      String(req.body?.user || req.body?.username || req.body?.nome || '').trim();

    const raw =
      req.body?.rawText ?? req.body?.raw ?? req.body?.text ?? req.body?.value ?? '';

    const cents = parseMoneyToCents(req.body?.value ?? req.body?.guess ?? raw);
    if (!user || cents == null || cents < 0) {
      return res.status(400).json({ error:'dados_invalidos' });
    }

    const { rows } = await q(
      `insert into palpite_entries (round_id, user_name, guess_cents, raw_text, created_at, updated_at)
       values ($1, $2, $3, $4, now(), now())
       on conflict (round_id, user_name)
       do update set guess_cents = excluded.guess_cents,
                     raw_text   = excluded.raw_text,
                     updated_at = now()
       returning user_name as "user",
                 guess_cents as "guessCents",
                 raw_text as "rawText",
                 created_at as "createdAt",
                 updated_at as "updatedAt"`,
      [PALPITE.roundId, user, cents, String(raw || '').slice(0, 300)]
    );

    const entry = rows[0];
    const total = await palpiteCountEntries();

    palpiteSendAll('palpite-guess', { entry, total });

    palpiteAdminSendAll('guess', {
      name: entry.user,
      value: (entry.guessCents || 0) / 100,
      totalGuesses: total
    });
    palpiteAdminSendAll('state', await palpiteAdminCompactState());

    sseSendAll('palpite-changed', { reason:'guess', entry });

    res.json({ ok:true, entry });
  }catch(e){
    console.error('palpite/guess:', e.message);
    res.status(500).json({ error:'falha_palpite' });
  }
});

app.get('/api/palpite/state', requireAuth, async (req, res) => {
  const state = await palpiteStatePayload();
  res.json(state);
});

app.post('/api/palpite/start', requireAuth, async (req, res) => {
  req.body = {
    buyValue: req.body?.buyValue ?? req.body?.buy ?? req.body?.buyValueCents ?? 0,
    winnersCount: req.body?.winnersCount ?? req.body?.winners ?? 3
  };
  try{
    const buyCents =
      (typeof req.body?.buyValueCents === 'number' ? (req.body.buyValueCents|0) : null) ??
      parseMoneyToCents(req.body?.buyValue ?? req.body?.buy ?? 0) ??
      0;

    let winners =
      parseInt(req.body?.winnersCount ?? req.body?.winners ?? 3, 10);

    if (!Number.isFinite(winners) || winners < 1) winners = 1;
    if (winners > 10) winners = 10;

    if (PALPITE.roundId && PALPITE.isOpen) {
      try{
        await q(
          `update palpite_rounds
              set is_open = false,
                  closed_at = now(),
                  updated_at = now()
            where id = $1`,
          [PALPITE.roundId]
        );
      }catch{}
    }

    const roundId = uid();

    await q(
      `insert into palpite_rounds (id, is_open, buy_value_cents, winners_count, created_at, updated_at)
       values ($1, true, $2, $3, now(), now())`,
      [roundId, buyCents|0, winners|0]
    );

    PALPITE.roundId = roundId;
    PALPITE.isOpen = true;
    PALPITE.buyValueCents = buyCents|0;
    PALPITE.winnersCount = winners|0;
    PALPITE.createdAt = new Date().toISOString();

    const state = await palpiteStatePayload();

    palpiteSendAll('palpite-open', state);
    palpiteAdminSendAll('state', await palpiteAdminCompactState());
    sseSendAll('palpite-changed', { reason:'open', state });

    res.json({ ok:true, roundId });
  }catch(e){
    console.error('palpite/start:', e.message);
    res.status(500).json({ error:'falha_start' });
  }
});

app.post('/api/palpite/stop', requireAuth, async (req, res) => {
  try{
    if (!PALPITE.roundId) return res.json({ ok:true });

    await q(
      `update palpite_rounds
          set is_open = false,
              closed_at = now(),
              updated_at = now()
        where id = $1`,
      [PALPITE.roundId]
    );

    PALPITE.isOpen = false;

    const state = await palpiteStatePayload();
    palpiteSendAll('palpite-close', state);
    palpiteAdminSendAll('state', await palpiteAdminCompactState());
    sseSendAll('palpite-changed', { reason:'close', state });

    res.json({ ok:true });
  }catch(e){
    console.error('palpite/stop:', e.message);
    res.status(500).json({ error:'falha_stop' });
  }
});

app.post('/api/palpite/open', requireAuth, async (req, res) => {
  try{
    const buyCents =
      (typeof req.body?.buyValueCents === 'number' ? (req.body.buyValueCents|0) : null) ??
      parseMoneyToCents(req.body?.buyValue ?? req.body?.buy ?? 0) ??
      0;

    let winners =
      parseInt(req.body?.winnersCount ?? req.body?.winners ?? 3, 10);

    if (!Number.isFinite(winners) || winners < 1) winners = 1;
    if (winners > 10) winners = 10;

    if (PALPITE.roundId && PALPITE.isOpen) {
      try{
        await q(
          `update palpite_rounds
              set is_open = false,
                  closed_at = now(),
                  updated_at = now()
            where id = $1`,
          [PALPITE.roundId]
        );
      }catch{}
    }

    const roundId = uid();

    await q(
      `insert into palpite_rounds (id, is_open, buy_value_cents, winners_count, created_at, updated_at)
       values ($1, true, $2, $3, now(), now())`,
      [roundId, buyCents|0, winners|0]
    );

    PALPITE.roundId = roundId;
    PALPITE.actualResultCents = null;
    PALPITE.winners = [];
    PALPITE.winnersAt = null;
    PALPITE.isOpen = true;
    PALPITE.buyValueCents = buyCents|0;
    PALPITE.winnersCount = winners|0;
    PALPITE.createdAt = new Date().toISOString();

    const state = await palpiteStatePayload();

    palpiteSendAll('palpite-open', state);
    palpiteAdminSendAll('state', await palpiteAdminCompactState());
    sseSendAll('palpite-changed', { reason:'open', state });

    if (twitchBot?.enabled) {
      twitchBot.say(`🔔 PALPITE ABERTO! Digite: !p 230,50`);
    }

    res.json({ ok:true, roundId });
  }catch(e){
    console.error('palpite/open:', e.message);
    res.status(500).json({ error:'falha_open' });
  }
});

app.post('/api/palpite/close', requireAuth, async (req, res) => {
  try{
    if (!PALPITE.roundId) return res.json({ ok:true });

    await q(
      `update palpite_rounds
          set is_open = false,
              closed_at = now(),
              updated_at = now()
        where id = $1`,
      [PALPITE.roundId]
    );

    PALPITE.isOpen = false;

    const state = await palpiteStatePayload();
    palpiteSendAll('palpite-close', state);
    palpiteAdminSendAll('state', await palpiteAdminCompactState());
    sseSendAll('palpite-changed', { reason:'close', state });

    if (twitchBot?.enabled) {
      twitchBot.say(`⛔ PALPITE FECHADO!`);
    }

    res.json({ ok:true });
  }catch(e){
    console.error('palpite/close:', e.message);
    res.status(500).json({ error:'falha_close' });
  }
});

app.post('/api/palpite/clear', requireAuth, async (req, res) => {
  try{
    if (!PALPITE.roundId) return res.json({ ok:true });

    await q(`delete from palpite_entries where round_id = $1`, [PALPITE.roundId]);

    PALPITE.actualResultCents = null;
    PALPITE.winners = [];
    PALPITE.winnersAt = null;

    const state = await palpiteStatePayload();
    palpiteSendAll('palpite-clear', state);

    palpiteAdminSendAll('clear', {});
    palpiteAdminSendAll('state', await palpiteAdminCompactState());

    sseSendAll('palpite-changed', { reason:'clear', state });

    res.json({ ok:true });
  }catch(e){
    console.error('palpite/clear:', e.message);
    res.status(500).json({ error:'falha_clear' });
  }
});

app.post('/api/palpite/winners', requireAdmin, async (req, res) => {
  try {
    if (!PALPITE.roundId) return res.status(409).json({ error: 'no_round' });

    let actualCents =
      req.body?.actualResultCents != null ? Number(req.body.actualResultCents) : null;

    if (!Number.isFinite(actualCents)) {
      actualCents = parseMoneyToCents(req.body?.actualResult ?? req.body?.actual ?? req.body?.value);
    }

    if (!Number.isFinite(actualCents) || actualCents == null) {
      return res.status(400).json({ error: 'actual_invalido' });
    }

    let winnersCount = Number(req.body?.winnersCount ?? PALPITE.winnersCount ?? 3);
    winnersCount = Math.max(1, Math.min(3, winnersCount));

    const entries = await palpiteGetEntries(1000);
    if (!entries.length) {
      return res.status(400).json({ error: 'sem_palpites' });
    }

    const ranked = entries
      .map(e => ({
        name: e.user,
        valueCents: Number(e.guessCents || 0) | 0,
        deltaCents: Math.abs((Number(e.guessCents || 0) | 0) - actualCents),
      }))
      .sort((a, b) => a.deltaCents - b.deltaCents);

    const winners = ranked.slice(0, winnersCount);

    PALPITE.actualResultCents = actualCents;
    PALPITE.winnersCount = winnersCount;
    PALPITE.winners = winners;
    PALPITE.winnersAt = new Date().toISOString();
    PALPITE.isOpen = false;

    const state = await palpiteStatePayload();

    palpiteSendAll('palpite-winners', state);

    palpiteAdminSendAll('state', await palpiteAdminCompactState());

    sseSendAll('palpite-changed', { reason: 'winners', winners, actualResultCents: actualCents });

    return res.json({ ok: true, winners, actualResultCents: actualCents, winnersCount });
  } catch (e) {
    console.error('palpite/winners:', e.message);
    return res.status(500).json({ error: 'falha_winners' });
  }
});

app.get(["/overlay", "/overlay.html"], (req, res) => {
  if (!OVERLAY_PUBLIC_KEY) return res.status(403).send("overlay_off");

  const key = String(req.query?.key || "").trim();
  if (!key || key !== OVERLAY_PUBLIC_KEY) return res.status(401).send("unauthorized");

  return res.sendFile(path.join(PRIVATE_ROOT, "overlay.html"));
});




app.post('/api/auth/login', loginLimiter, async (req, res) => {
  try {
    const body = req.body || {};

    const username =
      typeof body.username === "string" ? body.username.trim() : "";

    
    const rawPass = body.password ?? body.senha;

    const password =
      typeof rawPass === "string" ? rawPass : "";

    if (!username || !password) {
      return res.status(400).json({ error: "missing_fields" });
    }

    if (typeof ADMIN_PASSWORD_HASH !== "string" || !ADMIN_PASSWORD_HASH.trim()) {
      return res.status(500).json({ error: "hash_admin_nao_configurado" });
    }

    const userOk = username === ADMIN_USER;

    
    const passOk = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);

    if (!userOk || !passOk) {
      return res.status(401).json({ error: "invalid_credentials" });
    }

    const token = signSession({ sub: ADMIN_USER, role: "admin" });
    setAuthCookies(res, token);
    return res.json({ ok: true });
  } catch (e) {
    console.error("login error:", e);
    return res.status(500).json({ error: "login_failed" });
  }
});


app.post('/api/auth/logout', (req, res) => {
  clearAuthCookies(res);
  return res.json({ ok:true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.session;
  const data  = token && verifySession(token);
  if (!data) return res.status(401).json({ error: 'unauthorized' });
  return res.json({ user: { username: data.sub } });
});



app.get('/health', async (req, res) => {
  try {
    await q('select 1');
    return res.json({ ok:true, pg:true });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.message });
  }
});




app.post('/api/cashbacks/submit', requireAppKey, async (req, res) => {
  return res.status(410).json({
    error: 'cashback_public_removed',
    message: 'O envio publico do cashback foi removido. Use o fluxo do Discord.'
  });
});








app.get('/api/cashbacks/status', requireAppKey, async (req, res) => {
  try{
    const twitchNick = normalizeNick(req.query?.nick ?? req.query?.user ?? req.query?.username);
    if (!twitchNick) return res.status(400).json({ error:'dados_invalidos' });

    const { rows } = await q(
      `select *
         from cashbacks
        where lower(twitch_nick) = lower($1)
        order by created_at desc
        limit 1`,
      [twitchNick]
    );

    if (!rows.length) return res.status(404).json({ error:'not_found' });

    const { rows: c } = await q(
      `select count(*)::int as aprovados
         from cashbacks
        where lower(twitch_nick) = lower($1)
          and status = 'aprovado'`,
      [twitchNick]
    );

    return res.json({
      ok:true,
      aprovados: c?.[0]?.aprovados ?? 0,
      ...mapCashbackRow(rows[0])
    });
  }catch(e){
    console.error('cashbacks/status:', e.message);
    return res.status(500).json({ error:'falha_status' });
  }
});

app.get('/api/cashbacks', requireAdmin, async (req, res) => {
  try{
    const lim = Math.min(Math.max(parseInt(req.query?.limit || '600', 10) || 600, 1), 2000);
    const { rows } = await q(
      `select *
         from cashbacks
        order by created_at desc
        limit ${lim}`
    );
    res.json(rows.map(mapCashbackRow));
  }catch(e){
    console.error('cashbacks/list:', e.message);
    res.status(500).json({ error:'falha_list' });
  }
});

app.get('/api/cashbacks/ranking', requireAdmin, async (req, res) => {
  try{
    const lim = Math.min(Math.max(parseInt(req.query?.limit || '10', 10) || 10, 1), 100);
    const { rows } = await q(
      `select twitch_nick as nick, count(*)::int as aprovados
         from cashbacks
        where status = 'aprovado'
        group by twitch_nick
        order by aprovados desc, nick asc
        limit ${lim}`
    );
    res.json(rows);
  }catch(e){
    console.error('cashbacks/ranking:', e.message);
    res.status(500).json({ error:'falha_ranking' });
  }
});

app.patch('/api/cashbacks/:id', requireAdmin, async (req, res) => {
  try{
    const id = String(req.params.id || '').trim();
    const status = String(req.body?.status || '').trim().toLowerCase();
    const motivo = req.body?.motivo != null ? String(req.body.motivo).trim().slice(0, 500) : null;
    const prazoHorasRaw = req.body?.prazoHoras;
    const prazoHorasNum = prazoHorasRaw != null ? parseInt(prazoHorasRaw, 10) : null;
    const prazoHoras = prazoHorasNum != null && Number.isFinite(prazoHorasNum) ? Math.max(1, Math.min(720, prazoHorasNum)) : null;

    if (!id) return res.status(400).json({ error:'dados_invalidos' });
    if (!['aprovado','reprovado','pendente'].includes(status)) {
      return res.status(400).json({ error:'status_invalido' });
    }
    if (status === 'reprovado' && !motivo) {
      return res.status(400).json({ error:'motivo_obrigatorio' });
    }

    const motivoFinal = status === 'pendente' ? null : (motivo || null);
    const prazoFinal = status === 'aprovado' ? (prazoHoras || 24) : null;

    const { rows } = await q(
      `update cashbacks
          set status = $2,
              motivo = $3,
              payout_prazo_horas = $4,
              updated_at = now(),
              decided_at = case when cashbacks.status <> $2 and $2 <> 'pendente' then now() else cashbacks.decided_at end
        where id = $1
        returning *`,
      [id, status, motivoFinal, prazoFinal]
    );

    if (!rows.length) return res.status(404).json({ error:'not_found' });

    sseSendAll('cashbacks-changed', { reason:'update', id });
    res.json(mapCashbackRow(rows[0]));
  }catch(e){
    console.error('cashbacks/update:', e.message);
    res.status(500).json({ error:'falha_update' });
  }
});

registerTorneioRoutes({
  app, q, uid,
  requireAppKey,
  requireOverlayKey,
  requireAdmin,
  sseSendAll,
  announce: async (msg) => {
    if (twitchBot?.enabled) await twitchBot.say(msg);
  }
});



registerCashbackRoutes({
  app,
  q,
  uid,
  requireAppKey,
  requireAuth,
  requireAdmin,
  sseSendAll
});

registerGorjetaRoutes({
  app,
  q,
  requireAppKey,
  requireAuth,
  requireAdmin,
  sseSendAll,
  discordBot
});

registerBatalhaBonusRoutes({
  app,
  q,
  uid,
  requireAppKey,
  requireAdmin,
  sseSendAll,
  announce: async () => {}
});

const areaAuth = [requireAuth];

app.get('/api/bancas', areaAuth, async (req, res) => {
  try {
    const { rows } = await q(
      `select id, nome,
              deposito_cents as "depositoCents",
              banca_cents    as "bancaCents",
              pix_type       as "pixType",
              pix_key        as "pixKey",
              message        as "message",
              created_at     as "createdAt"
       from bancas
       order by created_at desc`
    );
    res.json(rows);
  } catch (e) {
    console.error('bancas/list:', e.message);
    res.status(500).json({ error: 'falha_bancas_list' });
  }
});

app.post('/api/bancas', areaAuth, async (req, res) => {
  try {
    const { nome, depositoCents, pixType=null, pixKey=null, message=null } = req.body || {};
    if (!nome || typeof depositoCents !== 'number' || depositoCents <= 0) {
      return res.status(400).json({ error: 'dados_invalidos' });
    }
    const id = uid();
    const { rows } = await q(
      `insert into bancas (id, nome, deposito_cents, banca_cents, pix_type, pix_key, message, created_at)
       values ($1,$2,$3,$4,$5,$6,$7, now())
       returning id, nome, deposito_cents as "depositoCents", banca_cents as "bancaCents",
                 pix_type as "pixType", pix_key as "pixKey", message as "message", created_at as "createdAt"`,
      [id, nome, depositoCents, null, pixType, pixKey, message]
    );

    sseSendAll('bancas-changed', { reason: 'insert' });
    res.json(rows[0]);
  } catch (e) {
    console.error('bancas/create:', e.message);
    res.status(500).json({ error: 'falha_bancas_create' });
  }
});

app.patch('/api/bancas/:id', areaAuth, async (req, res) => {
  try {
    const { bancaCents } = req.body || {};
    if (typeof bancaCents !== 'number' || bancaCents < 0) {
      return res.status(400).json({ error: 'dados_invalidos' });
    }
    const { rows } = await q(
      `update bancas set banca_cents = $2
       where id = $1
       returning id, nome,
                 deposito_cents as "depositoCents",
                 banca_cents    as "bancaCents",
                 pix_type       as "pixType",
                 pix_key        as "pixKey",
                 message        as "message",
                 created_at     as "createdAt"`,
      [req.params.id, bancaCents]
    );
    if (!rows.length) return res.status(404).json({ error:'not_found' });

    sseSendAll('bancas-changed', { reason: 'update' });
    res.json(rows[0]);
  } catch (e) {
    console.error('bancas/update:', e.message);
    res.status(500).json({ error: 'falha_bancas_update' });
  }
});

app.post('/api/bancas/:id/to-pagamento', areaAuth, async (req, res) => {
  const { bancaCents } = req.body || {};
  const client = await pool.connect();
  try{
    await client.query('begin');

    const sel = await client.query(
      `select id, nome, deposito_cents, banca_cents, pix_type, pix_key, message, created_at
       from bancas where id = $1 for update`,
      [req.params.id]
    );
    if (!sel.rows.length) {
      await client.query('rollback');
      return res.status(404).json({ error:'not_found' });
    }
    const b = sel.rows[0];

    const bancaFinal = (typeof bancaCents === 'number' && bancaCents >= 0)
      ? bancaCents
      : (typeof b.banca_cents === 'number' && b.banca_cents > 0 ? b.banca_cents : b.deposito_cents);

    await client.query(
      `insert into pagamentos (id, nome, pagamento_cents, pix_type, pix_key, message, status, created_at, paid_at)
       values ($1,$2,$3,$4,$5,$6,'nao_pago',$7,null)`,
      [b.id, b.nome, bancaFinal, b.pix_type, b.pix_key, b.message || null, b.created_at]
    );
    await client.query(`delete from bancas where id = $1`, [b.id]);

    await client.query('commit');

    sseSendAll('bancas-changed', { reason: 'moved' });
    sseSendAll('pagamentos-changed', { reason: 'moved' });

    res.json({ ok:true });
  }catch(e){
    await client.query('rollback');
    console.error('to-pagamento:', e.message);
    res.status(500).json({ error:'falha_mover' });
  }finally{
    client.release();
  }
});

app.post('/api/pagamentos/:id/to-banca', areaAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const sel = await client.query(
      `select id, nome, pagamento_cents, pix_type, pix_key, message, created_at
         from pagamentos where id = $1 for update`,
      [req.params.id]
    );
    if (!sel.rows.length) {
      await client.query('rollback');
      return res.status(404).json({ error: 'not_found' });
    }
    const p = sel.rows[0];

    await client.query(
      `insert into bancas (id, nome, deposito_cents, banca_cents, pix_type, pix_key, message, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.id, p.nome, p.pagamento_cents, p.pagamento_cents, p.pix_type, p.pix_key, p.message || null, p.created_at]
    );
    await client.query(`delete from pagamentos where id = $1`, [p.id]);

    await client.query('commit');

try {
  await discordBot?.deleteGorjetaPaymentMessage?.(p.id);
} catch {}

sseSendAll('bancas-changed', { reason: 'moved-back' });
sseSendAll('pagamentos-changed', { reason: 'moved-back' });

return res.json({ ok: true });
  } catch (e) {
    await client.query('rollback');
    console.error('to-banca:', e.message);
    return res.status(500).json({ error: 'falha_mover' });
  } finally {
    client.release();
  }
});

app.delete('/api/bancas/:id', areaAuth, async (req, res) => {
  try {
    const r = await q(`delete from bancas where id = $1`, [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error:'not_found' });
    sseSendAll('bancas-changed', { reason: 'delete' });
    res.json({ ok:true });
  } catch (e) {
    console.error('bancas/delete:', e.message);
    res.status(500).json({ error: 'falha_bancas_delete' });
  }
});

app.get('/api/pagamentos', areaAuth, async (req, res) => {
  try {
    const { rows } = await q(
      `select id, nome,
              pagamento_cents as "pagamentoCents",
              pix_type        as "pixType",
              pix_key         as "pixKey",
              message         as "message",
              status,
              created_at      as "createdAt",
              paid_at         as "paidAt"
       from pagamentos
       order by created_at desc`
    );
    res.json(rows);
  } catch (e) {
    console.error('pagamentos/list:', e.message);
    res.status(500).json({ error: 'falha_pagamentos_list' });
  }
});

app.patch('/api/pagamentos/:id', areaAuth, async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!['pago','nao_pago'].includes(status)) {
      return res.status(400).json({ error: 'status_invalido' });
    }

    const beforeQ = await q(
      `select id, nome, pagamento_cents, status, paid_at from pagamentos where id = $1`,
      [req.params.id]
    );
    if (!beforeQ.rows.length) return res.status(404).json({ error:'not_found' });

    const { rows } = await q(
      `update pagamentos
         set status = $2,
             paid_at = case when $2 = 'pago' then now() else null end
       where id = $1
       returning id, nome,
                 pagamento_cents as "pagamentoCents",
                 pix_type as "PixType",
                 pix_key  as "pixKey",
                 status, created_at as "CreatedAt", paid_at as "paidAt"`,
      [req.params.id, status]
    );
    if (!rows.length) return res.status(404).json({ error:'not_found' });

    sseSendAll('pagamentos-changed', { reason: 'update-status' });
    res.json(rows[0]);
  } catch (e) {
    console.error('pagamentos/update:', e.message);
    res.status(500).json({ error: 'falha_pagamentos_update' });
  }
});

app.delete('/api/pagamentos/:id', areaAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('begin');

    const sel = await client.query(
      `select id, nome, pagamento_cents, status, paid_at
         from pagamentos
        where id = $1
        for update`,
      [req.params.id]
    );
    if (!sel.rows.length) {
      await client.query('rollback');
      return res.status(404).json({ error:'not_found' });
    }
    const p = sel.rows[0];

    let insertedExtrato = false;
    if (p.status === 'pago') {
      await client.query(
        `insert into extratos (id, ref_id, nome, tipo, valor_cents, created_at)
         values ($1,$2,$3,'pagamento',$4, coalesce($5, now()))`,
        [uid(), p.id, p.nome, p.pagamento_cents, p.paid_at]
      );
      insertedExtrato = true;
    }

    const del = await client.query(`delete from pagamentos where id = $1`, [p.id]);
    if (del.rowCount === 0) {
      await client.query('rollback');
      return res.status(404).json({ error:'not_found' });
    }

    await client.query('commit');

try {
  await discordBot?.deleteGorjetaPaymentMessage?.(p.id);
} catch {}

if (insertedExtrato) sseSendAll('extratos-changed', { reason: 'pagamento-finalizado' });
sseSendAll('pagamentos-changed', { reason: 'delete' });

return res.json({ ok:true });
  } catch (e) {
    await client.query('rollback');
    console.error('delete pagamento:', e.message);
    return res.status(500).json({ error:'falha_delete' });
  } finally {
    client.release();
  }
});

app.get('/qr', async (req, res) => {
  try {
    const data = String(req.query.data || '');
    const size = Math.max(120, Math.min(1024, parseInt(req.query.size || '240', 10)));
    if (!data) return res.status(400).send('missing data');

    const png = await QRCode.toBuffer(data, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 1,
      width: size
    });

    res.set('Content-Type', 'image/png');
    res.send(png);
  } catch (e) {
    res.status(500).send('qr error');
  }
});

app.get('/api/sorteio/state-public', async (req, res) => {
  try {
    const r = await q('SELECT is_open FROM sorteio_state WHERE id=1', []);
    res.json({ open: !!r?.rows?.[0]?.is_open });
  } catch (e) {
    res.status(200).json({ open: false });
  }
});


app.get('/api/sorteio/state', areaAuth, async (req, res) => {
  const r = await q(`SELECT is_open, discord_channel_id, discord_message_id FROM sorteio_state WHERE id=1`);
  const row = r?.rows?.[0];

  res.json({
    open: !!row?.is_open,
    channelId: row?.discord_channel_id || null,
    messageId: row?.discord_message_id || null
  });
});

app.patch('/api/sorteio/state', areaAuth, async (req, res) => {
  const open = !!req.body?.open;

  await q(
    `INSERT INTO sorteio_state (id, is_open, updated_at)
     VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE
     SET is_open = EXCLUDED.is_open,
         updated_at = now()`,
    [open]
  );

  
  try { await discordBot?.updateSorteioMessage?.(open); } catch {}

  
  try { sseSendAll('sorteio-state', { open }); } catch {}

  res.json({ ok: true, open });
});





app.get('/api/sorteio/inscricoes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nome_twitch, mensagem, criado_em FROM sorteio_inscricoes ORDER BY criado_em DESC'
    );
    res.json(rows);
  } catch (err) {
    console.error('GET /api/sorteio/inscricoes', err);
    res.status(500).json({ error: 'Erro ao buscar inscritos' });
  }
});

app.post('/api/sorteio/inscrever', async (req, res) => {
  return res.status(410).json({
    ok: false,
    code: 'SORTEIO_PUBLICO_REMOVIDO',
    error: 'A inscricao publica foi removida. O sorteio agora funciona apenas pelo Discord.'
  });
});


app.delete('/api/sorteio/inscricoes/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'ID inválido' });

    await pool.query('DELETE FROM sorteio_inscricoes WHERE id = $1', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/sorteio/inscricoes/:id', err);
    res.status(500).json({ error: 'Erro ao excluir inscrição' });
  }
});

app.delete('/api/sorteio/inscricoes', async (req, res) => {
  try {
    await pool.query('TRUNCATE TABLE sorteio_inscricoes');
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/sorteio/inscricoes', err);
    res.status(500).json({ error: 'Erro ao limpar inscrições' });
  }
});

app.post('/api/bancas/manual', areaAuth, async (req, res) => {
  const { nome, depositoCents, pixKey, pixType } = req.body || {};

  const nomeTrim    = (nome || '').trim();
  const deposito    = Number(depositoCents || 0) | 0;
  const pix         = (pixKey || '').trim();
  const pixTypeNorm = ['email','cpf','phone','random'].includes(pixType) ? pixType : null;

  if (!nomeTrim || deposito <= 0) {
    return res.status(400).json({ error: 'Nome e depósito são obrigatórios.' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const bancaId = uid();

    const insertBanca = await client.query(
      `INSERT INTO bancas (id, nome, deposito_cents, banca_cents, pix_type, pix_key, message, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, now())
       RETURNING id, nome, deposito_cents, banca_cents, pix_type, pix_key, message, created_at`,
      [bancaId, nomeTrim, deposito, deposito, pixTypeNorm, pix || null]
    );
    const row = insertBanca.rows[0];

    await client.query(
  `INSERT INTO extratos (id, ref_id, nome, tipo, origem, valor_cents, created_at)
   VALUES ($1, $2, $3, 'deposito', 'manual', $4, now())`,
  [uid(), row.id, nomeTrim, deposito]
);


    await client.query('COMMIT');

    sseSendAll('bancas-changed', { reason: 'manual' });
    sseSendAll('extratos-changed', { reason: 'deposito-manual' });

    return res.status(201).json({
      id:            row.id,
      nome:          row.nome,
      depositoCents: row.deposito_cents,
      bancaCents:    row.banca_cents,
      pixType:       row.pix_type,
      pixKey:        row.pix_key,
      message:       row.message,
      createdAt:     row.created_at
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erro ao criar banca manual:', err);
    return res.status(500).json({ error: 'Erro ao criar banca manual.' });
  } finally {
    client.release();
  }
});

app.get('/api/extratos', areaAuth, async (req, res) => {
  try {
    let { tipo, nome, from, to, range, limit = 200 } = req.query || {};

    const conds = [];
    const params = [];
    let i = 1;

    if (tipo && ['deposito','pagamento'].includes(tipo)) {
      conds.push(`tipo = $${i++}`);
      params.push(tipo);

      if (tipo === 'deposito') {
        conds.push(`(origem is null or origem = 'pix')`);
      }
    }
    if (nome) {
      conds.push(`lower(nome) LIKE $${i++}`);
      params.push(`%${String(nome).toLowerCase()}%`);
    }

    const now = new Date();
    const startOfDay = (d)=>{
      const x = new Date(d);
      x.setHours(0,0,0,0);
      return x;
    };
    const addDays = (d,n)=>{
      const x = new Date(d);
      x.setDate(x.getDate()+n);
      return x;
    };

    if (range) {
      if (range === 'today') {
        from = startOfDay(now).toISOString();
        to   = addDays(startOfDay(now), 1).toISOString();
      }
      if (range === 'last7') {
        from = addDays(startOfDay(now), -6).toISOString();
        to   = addDays(startOfDay(now), 1).toISOString();
      }
      if (range === 'last30'){
        from = addDays(startOfDay(now), -29).toISOString();
        to   = addDays(startOfDay(now), 1).toISOString();
      }
    }

    if (from) {
      conds.push(`created_at >= $${i++}`);
      params.push(new Date(from));
    }
    if (to)   {
      conds.push(`created_at <  $${i++}`);
      params.push(new Date(to));
    }

    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const sql = `
      SELECT
        id,
        ref_id        AS "refId",
        nome,
        tipo,
        valor_cents   AS "valorCents",
        created_at    AS "createdAt"
      FROM extratos
      ${where}
      ORDER BY created_at DESC
      LIMIT ${Math.min(parseInt(limit,10)||200, 1000)}
    `;
    const { rows } = await q(sql, params);
    res.json(rows);
  } catch (e) {
    console.error('extratos/list:', e.message);
    res.status(500).json({ error: 'falha_extratos_list' });
  }
});

async function ensureMessageColumns(){
  try{
    await q(`alter table if exists bancas add column if not exists message text`);
    await q(`alter table if exists pagamentos add column if not exists message text`);
  }catch(e){
    console.error('ensureMessageColumns:', e.message);
  }
}

async function ensurePalpiteTables(){
  try{
    await q(`
      CREATE TABLE IF NOT EXISTS palpite_rounds (
        id TEXT PRIMARY KEY,
        is_open BOOLEAN NOT NULL DEFAULT false,
        buy_value_cents INTEGER NOT NULL DEFAULT 0,
        winners_count INTEGER NOT NULL DEFAULT 3,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        closed_at TIMESTAMPTZ
      )
    `);

    await q(`
      CREATE TABLE IF NOT EXISTS palpite_entries (
        id BIGSERIAL PRIMARY KEY,
        round_id TEXT NOT NULL REFERENCES palpite_rounds(id) ON DELETE CASCADE,
        user_name TEXT NOT NULL,
        guess_cents INTEGER NOT NULL,
        raw_text TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (round_id, user_name)
      )
    `);
  }catch(e){
    console.error('ensurePalpiteTables:', e.message);
  }
}


async function ensureExtratosOrigemColumn(){
  try{
    await q(`alter table if exists extratos add column if not exists origem text`);
    await q(`create index if not exists extratos_tipo_origem_created_idx on extratos (tipo, origem, created_at desc)`);
  }catch(e){
    console.error('ensureExtratosOrigemColumn:', e.message);
  }
}


async function ensureCashbacksTable(){
  try{
    await q(`
      CREATE TABLE IF NOT EXISTS cashbacks (
        id TEXT PRIMARY KEY,
        twitch_nick TEXT NOT NULL,
        pix_type TEXT,
        pix_key TEXT NOT NULL,
        proof_url TEXT,
        status TEXT NOT NULL DEFAULT 'pendente',
        motivo TEXT,
        payout_prazo_horas INTEGER,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        decided_at TIMESTAMPTZ
      )
    `);

    await q(`CREATE INDEX IF NOT EXISTS cashbacks_created_at_idx ON cashbacks (created_at DESC)`);
    await q(`CREATE INDEX IF NOT EXISTS cashbacks_nick_idx ON cashbacks (lower(twitch_nick))`);
    await q(`CREATE INDEX IF NOT EXISTS cashbacks_status_idx ON cashbacks (status)`);
  }catch(e){
    console.error('ensureCashbacksTable:', e.message);
  }
}

async function ensureSorteioStateTable(){
  try{
    await q(`
      CREATE TABLE IF NOT EXISTS sorteio_state (
        id INTEGER PRIMARY KEY,
        is_open BOOLEAN NOT NULL DEFAULT false,
        discord_channel_id TEXT,
        discord_message_id TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    
    await q(`
      INSERT INTO sorteio_state (id, is_open)
      VALUES (1, false)
      ON CONFLICT (id) DO NOTHING
    `);
  }catch(e){
    console.error('ensureSorteioStateTable:', e.message);
  }
}


async function ensureSorteioTables(){
  try{
    await q(`
      CREATE TABLE IF NOT EXISTS sorteio_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        is_open BOOLEAN NOT NULL DEFAULT false,
        discord_channel_id TEXT,
        discord_message_id TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    await q(`INSERT INTO sorteio_state (id, is_open) VALUES (1, false)
             ON CONFLICT (id) DO NOTHING`);

    await q(`
      CREATE TABLE IF NOT EXISTS sorteio_inscricoes (
        id BIGSERIAL PRIMARY KEY,
        nome_twitch TEXT NOT NULL,
        mensagem TEXT,
        criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    
    try { await q(`ALTER TABLE sorteio_inscricoes ALTER COLUMN mensagem DROP NOT NULL`); } catch {}

    
    await q(`
      CREATE UNIQUE INDEX IF NOT EXISTS sorteio_inscricoes_nome_unique
      ON sorteio_inscricoes (lower(nome_twitch))
    `);
  }catch(e){
    console.error('ensureSorteioTables:', e.message);
  }
}


let twitchBot = { enabled: false, say: async () => {} };



app.listen(PORT, async () => {

  try { await q("select 1"); } catch (e) { console.error("PG caiu:", e); }

  try { await ensureTorneioTables(q); console.log("✅ torneio tables ok"); }
  catch (e) { console.error("❌ torneio tables fail:", e); }

  try { await ensureCashbackTables(q); console.log("✅ cashback tables ok"); }
  catch (e) { console.error("❌ cashback tables fail:", e); }
  
  try { await ensureGorjetaTables(q); console.log("✅ gorjeta tables ok"); }
catch (e) { console.error("❌ gorjeta tables fail:", e); }

  try { await ensureBatalhaBonusTables(q); console.log("✅ batalha bonus tables ok"); }
catch (e) { console.error("❌ batalha bonus tables fail:", e); }

  try{
    await q('select 1');
    await ensureMessageColumns();
    await ensureCashbacksTable();
    await ensureSorteioTables();
    await ensureSorteioStateTable();
    await ensurePalpiteTables();
    await palpiteLoadFromDB();
    await ensureCashbackTables(q);
    await ensureTorneioTables(q);
    await ensureBatalhaBonusTables(q);
    await ensureExtratosOrigemColumn();
    discordBot = initDiscordBot({ q, uid, onLog: console, sseSendAll });
    console.log('🧩 Discord init retornou:', discordBot ? 'OK' : 'NULL');



    console.log('🗄️  Postgres conectado');
  } catch(e){
    console.error('❌ Postgres falhou:', e.message);
  }

  twitchBot = initTwitchBot({
  port: PORT,
  apiKey: APP_PUBLIC_KEY,
  overlayKey: OVERLAY_PUBLIC_KEY,
  botUsername: process.env.TWITCH_BOT_USERNAME,
  oauthToken: process.env.TWITCH_OAUTH_TOKEN,
  channel: process.env.TWITCH_CHANNEL,
  enabled: true,
  onLog: console,
});

  console.log(`✅ Server rodando em ${ORIGIN} (NODE_ENV=${process.env.NODE_ENV||'dev'})`);
  console.log(`🗂  Servindo estáticos de: ${ROOT}`);
  console.log(`⚛️  /area servindo a interface React`);
});
