import {
  Client,
  GatewayIntentBits,
  Partials,
  ChannelType,
  PermissionsBitField,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder
} from "discord.js";

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;
const DISCORD_PANEL_CHANNEL_ID = process.env.DISCORD_PANEL_CHANNEL_ID;
const DISCORD_TICKETS_CATEGORY_ID = process.env.DISCORD_TICKETS_CATEGORY_ID;

const DISCORD_STAFF_ROLE_IDS = (process.env.DISCORD_STAFF_ROLE_IDS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const APP_PUBLIC_KEY = process.env.APP_PUBLIC_KEY;

const PORT = Number(process.env.PORT || 3000);
const INTERNAL_API_BASE =
  process.env.INTERNAL_API_BASE || `http://127.0.0.1:${PORT}`;

const CLOSE_AFTER_MINUTES = Number(process.env.DISCORD_CLOSE_AFTER_MINUTES || 3);
const IDLE_CLOSE_MINUTES = Number(process.env.DISCORD_IDLE_CLOSE_MINUTES || 30);

const PANEL_CUSTOM_ID = "deposit_open_ticket";
const FILL_CUSTOM_ID = "deposit_fill_data";
const MODAL_CUSTOM_ID = "deposit_modal";

const ticketByUser = new Map();
const ticketStateByChannel = new Map();
const lastWarnByChannelUser = new Map();

function now() {
  return Date.now();
}

function normNick(s) {
  const v = String(s || "").trim().replace(/^@+/, "");
  return v.slice(0, 30);
}

function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

function normalizePixType(s) {
  const v = String(s || "").trim().toLowerCase();
  if (!v) return null;

  const map = {
    cpf: "cpf",
    "c.p.f": "cpf",
    email: "email",
    e_mail: "email",
    mail: "email",
    phone: "phone",
    telefone: "phone",
    tel: "phone",
    celular: "phone",
    random: "random",
    aleatorio: "random",
    "aleatória": "random",
    aleatoria: "random",
    chave: "random"
  };

  return map[v] || null;
}

function isValidEmail(s) {
  const v = String(s || "").trim();
  if (v.length > 120) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

function isValidPhoneBR(s) {
  const d = onlyDigits(s);
  if (d.length === 10 || d.length === 11) return true;
  if (d.length === 12 || d.length === 13) {
    if (d.startsWith("55")) {
      const rest = d.slice(2);
      return rest.length === 10 || rest.length === 11;
    }
  }
  return false;
}

function isValidCPF(raw) {
  const cpf = onlyDigits(raw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let d1 = 11 - (sum % 11);
  if (d1 >= 10) d1 = 0;
  if (d1 !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  let d2 = 11 - (sum % 11);
  if (d2 >= 10) d2 = 0;
  if (d2 !== Number(cpf[10])) return false;

  return true;
}

function maskPix(pix) {
  const v = String(pix || "").trim();
  if (!v) return "";
  const d = onlyDigits(v);
  if (d.length >= 6) return `${d.slice(0, 2)}••${d.slice(-2)}`;
  if (v.length <= 4) return "••";
  return `${v.slice(0, 2)}••`;
}

function minutesToMs(m) {
  return Math.max(0, Math.floor(m * 60_000));
}

function makePanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle("📩 Enviar print do depósito")
    .setDescription(
      [
        "Clique no botão abaixo para abrir um **ticket privado**.",
        "",
        "Dentro do ticket você vai:",
        "1) Preencher **Nick da Twitch**, **Tipo Pix** e **Chave Pix**",
        "2) Anexar o **print do histórico/comprovante do depósito**"
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(PANEL_CUSTOM_ID)
      .setLabel("Enviar print do depósito")
      .setStyle(ButtonStyle.Success)
  );

  return { embeds: [embed], components: [row] };
}

function makeTicketIntro() {
  const embed = new EmbedBuilder()
    .setTitle("📄 Envio de print do depósito")
    .setDescription(
      [
        "1) Clique em **Preencher dados**",
        "2) Depois **anexe aqui** no ticket a imagem do print (PNG/JPG/WEBP)",
        "",
        "⚠️ Não envie senha nem dados sensíveis além do necessário."
      ].join("\n")
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(FILL_CUSTOM_ID)
      .setLabel("Preencher dados")
      .setStyle(ButtonStyle.Primary)
  );

  return { embeds: [embed], components: [row] };
}

function ticketPermissions(userId) {
  const overwrites = [
    {
      id: userId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    }
  ];

  for (const roleId of DISCORD_STAFF_ROLE_IDS) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages
      ]
    });
  }

  overwrites.push({
    id: userId,
    deny: []
  });

  return overwrites;
}

async function safeFetchChannel(guild, channelId) {
  if (!channelId) return null;
  try {
    const ch = await guild.channels.fetch(channelId);
    return ch || null;
  } catch {
    return null;
  }
}

