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

  await q(`CREATE INDEX IF NOT EXISTS discord_deposit_tickets_channel_idx ON discord_deposit_tickets (channel_id)`);
  await q(`CREATE INDEX IF NOT EXISTS discord_deposit_tickets_user_idx ON discord_deposit_tickets (user_id)`);
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

  const staffRoleIds = parseIdsCsv(process.env.DISCORD_STAFF_ROLE_IDS || process.env.DISCORD_STAFF_ROLE_ID);
  const logChannelId = String(process.env.DISCORD_LOG_CHANNEL_ID || '').trim();

  const waitImageMin = Math.max(1, parseInt(process.env.DISCORD_TICKET_WAIT_IMAGE_MINUTES || '5', 10) || 5);
  const deleteMin = Math.max(0, parseInt(process.env.DISCORD_TICKET_DELETE_MINUTES || '2', 10) || 2);

  const idleCloseMin = Math.max(1, parseInt(process.env.DISCORD_TICKET_IDLE_CLOSE_MINUTES || '8', 10) || 8);
  const idleWarnBeforeMin = Math.max(1, parseInt(process.env.DISCORD_TICKET_IDLE_WARN_BEFORE_MINUTES || '3', 10) || 3);

  if (!token || !guildId || !entryChannelId || !ticketsCategoryId) {
    onLog.error('❌ Variáveis faltando: DISCORD_TOKEN (ou DISCORD_BOT_KEY), DISCORD_GUILD_ID, DISCORD_ENTRY_CHANNEL_ID, DISCORD_TICKETS_CATEGORY_ID');
    return null;
  }

  onLog.log('🚀 [DISCORD] init ok. Tentando login…', {
    enabled: true,
    hasToken: !!token,
    guildId: !!guildId,
    entryChannelId: !!entryChannelId,
    ticketsCategoryId: !!ticketsCategoryId
  });

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages
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
      return { open, channelId, messageId };
    } catch {
      return { open: true, channelId: sorteioChannelId || entryChannelId, messageId: null };
    }
  }

  async function setSorteioMessageRef(channelId, messageId) {
    try {
      await q(`UPDATE sorteio_state SET discord_channel_id=$1, discord_message_id=$2, updated_at=now() WHERE id=1`, [
        String(channelId || ''),
        String(messageId || '')
      ]);
    } catch {}
  }

  function buildEntryMessage() {
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

    return { embeds: [embed], components: [row] };
  }

  function buildSorteioMessage(open) {
    const embed = new EmbedBuilder()
      .setTitle('🎁 Sorteio')
      .setDescription(open ? 'Inscrições abertas! Clique para participar.' : 'Inscrições fechadas no momento.')
      .setFooter({ text: `Atualizado em ${nowIso()}` });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('sorteio:join')
        .setLabel(open ? 'Inscrever no sorteio' : 'Sorteio fechado')
        .setStyle(open ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(!open)
    );

    return { embeds: [embed], components: [row] };
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

  async function ensureSorteioMessage() {
    const st = await getSorteioState();
    const ch = await client.channels.fetch(st.channelId).catch(() => null);
    if (!ch || !ch.isTextBased()) return;

    if (st.messageId) {
      const msg = await ch.messages.fetch(st.messageId).catch(() => null);
      if (msg) {
        await msg.edit(buildSorteioMessage(st.open)).catch(() => {});
        return;
      }
    }

    const sent = await ch.send(buildSorteioMessage(st.open)).catch(() => null);
    if (sent?.id) {
      await setSorteioMessageRef(ch.id, sent.id);
    }
  }

  async function logToChannel(content) {
    try {
      if (!logChannelId) return;
      const ch = await client.channels.fetch(logChannelId).catch(() => null);
      if (!ch || !ch.isTextBased()) return;
      await ch.send(content).catch(() => {});
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
    try {
      const r = await q(
        `SELECT * FROM discord_deposit_tickets WHERE user_id=$1 AND closed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [String(userId)]
      );
      return r?.rows?.[0] || null;
    } catch {
      return null;
    }
  }

  async function getOpenTicketById(ticketId) {
    try {
      const r = await q(
        `SELECT * FROM discord_deposit_tickets WHERE id=$1 AND closed_at IS NULL LIMIT 1`,
        [String(ticketId)]
      );
      return r?.rows?.[0] || null;
    } catch {
      return null;
    }
  }

  async function getOpenTicketByChannel(channelId) {
    try {
      const r = await q(
        `SELECT * FROM discord_deposit_tickets WHERE channel_id=$1 AND closed_at IS NULL ORDER BY created_at DESC LIMIT 1`,
        [String(channelId)]
      );
      return r?.rows?.[0] || null;
    } catch {
      return null;
    }
  }

  function buildTicketPanel(ticketId) {
    const embed = new EmbedBuilder()
      .setTitle('✅ Ticket aberto')
      .setDescription('Clique em **Preencher dados**, escolha o tipo de Pix e depois envie o **print** (imagem) aqui no ticket.')
      .setFooter({ text: `Ticket: ${ticketId}` });

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

    return { embeds: [embed], components: [row1, row2] };
  }

  async function logTicket({ kind, userId, channelId, ticketId, extra }) {
    const embed = new EmbedBuilder()
      .setTitle(`📌 Ticket: ${kind}`)
      .setDescription(`Usuário: <@${userId}>\nCanal: <#${channelId}>\nTicket: ${ticketId}${extra ? `\n${extra}` : ''}`)
      .setFooter({ text: nowIso() });

    await logToChannel({ embeds: [embed] });
  }

  async function scheduleIdle(ticketId, channelId, userId) {
    clearIdle(ticketId);

    const warnAtMs = Math.max(1, idleCloseMin - idleWarnBeforeMin) * 60 * 1000;
    const closeAtMs = idleCloseMin * 60 * 1000;

    const timer = setTimeout(async () => {
      try {
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (!ch || !ch.isTextBased()) return;

        await ch.send({ content: `<@${userId}> ⏳ Ticket inativo. Se não mandar o print, ele vai fechar em ${idleWarnBeforeMin} minuto(s).` }).catch(() => {});
      } catch {}
    }, warnAtMs);

    idleTimers.set(ticketId, timer);

    setTimeout(async () => {
      try {
        const t = await getOpenTicketById(ticketId);
        if (!t) return;

        await q(`UPDATE discord_deposit_tickets SET closed_at=now(), status='CLOSED', updated_at=now() WHERE id=$1`, [String(ticketId)]);
        const ch = await client.channels.fetch(channelId).catch(() => null);
        if (ch && ch.isTextBased()) {
          await ch.send({ content: '⛔ Ticket fechado por inatividade. Se precisar, abra outro.' }).catch(() => {});
          if (deleteMin > 0) {
            setTimeout(async () => {
              await ch.delete().catch(() => {});
            }, deleteMin * 60 * 1000);
          }
        }
      } catch {}
    }, closeAtMs);
  }

  async function openTicket(interaction) {
    try {
      await interaction.deferReply({ flags: 64 }).catch((err) => onLog.error('❌ [DISCORD] deferReply falhou:', err?.message || err));
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
      await interaction.reply({ flags: 64, content: 'Esse ticket não está mais ativo.' }).catch(() => {});
      return;
    }

    const pixType = String(interaction.values?.[0] || '').trim();
    if (!['cpf', 'email', 'phone', 'random'].includes(pixType)) {
      await interaction.reply({ flags: 64, content: 'Tipo de Pix inválido.' }).catch(() => {});
      return;
    }

    await q(
      `UPDATE discord_deposit_tickets SET pix_type=$2, updated_at=now() WHERE id=$1`,
      [String(ticketId), String(pixType)]
    );

    await interaction.reply({ flags: 64, content: `✅ Tipo de Pix selecionado: **${toTitlePixType(pixType)}**` }).catch(() => {});
  }

  async function handleFill(interaction, ticketId) {
    const t = await getOpenTicketById(ticketId);
    if (!t) {
      await interaction.reply({ flags: 64, content: 'Esse ticket não está mais ativo.' }).catch(() => {});
      return;
    }

    const modal = new ModalBuilder()
      .setCustomId(`dep:modal:${ticketId}`)
      .setTitle('Dados do depósito');

    const twitch = new TextInputBuilder()
      .setCustomId('twitch')
      .setLabel('Seu nick da Twitch')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(25);

    const pixKey = new TextInputBuilder()
      .setCustomId('pixkey')
      .setLabel('Sua chave Pix')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(5)
      .setMaxLength(120);

    modal.addComponents(
      new ActionRowBuilder().addComponents(twitch),
      new ActionRowBuilder().addComponents(pixKey)
    );

    await interaction.showModal(modal).catch(() => {});
  }

  async function handleModal(interaction, ticketId) {
    await interaction.deferReply({ flags: 64 }).catch(() => {});

    const t = await getOpenTicketById(ticketId);
    if (!t) {
      await interaction.editReply({ content: 'Esse ticket não está mais ativo.' }).catch(() => {});
      return;
    }

    const twitchRaw = interaction.fields.getTextInputValue('twitch');
    const pixKey = interaction.fields.getTextInputValue('pixkey');

    if (!isValidTwitchName(twitchRaw)) {
      await interaction.editReply({ content: 'Nick da Twitch inválido.' }).catch(() => {});
      return;
    }

    const twitchName = normalizeTwitchName(twitchRaw);

    const pixType = t.pix_type;
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

    await q(
      `UPDATE discord_deposit_tickets
       SET twitch_name=$2, pix_key=$3, status='WAIT_IMAGE', updated_at=now()
       WHERE id=$1`,
      [String(ticketId), String(twitchName), String(pixKey)]
    );

    await interaction.editReply({ content: '✅ Dados salvos. Agora envie **somente a imagem** do print aqui no ticket.' }).catch(() => {});
  }

  async function openSorteioModal(interaction) {
    const modal = new ModalBuilder()
      .setCustomId('sorteio:modal')
      .setTitle('Inscrição no sorteio');

    const twitch = new TextInputBuilder()
      .setCustomId('twitch')
      .setLabel('Seu nick da Twitch')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMinLength(3)
      .setMaxLength(25);

    modal.addComponents(new ActionRowBuilder().addComponents(twitch));
    await interaction.showModal(modal).catch(() => {});
  }

  async function handleSorteioModal(interaction) {
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

    await q(
      `INSERT INTO sorteio_entries (id, discord_user_id, discord_tag, twitch_name, created_at)
       VALUES ($1,$2,$3,$4,now())`,
      [crypto.randomUUID(), String(userId), String(tag), String(twitchName)]
    ).catch(() => {});

    await interaction.editReply({ content: '✅ Inscrição registrada! Boa sorte 🍀' }).catch(() => {});
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
      onLog.error('InteractionCreate falhou:', e?.message || e);
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

  client.on(Events.MessageCreate, async (msg) => {
    try {
      if (!msg || !msg.guildId) return;
      if (String(msg.guildId) !== String(guildId)) return;
      if (msg.author?.bot) return;

      const t = await getOpenTicketByChannel(msg.channelId);
      if (!t) return;
      if (String(t.status) !== 'WAIT_IMAGE') return;
      if (String(msg.author.id) !== String(t.user_id)) return;

      const imgs = Array.from(msg.attachments?.values?.() || []).filter(likelyImageAttachment);
      if (!imgs.length) {
        const last = warnCooldown.get(msg.channelId) || 0;
        if (Date.now() - last < 20000) return;
        warnCooldown.set(msg.channelId, Date.now());
        await msg.channel.send({ content: `<@${msg.author.id}> Manda **somente a imagem** do print (PNG/JPG/WEBP).` }).catch(() => {});
        return;
      }

      const att = imgs[0];
      const rawUrl = String(att.url || '');
      if (!rawUrl) return;

      clearWaitTimer(String(t.id));
      clearIdle(String(t.id));

      const pixType = t.pix_type || '—';
      const twitchName = t.twitch_name || '—';
      const pixKeyMasked = maskPixKey(pixType, t.pix_key);

      const embed = new EmbedBuilder()
        .setTitle('✅ Print recebido')
        .setDescription(`Twitch: **${twitchName}**\nPix: **${toTitlePixType(pixType)}** (${pixKeyMasked})`)
        .setImage(rawUrl)
        .setFooter({ text: `Ticket: ${t.id}` });

      await msg.channel.send({ embeds: [embed] }).catch(() => {});

      await q(`UPDATE discord_deposit_tickets SET status='DONE', updated_at=now() WHERE id=$1`, [String(t.id)]).catch(() => {});

      await logTicket({
        kind: 'DONE',
        userId: t.user_id,
        channelId: msg.channelId,
        ticketId: t.id,
        extra: `Twitch: **${twitchName}** | Pix: **${toTitlePixType(pixType)}** (${pixKeyMasked})`
      });

      if (deleteMin > 0) {
        setTimeout(async () => {
          try {
            const ch = await client.channels.fetch(msg.channelId).catch(() => null);
            await ch?.delete?.().catch(() => {});
          } catch {}
        }, deleteMin * 60 * 1000);
      }
    } catch (e) {
      onLog.error('MessageCreate erro:', e?.message || e);
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
        }
      }
    } catch {}
  }

  client.once(Events.ClientReady, async () => {
    onLog.log(`🤖 Discord bot online: ${client.user.tag}`);
    await ensureTables(q);
    await ensureEntryMessage();
    await ensureSorteioMessage();
    setInterval(periodicCleanup, 5 * 60 * 1000);
  });

  onLog.log('🚀 [DISCORD] chamando client.login()…');
  client.login(token)
    .then(() => onLog.log('✅ [DISCORD] login promise resolveu'))
    .catch((e) => {
      onLog.error('❌ [DISCORD] login falhou:', e?.message || e);
    });

  return { client };
}