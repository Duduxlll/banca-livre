import {
  Client,
  GatewayIntentBits,
  Partials,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  PermissionsBitField,
  ChannelType
} from "discord.js";

function normalizeTwitchName(name) {
  return String(name || "")
    .trim()
    .replace(/^@+/, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function safeText(v, max = 160) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  return s.slice(0, max);
}

function isValidPixType(v) {
  return ["email", "cpf", "phone", "random"].includes(String(v || "").trim());
}

function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function normalizePixKey(pixType, pixKeyRaw) {
  const v = String(pixKeyRaw || "").trim();
  if (!v) return null;

  if (pixType === "cpf") return onlyDigits(v).slice(0, 11);
  if (pixType === "phone") return onlyDigits(v).slice(-11);
  return v;
}

function isImageAttachment(att) {
  const ct = String(att?.contentType || "").toLowerCase();
  if (ct.startsWith("image/")) return true;

  const name = String(att?.name || "").toLowerCase();
  return /\.(png|jpe?g|webp)$/i.test(name);
}

function maskPix(key = "") {
  const k = String(key || "");
  if (k.length <= 6) return "******";
  return `${k.slice(0, 2)}******${k.slice(-2)}`;
}

export function initDiscordBot({ q, uid, onLog = console }) {
  const enabled = String(process.env.DISCORD_ENABLED || "").toLowerCase() === "true";
  if (!enabled) {
    onLog.log("ℹ️ Discord bot desativado (DISCORD_ENABLED != true).");
    return { enabled: false };
  }

  const TOKEN = process.env.DISCORD_TOKEN;
  const GUILD_ID = process.env.DISCORD_GUILD_ID;
  const PANEL_CHANNEL_ID = process.env.DISCORD_PANEL_CHANNEL_ID;
  const TICKETS_CATEGORY_ID = process.env.DISCORD_TICKETS_CATEGORY_ID;
  const STAFF_ROLE_ID = process.env.DISCORD_STAFF_ROLE_ID;

  if (!TOKEN || !GUILD_ID || !PANEL_CHANNEL_ID || !TICKETS_CATEGORY_ID || !STAFF_ROLE_ID) {
    onLog.error("❌ Falta env do Discord. Veja: DISCORD_TOKEN/GUILD_ID/PANEL_CHANNEL_ID/TICKETS_CATEGORY_ID/STAFF_ROLE_ID");
    return { enabled: false };
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages
      
    ],
    partials: [Partials.Channel]
  });

  
  const openTickets = new Map();
  
  const ticketState = new Map();

  async function ensurePanelMessage(guild) {
    const ch = await guild.channels.fetch(PANEL_CHANNEL_ID).catch(() => null);
    if (!ch || !ch.isTextBased()) {
      onLog.error("❌ Não consegui acessar o canal painel (PANEL_CHANNEL_ID).");
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("🧾 Enviar print do depósito")
      .setDescription(
        "Clique no botão abaixo para abrir um ticket privado e enviar seu print.\n\n" +
        "⚠️ Não mande Pix em público. O Pix será pedido no modal e o print será enviado no ticket."
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_ticket")
        .setLabel("Abrir ticket")
        .setStyle(ButtonStyle.Success)
    );

    await ch.send({ embeds: [embed], components: [row] }).catch((e) => {
      onLog.error("❌ Falha ao enviar mensagem do painel:", e?.message);
    });
  }

  async function createTicketChannel({ guild, user, twitchName, pixType, pixKey }) {
    const base = `ticket-${user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 24);
    const name = `${base}-${String(user.discriminator || "0").slice(-1)}${Math.floor(Math.random() * 9)}`;

    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: TICKETS_CATEGORY_ID,
      topic: `Ticket depósito • ${user.tag} (${user.id})`,
      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [PermissionsBitField.Flags.ViewChannel]
        },
        {
          id: STAFF_ROLE_ID,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles
          ]
        },
        {
          id: user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.AttachFiles
          ]
        },
        {
          id: client.user.id,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory,
            PermissionsBitField.Flags.ManageChannels,
            PermissionsBitField.Flags.ManageMessages,
            PermissionsBitField.Flags.AttachFiles
          ]
        }
      ]
    });

    openTickets.set(user.id, channel.id);
    ticketState.set(channel.id, {
      userId: user.id,
      twitchName,
      pixType,
      pixKey,
      step: "awaiting_screenshot"
    });

    const embed = new EmbedBuilder()
      .setTitle("✅ Ticket criado")
      .setDescription(
        `Nick Twitch: **${twitchName}**\n` +
        `Pix: **${pixType || "—"}** • **${maskPix(pixKey)}**\n\n` +
        "Agora envie **APENAS o print do depósito** (imagem PNG/JPG/WEBP) aqui no ticket."
      );

    await channel.send({
      content: `<@${user.id}> <@&${STAFF_ROLE_ID}>`,
      embeds: [embed]
    });

    return channel;
  }

  client.on("interactionCreate", async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId === "open_ticket") {
        const guild = interaction.guild;
        if (!guild || guild.id !== GUILD_ID) {
          return interaction.reply({ content: "Servidor inválido.", ephemeral: true });
        }

        const existing = openTickets.get(interaction.user.id);
        if (existing) {
          return interaction.reply({
            content: `Você já tem um ticket aberto: <#${existing}>`,
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId("ticket_modal")
          .setTitle("Enviar dados do depósito");

        const twitch = new TextInputBuilder()
          .setCustomId("twitch")
          .setLabel("Nick da Twitch (sem @)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(40);

        const pixType = new TextInputBuilder()
          .setCustomId("pixtype")
          .setLabel("Tipo Pix: cpf / email / phone / random")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(10);

        const pixKey = new TextInputBuilder()
          .setCustomId("pixkey")
          .setLabel("Chave Pix")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(160);

        modal.addComponents(
          new ActionRowBuilder().addComponents(twitch),
          new ActionRowBuilder().addComponents(pixType),
          new ActionRowBuilder().addComponents(pixKey)
        );

        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId === "ticket_modal") {
        const guild = interaction.guild;
        if (!guild || guild.id !== GUILD_ID) {
          return interaction.reply({ content: "Servidor inválido.", ephemeral: true });
        }

        const twitchRaw = interaction.fields.getTextInputValue("twitch");
        const pixTypeRaw = interaction.fields.getTextInputValue("pixtype");
        const pixKeyRaw = interaction.fields.getTextInputValue("pixkey");

        const twitchNameLc = normalizeTwitchName(twitchRaw);
        const twitchName = safeText(String(twitchRaw).trim().replace(/^@+/, ""), 40);

        const pixType = isValidPixType(pixTypeRaw) ? String(pixTypeRaw).trim() : null;
        const pixKey = safeText(normalizePixKey(pixType, pixKeyRaw), 160);

        if (!twitchNameLc || !twitchName || !pixKey) {
          return interaction.reply({ content: "Dados inválidos. Preencha certo.", ephemeral: true });
        }

        const channel = await createTicketChannel({
          guild,
          user: interaction.user,
          twitchName,
          pixType,
          pixKey
        });

        return interaction.reply({
          content: `Ticket criado: <#${channel.id}>`,
          ephemeral: true
        });
      }
    } catch (e) {
      onLog.error("interactionCreate error:", e?.message);
      if (interaction?.isRepliable() && !interaction.replied) {
        await interaction.reply({ content: "Falha ao processar. Tenta de novo.", ephemeral: true }).catch(() => {});
      }
    }
  });

  client.on("messageCreate", async (message) => {
    try {
      if (message.author.bot) return;

      const st = ticketState.get(message.channel.id);
      if (!st) return;
      if (st.userId !== message.author.id) return;
      if (st.step !== "awaiting_screenshot") return;

      const att = message.attachments.first();
      if (!att || !isImageAttachment(att)) {
        await message.reply("Manda **somente a imagem do print** (PNG/JPG/WEBP).").catch(() => {});
        return;
      }

     
      const resp = await fetch(att.url);
      if (!resp.ok) {
        await message.reply("Não consegui baixar a imagem. Tenta reenviar.").catch(() => {});
        return;
      }

      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.length > 4.5 * 1024 * 1024) {
        await message.reply("Imagem grande demais (máx ~4,5MB). Comprime e manda de novo.").catch(() => {});
        return;
      }

      const mime = String(att.contentType || "image/png").toLowerCase();
      const dataUrl = `data:${mime};base64,${buf.toString("base64")}`;

      
      const id = uid();
      await q(
        `INSERT INTO cashback_submissions
          (id, twitch_name, twitch_name_lc, pix_type, pix_key, screenshot_data_url, status, created_at, updated_at)
         VALUES
          ($1, $2, $3, $4, $5, $6, 'PENDENTE', now(), now())`,
        [id, st.twitchName, normalizeTwitchName(st.twitchName), st.pixType, st.pixKey, dataUrl]
      );

      
      await message.delete().catch(() => {});

      await message.channel.send(
        `✅ Recebido! Protocolo: **${id}**\nA staff vai analisar e decidir no painel.`
      ).catch(() => {});

      
      await message.channel.permissionOverwrites.edit(st.userId, {
        SendMessages: false,
        AttachFiles: false
      }).catch(() => {});

      ticketState.delete(message.channel.id);
      openTickets.delete(st.userId);
    } catch (e) {
      onLog.error("messageCreate error:", e?.message);
    }
  });

  client.once("ready", async () => {
    onLog.log(`🤖 Discord bot online: ${client.user.tag}`);
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) return onLog.error("❌ Não achei o GUILD pelo DISCORD_GUILD_ID");
    await ensurePanelMessage(guild);
  });

  client.login(TOKEN).catch((e) => {
    onLog.error("❌ Discord login falhou:", e?.message);
  });

  return { enabled: true, client };
}
