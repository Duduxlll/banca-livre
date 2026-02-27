import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  Events
} from 'discord.js';
import crypto from 'node:crypto';

function asBool(v, def = false) {
  if (v == null) return def;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false;
  return def;
}

function onlyDigits(s) {
  return String(s || '').replace(/\D+/g, '');
}

function normalizeTwitchName(raw) {
  const s = String(raw || '').trim().replace(/^@+/, '');
  const cleaned = s.replace(/[^\w]/g, '');
  return cleaned.toLowerCase();
}

function isValidTwitchName(raw) {
  const s = String(raw || '').trim().replace(/^@+/, '');
  return /^[a-zA-Z0-9_]{3,25}$/.test(s);
}

function isValidEmail(s) {
  const v = String(s || '').trim();
  if (v.length < 6 || v.length > 160) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

function isValidUUID(s) {
  const v = String(s || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function isValidPhoneBR(s) {
  const d = onlyDigits(s);
  if (d.length < 10 || d.length > 13) return false;
  if (d.length === 13 && !d.startsWith('55')) return false;
  return true;
}

function isValidCPF(cpf) {
  const c = onlyDigits(cpf);
  if (c.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(c)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(c[i], 10) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== parseInt(c[9], 10)) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(c[i], 10) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  if (d2 !== parseInt(c[10], 10)) return false;

  return true;
}

function safeChannelSlug(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return (s || 'user').slice(0, 10);
}

function parseIdsCsv(v) {
  return String(v || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);
}

function nowIso() {
  return new Date().toISOString();
}

function toTitlePixType(t) {
  switch (t) {
    case 'cpf': return 'CPF';
    case 'email': return 'Email';
    case 'phone': return 'Telefone';
    case 'random': return 'Aleatória';
    default: return String(t || '');
  }
}

function maskPixKey(pixType, pixKey) {
  const k = String(pixKey || '').trim();
  if (!k) return '—';
  if (pixType === 'cpf') {
    const d = onlyDigits(k);
    if (d.length >= 4) return `***${d.slice(-4)}`;
    return '***';
  }
  if (pixType === 'phone') {
    const d = onlyDigits(k);
    if (d.length >= 4) return `***${d.slice(-4)}`;
    return '***';
  }
  if (pixType === 'email') {
    const at = k.indexOf('@');
    if (at > 1) return `${k[0]}***@${k.slice(at + 1)}`;
    return '***';
  }
  if (pixType === 'random') {
    return `${k.slice(0, 4)}***${k.slice(-4)}`;
  }
  return '***';
}

function likelyImageAttachment(att) {
  if (!att) return false;
  if (att.contentType && String(att.contentType).startsWith('image/')) return true;
  if (att.height != null || att.width != null) return true;
  const name = String(att.name || '');
  const url = String(att.url || '');
  const re = /\.(png|jpe?g|webp|gif|jfif)(\?|$)/i;
  return re.test(name) || re.test(url);
}

async function ensureTables(q) {
  await q(`
    CREATE TABLE IF NOT EXISTS discord_deposit_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      pix_type TEXT,
      twitch_name TEXT,
      pix_key TEXT,
      submission_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      closed_at TIMESTAMPTZ
    )
  `);

  await q(`CREATE INDEX IF NOT EXISTS discord_deposit_tickets_user_open_idx ON discord_deposit_tickets(user_id) WHERE closed_at IS NULL`);
  await q(`CREATE INDEX IF NOT EXISTS discord_deposit_tickets_channel_open_idx ON discord_deposit_tickets(channel_id) WHERE closed_at IS NULL`);
}

function isPlaceholderCloudinaryUrl(s) {
  const v = String(s || '');
  if (!v) return true;
  if (v.includes('<your_api_key>') || v.includes('<your_api_secret>')) return true;
  if (v.includes('your_api_key') || v.includes('your_api_secret')) return true;
  if (v.includes('%3Cyour_api_key%3E') || v.includes('%3Cyour_api_secret%3E')) return true;
  return false;
}

async function tryUploadToCloudinary({ imageUrl, ticketId, onLog }) {
  const cloudUrl = String(process.env.CLOUDINARY_URL || '').trim();
  if (!cloudUrl || isPlaceholderCloudinaryUrl(cloudUrl)) return null;

  try {
    const mod = await import('cloudinary').catch(() => null);
    if (!mod) return null;

    const v2 = mod.v2 || mod.default?.v2 || mod.default || null;
    if (!v2?.uploader?.upload) return null;

    let api_key = '';
    let api_secret = '';
    let cloud_name = '';
    try {
      const u = new URL(cloudUrl);
      api_key = decodeURIComponent(u.username || '');
      api_secret = decodeURIComponent(u.password || '');
      cloud_name = decodeURIComponent(u.hostname || '');
    } catch {
      return null;
    }

    if (!api_key || !api_secret || !cloud_name) return null;

    v2.config({ cloud_name, api_key, api_secret, secure: true });

    const folder = String(process.env.CLOUDINARY_FOLDER || 'banca-livre/depositos').trim();
    const publicId = `ticket_${String(ticketId).replace(/[^a-z0-9_-]/gi, '')}_${Date.now()}`;

    const res = await v2.uploader.upload(String(imageUrl), {
      folder,
      public_id: publicId,
      resource_type: 'image'
    });

    const out = res?.secure_url || res?.url || null;
    if (out) return String(out);
    return null;
  } catch (e) {
    onLog?.error?.('cloudinary upload falhou:', e?.message || e);
    return null;
  }
}

function reasonLabel(reason) {
  const r = String(reason || '').toLowerCase();
  if (r === 'ok') return 'OK (finalizado)';
  if (r === 'timeout') return 'Timeout (sem imagem)';
  if (r === 'idle') return 'Inativo (sem continuar)';
  if (r === 'auto') return 'Auto';
  return reason ? String(reason) : '—';
}

export function initDiscordBot({ q, uid, onLog = console, sseSendAll } = {}) {
  const enabled = asBool(process.env.DISCORD_ENABLED, true);
  if (!enabled) {
    onLog.log('🔕 Discord bot desativado (DISCORD_ENABLED=false)');
    return null;
  }

  const token = String(process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_KEY || '').trim();
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();
  const entryChannelId = String(process.env.DISCORD_ENTRY_CHANNEL_ID || '').trim();
  const sorteioChannelId = String(process.env.DISCORD_SORTEIO_CHANNEL_ID || entryChannelId || '').trim();
  const ticketsCategoryId = String(process.env.DISCORD_TICKETS_CATEGORY_ID || '').trim();

  if (!token || !guildId || !entryChannelId || !ticketsCategoryId) {
    onLog.error('❌ Variáveis faltando: DISCORD_TOKEN (ou DISCORD_BOT_KEY), DISCORD_GUILD_ID, DISCORD_ENTRY_CHANNEL_ID, DISCORD_TICKETS_CATEGORY_ID');
    return null;
  }

  const staffRoleIds = parseIdsCsv(process.env.DISCORD_STAFF_ROLE_IDS || process.env.DISCORD_STAFF_ROLE_ID);
  const logChannelId = String(process.env.DISCORD_LOG_CHANNEL_ID || '').trim();

  const waitImageMin = Math.max(1, parseInt(process.env.DISCORD_TICKET_WAIT_IMAGE_MINUTES || '5', 10) || 5);
  const deleteMin = Math.max(0, parseInt(process.env.DISCORD_TICKET_DELETE_MINUTES || '2', 10) || 2);

  const idleCloseMin = Math.max(1, parseInt(process.env.DISCORD_TICKET_IDLE_CLOSE_MINUTES || '8', 10) || 8);
  const idleWarnBeforeMin = Math.max(1, parseInt(process.env.DISCORD_TICKET_IDLE_WARN_BEFORE_MINUTES || '3', 10) || 3);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
  });

  client.on('warn', (m) => onLog.warn('DISCORD WARN:', m));
  client.on('error', (e) => onLog.error('DISCORD ERROR:', e?.message || e));
  client.on('shardError', (e) => onLog.error('DISCORD SHARD ERROR:', e?.message || e));
  client.on('shardDisconnect', (event, id) => onLog.warn('DISCORD SHARD DISCONNECT:', id, event?.code, event?.reason));
  client.on('shardReconnecting', (id) => onLog.warn('DISCORD SHARD RECONNECTING:', id));
  client.on('shardReady', (id) => onLog.log('DISCORD SHARD READY:', id));

  process.on('unhandledRejection', (e) => onLog.error('UNHANDLED REJECTION:', e));
  process.on('uncaughtException', (e) => onLog.error('UNCAUGHT EXCEPTION:', e));

  const warnCooldown = new Map();
  const waitTimers = new Map();
  const idleTimers = new Map();

  function dayEqTodaySql(col) {
    return `((${col} AT TIME ZONE 'America/Sao_Paulo')::date = (now() AT TIME ZONE 'America/Sao_Paulo')::date)`;
  }

  async function getSorteioState() {
    try {
      const r = await q(`SELECT is_open, discord_channel_id, discord_message_id FROM sorteio_state WHERE id=1`);
      const row = r?.rows?.[0] || null;
      const open = !!row?.is_open;
      const channelId = String(row?.discord_channel_id || sorteioChannelId || entryChannelId || '').trim();
      const messageId = row?.discord_message_id ? String(row.discord_message_id) : null;

      if (!row) {
        await q(
          `INSERT INTO sorteio_state (id, is_open, discord_channel_id)
           VALUES (1, false, $1)
           ON CONFLICT (id) DO NOTHING`,
          [channelId || null]
        );
      }

      return { open, channelId: channelId || null, messageId };
    } catch {
      return { open: false, channelId: sorteioChannelId || entryChannelId, messageId: null };
    }
  }

  async function setSorteioMessageIds(channelId, messageId) {
    try {
      await q(`UPDATE sorteio_state SET discord_channel_id=$1, discord_message_id=$2, updated_at=now() WHERE id=1`, [channelId || null, messageId || null]);
    } catch {}
  }

  function sorteioPayload(open) {
    const title = '🎉 SORTEIO DA LIVE — INSCRIÇÕES';

    const desc =
      '📌 **Para participar do sorteio é obrigatório:**\n' +
      '1) ter feito **DEPÓSITO HOJE**\n' +
      '2) ter enviado **HOJE** o **print do histórico de depósito** no sistema (bot: **<#1470084521423536249>**)\n\n' +
      '3) Aguarde o streamer liberar o sorteio na live.\n' +
      '4) Quando estiver liberado, clique no botão abaixo.\n' +
      '5) Digite seu **nick da Twitch** (sem @) e confirme.\n\n' +
      (open ? '🟢 **INSCRIÇÕES ABERTAS!**' : '🔴 **INSCRIÇÕES FECHADAS** — aguarde o streamer abrir.');

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(desc)
      .setColor(open ? 0x00ff99 : 0xff3333);

    const btn = new ButtonBuilder()
      .setCustomId('sorteio:join')
      .setLabel(open ? 'Inscrever no Sorteio' : 'Sorteio Fechado')
      .setStyle(open ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(!open);

    const row = new ActionRowBuilder().addComponents(btn);
    return { embeds: [embed], components: [row] };
  }

  async function findExistingSorteioMessage(ch) {
    try {
      const msgs = await ch.messages.fetch({ limit: 50 }).catch(() => null);
      if (!msgs) return null;

      const found = msgs.find(m => {
        if (!m.author || m.author.id !== client.user.id) return false;
        const hasBtn = (m.components || []).some(row =>
          (row.components || []).some(c => c?.customId === 'sorteio:join')
        );
        return hasBtn;
      });

      return found || null;
    } catch {
      return null;
    }
  }

  async function updateSorteioMessage(open) {
    const st = await getSorteioState();
    const channelId = st.channelId || sorteioChannelId || entryChannelId;
    if (!channelId) return;

    const ch = await client.channels.fetch(String(channelId)).catch(() => null);
    if (!ch || !ch.isTextBased()) return;

    const payload = sorteioPayload(!!open);

    if (st.messageId) {
      const msg = await ch.messages.fetch(String(st.messageId)).catch(() => null);
      if (msg) {
        await msg.edit(payload).catch(() => {});
        return;
      }
    }

    const existing = await findExistingSorteioMessage(ch);
    if (existing?.id) {
      await setSorteioMessageIds(String(channelId), String(existing.id));
      await existing.edit(payload).catch(() => {});
      return;
    }

    const sent = await ch.send(payload).catch(() => null);
    if (sent?.id) {
      await setSorteioMessageIds(String(channelId), String(sent.id));
    }
  }

  async function jaInscritoSorteio(twitchName) {
    const nn = normalizeTwitchName(twitchName);
    try {
      const r = await q(`SELECT 1 FROM sorteio_inscricoes WHERE lower(nome_twitch)=$1 LIMIT 1`, [nn]);
      return (r?.rows?.length || 0) > 0;
    } catch {
      return false;
    }
  }

  async function inserirSorteio(twitchName) {
    const nome = String(twitchName || '').trim().replace(/^@+/, '');
    await q(`INSERT INTO sorteio_inscricoes (nome_twitch, mensagem) VALUES ($1, NULL)`, [nome]);
  }

  async function getPrintHojeInfo(twitchName) {
    const nn = normalizeTwitchName(twitchName);

    try {
      const r = await q(
        `SELECT status, reason
         FROM cashback_submissions
         WHERE lower(twitch_name)=$1
           AND ${dayEqTodaySql('created_at')}
         ORDER BY created_at DESC
         LIMIT 1`,
        [nn]
      );

      const row = r?.rows?.[0] || null;
      if (!row) return { found: false, status: null, reason: null };

      const status = row.status ? String(row.status).toUpperCase() : null;
      const reason = row.reason ? String(row.reason) : null;

      return { found: true, status, reason };
    } catch {
      return { found: false, status: null, reason: null };
    }
  }

  async function openSorteioModal(interaction) {
    const st = await getSorteioState();
    if (!st.open) {
      await interaction.reply({ ephemeral: true, content: 'Sorteio está fechado. Aguarde o streamer abrir.' }).catch(() => {});
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId('sorteio:modal')
      .setTitle('Inscrever no sorteio');

    const inp = new TextInputBuilder()
      .setCustomId('twitch_name')
      .setLabel('Seu nick da Twitch (sem @)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(25)
      .setPlaceholder('ex: seuNick');

    modal.addComponents(new ActionRowBuilder().addComponents(inp));

    await interaction.showModal(modal).catch(async () => {
      await interaction.reply({ ephemeral: true, content: 'Não consegui abrir o formulário. Tenta de novo.' }).catch(() => {});
    });
  }

  async function handleSorteioModal(interaction) {
    const raw = String(interaction.fields.getTextInputValue('twitch_name') || '');
    const nome = raw.trim().replace(/^@+/, '');

    if (!isValidTwitchName(nome)) {
      await interaction.reply({ ephemeral: true, content: 'Nick inválido. Use 3–25 caracteres (letras, números e _).' }).catch(() => {});
      return;
    }

    const st = await getSorteioState();
    if (!st.open) {
      await interaction.reply({ ephemeral: true, content: 'Sorteio está fechado. Aguarde o streamer abrir.' }).catch(() => {});
      return;
    }

    if (await jaInscritoSorteio(nome)) {
      await interaction.reply({ ephemeral: true, content: `@${nome} já está inscrito.` }).catch(() => {});
      return;
    }

    const info = await getPrintHojeInfo(nome);

    if (!info.found) {
      await interaction.reply({
        ephemeral: true,
        content: 'Para participar, você precisa ter enviado **HOJE** o print do **histórico de depósito** no sistema (<#1470084521423536249>).'
      }).catch(() => {});
      return;
    }

    if (info.status === 'PENDENTE') {
      await interaction.reply({
        ephemeral: true,
        content: 'Seu print de **hoje** foi recebido e está **PENDENTE**. Aguarde um admin aprovar e tente novamente.'
      }).catch(() => {});
      return;
    }

    if (info.status === 'REPROVADO') {
      const motivo = info.reason ? `\nMotivo: **${info.reason}**` : '';
      await interaction.reply({
        ephemeral: true,
        content: `Seu print de **hoje** foi **REPROVADO**.${motivo}`
      }).catch(() => {});
      return;
    }

    if (info.status !== 'APROVADO') {
      await interaction.reply({
        ephemeral: true,
        content: `Seu print de hoje está com status: **${info.status || 'DESCONHECIDO'}**.`
      }).catch(() => {});
      return;
    }

    try {
      await inserirSorteio(nome);
      if (typeof sseSendAll === 'function') {
        sseSendAll('sorteio-changed', { action: 'join', nome_twitch: nome });
      }
      await interaction.reply({ ephemeral: true, content: `Inscrição confirmada: @${nome}. Boa sorte! 🍀` }).catch(() => {});
    } catch (e) {
      if (e?.code === '23505') {
        await interaction.reply({ ephemeral: true, content: `@${nome} já está inscrito.` }).catch(() => {});
      } else {
        await interaction.reply({ ephemeral: true, content: 'Erro ao inscrever. Tenta de novo.' }).catch(() => {});
      }
    }
  }

  async function logTicket(event) {
    if (!logChannelId) return;

    try {
      const ch = await client.channels.fetch(String(logChannelId)).catch(() => null);
      if (!ch || !ch.isTextBased()) return;

      const kind = String(event?.kind || '').toUpperCase();
      const userId = String(event?.userId || '');
      const channelId = String(event?.channelId || '');
      const ticketId = String(event?.ticketId || '');
      const submissionId = event?.submissionId ? String(event.submissionId) : '';
      const reason = event?.reason ? String(event.reason) : '';

      const guild = await client.guilds.fetch(String(guildId)).catch(() => null);

      let username = '';
      try {
        if (guild && userId) {
          const m = await guild.members.fetch(userId).catch(() => null);
          username = m?.user?.username ? String(m.user.username) : '';
        }
      } catch {}

      let channelName = '';
      try {
        if (channelId) {
          const c = await client.channels.fetch(channelId).catch(() => null);
          channelName = c?.name ? String(c.name) : '';
        }
      } catch {}

      const userLabel = username ? `@${username}` : '—';
      const userText = userId ? `${userLabel} (\`${userId}\`)` : '—';
      const channelText =
        channelId
          ? (channelName ? `#${channelName} (\`${channelId}\`)` : `\`${channelId}\``)
          : '—';

      let title = '📌 Log';
      let color = 0x95a5a6;
      let desc = '';

      if (kind === 'OPEN') {
        title = '🟢 Ticket aberto';
        color = 0x2ecc71;
        desc = 'Um novo ticket de depósito foi criado.';
      } else if (kind === 'FINAL') {
        title = '✅ Ticket finalizado';
        color = 0x3498db;
        desc = 'Print recebido e registrado no sistema (status **PENDENTE**).';
      } else if (kind === 'CLOSE') {
        title = '🔴 Ticket fechado';
        const r = String(reason || '').toLowerCase();
        color = (r === 'ok') ? 0xe74c3c : (r === 'timeout' ? 0xf39c12 : (r === 'idle' ? 0xf1c40f : 0xe67e22));
        desc = `Encerrado: **${reasonLabel(reason)}**.`;
      }

      const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(desc)
        .setColor(color)
        .addFields(
          { name: 'Usuário', value: userText, inline: true },
          { name: 'Canal', value: channelText, inline: true },
          { name: 'Ticket ID', value: ticketId ? `\`${ticketId}\`` : '—', inline: false }
        )
        .setTimestamp(new Date());

      if (submissionId) {
        embed.addFields({ name: 'Submission ID', value: `\`${submissionId}\``, inline: true });
      }

      if (kind === 'CLOSE') {
        embed.addFields({ name: 'Motivo', value: reasonLabel(reason), inline: true });
      }

      await ch.send({
        embeds: [embed],
        allowedMentions: { parse: [] }
      }).catch(() => {});
    } catch {}
  }

  async function getOpenTicketByUser(userId) {
    const r = await q(
      `SELECT * FROM discord_deposit_tickets WHERE user_id=$1 AND closed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
      [String(userId)]
    );
    return r?.rows?.[0] || null;
  }

  async function getOpenTicketById(ticketId) {
    const r = await q(
      `SELECT * FROM discord_deposit_tickets WHERE id=$1 AND closed_at IS NULL LIMIT 1`,
      [String(ticketId)]
    );
    return r?.rows?.[0] || null;
  }

  async function getOpenTicketByChannel(channelId) {
    const r = await q(
      `SELECT * FROM discord_deposit_tickets WHERE channel_id=$1 AND closed_at IS NULL LIMIT 1`,
      [String(channelId)]
    );
    return r?.rows?.[0] || null;
  }

  function clearWaitTimer(ticketId) {
    const h = waitTimers.get(String(ticketId));
    if (h) {
      clearTimeout(h);
      waitTimers.delete(String(ticketId));
    }
  }

  function clearIdle(ticketId) {
    const t = idleTimers.get(String(ticketId));
    if (!t) return;
    if (t.warn) clearTimeout(t.warn);
    if (t.close) clearTimeout(t.close);
    idleTimers.delete(String(ticketId));
  }

  async function scheduleIdle(ticketId, channelId, userId) {
    clearIdle(ticketId);

    const warnAtMin = Math.max(1, idleCloseMin - idleWarnBeforeMin);

    const warn = setTimeout(async () => {
      try {
        const t = await getOpenTicketById(ticketId);
        if (!t) return;
        if (String(t.status) === 'WAIT_IMAGE') return;
        const ch = await client.channels.fetch(String(channelId)).catch(() => null);
        if (ch && ch.isTextBased()) {
          await ch.send({
            content: `⏳ <@${userId}> Sem atividade. Este ticket vai fechar em **${idleWarnBeforeMin} min** se você não continuar.`
          }).catch(() => {});
        }
      } catch {}
    }, warnAtMin * 60 * 1000);

    const close = setTimeout(() => {
      closeTicket(String(ticketId), 'idle');
    }, idleCloseMin * 60 * 1000);

    idleTimers.set(String(ticketId), { warn, close });
  }

  async function scheduleDeleteChannel(channelId) {
    if (!deleteMin) return;
    setTimeout(async () => {
      try {
        const ch = await client.channels.fetch(String(channelId)).catch(() => null);
        if (ch && ch.deletable) {
          await ch.delete('auto delete').catch(() => {});
        }
      } catch {}
    }, deleteMin * 60 * 1000);
  }

  async function closeTicket(ticketId, reason = 'auto') {
    const t = await getOpenTicketById(ticketId);
    if (!t) return;

    clearWaitTimer(ticketId);
    clearIdle(ticketId);

    await q(
      `UPDATE discord_deposit_tickets SET closed_at=now(), status='CLOSED', updated_at=now() WHERE id=$1`,
      [String(ticketId)]
    );

    await logTicket({
      kind: 'CLOSE',
      userId: t.user_id,
      channelId: t.channel_id,
      ticketId: t.id,
      reason
    });

    try {
      const ch = await client.channels.fetch(String(t.channel_id)).catch(() => null);
      if (!ch) return;

      const guild = await client.guilds.fetch(guildId);
      const everyoneId = guild.roles.everyone.id;

      await ch.permissionOverwrites.edit(everyoneId, { ViewChannel: false }).catch(() => {});
      await ch.permissionOverwrites.edit(String(t.user_id), {
        ViewChannel: false,
        SendMessages: false,
        AttachFiles: false
      }).catch(() => {});

      const newName = String(ch.name || '').startsWith('fechado-')
        ? String(ch.name)
        : `fechado-${String(ch.name || '').slice(0, 90)}`;

      await ch.setName(newName).catch(() => {});
      await ch.send({ content: `✅ Ticket encerrado (${reason}).` }).catch(() => {});

      if (deleteMin) {
        await ch.send({ content: `🧹 Este canal será apagado automaticamente em **${deleteMin} min**.` }).catch(() => {});
        await scheduleDeleteChannel(ch.id);
      }
    } catch (e) {
      onLog.error('closeTicket falhou:', e?.message || e);
    }
  }

  function hasStaffRole(member) {
    if (!member) return false;
    if (!staffRoleIds.length) return false;
    return staffRoleIds.some(rid => member.roles?.cache?.has(rid));
  }

  function buildEntryMessage() {
    const embed = new EmbedBuilder()
      .setTitle('📩 Enviar print do depósito')
      .setDescription(
        'Clique no botão abaixo para abrir um **ticket privado**.\n\n' +
        'Dentro do ticket você vai:\n' +
        '1) escolher o **Tipo Pix**\n' +
        '2) preencher **Nick da Twitch + Chave Pix**\n' +
        '3) anexar o **print do histórico de depósito** (PNG/JPG/WEBP)'
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dep:open')
        .setLabel('Enviar print do depósito')
        .setStyle(ButtonStyle.Success)
    );

    return { embeds: [embed], components: [row] };
  }

  function buildTicketPanel(ticketId) {
    const embed = new EmbedBuilder()
      .setTitle('📄 Envio de print do depósito')
      .setDescription(
        'Passo a passo:\n' +
        '1) Escolha o **Tipo Pix** no seletor abaixo\n' +
        '2) Clique em **Preencher dados** (Nick da Twitch + Chave Pix)\n' +
        '3) Depois envie **APENAS a imagem** do print aqui no ticket (PNG/JPG/WEBP)'
      );

    const select = new StringSelectMenuBuilder()
      .setCustomId(`dep:pick:${ticketId}`)
      .setPlaceholder('Escolha o Tipo Pix')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('CPF').setValue('cpf'),
        new StringSelectMenuOptionBuilder().setLabel('Email').setValue('email'),
        new StringSelectMenuOptionBuilder().setLabel('Telefone').setValue('phone'),
        new StringSelectMenuOptionBuilder().setLabel('Aleatória').setValue('random')
      );

    const row1 = new ActionRowBuilder().addComponents(select);

    const btn = new ButtonBuilder()
      .setCustomId(`dep:fill:${ticketId}`)
      .setLabel('Preencher dados')
      .setStyle(ButtonStyle.Primary);

    const row2 = new ActionRowBuilder().addComponents(btn);

    return { embeds: [embed], components: [row1, row2] };
  }

  function buildModal(ticketId) {
    const modal = new ModalBuilder()
      .setCustomId(`dep:modal:${ticketId}`)
      .setTitle('Enviar dados do depósito');

    const twitch = new TextInputBuilder()
      .setCustomId('twitch')
      .setLabel('Nick da Twitch (sem @)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(25);

    const pix = new TextInputBuilder()
      .setCustomId('pix')
      .setLabel('Chave Pix')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(160);

    modal.addComponents(
      new ActionRowBuilder().addComponents(twitch),
      new ActionRowBuilder().addComponents(pix)
    );

    return modal;
  }

  async function ensureEntryMessage() {
    const ch = await client.channels.fetch(entryChannelId).catch(() => null);
    if (!ch || !ch.isTextBased()) return;

    const msgs = await ch.messages.fetch({ limit: 30 }).catch(() => null);
    const already = msgs?.find(m => {
      if (!m.author || m.author.id !== client.user.id) return false;
      const hasBtn = (m.components || []).some(row =>
        (row.components || []).some(c => c.customId === 'dep:open')
      );
      return hasBtn;
    });

    if (!already) {
      await ch.send(buildEntryMessage()).catch(() => {});
    }
  }

  async function openTicket(interaction) {
    try {
      await interaction.deferReply({ ephemeral: true }).catch(() => {});
    } catch {}

    const userId = interaction.user.id;
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId).catch(() => null);

    let existing = await getOpenTicketByUser(userId);

    if (existing) {
      const ch = await client.channels.fetch(String(existing.channel_id)).catch(() => null);
      if (ch) {
        await interaction.editReply({
          content: `Você já tem um ticket aberto: <#${ch.id}>`
        }).catch(() => {});
        return;
      }

      await q(
        `UPDATE discord_deposit_tickets SET closed_at=now(), status='CLOSED', updated_at=now() WHERE id=$1`,
        [String(existing.id)]
      );
      clearWaitTimer(String(existing.id));
      clearIdle(String(existing.id));
      existing = null;
    }

    const ticketId = (typeof uid === 'function' ? uid() : crypto.randomUUID());
    const slug = safeChannelSlug(member?.user?.username || interaction.user.username);
    const rand = Math.floor(100 + Math.random() * 900);
    const channelName = `ticket-${slug}-${rand}`;

    const overwrites = [];

    overwrites.push({
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel]
    });

    overwrites.push({
      id: userId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles
      ]
    });

    for (const rid of staffRoleIds) {
      overwrites.push({
        id: rid,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.ManageMessages,
          PermissionsBitField.Flags.AttachFiles
        ]
      });
    }

    overwrites.push({
      id: client.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ManageMessages,
        PermissionsBitField.Flags.AttachFiles
      ]
    });

    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: ticketsCategoryId,
      permissionOverwrites: overwrites,
      topic: `ticketId=${ticketId} userId=${userId} created=${nowIso()}`
    });

    await q(
      `INSERT INTO discord_deposit_tickets (id, user_id, channel_id, status, created_at, updated_at)
       VALUES ($1,$2,$3,'OPEN',now(),now())`,
      [String(ticketId), String(userId), String(ticketChannel.id)]
    );

    await logTicket({
      kind: 'OPEN',
      userId,
      channelId: ticketChannel.id,
      ticketId
    });

    const pingStaff = staffRoleIds.length ? staffRoleIds.map(r => `<@&${r}>`).join(' ') : '';
    await ticketChannel.send({
      content: `${pingStaff} <@${userId}>`,
      ...buildTicketPanel(ticketId)
    }).catch(() => {});

    await interaction.editReply({
      content: `✅ Ticket criado: <#${ticketChannel.id}>`
    }).catch(() => {});

    await scheduleIdle(ticketId, ticketChannel.id, userId);
  }

  async function handlePick(interaction, ticketId) {
    const t = await getOpenTicketById(ticketId);
    if (!t) {
      await interaction.reply({ ephemeral: true, content: 'Esse ticket não está mais ativo.' }).catch(() => {});
      return;
    }

    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    const isOwner = String(interaction.user.id) === String(t.user_id);
    const staff = hasStaffRole(member);

    if (!isOwner && !staff) {
      await interaction.reply({ ephemeral: true, content: 'Sem permissão.' }).catch(() => {});
      return;
    }

    const val = interaction.values?.[0] || null;
    if (!['cpf', 'email', 'phone', 'random'].includes(val)) {
      await interaction.reply({ ephemeral: true, content: 'Tipo Pix inválido.' }).catch(() => {});
      return;
    }

    await q(
      `UPDATE discord_deposit_tickets SET pix_type=$2, updated_at=now() WHERE id=$1`,
      [String(ticketId), String(val)]
    );

    await scheduleIdle(ticketId, t.channel_id, t.user_id);

    await interaction.reply({
      ephemeral: true,
      content: `✅ Tipo Pix selecionado: **${toTitlePixType(val)}**`
    }).catch(() => {});
  }

  async function handleFill(interaction, ticketId) {
    const t = await getOpenTicketById(ticketId);
    if (!t) {
      await interaction.reply({ ephemeral: true, content: 'Esse ticket não está mais ativo.' }).catch(() => {});
      return;
    }

    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    const isOwner = String(interaction.user.id) === String(t.user_id);
    const staff = hasStaffRole(member);

    if (!isOwner && !staff) {
      await interaction.reply({ ephemeral: true, content: 'Sem permissão.' }).catch(() => {});
      return;
    }

    if (!t.pix_type) {
      await interaction.reply({ ephemeral: true, content: 'Escolha o **Tipo Pix** primeiro.' }).catch(() => {});
      return;
    }

    await scheduleIdle(ticketId, t.channel_id, t.user_id);

    await interaction.showModal(buildModal(ticketId)).catch(() => {});
  }

  function scheduleWaitImage(ticketId) {
    clearWaitTimer(ticketId);

    const h = setTimeout(async () => {
      try {
        const t = await getOpenTicketById(ticketId);
        if (!t) return;
        if (String(t.status) !== 'WAIT_IMAGE') return;

        const ch = await client.channels.fetch(String(t.channel_id)).catch(() => null);
        if (ch && ch.isTextBased()) {
          await ch.send({ content: `⏳ Tempo esgotado. Nenhuma imagem foi enviada em ${waitImageMin} min. Fechando o ticket.` }).catch(() => {});
        }

        await closeTicket(String(ticketId), 'timeout');
      } catch {}
    }, waitImageMin * 60 * 1000);

    waitTimers.set(String(ticketId), h);
  }

  async function handleModal(interaction, ticketId) {
    const t = await getOpenTicketById(ticketId);
    if (!t) {
      await interaction.reply({ ephemeral: true, content: 'Esse ticket não está mais ativo.' }).catch(() => {});
      return;
    }

    if (!t.pix_type) {
      await interaction.reply({ ephemeral: true, content: 'Escolha o **Tipo Pix** primeiro.' }).catch(() => {});
      return;
    }

    const twitchRaw = interaction.fields.getTextInputValue('twitch');
    const pixRaw = interaction.fields.getTextInputValue('pix');

    const twitch = String(twitchRaw || '').trim().replace(/^@+/, '');
    const pixKey = String(pixRaw || '').trim();

    if (!isValidTwitchName(twitch)) {
      await interaction.reply({ ephemeral: true, content: 'Nick da Twitch inválido.' }).catch(() => {});
      return;
    }

    const pixType = String(t.pix_type);
    let ok = true;

    if (pixType === 'cpf') ok = isValidCPF(pixKey);
    else if (pixType === 'email') ok = isValidEmail(pixKey);
    else if (pixType === 'phone') ok = isValidPhoneBR(pixKey);
    else if (pixType === 'random') ok = isValidUUID(pixKey);
    else ok = false;

    if (!ok) {
      const msg =
        pixType === 'cpf' ? 'CPF inválido. Confira os 11 dígitos.' :
        pixType === 'email' ? 'Email inválido.' :
        pixType === 'phone' ? 'Telefone inválido.' :
        pixType === 'random' ? 'Chave aleatória inválida (UUID).' :
        'Chave Pix inválida.';
      await interaction.reply({ ephemeral: true, content: `❌ ${msg}` }).catch(() => {});
      return;
    }

    await q(
      `UPDATE discord_deposit_tickets
       SET twitch_name=$2, pix_key=$3, status='WAIT_IMAGE', updated_at=now()
       WHERE id=$1`,
      [String(ticketId), twitch, pixKey]
    );

    clearIdle(ticketId);
    scheduleWaitImage(ticketId);

    await interaction.reply({
      ephemeral: true,
      content: `✅ Dados recebidos. Agora envie **APENAS a imagem** do print aqui no ticket (PNG/JPG/WEBP). Você tem **${waitImageMin} min**.`
    }).catch(() => {});

    const ch = await client.channels.fetch(String(t.channel_id)).catch(() => null);
    if (ch && ch.isTextBased()) {
      await ch.send({
        content:
          `✅ **Dados recebidos**\n` +
          `Nick Twitch: **${twitch}**\n` +
          `Tipo Pix: **${toTitlePixType(pixType)}**\n` +
          `Chave Pix: **${maskPixKey(pixType, pixKey)}**\n\n` +
          `Agora envie **APENAS a imagem** do print aqui no ticket (PNG/JPG/WEBP). Você tem **${waitImageMin} min**.`
      }).catch(() => {});
    }
  }

  async function submitToCashback(t, screenshotUrl) {
    const id = (typeof uid === 'function' ? uid() : crypto.randomUUID());
    const twitchName = String(t.twitch_name || '').trim();
    const twitchLc = normalizeTwitchName(twitchName);

    await q(
      `INSERT INTO cashback_submissions
       (id, twitch_name, twitch_name_lc, pix_type, pix_key, screenshot_data_url, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDENTE',now(),now())`,
      [
        String(id),
        twitchName,
        twitchLc,
        String(t.pix_type || ''),
        String(t.pix_key || ''),
        String(screenshotUrl || '')
      ]
    );

    await q(
      `UPDATE discord_deposit_tickets
       SET submission_id=$2, status='DONE', updated_at=now()
       WHERE id=$1`,
      [String(t.id), String(id)]
    );

    if (typeof sseSendAll === 'function') {
      try { sseSendAll('cashback-changed', { reason: 'submit', id, twitch: twitchName }); } catch {}
    }

    return id;
  }

  client.on(Events.MessageCreate, async (msg) => {
    try {
      if (!msg || !msg.guildId) return;
      if (String(msg.guildId) !== String(guildId)) return;
      if (msg.author?.bot) return;

      if (msg.partial) {
        msg = await msg.fetch().catch(() => msg);
      }

      const t = await getOpenTicketByChannel(msg.channelId);
      if (!t) return;

      if (String(msg.author.id) !== String(t.user_id)) return;
      if (String(t.status) !== 'WAIT_IMAGE') return;

      const imgs = Array.from(msg.attachments?.values?.() || []).filter(likelyImageAttachment);
      if (!imgs.length) {
        const last = warnCooldown.get(msg.channelId) || 0;
        if (Date.now() - last < 20000) return;
        warnCooldown.set(msg.channelId, Date.now());

        await msg.channel.send({
          content: `<@${msg.author.id}> Manda **somente a imagem** do print (PNG/JPG/WEBP).`
        }).catch(() => {});
        return;
      }

      const att = imgs[0];
      const rawUrl = String(att.url || '');
      if (!rawUrl) return;

      clearWaitTimer(String(t.id));
      clearIdle(String(t.id));

      const uploaded = await tryUploadToCloudinary({ imageUrl: rawUrl, ticketId: t.id, onLog });
      const finalUrl = uploaded || rawUrl;

      let submissionId = null;
      try {
        submissionId = await submitToCashback(t, finalUrl);
      } catch (e) {
        onLog.error('submitToCashback falhou:', e?.message || e);
        await msg.channel.send({ content: `❌ Deu erro ao registrar o print. Tenta de novo ou chama um admin.` }).catch(() => {});
        scheduleWaitImage(String(t.id));
        return;
      }

      await logTicket({
        kind: 'FINAL',
        userId: t.user_id,
        channelId: t.channel_id,
        ticketId: t.id,
        submissionId
      });

      await msg.channel.send({
        content:
          `✅ **Print recebido e registrado!**\n` +
          `Status: **PENDENTE** — um admin vai analisar e **aprovar/reprovar**.\n` +
          `ID: \`${submissionId}\`\n` +
          `Fechando o ticket...`
      }).catch(() => {});

      setTimeout(() => {
        closeTicket(String(t.id), 'ok');
      }, 2000);
    } catch (e) {
      onLog.error('MessageCreate falhou:', e?.message || e);
    }
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isButton()) {
        if (interaction.customId === 'dep:open') {
          await openTicket(interaction);
          return;
        }

        if (interaction.customId.startsWith('dep:fill:')) {
          const ticketId = interaction.customId.split(':').slice(2).join(':');
          await handleFill(interaction, ticketId);
          return;
        }

        if (interaction.customId === 'sorteio:join') {
          await openSorteioModal(interaction);
          return;
        }
      }

      if (interaction.isStringSelectMenu()) {
        if (interaction.customId.startsWith('dep:pick:')) {
          const ticketId = interaction.customId.split(':').slice(2).join(':');
          await handlePick(interaction, ticketId);
          return;
        }
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId.startsWith('dep:modal:')) {
          const ticketId = interaction.customId.split(':').slice(2).join(':');
          await handleModal(interaction, ticketId);
          return;
        }

        if (interaction.customId === 'sorteio:modal') {
          await handleSorteioModal(interaction);
          return;
        }
      }
    } catch (e) {
      onLog.error('InteractionCreate falhou:', e?.message || e);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ ephemeral: true, content: 'Falha ao processar. Tenta de novo.' }).catch(() => {});
        }
      } catch {}
    }
  });

  async function periodicCleanup() {
    try {
      const r = await q(
        `SELECT * FROM discord_deposit_tickets WHERE closed_at IS NULL ORDER BY created_at DESC LIMIT 200`
      );
      const rows = r?.rows || [];
      for (const t of rows) {
        const ch = await client.channels.fetch(String(t.channel_id)).catch(() => null);
        if (!ch) {
          await q(
            `UPDATE discord_deposit_tickets SET closed_at=now(), status='CLOSED', updated_at=now() WHERE id=$1`,
            [String(t.id)]
          );
          clearWaitTimer(String(t.id));
          clearIdle(String(t.id));
          continue;
        }

        const created = new Date(t.created_at);
        if (Number.isFinite(created.getTime())) {
          const ageMin = (Date.now() - created.getTime()) / 60000;
          if (ageMin > 180) {
            await closeTicket(String(t.id), 'timeout');
          }
        }
      }
    } catch (e) {
      onLog.error('periodicCleanup falhou:', e?.message || e);
    }
  }

  client.once(Events.ClientReady, async () => {
    onLog.log(`🤖 Discord bot online: ${client.user.tag}`);
    await ensureTables(q);
    await ensureEntryMessage();

    try {
      const st = await getSorteioState();
      await updateSorteioMessage(st.open);
    } catch {}

    setInterval(periodicCleanup, 5 * 60 * 1000);
  });

  async function loginWithBackoff() {
    let attempt = 0;
    const maxDelay = 15 * 60 * 1000;

    while (true) {
      try {
        await client.login(token);
        return;
      } catch (e) {
        const msg = e?.message || String(e);
        onLog.error('❌ Discord login falhou:', msg);

        const delay = Math.min(30_000 * (2 ** attempt), maxDelay);
        attempt = Math.min(attempt + 1, 10);

        onLog.warn('Discord retry em ms=', delay);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  loginWithBackoff();

  return { client, updateSorteioMessage };
}