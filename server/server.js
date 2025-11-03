import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import axios from 'axios';
import QRCode from 'qrcode';

/* =========================================================
   .env necessários (Render/produção):
   ---------------------------------------------------------
   NODE_ENV=production
   PORT=10000                       # Render injeta, pode omitir
   ORIGIN=https://seu-app.onrender.com
   STATIC_ROOT=..                   # (padrão) raiz do projeto, pai de /server

   ADMIN_USER=admin
   ADMIN_PASSWORD_HASH=<hash_bcrypt>
   JWT_SECRET=<64+ chars aleatórios>

   EFI_CLIENT_ID=...
   EFI_CLIENT_SECRET=...
   EFI_PIX_KEY=...
   EFI_BASE_URL=https://pix-h.api.efipay.com.br
   EFI_OAUTH_URL=https://pix-h.api.efipay.com.br/oauth/token
   EFI_CERT_PATH=/etc/secrets/client-cert.pem
   EFI_KEY_PATH=/etc/secrets/client-key.pem
   ========================================================= */

const {
  PORT = 3000,
  ORIGIN = `http://localhost:3000`,
  STATIC_ROOT, // opcional; default = pai de /server
  ADMIN_USER = 'admin',
  ADMIN_PASSWORD_HASH,
  JWT_SECRET,
  EFI_CLIENT_ID,
  EFI_CLIENT_SECRET,
  EFI_CERT_PATH,
  EFI_KEY_PATH,
  EFI_BASE_URL,
  EFI_OAUTH_URL,
  EFI_PIX_KEY
} = process.env;

const PROD = process.env.NODE_ENV === 'production';

// valida env do login
['ADMIN_USER','ADMIN_PASSWORD_HASH','JWT_SECRET'].forEach(k=>{
  if(!process.env[k]) { console.error(`❌ Falta ${k} no .env (login)`); process.exit(1); }
});
// valida env do Efi
['EFI_CLIENT_ID','EFI_CLIENT_SECRET','EFI_CERT_PATH','EFI_KEY_PATH','EFI_PIX_KEY','EFI_BASE_URL','EFI_OAUTH_URL']
  .forEach(k => { if(!process.env[k]) { console.error(`❌ Falta ${k} no .env (Efi)`); process.exit(1); } });

// paths
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const ROOT       = path.resolve(__dirname, STATIC_ROOT || '..'); // raiz do site (onde ficam index.html, area.html, assets/)

// ===== HTTPS agent APENAS para chamadas ao Efi =====
const httpsAgent = new https.Agent({
  cert: fs.readFileSync(EFI_CERT_PATH),
  key:  fs.readFileSync(EFI_KEY_PATH),
  rejectUnauthorized: true
});

async function getAccessToken() {
  const resp = await axios.post(
    EFI_OAUTH_URL,
    'grant_type=client_credentials',
    {
      httpsAgent,
      auth: { username: EFI_CLIENT_ID, password: EFI_CLIENT_SECRET },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    }
  );
  return resp.data.access_token;
}

// ===== app base =====
const app = express();

// Render/Proxies: necessário para cookies secure e sameSite funcionarem
app.set('trust proxy', 1);

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  // CSP opcional – se usar, mantenha JS SEM inline.
  // contentSecurityPolicy: { directives: { ... } }
}));

app.use(express.json());
app.use(cookieParser());

// Se o front for servido por ESTE MESMO servidor (recomendado), CORS nem seria necessário.
// Mantive para o caso de você consumir /api de outro domínio:
app.use(cors({
  origin: ORIGIN,
  credentials: true
}));

// Servir estáticos (site completo)
app.use(express.static(ROOT, { extensions: ['html'] }));

// ===== helpers de auth =====
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
  try { return jwt.verify(token, JWT_SECRET); } catch { return null; }
}
function randomHex(n=32){ return crypto.randomBytes(n).toString('hex'); }

function setAuthCookies(res, token) {
  const isProd = process.env.NODE_ENV === 'production';
  const common = {
    sameSite: 'strict',
    secure: isProd,            // 🔒 em prod: true
    maxAge: 2 * 60 * 60 * 1000 // 2h
  };
  res.cookie('session', token, { ...common, httpOnly: true });
  res.cookie('csrf',    randomHex(16), { ...common, httpOnly: false });
}


function clearAuthCookies(res){
  const common = {
    sameSite: PROD ? 'lax' : 'strict',
    secure: PROD,
    path: '/'
  };
  res.clearCookie('session', { ...common, httpOnly:true });
  res.clearCookie('csrf',    { ...common });
}

