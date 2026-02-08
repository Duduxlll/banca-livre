import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";

const ENV = {
  DISCORD_TOKEN: process.env.DISCORD_TOKEN,
  DISCORD_ENTRY_CHANNEL_ID: process.env.DISCORD_ENTRY_CHANNEL_ID,
  DISCORD_TICKETS_CATEGORY_ID: process.env.DISCORD_TICKETS_CATEGORY_ID,
  DISCORD_TICKETS_ARCHIVE_CATEGORY_ID: process.env.DISCORD_TICKETS_ARCHIVE_CATEGORY_ID || "",
  DISCORD_STAFF_ROLE_ID: process.env.DISCORD_STAFF_ROLE_ID || "",
  DISCORD_TICKET_CLOSE_MINUTES: Number(process.env.DISCORD_TICKET_CLOSE_MINUTES || "3")
};

const IDS = {
  OPEN_TICKET: "dep_open_ticket",
  FILL_DATA: "dep_fill_data",
  MODAL: "dep_modal",
  IN_TWITCH: "dep_twitch",
  IN_PIX_TYPE: "dep_pix_type",
  IN_PIX_KEY: "dep_pix_key"
};

function nowIso() {
  return new Date().toISOString();
}

function onlyDigits(s) {
  return String(s || "").replace(/\D+/g, "");
}

function normalizePixType(s) {
  const v = String(s || "").trim().toLowerCase();
  if (v === "cpf") return "cpf";
  if (v === "email" || v === "e-mail") return "email";
  if (v === "phone" || v === "telefone" || v === "celular" || v === "tel") return "phone";
  if (v === "random" || v === "aleatoria" || v === "aleatório" || v === "chavealeatoria" || v === "chave_aleatoria") return "random";
  return "";
}

function isValidEmail(s) {
  const v = String(s || "").trim();
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isValidPhoneBR(s) {
  const d = onlyDigits(s);
  if (d.length === 13 && d.startsWith("55")) {
    const rest = d.slice(2);
    return rest.length === 11 || rest.length === 10;
  }
  return d.length === 11 || d.length === 10;
}

function cpfIsValid(cpfRaw) {
  const cpf = onlyDigits(cpfRaw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const calc = (base, factor) => {
    let sum = 0;
    for (let i = 0; i < base.length; i++) sum += Number(base[i]) * (factor - i);
    const mod = (sum * 10) % 11;
    return mod === 10 ? 0 : mod;
  };

  const d1 = calc(cpf.slice(0, 9), 10);
  const d2 = calc(cpf.slice(0, 10), 11);
  return d1 === Number(cpf[9]) && d2 === Number(cpf[10]);
}

function isImageAttachment(att) {
  const name = String(att?.name || "").toLowerCase();
  const ct = String(att?.contentType || "").toLowerCase();
  if (ct.startsWith("image/")) return true;
  return name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".webp");
}

function buildEntryEmbed() {
  return new EmbedBuilder()
    .setTitle("📩 Enviar print do depósito")
    .setDescription(
      [
        "Clique no botão abaixo para abrir um **ticket privado**.",
        "",
        "Dentro do ticket você vai:",
        "1) Preencher **Nick da Twitch + Tipo Pix + Chave Pix**",
        "2) Anexar o **print do histórico/comprovante do depósito**"
      ].join("\n")
    )
    .setFooter({ text: "Não envie dados sensíveis em canais públicos." });
}

function buildEntryRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(IDS.OPEN_TICKET).setLabel("Enviar print do depósito").setStyle(ButtonStyle.Success)
  );
}

function buildTicketEmbed() {
  return new EmbedBuilder()
    .setTitle("📄 Envio de print do depósito")
    .setDescription(
      [
        "Passo a passo:",
        "1) Clique em **Preencher dados**",
        "2) Preencha: Nick da Twitch, Tipo Pix (cpf/email/phone/random) e a Chave Pix",
        "3) Depois envie **APENAS a imagem** do print aqui no ticket (PNG/JPG/WEBP)"
      ].join("\n")
    );
}

function buildTicketRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(IDS.FILL_DATA).setLabel("Preencher dados").setStyle(ButtonStyle.Primary)
  );
}

function buildModal(prefill = {}) {
  const modal = new ModalBuilder().setCustomId(IDS.MODAL).setTitle("Enviar dados do depósito");

  const twitch = new TextInputBuilder()
    .setCustomId(IDS.IN_TWITCH)
    .setLabel("Nick da Twitch (sem @)")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(String(prefill.twitch_name || ""));

  const pixType = new TextInputBuilder()
    .setCustomId(IDS.IN_PIX_TYPE)
    .setLabel("Tipo Pix: cpf / email / phone / random")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(String(prefill.pix_type || ""));

  const pixKey = new TextInputBuilder()
    .setCustomId(IDS.IN_PIX_KEY)
    .setLabel("Chave Pix")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(String(prefill.pix_key || ""));

  modal.addComponents(
    new ActionRowBuilder().addComponents(twitch),
    new ActionRowBuilder().addComponents(pixType),
    new ActionRowBuilder().addComponents(pixKey)
  );

  return modal;
}

async function ensureTables(q) {
  await q(`
    CREATE TABLE IF NOT EXISTS discord_tickets (
      user_id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'OPEN',
      twitch_name TEXT,
      pix_type TEXT,
      pix_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function getTicketByUser(q, userId) {
  const r = await q(`SELECT * FROM discord_tickets WHERE user_id=$1 LIMIT 1`, [String(userId)]);
  return r.rows?.[0] || null;
}

async function getTicketByChannel(q, channelId) {
  const r = await q(`SELECT * FROM discord_tickets WHERE channel_id=$1 LIMIT 1`, [String(channelId)]);
  return r.rows?.[0] || null;
}

async function upsertTicket(q, ticket) {
  await q(
    `
    INSERT INTO discord_tickets (user_id, channel_id, state, twitch_name, pix_type, pix_key, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET channel_id=EXCLUDED.channel_id, state=EXCLUDED.state, twitch_name=EXCLUDED.twitch_name, pix_type=EXCLUDED.pix_type, pix_key=EXCLUDED.pix_key, updated_at=NOW()
    `,
    [
      String(ticket.user_id),
      String(ticket.channel_id),
      String(ticket.state || "OPEN"),
      ticket.twitch_name || null,
      ticket.pix_type || null,
      ticket.pix_key || null
    ]
  );
}

async function deleteTicketByUser(q, userId) {
  await q(`DELETE FROM discord_tickets WHERE user_id=$1`, [String(userId)]);
}

async function deleteTicketByChannel(q, channelId) {
  await q(`DELETE FROM discord_tickets WHERE channel_id=$1`, [String(channelId)]);
}

async function postOrReuseEntryMessage(client, onLog) {
  const entryChannel = await client.channels.fetch(ENV.DISCORD_ENTRY_CHANNEL_ID).catch(() => null);
  if (!entryChannel || entryChannel.type !== ChannelType.GuildText) {
    onLog?.error?.("❌ DISCORD_ENTRY_CHANNEL_ID inválido ou sem acesso");
    return;
  }

  const msgs = await entryChannel.messages.fetch({ limit: 25 }).catch(() => null);
  const found = msgs
    ? Array.from(msgs.values()).find((m) => {
        if (m.author?.id !== client.user?.id) return false;
        const row = m.components?.[0];
        const btn = row?.components?.[0];
        return btn?.customId === IDS.OPEN_TICKET;
      })
    : null;

  const payload = { embeds: [buildEntryEmbed()], components: [buildEntryRow()] };

  if (found) {
    await found.edit(payload).catch(() => null);
    return;
  }

  await entryChannel.send(payload).catch(() => null);
}

async function createTicketChannel(guild, user, onLog) {
  const parentId = ENV.DISCORD_TICKETS_CATEGORY_ID;
  const staffRoleId = ENV.DISCORD_STAFF_ROLE_ID;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: guild.members.me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] }
  ];

  if (staffRoleId) {
    overwrites.push({
      id: staffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.ManageMessages]
    });
  }

  const safeName = String(user.username || "user").toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 16) || "user";
  const short = String(user.id).slice(-3);
  const name = `ticket-${safeName}-${short}`;

  const ch = await guild.channels
    .create({
      name,
      type: ChannelType.GuildText,
      parent: parentId,
      permissionOverwrites: overwrites,
      topic: `Ticket depósito • user=${user.id} • created=${nowIso()}`
    })
    .catch((e) => {
      onLog?.error?.("❌ Falha ao criar canal de ticket:", e?.message || e);
      return null;
    });

  return ch;
}

async function lockAndArchiveTicket(channel, userId, onLog) {
  const archiveParent = ENV.DISCORD_TICKETS_ARCHIVE_CATEGORY_ID || "";
  const mins = Number.isFinite(ENV.DISCORD_TICKET_CLOSE_MINUTES) ? ENV.DISCORD_TICKET_CLOSE_MINUTES : 3;
  const ms = Math.max(30_000, mins * 60_000);

  setTimeout(async () => {
    try {
      await channel.permissionOverwrites.edit(userId, { ViewChannel: false, SendMessages: false }).catch(() => null);
      await channel.setName(channel.name.startsWith("fechado-") ? channel.name : `fechado-${channel.name}`.slice(0, 90)).catch(() => null);
      if (archiveParent) {
        await channel.setParent(archiveParent, { lockPermissions: false }).catch(() => null);
      }
    } catch (e) {
      onLog?.error?.("❌ Erro ao arquivar ticket:", e?.message || e);
    }
  }, ms);
}

async function storeSubmission(q, data) {
  const id = crypto.randomUUID();
  const twitchName = String(data.twitch_name || "").trim();
  const pixType = String(data.pix_type || "").trim().toLowerCase();
  const pixKey = String(data.pix_key || "").trim();
  const screenshot = data.screenshot_data_url || null;

  await q(
    `
    INSERT INTO cashback_submissions
      (id, twitch_name, pix_type, pix_key, screenshot_data_url, status, reason, payout_window, created_at, updated_at)
    VALUES
      ($1,$2,$3,$4,$5,'PENDENTE',NULL,NULL,NOW(),NOW())
    `,
    [id, twitchName, pixType, pixKey, screenshot]
  );

  return id;
}

async function downloadAsDataUrl(url, fallbackName = "print.png") {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download_failed_${r.status}`);
  const ct = r.headers.get("content-type") || "";
  const buf = Buffer.from(await r.arrayBuffer());
  const max = 4_500_000;
  if (buf.length > max) {
    return { kind: "url", value: url, bytes: buf.length, contentType: ct || "", name: fallbackName };
  }
  const b64 = buf.toString("base64");
  const mime = ct && ct.includes("/") ? ct : "image/png";
  return { kind: "dataurl", value: `data:${mime};base64,${b64}`, bytes: buf.length, contentType: mime, name: fallbackName };
}

export async function initDiscordBot({ q, uid, onLog = console, enabled = true } = {}) {
  if (!enabled) return null;
  if (!ENV.DISCORD_TOKEN) {
    onLog?.error?.("❌ DISCORD_TOKEN não definido");
    return null;
  }
  if (!ENV.DISCORD_ENTRY_CHANNEL_ID || !ENV.DISCORD_TICKETS_CATEGORY_ID) {
    onLog?.error?.("❌ Defina DISCORD_ENTRY_CHANNEL_ID e DISCORD_TICKETS_CATEGORY_ID");
    return null;
  }
  if (!q) {
    onLog?.error?.("❌ initDiscordBot precisa receber { q }");
    return null;
  }

  await ensureTables(q);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    partials: [Partials.Channel]
  });

  client.once("ready", async () => {
    onLog?.log?.(`✅ Discord bot online: ${client.user?.tag}`);
    await postOrReuseEntryMessage(client, onLog);
  });

  client.on("channelDelete", async (ch) => {
    try {
      await deleteTicketByChannel(q, ch.id);
    } catch (_) {}
  });

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isButton()) {
        if (interaction.customId === IDS.OPEN_TICKET) {
          const guild = interaction.guild;
          const user = interaction.user;
          if (!guild || !user) return;

          const existing = await getTicketByUser(q, user.id);
          if (existing) {
            const ch = await guild.channels.fetch(existing.channel_id).catch(() => null);
            if (ch) {
              await interaction.reply({ content: `Você já tem um ticket aberto: <#${ch.id}>`, ephemeral: true }).catch(() => null);
              return;
            }
            await deleteTicketByUser(q, user.id);
          }

          const ticketCh = await createTicketChannel(guild, user, onLog);
          if (!ticketCh) {
            await interaction.reply({ content: "Não consegui criar seu ticket. Fala com um moderador.", ephemeral: true }).catch(() => null);
            return;
          }

          await upsertTicket(q, {
            user_id: user.id,
            channel_id: ticketCh.id,
            state: "WAITING_DATA",
            twitch_name: null,
            pix_type: null,
            pix_key: null
          });

          await ticketCh.send({ content: `<@${user.id}>`, embeds: [buildTicketEmbed()], components: [buildTicketRow()] }).catch(() => null);
          await interaction.reply({ content: `Ticket criado: <#${ticketCh.id}>`, ephemeral: true }).catch(() => null);
          return;
        }

        if (interaction.customId === IDS.FILL_DATA) {
          const guild = interaction.guild;
          const user = interaction.user;
          const channel = interaction.channel;
          if (!guild || !user || !channel) return;

          const ticket = await getTicketByChannel(q, channel.id);
          if (!ticket || String(ticket.user_id) !== String(user.id)) {
            await interaction.reply({ content: "Esse botão é só para o dono do ticket.", ephemeral: true }).catch(() => null);
            return;
          }

          const modal = buildModal({
            twitch_name: ticket.twitch_name || "",
            pix_type: ticket.pix_type || "",
            pix_key: ticket.pix_key || ""
          });

          await interaction.showModal(modal).catch(() => null);
          return;
        }
      }

      if (interaction.isModalSubmit()) {
        if (interaction.customId !== IDS.MODAL) return;

        const guild = interaction.guild;
        const user = interaction.user;
        const channel = interaction.channel;
        if (!guild || !user || !channel) return;

        const ticket = await getTicketByChannel(q, channel.id);
        if (!ticket || String(ticket.user_id) !== String(user.id)) {
          await interaction.reply({ content: "Esse formulário é só para o dono do ticket.", ephemeral: true }).catch(() => null);
          return;
        }

        const twitchName = String(interaction.fields.getTextInputValue(IDS.IN_TWITCH) || "").trim().replace(/^@/, "");
        const pixTypeRaw = String(interaction.fields.getTextInputValue(IDS.IN_PIX_TYPE) || "").trim();
        const pixKeyRaw = String(interaction.fields.getTextInputValue(IDS.IN_PIX_KEY) || "").trim();

        if (!twitchName || twitchName.length > 32) {
          await interaction.reply({ content: "Nick da Twitch inválido.", ephemeral: true }).catch(() => null);
          return;
        }

        const pixType = normalizePixType(pixTypeRaw);
        if (!pixType) {
          await interaction.reply({ content: "Tipo Pix inválido. Use: cpf / email / phone / random", ephemeral: true }).catch(() => null);
          return;
        }

        let pixKeyOk = false;

        if (pixType === "cpf") pixKeyOk = cpfIsValid(pixKeyRaw);
        if (pixType === "email") pixKeyOk = isValidEmail(pixKeyRaw);
        if (pixType === "phone") pixKeyOk = isValidPhoneBR(pixKeyRaw);
        if (pixType === "random") pixKeyOk = onlyDigits(pixKeyRaw).length >= 8 || String(pixKeyRaw).length >= 8;

        if (!pixKeyOk) {
          const msg =
            pixType === "cpf"
              ? "CPF inválido. Confira os 11 dígitos."
              : pixType === "email"
              ? "Email inválido."
              : pixType === "phone"
              ? "Telefone inválido (use DDD + número)."
              : "Chave aleatória inválida.";
          await interaction.reply({ content: msg, ephemeral: true }).catch(() => null);
          return;
        }

        await upsertTicket(q, {
          user_id: user.id,
          channel_id: channel.id,
          state: "WAITING_IMAGE",
          twitch_name: twitchName,
          pix_type: pixType,
          pix_key: pixKeyRaw
        });

        const emb = new EmbedBuilder()
          .setTitle("✅ Dados recebidos")
          .setDescription(
            [
              `Nick Twitch: **${twitchName}**`,
              `Tipo Pix: **${pixType}**`,
              `Chave Pix: **${pixKeyRaw}**`,
              "",
              "Agora anexe **APENAS a imagem do print** aqui no ticket (PNG/JPG/WEBP)."
            ].join("\n")
          );

        await interaction.reply({ embeds: [emb], ephemeral: false }).catch(() => null);
        return;
      }
    } catch (e) {
      onLog?.error?.("❌ interactionCreate erro:", e?.message || e);
      try {
        if (interaction && !interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: "Erro interno. Tenta de novo.", ephemeral: true }).catch(() => null);
        }
      } catch (_) {}
    }
  });

  client.on("messageCreate", async (msg) => {
    try {
      if (!msg.guild) return;
      if (msg.author?.bot) return;

      const ticket = await getTicketByChannel(q, msg.channel.id);
      if (!ticket) return;

      if (String(ticket.user_id) !== String(msg.author.id)) return;
      if (String(ticket.state) !== "WAITING_IMAGE") return;

      const atts = Array.from(msg.attachments?.values?.() || []);
      const img = atts.find(isImageAttachment);

      if (!img) {
        const warn = await msg.channel.send({ content: `<@${msg.author.id}> Manda **somente a imagem do print** (PNG/JPG/WEBP).` }).catch(() => null);
        await msg.delete().catch(() => null);
        if (warn) setTimeout(() => warn.delete().catch(() => null), 12_000);
        return;
      }

      const dl = await downloadAsDataUrl(img.url, img.name || "print.png");
      const screenshotVal = dl.kind === "dataurl" ? dl.value : dl.value;

      const subId = await storeSubmission(q, {
        twitch_name: ticket.twitch_name,
        pix_type: ticket.pix_type,
        pix_key: ticket.pix_key,
        screenshot_data_url: screenshotVal
      });

      await deleteTicketByUser(q, msg.author.id);

      const done = new EmbedBuilder()
        .setTitle("✅ Print recebido")
        .setDescription(
          [
            `ID: **${subId}**`,
            "",
            "Seu envio foi registrado e vai ser analisado pela staff.",
            `Este ticket será fechado/arquivado em ~${ENV.DISCORD_TICKET_CLOSE_MINUTES} minuto(s).`
          ].join("\n")
        );

      await msg.channel.send({ embeds: [done] }).catch(() => null);
      await lockAndArchiveTicket(msg.channel, msg.author.id, onLog);
    } catch (e) {
      onLog?.error?.("❌ messageCreate erro:", e?.message || e);
    }
  });

  await client.login(ENV.DISCORD_TOKEN);
  return client;
}
