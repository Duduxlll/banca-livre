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

  await q(`
    CREATE INDEX IF NOT EXISTS discord_deposit_tickets_channel_idx
    ON discord_deposit_tickets (channel_id)
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS discord_deposit_tickets_user_idx
    ON discord_deposit_tickets (user_id)
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS discord_sorteio_state (
      id INTEGER PRIMARY KEY DEFAULT 1,
      is_open BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`
    INSERT INTO discord_sorteio_state (id, is_open)
    VALUES (1, true)
    ON CONFLICT (id) DO NOTHING
  `);

  await q(`
    CREATE TABLE IF NOT EXISTS discord_sorteio_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      discord_tag TEXT NOT NULL,
      twitch_name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS discord_sorteio_entries_user_idx
    ON discord_sorteio_entries (user_id)
  `);

  await q(`
    CREATE INDEX IF NOT EXISTS discord_sorteio_entries_twitch_idx
    ON discord_sorteio_entries (twitch_name)
  `);
}

export function initDiscordBot({ q, uid, onLog = console, sseSendAll } = {}) {
  const enabled = asBool(process.env.DISCORD_ENABLED, true);
  if (!enabled) {
    onLog.log('🔕 Discord bot desativado (DISCORD_ENABLED=false)');
    return null;
  }

  const token = process.env.DISCORD_TOKEN || process.env.DISCORD_BOT_KEY;
  const guildId = process.env.DISCORD_GUILD_ID;
  const entryChannelId = process.env.DISCORD_ENTRY_CHANNEL_ID;
  const sorteioChannelId = String(process.env.DISCORD_SORTEIO_CHANNEL_ID || entryChannelId || '').trim();
  const ticketsCategoryId = process.env.DISCORD_TICKETS_CATEGORY_ID;

  if (!token || !guildId || !entryChannelId || !ticketsCategoryId) {
    onLog.error('❌ Variáveis faltando: DISCORD_TOKEN (ou DISCORD_BOT_KEY), DISCORD_GUILD_ID, DISCORD_ENTRY_CHANNEL_ID, DISCORD_TICKETS_CATEGORY_ID');
    return null;
  }

  onLog.log('🚀 [DISCORD] init ok. Tentando login…', {
    enabled,
    hasToken: !!token,
    guildId: !!guildId,
    entryChannelId: !!entryChannelId,
    ticketsCategoryId: !!ticketsCategoryId
  });

  const staffRoleIds = parseIdsCsv(process.env.DISCORD_STAFF_ROLE_IDS || process.env.DISCORD_STAFF_ROLE_ID);
  const logChannelId = String(process.env.DISCORD_LOG_CHANNEL_ID || '').trim();

  const waitImageMin = Math.max(1, parseInt(process.env.DISCORD_TICKET_WAIT_IMAGE_MINUTES || '5', 10) || 5);
  const deleteMin = Math.max(0, parseInt(process.env.DISCORD_TICKET_DELETE_MINUTES || '2', 10) || 2);

  const idleCloseMin = Math.max(1, parseInt(process.env.DISCORD_TICKET_IDLE_CLOSE_MINUTES || '8', 10) || 8);
  const idleWarnBeforeMin = Math.max(1, parseInt(process.env.DISCORD_TICKET_IDLE_WARN_BEFORE_MINUTES || '2', 10) || 2);

  const cloudName = String(process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const cloudApiKey = String(process.env.CLOUDINARY_API_KEY || '').trim();
  const cloudApiSecret = String(process.env.CLOUDINARY_API_SECRET || '').trim();
  const cloudFolder = String(process.env.CLOUDINARY_DISCORD_FOLDER || process.env.CLOUDINARY_FOLDER || 'discord').trim();

  const allowOnlyOneOpenTicket = asBool(process.env.DISCORD_TICKET_ONE_OPEN_PER_USER, true);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
  });

  process.on('unhandledRejection', (e) => onLog.error('❌ [DISCORD] unhandledRejection:', e));
  process.on('uncaughtException', (e) => onLog.error('❌ [DISCORD] uncaughtException:', e));

  client.on('warn', (m) => onLog.warn('⚠️ [DISCORD] warn:', m));
  client.on('error', (e) => onLog.error('❌ [DISCORD] client error:', e?.message || e));
  client.on('shardReady', (id) => onLog.log('✅ [DISCORD] shardReady:', id));
  client.on('shardDisconnect', (event, id) => {
    onLog.error('❌ [DISCORD] shardDisconnect:', { id, code: event?.code, reason: event?.reason });
  });
  client.on('shardError', (e) => onLog.error('❌ [DISCORD] shardError:', e?.message || e));

  const warnCooldown = new Map();
  const waitTimers = new Map();
  const idleTimers = new Map();

  function isStaff(member) {
    try {
      if (!member) return false;
      if (member.permissions?.has?.(PermissionsBitField.Flags.Administrator)) return true;
      if (!staffRoleIds.length) return false;
      const roles = member.roles?.cache;
      if (!roles) return false;
      return staffRoleIds.some(id => roles.has(id));
    } catch {
      return false;
    }
  }

  async function logToChannel(embedOrText) {
    try {
      if (!logChannelId) return;
      const ch = await client.channels.fetch(logChannelId).catch(() => null);
      if (!ch) return;
      if (typeof embedOrText === 'string') {
        await ch.send({ content: embedOrText }).catch(() => {});
        return;
      }
      await ch.send({ embeds: [embedOrText] }).catch(() => {});
    } catch {}
  }

  function clearWaitTimer(ticketId) {
    const t = waitTimers.get(ticketId);
    if (t) clearTimeout(t);
    waitTimers.delete(ticketId);
  }

  function clearIdle(ticketId) {
    const t = idleTimers.get(ticketId);
    if (t) clearTimeout(t);
    idleTimers.delete(ticketId);
  }

  async function getOpenTicketByUser(userId) {
    const r = await q(
      `SELECT * FROM discord_deposit_tickets
       WHERE user_id=$1 AND status IN ('OPEN','WAIT_IMAGE')
       ORDER BY created_at DESC
       LIMIT 1`,
      [String(userId)]
    );
    return r.rows?.[0] || null;
  }

  async function getOpenTicketByChannel(channelId) {
    const r = await q(
      `SELECT * FROM discord_deposit_tickets
       WHERE channel_id=$1 AND status IN ('OPEN','WAIT_IMAGE')
       ORDER BY created_at DESC
       LIMIT 1`,
      [String(channelId)]
    );
    return r.rows?.[0] || null;
  }

  async function createTicketRow({ ticketId, userId, channelId }) {
    await q(
      `INSERT INTO discord_deposit_tickets (id, user_id, channel_id, status)
       VALUES ($1,$2,$3,'OPEN')
       ON CONFLICT (id) DO UPDATE SET updated_at=now()`,
      [String(ticketId), String(userId), String(channelId)]
    );
  }

  async function setTicketStatus(ticketId, status) {
    await q(
      `UPDATE discord_deposit_tickets
       SET status=$2, updated_at=now(),
           closed_at = CASE WHEN $2 IN ('CLOSED','DONE','CANCELLED') THEN now() ELSE closed_at END
       WHERE id=$1`,
      [String(ticketId), String(status)]
    );
  }

  async function saveTicketData(ticketId, { pixType, twitchName, pixKey, submissionId }) {
    await q(
      `UPDATE discord_deposit_tickets
       SET pix_type = COALESCE($2, pix_type),
           twitch_name = COALESCE($3, twitch_name),
           pix_key = COALESCE($4, pix_key),
           submission_id = COALESCE($5, submission_id),
           updated_at = now()
       WHERE id=$1`,
      [String(ticketId), pixType ?? null, twitchName ?? null, pixKey ?? null, submissionId ?? null]
    );
  }

  async function deleteTicketRow(ticketId) {
    await q(`DELETE FROM discord_deposit_tickets WHERE id=$1`, [String(ticketId)]);
  }

  function buildEntryComponents(ticketId) {
    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`dep:fill:${ticketId}`)
        .setLabel('Preencher dados')
        .setStyle(ButtonStyle.Primary)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`dep:pick:${ticketId}`)
        .setPlaceholder('Escolha o tipo de chave Pix')
        .addOptions(
          new StringSelectMenuOptionBuilder().setLabel('CPF').setValue('cpf'),
          new StringSelectMenuOptionBuilder().setLabel('Email').setValue('email'),
          new StringSelectMenuOptionBuilder().setLabel('Telefone').setValue('phone'),
          new StringSelectMenuOptionBuilder().setLabel('Chave aleatória').setValue('random')
        )
    );

    return [row1, row2];
  }

  function buildSorteioComponents(isOpen) {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sorteio:join')
        .setLabel(isOpen ? 'Inscrever no sorteio' : 'Sorteio fechado')
        .setStyle(isOpen ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!isOpen)
    );
    return [row];
  }

  async function ensureEntryMessage() {
    const ch = await client.channels.fetch(entryChannelId).catch(() => null);
    if (!ch) return;

    const embed = new EmbedBuilder()
      .setTitle('📥 Enviar print do depósito')
      .setDescription('Clique no botão abaixo para abrir um ticket e enviar seu print.')
      .setFooter({ text: 'Sistema de tickets automático' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('dep:open')
        .setLabel('Enviar print')
        .setStyle(ButtonStyle.Primary)
    );

    await ch.send({ embeds: [embed], components: [row] }).catch(() => {});
  }

  async function getSorteioState() {
    const r = await q(`SELECT is_open FROM discord_sorteio_state WHERE id=1`);
    return { open: !!r.rows?.[0]?.is_open };
  }

  async function setSorteioState(open) {
    await q(`UPDATE discord_sorteio_state SET is_open=$1, updated_at=now() WHERE id=1`, [!!open]);
  }

  async function updateSorteioMessage(isOpen) {
    try {
      const ch = await client.channels.fetch(sorteioChannelId).catch(() => null);
      if (!ch) return;

      const embed = new EmbedBuilder()
        .setTitle('🎁 Sorteio')
        .setDescription(isOpen ? 'Inscrições abertas! Clique para participar.' : 'Inscrições fechadas no momento.')
        .setFooter({ text: `Atualizado em ${nowIso()}` });

      await ch.send({ embeds: [embed], components: buildSorteioComponents(isOpen) }).catch(() => {});
    } catch {}
  }

  async function tryUploadToCloudinary({ imageUrl, ticketId, onLog }) {
    try {
      if (!cloudName || !cloudApiKey || !cloudApiSecret) return null;

      const boundary = '----WebKitFormBoundary' + crypto.randomBytes(12).toString('hex');

      const timestamp = Math.floor(Date.now() / 1000);
      const publicId = `ticket_${ticketId}_${timestamp}`;

      const paramsToSign = `folder=${encodeURIComponent(cloudFolder)}&public_id=${encodeURIComponent(publicId)}&timestamp=${timestamp}`;
      const sig = crypto
        .createHash('sha1')
        .update(`${paramsToSign}${cloudApiSecret}`)
        .digest('hex');

      const formParts = [];
      const pushField = (name, value) => {
        formParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`);
      };

      pushField('file', imageUrl);
      pushField('api_key', cloudApiKey);
      pushField('timestamp', String(timestamp));
      pushField('signature', sig);
      pushField('folder', cloudFolder);
      pushField('public_id', publicId);

      formParts.push(`--${boundary}--\r\n`);
      const body = formParts.join('');

      const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/image/upload`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body
      });

      const json = await res.json().catch(() => null);
      if (!res.ok) {
        onLog?.error?.('Cloudinary upload falhou:', json || res.status);
        return null;
      }
      return json?.secure_url || json?.url || null;
    } catch (e) {
      onLog?.error?.('Cloudinary upload erro:', e?.message || e);
      return null;
    }
  }

  async function openTicket(interaction) {
    try {
      await interaction.deferReply({ flags: 64 }).catch((err) => onLog.error('❌ [DISCORD] deferReply falhou:', err?.message || err));
    } catch {}

    const userId = interaction.user.id;

    try {
      if (allowOnlyOneOpenTicket) {
        const existing = await getOpenTicketByUser(userId);
        if (existing) {
          await interaction.editReply({ content: 'Você já tem um ticket aberto. Verifique o canal do ticket.' }).catch(() => {});
          return;
        }
      }

      const g = await client.guilds.fetch(guildId).catch(() => null);
      if (!g) {
        await interaction.editReply({ content: 'Servidor não encontrado. Fala com a staff.' }).catch(() => {});
        return;
      }

      const member = await g.members.fetch(userId).catch(() => null);
      if (!member) {
        await interaction.editReply({ content: 'Não consegui te localizar no servidor. Fala com a staff.' }).catch(() => {});
        return;
      }

      const parent = await client.channels.fetch(ticketsCategoryId).catch(() => null);
      if (!parent) {
        await interaction.editReply({ content: 'Categoria de tickets não encontrada. Fala com a staff.' }).catch(() => {});
        return;
      }

      const ticketId = crypto.randomUUID();
      const chanName = `dep-${safeChannelSlug(interaction.user.username)}-${ticketId.slice(0, 4)}`;

      const ch = await g.channels.create({
        name: chanName,
        type: ChannelType.GuildText,
        parent: ticketsCategoryId,
        permissionOverwrites: [
          { id: g.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: userId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] }
        ]
      });

      await createTicketRow({ ticketId, userId, channelId: ch.id });

      const embed = new EmbedBuilder()
        .setTitle('✅ Ticket aberto')
        .setDescription('Clique em **Preencher dados**, escolha o tipo de Pix, e depois envie o **print** (imagem) aqui no ticket.')
        .setFooter({ text: `Ticket: ${ticketId}` });

      const comps = buildEntryComponents(ticketId);

      await ch.send({ content: `<@${userId}>`, embeds: [embed], components: comps }).catch(() => {});
      await interaction.editReply({ content: `Ticket criado: <#${ch.id}>` }).catch(() => {});

      await logToChannel(new EmbedBuilder()
        .setTitle('📥 Ticket criado')
        .setDescription(`Usuário: <@${userId}>\nCanal: <#${ch.id}>\nTicket: ${ticketId}`)
        .setFooter({ text: nowIso() })
      );

      if (deleteMin > 0) {
        setTimeout(async () => {
          try {
            const t = await getOpenTicketByChannel(ch.id);
            if (!t) return;
            if (t.status === 'DONE' || t.status === 'CLOSED' || t.status === 'CANCELLED') return;
            await setTicketStatus(ticketId, 'CLOSED');
            await ch.send({ content: '⏳ Ticket fechado por tempo. Se precisar, abra novamente.' }).catch(() => {});
            await ch.delete().catch(() => {});
            await deleteTicketRow(ticketId);
          } catch {}
        }, deleteMin * 60 * 1000);
      }
    } catch (e) {
      onLog.error('openTicket erro:', e?.message || e);
      await interaction.editReply({ content: 'Falha ao abrir o ticket. Fala com a staff.' }).catch(() => {});
    }
  }

  async function handleFill(interaction, ticketId) {
    try {
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId(`dep:modal:${ticketId}`)
          .setTitle('Dados do depósito')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('twitch')
                .setLabel('Seu nick da Twitch')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(25)
            ),
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('pixkey')
                .setLabel('Sua chave Pix')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(5)
                .setMaxLength(120)
            )
          )
      );
    } catch (e) {
      onLog.error('handleFill erro:', e?.message || e);
      if (interaction.deferred) {
        await interaction.editReply({ content: 'Falha ao abrir formulário. Tenta de novo.' }).catch(() => {});
      } else if (!interaction.replied) {
        await interaction.reply({ flags: 64, content: 'Falha ao abrir formulário. Tenta de novo.' }).catch(() => {});
      }
    }
  }

  async function handlePick(interaction, ticketId) {
    try {
      const pixType = String(interaction.values?.[0] || '').trim();
      await saveTicketData(ticketId, { pixType });

      await interaction.reply({ flags: 64, content: `✅ Tipo de Pix selecionado: **${toTitlePixType(pixType)}**` }).catch(() => {});
    } catch (e) {
      onLog.error('handlePick erro:', e?.message || e);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ flags: 64, content: 'Falha ao salvar tipo Pix.' }).catch(() => {});
      }
    }
  }

  async function handleModal(interaction, ticketId) {
    try {
      await interaction.deferReply({ flags: 64 }).catch(() => {});
      const twitchRaw = interaction.fields.getTextInputValue('twitch');
      const pixKey = interaction.fields.getTextInputValue('pixkey');

      if (!isValidTwitchName(twitchRaw)) {
        await interaction.editReply({ content: 'Nick da Twitch inválido.' }).catch(() => {});
        return;
      }

      const twitchName = normalizeTwitchName(twitchRaw);

      const t = await q(`SELECT * FROM discord_deposit_tickets WHERE id=$1`, [String(ticketId)]);
      const row = t.rows?.[0];
      const pixType = row?.pix_type;

      if (!pixType || !['cpf', 'email', 'phone', 'random'].includes(pixType)) {
        await interaction.editReply({ content: 'Selecione o tipo de Pix antes.' }).catch(() => {});
        return;
      }

      let okKey = true;
      if (pixType === 'cpf') okKey = isValidCPF(pixKey);
      if (pixType === 'email') okKey = isValidEmail(pixKey);
      if (pixType === 'phone') okKey = isValidPhoneBR(pixKey);
      if (!okKey) {
        await interaction.editReply({ content: `Chave Pix inválida para o tipo ${toTitlePixType(pixType)}.` }).catch(() => {});
        return;
      }

      await saveTicketData(ticketId, { twitchName, pixKey });

      await setTicketStatus(ticketId, 'WAIT_IMAGE');

      await interaction.editReply({ content: '✅ Dados salvos. Agora envie **somente a imagem** do print aqui no ticket.' }).catch(() => {});
    } catch (e) {
      onLog.error('handleModal erro:', e?.message || e);
      await interaction.editReply({ content: 'Falha ao processar seus dados.' }).catch(() => {});
    }
  }

  async function openSorteioModal(interaction) {
    try {
      await interaction.showModal(
        new ModalBuilder()
          .setCustomId('sorteio:modal')
          .setTitle('Inscrição no sorteio')
          .addComponents(
            new ActionRowBuilder().addComponents(
              new TextInputBuilder()
                .setCustomId('twitch')
                .setLabel('Seu nick da Twitch')
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(25)
            )
          )
      );
    } catch (e) {
      onLog.error('openSorteioModal erro:', e?.message || e);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ flags: 64, content: 'Falha ao abrir inscrição.' }).catch(() => {});
      }
    }
  }

  async function handleSorteioModal(interaction) {
    try {
      await interaction.deferReply({ flags: 64 }).catch(() => {});
      const st = await getSorteioState();
      if (!st.open) {
        await interaction.editReply({ content: 'Sorteio fechado no momento.' }).catch(() => {});
        return;
      }

      const twitchRaw = interaction.fields.getTextInputValue('twitch');
      if (!isValidTwitchName(twitchRaw)) {
        await interaction.editReply({ content: 'Nick da Twitch inválido.' }).catch(() => {});
        return;
      }

      const twitchName = normalizeTwitchName(twitchRaw);

      const userId = interaction.user.id;
      const tag = `${interaction.user.username}#${interaction.user.discriminator}`;

      const id = crypto.randomUUID();
      await q(
        `INSERT INTO discord_sorteio_entries (id, user_id, discord_tag, twitch_name)
         VALUES ($1,$2,$3,$4)`,
        [id, String(userId), String(tag), String(twitchName)]
      );

      await interaction.editReply({ content: '✅ Inscrição registrada! Boa sorte 🍀' }).catch(() => {});
    } catch (e) {
      onLog.error('handleSorteioModal erro:', e?.message || e);
      await interaction.editReply({ content: 'Falha ao registrar inscrição.' }).catch(() => {});
    }
  }

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
      onLog.error('❌ [DISCORD] InteractionCreate falhou:', e?.message || e);
      try {
        const msg = 'Falha ao processar. Tenta de novo.';
        if (interaction.deferred) {
          await interaction.editReply({ content: msg }).catch(() => {});
        } else if (!interaction.replied) {
          await interaction.reply({ flags: 64, content: msg }).catch(() => {});
        }
      } catch {}
    }
  });

  async function periodicCleanup() {
    try {
      const r = await q(
        `SELECT * FROM discord_deposit_tickets
         WHERE status IN ('OPEN','WAIT_IMAGE')
         ORDER BY created_at ASC
         LIMIT 50`
      );

      for (const t of r.rows || []) {
        const ticketId = String(t.id);
        const channelId = String(t.channel_id);

        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (!ch) {
          await setTicketStatus(ticketId, 'CLOSED');
          await deleteTicketRow(ticketId);
          continue;
        }
      }
    } catch {}
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

      const pixType = t.pix_type || '—';
      const twitchName = t.twitch_name || '—';
      const pixKeyMasked = maskPixKey(pixType, t.pix_key);

      const embed = new EmbedBuilder()
        .setTitle('✅ Print recebido')
        .setDescription(`Twitch: **${twitchName}**\nPix: **${toTitlePixType(pixType)}** (${pixKeyMasked})`)
        .setImage(finalUrl)
        .setFooter({ text: `Ticket: ${t.id}` });

      await msg.channel.send({ embeds: [embed] }).catch(() => {});
      await setTicketStatus(String(t.id), 'DONE');

      await logToChannel(new EmbedBuilder()
        .setTitle('✅ Depósito enviado')
        .setDescription(`Usuário: <@${t.user_id}>\nTwitch: **${twitchName}**\nPix: **${toTitlePixType(pixType)}** (${pixKeyMasked})\nCanal: <#${msg.channelId}>`)
        .setFooter({ text: nowIso() })
      );

      if (deleteMin > 0) {
        setTimeout(async () => {
          try {
            const ch = await client.channels.fetch(msg.channelId).catch(() => null);
            await ch?.delete?.().catch(() => {});
            await deleteTicketRow(String(t.id));
          } catch {}
        }, deleteMin * 60 * 1000);
      }
    } catch (e) {
      onLog.error('MessageCreate erro:', e?.message || e);
    }
  });

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

  onLog.log('🚀 [DISCORD] chamando client.login()…');
  client.login(token)
    .then(() => onLog.log('✅ [DISCORD] login promise resolveu'))
    .catch((e) => {
      onLog.error('❌ [DISCORD] login falhou:', e?.message || e);
    });

  return { client, updateSorteioMessage };
}