function requireAuth(req, res, next){
  const token = req.cookies?.session;
  const data = token && verifySession(token);
  if (!data) return res.status(401).json({ error: 'unauthorized' });

  // CSRF para métodos que alteram estado
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

// ===== rotas de auth =====
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });

  const userOk = username === ADMIN_USER;
  const passOk = await bcrypt.compare(password, ADMIN_PASSWORD_HASH);

  if (!userOk || !passOk) return res.status(401).json({ error: 'invalid_credentials' });

  const token = signSession({ sub: ADMIN_USER, role: 'admin' });
  setAuthCookies(res, token);
  return res.json({ ok: true });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  res.clearCookie('session', { httpOnly:true, sameSite:'strict', secure:isProd });
  res.clearCookie('csrf',    { sameSite:'strict', secure:isProd });
  return res.json({ ok:true });
});

app.get('/api/auth/me', (req, res) => {
  const token = req.cookies?.session;
  const data  = token && verifySession(token);
  if (!data) return res.status(401).json({ error: 'unauthorized' });
  return res.json({ user: { username: data.sub } });
});

// Protege a área
app.get('/area.html', (req, res) => {
  const token = req.cookies?.session;
  if (!token || !verifySession(token)) return res.redirect('/login.html');
  return res.sendFile(path.join(ROOT, 'area.html'));
});

// ===== endpoints de verificação geral =====
app.get('/health', (req, res) => {
  try {
    fs.accessSync(EFI_CERT_PATH); fs.accessSync(EFI_KEY_PATH);
    return res.json({ ok:true, cert:EFI_CERT_PATH, key:EFI_KEY_PATH });
  } catch {
    return res.status(500).json({ ok:false, msg:'Cert/Key não encontrados' });
  }
});
app.get('/api/pix/ping', async (req, res) => {
  try {
    const token = await getAccessToken();
    return res.json({ ok:true, token:true });
  } catch (e) {
    return res.status(500).json({ ok:false, error: e.response?.data || e.message });
  }
});

// ===== API PIX (Efi) =====
app.post('/api/pix/cob', async (req, res) => {
  try {
    const { nome, cpf, valorCentavos } = req.body || {};
    if (!nome || !valorCentavos || valorCentavos < 1000) {
      return res.status(400).json({ error: 'Dados inválidos (mínimo R$ 10,00)' });
    }
    const token = await getAccessToken();
    const valor = (valorCentavos / 100).toFixed(2);

    const payload = {
      calendario: { expiracao: 3600 },
      devedor: cpf ? { cpf: (cpf||'').replace(/\D/g,''), nome } : { nome },
      valor: { original: valor },
      chave: EFI_PIX_KEY,
      infoAdicionais: [{ nome: 'Nome', valor: nome }]
    };

    const { data: cob } = await axios.post(
      `${EFI_BASE_URL}/v2/cob`,
      payload,
      { httpsAgent, headers: { Authorization: `Bearer ${token}` } }
    );
    const { txid, loc } = cob;

    const { data: qr } = await axios.get(
      `${EFI_BASE_URL}/v2/loc/${loc.id}/qrcode`,
      { httpsAgent, headers: { Authorization: `Bearer ${token}` } }
    );

    const emv = qr.qrcode;
    const qrPng = qr.imagemQrcode || (await QRCode.toDataURL(emv));
    res.json({ txid, emv, qrPng });
  } catch (err) {
    console.error('Erro /api/pix/cob:', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao criar cobrança PIX' });
  }
});

app.get('/api/pix/status/:txid', async (req, res) => {
  try {
    const token = await getAccessToken();
    const { data } = await axios.get(
      `${EFI_BASE_URL}/v2/cob/${encodeURIComponent(req.params.txid)}`,
      { httpsAgent, headers: { Authorization: `Bearer ${token}` } }
    );
    res.json({ status: data.status });
  } catch (err) {
    console.error('Erro status:', err.response?.data || err.message);
    res.status(500).json({ error: 'Falha ao consultar status' });
  }
});

// ===== start =====
app.listen(PORT, () => {
  console.log(`✅ Server rodando em ${ORIGIN} (NODE_ENV=${process.env.NODE_ENV||'dev'})`);
  console.log(`🗂  Servindo estáticos de: ${ROOT}`);
  console.log(`🔒 /area.html protegido por sessão; login em /login.html`);
});