async function findExistingTicketChannel(guild, userId) {
  const cached = ticketByUser.get(userId);
  if (cached) {
    const ch = await safeFetchChannel(guild, cached);
    if (ch) return ch;
    ticketByUser.delete(userId);
  }

  const channels = guild.channels.cache.filter(
    (c) =>
      c.type === ChannelType.GuildText &&
      c.parentId === DISCORD_TICKETS_CATEGORY_ID &&
      typeof c.topic === "string" &&
      c.topic.includes(`ticket_owner:${userId}`)
  );

  const first = channels.first?.();
  if (first) {
    ticketByUser.set(userId, first.id);
    return first;
  }

  return null;
}

async function ensurePanelMessage(client) {
  const guild = await client.guilds.fetch(DISCORD_GUILD_ID);
  const panel = await guild.channels.fetch(DISCORD_PANEL_CHANNEL_ID);
  if (!panel || panel.type !== ChannelType.GuildText) return;

  const messages = await panel.messages.fetch({ limit: 30 }).catch(() => null);
  if (messages) {
    const exists = messages.find((m) => {
      if (m.author?.id !== client.user.id) return false;
      const rows = m.components || [];
      for (const row of rows) {
        for (const comp of row.components || []) {
          if (comp.customId === PANEL_CUSTOM_ID) return true;
        }
      }
      return false;
    });
    if (exists) return;
  }

  await panel.send(makePanelMessage());
}

async function postTicketIntro(channel) {
  await channel.send(makeTicketIntro());
}

async function openTicket(interaction) {
  const guild = await interaction.client.guilds.fetch(DISCORD_GUILD_ID);
  const userId = interaction.user.id;

  const existing = await findExistingTicketChannel(guild, userId);
  if (existing) {
    await interaction.reply({
      content: `Você já tem um ticket aberto: <#${existing.id}>`,
      ephemeral: true
    });
    return;
  }

  const safeName = `ticket-${interaction.user.username}`
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 60);

  const channel = await guild.channels.create({
    name: safeName || `ticket-${userId.slice(-6)}`,
    type: ChannelType.GuildText,
    parent: DISCORD_TICKETS_CATEGORY_ID,
    topic: `ticket_owner:${userId}`,
    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionsBitField.Flags.ViewChannel]
      },
      ...ticketPermissions(userId)
    ]
  });

  ticketByUser.set(userId, channel.id);

  ticketStateByChannel.set(channel.id, {
    userId,
    createdAt: now(),
    updatedAt: now(),
    step: "awaiting_data",
    data: null,
    submitted: false
  });

  await interaction.reply({
    content: `Ticket criado: <#${channel.id}>`,
    ephemeral: true
  });

  await postTicketIntro(channel);

  scheduleIdleClose(channel.id, interaction.client);
}

function scheduleIdleClose(channelId, client) {
  const ms = minutesToMs(IDLE_CLOSE_MINUTES);
  if (!ms) return;

  setTimeout(async () => {
    const state = ticketStateByChannel.get(channelId);
    if (!state) return;
    if (state.submitted) return;

    const age = now() - (state.updatedAt || state.createdAt || now());
    if (age < ms) {
      scheduleIdleClose(channelId, client);
      return;
    }

    const guild = await client.guilds.fetch(DISCORD_GUILD_ID).catch(() => null);
    if (!guild) return;
    const ch = await safeFetchChannel(guild, channelId);
    if (!ch) {
      cleanupTicket(channelId, state.userId);
      return;
    }

    await ch
      .send("⏳ Ticket fechado por inatividade.")
      .catch(() => undefined);

    await ch.delete("Ticket idle timeout").catch(() => undefined);
    cleanupTicket(channelId, state.userId);
  }, ms);
}

function cleanupTicket(channelId, userId) {
  ticketStateByChannel.delete(channelId);
  if (userId && ticketByUser.get(userId) === channelId) {
    ticketByUser.delete(userId);
  }
}

