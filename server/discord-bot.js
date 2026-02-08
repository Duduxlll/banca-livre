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
  ChannelType,
  StringSelectMenuBuilder
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

function onlyDigits(s) {
  return String(s || "").replace(/\D/g, "");
}

function isValidEmail(s) {
  const v = String(s || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function isValidCPF(cpfRaw) {
  const cpf = onlyDigits(cpfRaw);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(cpf[i]) * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== Number(cpf[9])) return false;

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(cpf[i]) * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;

  return d2 === Number(cpf[10]);
}

function normalizePhoneBR(phoneRaw) {
  let d = onlyDigits(phoneRaw);
  
  if (d.startsWith("55") && (d.length === 12 || d.length === 13)) d = d.slice(2);
  return d;
}

function isValidPhoneBR(phoneRaw) {
  const d = normalizePhoneBR(phoneRaw);
  return d.length === 10 || d.length === 11;
}

function normalizePixKey(pixType, pixKeyRaw) {
  const v = String(pixKeyRaw || "").trim();
  if (!v) return null;

  if (pixType === "cpf") return onlyDigits(v).slice(0, 11);
  if (pixType === "phone") return normalizePhoneBR(v).slice(-11);
  if (pixType === "email") return v.toLowerCase();
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
    onLog.error("❌ Falta env do Discord.");
    return { enabled: false };
  }

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
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
      .setTitle("📩 Enviar print do depósito")
      .setDescription(
        "Clique no botão abaixo para abrir um **ticket privado**.\n\n" +
        "Dentro do ticket você vai:\n" +
        "1) escolher o **Tipo Pix**\n" +
        "2) informar **Nick da Twitch + Chave Pix**\n" +
        "3) anexar o **print do histórico/comprovante do depósito**"
      );

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_ticket")
        .setLabel("Enviar print do depósito")
        .setStyle(ButtonStyle.Success)
    );

    await ch.send({ embeds: [embed], components: [row] }).catch((e) => {
      onLog.error("❌ Falha ao enviar mensagem do painel:", e?.message);
    });
  }

  async function createTicketChannel({ guild, user }) {
    const base = `ticket-${user.username}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .slice(0, 24);

    const name = `${base}-${Math.floor(Math.random() * 1000)}`;

    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: TICKETS_CATEGORY_ID,
      topic: `Ticket depósito • ${user.tag} (${user.id})`,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
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
      pixType: "cpf", 
      twitchName: null,
      pixKey: null,
      step: "collect_details"
    });

    const embed = new EmbedBuilder()
      .setTitle("🧾 Envio de print do depósito")
      .setDescription(
        "1) Escolha o **Tipo Pix** no seletor abaixo\n" +
        "2) Clique em **Preencher dados** (Nick Twitch + Chave Pix)\n" +
        "3) Depois anexe aqui o **print do histórico/comprovante do depósito**"
      );

    const pixSelect = new StringSelectMenuBuilder()
      .setCustomId("pix_type_select")
      .setPlaceholder("Selecione o Tipo Pix")
      .addOptions(
        { label: "CPF", value: "cpf" },
        { label: "E-mail", value: "email" },
        { label: "Telefone", value: "phone" },
        { label: "Chave aleatória", value: "random" }
      );

    const row1 = new ActionRowBuilder().addComponents(pixSelect);

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("open_details_modal")
        .setLabel("Preencher dados")
        .setStyle(ButtonStyle.Primary)
    );

    await channel.send({
      content: `<@${user.id}> <@&${STAFF_ROLE_ID}>`,
      embeds: [embed],
      components: [row1, row2]
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
          return interaction.reply({ content: `Você já tem um ticket aberto: <#${existing}>`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });

        const ch = await createTicketChannel({ guild, user: interaction.user });

        return interaction.editReply({ content: `✅ Ticket criado: <#${ch.id}>` });
      }

      
      if (interaction.isStringSelectMenu() && interaction.customId === "pix_type_select") {
        const st = ticketState.get(interaction.channelId);
        if (!st) return interaction.reply({ content: "Esse seletor só funciona dentro do ticket.", ephemeral: true });
        if (st.userId !== interaction.user.id) {
          return interaction.reply({ content: "Só o dono do ticket pode selecionar isso.", ephemeral: true });
        }

        const v = interaction.values?.[0];
        if (!["cpf", "email", "phone", "random"].includes(v)) {
          return interaction.reply({ content: "Tipo Pix inválido.", ephemeral: true });
        }

        st.pixType = v;
        ticketState.set(interaction.channelId, st);

        return interaction.reply({ content: `✅ Tipo Pix selecionado: **${v}**`, ephemeral: true });
      }

     
      if (interaction.isButton() && interaction.customId === "open_details_modal") {
        const st = ticketState.get(interaction.channelId);
        if (!st) return interaction.reply({ content: "Esse botão só funciona dentro do ticket.", ephemeral: true });
        if (st.userId !== interaction.user.id) {
          return interaction.reply({ content: "Só o dono do ticket pode usar isso.", ephemeral: true });
        }

        const modal = new ModalBuilder()
          .setCustomId("ticket_details_modal")
          .setTitle("Enviar print do depósito");

        const twitch = new TextInputBuilder()
          .setCustomId("twitch")
          .setLabel("Nick da Twitch (sem @)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(40)
          .setPlaceholder("ex: guigz");

        const pixKey = new TextInputBuilder()
          .setCustomId("pixkey")
          .setLabel("Chave Pix")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(160)
          .setPlaceholder("Digite sua chave Pix");

        modal.addComponents(
          new ActionRowBuilder().addComponents(twitch),
          new ActionRowBuilder().addComponents(pixKey)
        );

        return interaction.showModal(modal);
      }

      
      if (interaction.isModalSubmit() && interaction.customId === "ticket_details_modal") {
        const st = ticketState.get(interaction.channelId);
        if (!st) return interaction.reply({ content: "Esse modal só funciona dentro do ticket.", ephemeral: true });
        if (st.userId !== interaction.user.id) {
          return interaction.reply({ content: "Só o dono do ticket pode enviar isso.", ephemeral: true });
        }

        const twitchRaw = interaction.fields.getTextInputValue("twitch");
        const pixKeyRaw = interaction.fields.getTextInputValue("pixkey");

        const twitchNameLc = normalizeTwitchName(twitchRaw);
        const twitchName = safeText(String(twitchRaw).trim().replace(/^@+/, ""), 40);

        const pixType = st.pixType || "cpf";
        const pixKeyNorm = normalizePixKey(pixType, pixKeyRaw);
        const pixKey = safeText(pixKeyNorm, 160);

        if (!twitchNameLc || !twitchName || !pixKey) {
          return interaction.reply({ content: "❌ Preencha os dados corretamente.", ephemeral: true });
        }

        
        if (pixType === "cpf" && !isValidCPF(pixKey)) {
          return interaction.reply({ content: "❌ CPF inválido. Confira os 11 dígitos.", ephemeral: true });
        }

        if (pixType === "phone" && !isValidPhoneBR(pixKey)) {
          return interaction.reply({ content: "❌ Telefone Pix inválido. Use DDD + número (10 ou 11 dígitos).", ephemeral: true });
        }

        if (pixType === "email" && !isValidEmail(pixKey)) {
          return interaction.reply({ content: "❌ E-mail Pix inválido.", ephemeral: true });
        }

        st.twitchName = twitchName;
        st.pixKey = pixKey;
        st.step = "awaiting_screenshot";
        ticketState.set(interaction.channelId, st);

        const embed = new EmbedBuilder()
          .setTitle("✅ Dados recebidos")
          .setDescription(
            `Nick Twitch: **${twitchName}**\n` +
            `Tipo Pix: **${pixType}**\n` +
            `Chave Pix: **${maskPix(pixKey)}**\n\n` +
            "Agora anexe **APENAS a imagem do print** aqui no ticket (PNG/JPG/WEBP)."
          );

        return interaction.reply({ embeds: [embed] });
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