function buildDataModal() {
  const modal = new ModalBuilder()
    .setCustomId(MODAL_CUSTOM_ID)
    .setTitle("Enviar dados do depósito");

  const nick = new TextInputBuilder()
    .setCustomId("twitchNick")
    .setLabel("Nick da Twitch (sem @)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(30);

  const tipo = new TextInputBuilder()
    .setCustomId("pixType")
    .setLabel("Tipo Pix: cpf / email / phone / random")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(20);

  const chave = new TextInputBuilder()
    .setCustomId("pixKey")
    .setLabel("Chave Pix")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(120);

  modal.addComponents(
    new ActionRowBuilder().addComponents(nick),
    new ActionRowBuilder().addComponents(tipo),
    new ActionRowBuilder().addComponents(chave)
  );

  return modal;
}

async function handleFillData(interaction) {
  const channelId = interaction.channelId;
  const state = ticketStateByChannel.get(channelId);

  if (!state) {
    await interaction.reply({
      content: "Este canal não parece ser um ticket ativo.",
      ephemeral: true
    });
    return;
  }

  if (interaction.user.id !== state.userId) {
    await interaction.reply({
      content: "Só o dono do ticket pode preencher os dados.",
      ephemeral: true
    });
    return;
  }

  state.updatedAt = now();
  ticketStateByChannel.set(channelId, state);

  await interaction.showModal(buildDataModal());
}

async function handleModalSubmit(interaction) {
  const channelId = interaction.channelId;
  const state = ticketStateByChannel.get(channelId);

  if (!state) {
    await interaction.reply({
      content: "Este ticket não está ativo.",
      ephemeral: true
    });
    return;
  }

  if (interaction.user.id !== state.userId) {
    await interaction.reply({
      content: "Só o dono do ticket pode enviar os dados.",
      ephemeral: true
    });
    return;
  }

  const twitchNick = normNick(
    interaction.fields.getTextInputValue("twitchNick")
  );
  const pixTypeRaw = interaction.fields.getTextInputValue("pixType");
  const pixType = normalizePixType(pixTypeRaw);
  const pixKeyRaw = interaction.fields.getTextInputValue("pixKey");
  const pixKey = String(pixKeyRaw || "").trim();

  if (!twitchNick || twitchNick.length < 2) {
    await interaction.reply({
      content: "Nick da Twitch inválido.",
      ephemeral: true
    });
    return;
  }

  if (!pixType) {
    await interaction.reply({
      content: "Tipo Pix inválido. Use: cpf / email / phone / random",
      ephemeral: true
    });
    return;
  }

  if (!pixKey) {
    await interaction.reply({
      content: "Chave Pix vazia.",
      ephemeral: true
    });
    return;
  }

  if (pixType === "cpf" && !isValidCPF(pixKey)) {
    await interaction.reply({
      content: "CPF inválido. Confira os 11 dígitos.",
      ephemeral: true
    });
    return;
  }

  if (pixType === "phone" && !isValidPhoneBR(pixKey)) {
    await interaction.reply({
      content: "Telefone inválido. Use DDD + número (10 ou 11 dígitos).",
      ephemeral: true
    });
    return;
  }

  if (pixType === "email" && !isValidEmail(pixKey)) {
    await interaction.reply({
      content: "E-mail inválido.",
      ephemeral: true
    });
    return;
  }

  state.updatedAt = now();
  state.step = "awaiting_image";
  state.data = {
    twitchName: twitchNick,
    pixType,
    pixKey
  };
  ticketStateByChannel.set(channelId, state);

  const embed = new EmbedBuilder()
    .setTitle("✅ Dados recebidos")
    .setDescription(
      [
        `Nick Twitch: **${twitchNick}**`,
        `Tipo Pix: **${pixType}**`,
        `Chave Pix: **${maskPix(pixKey)}**`,
        "",
        "Agora anexe **APENAS** a imagem do print aqui no ticket (PNG/JPG/WEBP)."
      ].join("\n")
    );

  await interaction.reply({ content: "Dados salvos.", ephemeral: true });
  await interaction.channel.send({ embeds: [embed] });
}

function getExtFromName(name) {
  const n = String(name || "").toLowerCase();
  if (n.endsWith(".png")) return "png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "jpeg";
  if (n.endsWith(".webp")) return "webp";
  return null;
}

function mimeFromExt(ext) {
  if (ext === "png") return "image/png";
  if (ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return null;
}

async function fetchImageAsDataUrl(url, name) {
  const res = await fetch(url);
  if (!res.ok) return { ok: false, error: "download_failed" };

  const ct = (res.headers.get("content-type") || "").toLowerCase();
  const buf = Buffer.from(await res.arrayBuffer());

  const ext = getExtFromName(name);
  const extMime = ext ? mimeFromExt(ext) : null;

  const mime =
    (ct.startsWith("image/") ? ct.split(";")[0] : null) || extMime;

  if (!mime || !["image/png", "image/jpeg", "image/webp"].includes(mime)) {
    return { ok: false, error: "not_supported_image" };
  }

  const maxRaw = 3_200_000;
  if (buf.length > maxRaw) return { ok: false, error: "too_large" };

  const b64 = buf.toString("base64");
  return { ok: true, dataUrl: `data:${mime};base64,${b64}` };
}

async function submitToBackend(payload) {
  if (!APP_PUBLIC_KEY) return { ok: false, error: "missing_app_public_key" };

  const r = await fetch(`${INTERNAL_API_BASE}/api/cashback/submit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-APP-KEY": APP_PUBLIC_KEY
    },
    body: JSON.stringify(payload)
  });

  if (!r.ok) {
    const j = await r.json().catch(() => null);
    return { ok: false, error: j?.error || "backend_error" };
  }

  const j = await r.json().catch(() => ({}));
  return { ok: true, id: j?.id || null };
}

async function warnOnce(channelId, userId, text) {
  const key = `${channelId}:${userId}`;
  const t = lastWarnByChannelUser.get(key) || 0;
  if (now() - t < 15_000) return;
  lastWarnByChannelUser.set(key, now());
  const guild = await clientSingleton.guilds.fetch(DISCORD_GUILD_ID).catch(() => null);
  if (!guild) return;
  const ch = await safeFetchChannel(guild, channelId);
  if (!ch) return;
  await ch.send(text).catch(() => undefined);
}

let clientSingleton = null;

async function handleTicketMessage(message) {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (message.guild.id !== DISCORD_GUILD_ID) return;
  if (message.channel.parentId !== DISCORD_TICKETS_CATEGORY_ID) return;

  const state = ticketStateByChannel.get(message.channel.id);
  if (!state) return;

  if (message.author.id !== state.userId) return;

  state.updatedAt = now();
  ticketStateByChannel.set(message.channel.id, state);

  if (state.submitted) return;

  if (state.step !== "awaiting_image" || !state.data) {
    if (message.attachments?.size) {
      await warnOnce(
        message.channel.id,
        message.author.id,
        "Antes de mandar a imagem, clique em **Preencher dados** e envie o modal."
      );
    }
    return;
  }

  if (!message.attachments || message.attachments.size === 0) return;

  const att = message.attachments.first();
  if (!att?.url) return;

  const got = await fetchImageAsDataUrl(att.url, att.name);
  if (!got.ok) {
    const msg =
      got.error === "too_large"
        ? "Imagem muito grande. Envie um print menor (PNG/JPG/WEBP)."
        : "Manda somente a imagem do print (PNG/JPG/WEBP).";
    await warnOnce(message.channel.id, message.author.id, msg);
    return;
  }

  const payload = {
    twitchName: state.data.twitchName,
    pixType: state.data.pixType,
    pixKey: state.data.pixKey,
    screenshotDataUrl: got.dataUrl
  };

  const sent = await submitToBackend(payload);
  if (!sent.ok) {
    await message.channel
      .send("Não consegui enviar agora. Tenta de novo em alguns segundos.")
      .catch(() => undefined);
    return;
  }

  state.submitted = true;
  state.updatedAt = now();
  ticketStateByChannel.set(message.channel.id, state);

  await message.delete().catch(() => undefined);

  await message.channel
    .send(
      `✅ Enviado com sucesso!${sent.id ? ` ID: **${sent.id}**` : ""}\nEste ticket será fechado em ${CLOSE_AFTER_MINUTES} minuto(s).`
    )
    .catch(() => undefined);

  const closeMs = minutesToMs(CLOSE_AFTER_MINUTES);
  setTimeout(async () => {
    const guild = await clientSingleton.guilds.fetch(DISCORD_GUILD_ID).catch(() => null);
    if (!guild) return;
    const ch = await safeFetchChannel(guild, message.channel.id);
    if (!ch) {
      cleanupTicket(message.channel.id, state.userId);
      return;
    }
    await ch.delete("Ticket auto close").catch(() => undefined);
    cleanupTicket(message.channel.id, state.userId);
  }, closeMs);
}

export function initDiscordBot() {
  if (!DISCORD_BOT_TOKEN) return null;
  if (!DISCORD_GUILD_ID) return null;
  if (!DISCORD_PANEL_CHANNEL_ID) return null;
  if (!DISCORD_TICKETS_CATEGORY_ID) return null;

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel, Partials.Message]
  });

  clientSingleton = client;

  client.once("ready", async () => {
    await ensurePanelMessage(client).catch(() => undefined);
  });

  client.on("channelDelete", (ch) => {
    const state = ticketStateByChannel.get(ch.id);
    if (state) cleanupTicket(ch.id, state.userId);
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isButton()) {
        if (interaction.customId === PANEL_CUSTOM_ID) {
          await openTicket(interaction);
          return;
        }
        if (interaction.customId === FILL_CUSTOM_ID) {
          await handleFillData(interaction);
          return;
        }
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId === MODAL_CUSTOM_ID) {
          await handleModalSubmit(interaction);
          return;
        }
      }
    } catch {
      if (!interaction.replied && !interaction.deferred) {
        await interaction
          .reply({ content: "Erro ao processar. Tenta de novo.", ephemeral: true })
          .catch(() => undefined);
      }
    }
  });

  client.on("messageCreate", async (message) => {
    try {
      await handleTicketMessage(message);
    } catch {
      return;
    }
  });

  client.login(DISCORD_BOT_TOKEN);
  return client;
}
