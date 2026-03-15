import tmiPkg from "tmi.js";

export function initTwitchBot({
  port,
  apiKey,
  botUsername,
  oauthToken,
  channel,
  enabled = true,
  onLog = console,
  cashbackPublicUrl,
}) {
  const log = onLog || console;

  if (globalThis.__TWITCH_BOT_SINGLETON__) {
    return globalThis.__TWITCH_BOT_SINGLETON__;
  }

  if (!enabled) {
    const api = { enabled: false, say: async () => {}, client: null };
    globalThis.__TWITCH_BOT_SINGLETON__ = api;
    return api;
  }

  if (!port || !apiKey || !botUsername || !oauthToken || !channel) {
    const api = { enabled: false, say: async () => {}, client: null };
    globalThis.__TWITCH_BOT_SINGLETON__ = api;
    return api;
  }

  const APP_KEY = String(apiKey || "").trim();

  const tmi = tmiPkg?.default ?? tmiPkg;
  const chan = channel.startsWith("#") ? channel : `#${channel}`;
  const pass = oauthToken.startsWith("oauth:") ? oauthToken : `oauth:${oauthToken}`;

  const OVERLAY_PUBLIC_KEY = (process.env.OVERLAY_PUBLIC_KEY || "").trim();

  const publicUrl =
    cashbackPublicUrl ||
    process.env.CASHBACK_PUBLIC_URL ||
    "guigz.com.br/cashback-publico";

  const sayOnJoin = String(process.env.TOURNEY_SAY_JOIN || "").trim().toLowerCase() === "true";
  const announceEnabled = String(process.env.TOURNEY_ANNOUNCE || "").trim().toLowerCase() === "true";
  const announceIntervalMs = (() => {
    const n = Number(process.env.TOURNEY_ANNOUNCE_INTERVAL_MS || 9000);
    if (!Number.isFinite(n)) return 9000;
    return Math.max(4000, Math.min(n, 60000));
  })();

  const autoMsgEnabled = String(process.env.TWITCH_AUTOMSG || "").trim().toLowerCase() === "true";
  const autoMsgIntervalMs = (() => {
    const n = Number(process.env.TWITCH_AUTOMSG_INTERVAL_MS || 300000);
    if (!Number.isFinite(n)) return 300000;
    return Math.max(60000, n);
  })();
  const autoMsgText = String(process.env.TWITCH_AUTOMSG_TEXT || "").trim();


  

  const client = new tmi.Client({
  options: { debug: false },
  connection: { reconnect: true, secure: true },
  identity: { username: botUsername, password: pass },
  channels: [chan]
});

  let queue = Promise.resolve();
  const enqueue = (fn) => {
    queue = queue.then(fn).catch((e) => log.error("[twitch-bot] erro:", e));
  };

  function toAsciiLower(s = "") {
    return String(s || "")
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .toLowerCase();
  }

  function normalizeTeamKey(name) {
    const s = toAsciiLower(name)
      .replace(/[^a-z0-9 _-]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\s/g, "");
    return s || null;
  }

  function parseCommand(msg) {
    const text = String(msg || "").trim();
    if (!text.startsWith("!")) return null;

    let m = text.match(/^!palpite\b\s*(.+)$/i) || text.match(/^!p\b\s*(.+)$/i);
    if (m && m[1]) return { type: "guess", payload: m[1].trim() };

    const t = text.match(/^!time\b\s*(.+)$/i);
    if (t) {
      const payload = String(t[1] || "").trim();
      if (!payload) return { type: "time", payload: "" };
      return { type: "time", payload };
    }

    const g = text.match(/^!gorjeta\b\s*(.*)$/i);
    if (g) {
      const arg = String(g[1] || "").trim().toLowerCase();
      if (arg === "status") return { type: "gorjeta_status" };
      return { type: "gorjeta_join" };
    }

    const c = text.match(/^!cashback\b/i);
    if (c) return { type: "cashback_link" };

    const s = text.match(/^!status\b/i);
    if (s) return { type: "cashback_status" };

    return null;
  }

  async function submitGuessToServer(user, rawGuess) {
    const url = `http://127.0.0.1:${port}/api/palpite/guess?key=${encodeURIComponent(APP_KEY)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-APP-KEY": APP_KEY,
      },
      body: JSON.stringify({ user, guess: rawGuess, source: "twitch" }),
    });
    return res.ok;
  }

  async function getTorneioState() {
    const k = OVERLAY_PUBLIC_KEY || "";
    if (!k) return { error: "missing_overlay_key" };

    const url = `http://127.0.0.1:${port}/api/torneio/state?key=${encodeURIComponent(k)}`;
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });

    let data = null;
    try {
      data = await res.json();
    } catch {}

    if (!res.ok) return { error: data?.error || `http_${res.status}` };
    return { ok: true, data };
  }

  function getTeamsFromStatePhase(phase) {
    if (Array.isArray(phase?.teamsList) && phase.teamsList.length) {
      return phase.teamsList
        .map((t) => {
          const key = String(t?.key ?? t?.id ?? "").trim();
          const name = String(t?.name ?? key).trim();
          if (!key) return null;
          return { key, name };
        })
        .filter(Boolean);
    }

    if (Array.isArray(phase?.teams) && phase.teams.length) {
      return phase.teams
        .map((t) => {
          const key = String(t?.key ?? t?.id ?? "").trim();
          const name = String(t?.name ?? key).trim();
          if (!key) return null;
          return { key, name };
        })
        .filter(Boolean);
    }

    const legacy = phase?.teams || {};
    const out = [];
    if (legacy?.A) out.push({ key: "A", name: String(legacy.A) });
    if (legacy?.B) out.push({ key: "B", name: String(legacy.B) });
    if (legacy?.C) out.push({ key: "C", name: String(legacy.C) });
    return out;
  }

  function resolveTeamKey(input, teams) {
    const raw = String(input || "").trim();
    if (!raw) return null;

    const k = normalizeTeamKey(raw);
    if (!k) return null;

    for (const t of teams || []) {
      const tk = String(t.key || "");
      const tn = String(t.name || "");
      if (tk && normalizeTeamKey(tk) === k) return tk;
      if (tn && normalizeTeamKey(tn) === k) return tk || k;
    }

    return null;
  }

  function formatTeamsHint(teams, max = 6) {
    const arr = (teams || []).map((t) => String(t.name || t.key || "").trim()).filter(Boolean);
    if (!arr.length) return "use: !time <nome do time>";
    const slice = arr.slice(0, max);
    const rest = arr.length - slice.length;
    const list = slice.join(" | ");
    return rest > 0 ? `use: !time ${list} | +${rest}` : `use: !time ${list}`;
  }

  function getTeamNameByKey(teams, key) {
    const k = String(key || "").trim();
    for (const t of teams || []) {
      if (String(t.key || "").trim() === k) return String(t.name || t.key || "").trim();
    }
    return "";
  }

  async function joinTeam(userTag, displayName, teamKey) {
    const url = `http://127.0.0.1:${port}/api/torneio/join?key=${encodeURIComponent(APP_KEY)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-APP-KEY": APP_KEY,
      },
      body: JSON.stringify({ user: userTag, displayName, team: teamKey }),
    });

    let data = null;
    try {
      data = await res.json();
    } catch {}

    if (!res.ok) return { error: data?.error || `http_${res.status}` };
    return { ok: true, data };
  }

  async function getCashbackStatus(user) {
    const url = `http://127.0.0.1:${port}/api/cashback/status/${encodeURIComponent(user)}?key=${encodeURIComponent(APP_KEY)}`;
    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json", "X-APP-KEY": APP_KEY } });

    if (res.status === 404) return { notFound: true };
    let data = null;
    try {
      data = await res.json();
    } catch {}
    if (!res.ok) return { error: data?.error || `http_${res.status}` };

    return { ok: true, data };
  }

  async function gorjetaJoin(userTag, displayName) {
    const url = `http://127.0.0.1:${port}/api/gorjeta/join?key=${encodeURIComponent(APP_KEY)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-APP-KEY": APP_KEY,
      },
      body: JSON.stringify({ user: userTag, displayName }),
    });

    let data = null;
    try { data = await res.json(); } catch {}

    if (!res.ok) return { error: data?.error || `http_${res.status}`, data };
    return { ok: true, data };
  }

  async function gorjetaStatus() {
    const url = `http://127.0.0.1:${port}/api/gorjeta/status?key=${encodeURIComponent(APP_KEY)}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-APP-KEY": APP_KEY,
      },
    });

    let data = null;
    try { data = await res.json(); } catch {}

    if (!res.ok) return { error: data?.error || `http_${res.status}`, data };
    return { ok: true, data };
  }

  async function say(msg) {
  try {
    await client.say(chan, msg);
  } catch (e) {
    if (isNoResponseFromTwitchError(e)) return;
    log.error("[twitch-bot] falha ao enviar msg:", e?.message || e);
  }
}

  const recent = new Map();
  function isDuplicate(userKey, cmdKey) {
    const key = `${userKey}|${cmdKey}`;
    const now = Date.now();
    const last = recent.get(key) || 0;
    if (now - last < 1500) return true;
    recent.set(key, now);

    if (recent.size > 500) {
      const cutoff = now - 60000;
      for (const [k, t] of recent.entries()) if (t < cutoff) recent.delete(k);
    }
    return false;
  }

  const lastJoinPhase = new Map();
  function shouldConfirmJoin(userKey, phaseNumber, teamKey) {
    if (!sayOnJoin) return false;
    const k = `${userKey}`;
    const v = lastJoinPhase.get(k);
    const nowSig = `${phaseNumber}:${teamKey}`;
    if (v === nowSig) return false;
    lastJoinPhase.set(k, nowSig);
    if (lastJoinPhase.size > 2000) {
      const keys = Array.from(lastJoinPhase.keys()).slice(0, 200);
      for (const kk of keys) lastJoinPhase.delete(kk);
    }
    return true;
  }

  let pollTimer = null;
  let autoMsgTimer = null;
  let lastAnnounceSig = "";
  let lastAnnounceAt = 0;

  function canAnnounce(sig) {
    const now = Date.now();
    if (sig && sig === lastAnnounceSig && now - lastAnnounceAt < 15000) return false;
    if (now - lastAnnounceAt < 2500) return false;
    lastAnnounceSig = sig || "";
    lastAnnounceAt = now;
    return true;
  }

  async function pollAnnounce() {
    const st = await getTorneioState();
    if (st.error) return;

    const d = st.data || {};
    const active = !!d.active;
    const tor = d.torneio || null;
    const phase = d.phase || null;

    const torId = String(tor?.id || "");
    const torName = String(tor?.name || "Torneio").trim();
    const phaseNum = Number(phase?.number || tor?.currentPhase || 0) || 0;
    const phStatus = String(phase?.status || "").toUpperCase();
    const winnerKey = String(phase?.winnerTeam || "").trim();

    const teams = getTeamsFromStatePhase(phase);
    const teamsNames = (teams || []).map((t) => String(t.name || t.key || "").trim()).filter(Boolean);
    const shortTeams = teamsNames.slice(0, 6);
    const extra = teamsNames.length - shortTeams.length;
    const teamsText = shortTeams.length ? `${shortTeams.join(" | ")}${extra > 0 ? ` | +${extra}` : ""}` : "";

    const sig = `${active ? "1" : "0"}|${torId}|${phaseNum}|${phStatus}|${winnerKey}|${teamsNames.join(",")}`;

    if (!canAnnounce(sig)) return;

    if (!active) {
      await say(`🏁 Torneio encerrado.`);
      return;
    }

    if (!phase || !phaseNum) {
      await say(`🏟️ ${torName} ativo, mas sem fase disponível agora.`);
      return;
    }

    if (phStatus === "ABERTA") {
      await say(
        `🏟️ ${torName} • Fase ${phaseNum} ABERTA ✅ ${teamsText ? `• Times: ${teamsText} • use !time <nome>` : "• use !time <nome do time>"}`
      );
      return;
    }

    if (phStatus === "FECHADA") {
      await say(`⛔ ${torName} • Fase ${phaseNum} FECHADA.`);
      return;
    }

    if (phStatus === "DECIDIDA") {
      const wn = winnerKey ? getTeamNameByKey(teams, winnerKey) : "";
      const wLabel = winnerKey ? (wn && wn !== winnerKey ? `${winnerKey} (${wn})` : winnerKey) : "—";
      await say(`🏆 ${torName} • Fase ${phaseNum} DECIDIDA • Vencedor: ${wLabel}.`);
      return;
    }
  }

  client.on("connected", () => {
    log.log(`[twitch-bot] conectado em ${chan} como ${botUsername}`);

    if (announceEnabled) {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(() => {
        enqueue(async () => {
          try {
            await pollAnnounce();
          } catch (e) {
            log.error("[twitch-bot] poll announce erro:", e?.message || e);
          }
        });
      }, announceIntervalMs);

      enqueue(async () => {
        try {
          await pollAnnounce();
        } catch {}
      });
    }

    if (autoMsgEnabled && autoMsgText) {
      if (autoMsgTimer) clearInterval(autoMsgTimer);

      autoMsgTimer = setInterval(() => {
        enqueue(async () => {
          try {
            await say(autoMsgText);
          } catch (e) {
            log.error("[twitch-bot] auto msg erro:", e?.message || e);
          }
        });
      }, autoMsgIntervalMs);

      enqueue(async () => {
        try {
          await say(autoMsgText);
        } catch {}
      });
    }
  });

  client.on("disconnected", () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (autoMsgTimer) {
      clearInterval(autoMsgTimer);
      autoMsgTimer = null;
    }
  });

  client.on("error", (err) => {
  if (isNoResponseFromTwitchError(err)) return;
  log.error("[twitch-bot] error:", err?.message || err);
});

  client.on("message", (channelName, tags, message, self) => {
    if (self) return;

    const userTag = (tags.username || "").trim();
    const display = (tags["display-name"] || tags.username || "").trim();
    const user = display || userTag;
    if (!user) return;

    const cmd = parseCommand(message);
    if (!cmd) return;

    const userKey = userTag || user;
    const cmdKey =
      cmd.type === "guess"
        ? `guess:${cmd.payload || ""}`
        : cmd.type === "time"
          ? `time:${cmd.payload || ""}`
          : cmd.type === "gorjeta_join"
            ? "gorjeta_join"
            : cmd.type === "gorjeta_status"
              ? "gorjeta_status"
              : cmd.type;

    if (isDuplicate(userKey, cmdKey)) return;

    enqueue(async () => {
      const mention = userTag ? `@${userTag}` : `@${user}`;

      if (cmd.type === "guess") {
        await submitGuessToServer(user, cmd.payload);
        return;
      }

      if (cmd.type === "gorjeta_join") {
  const r = await gorjetaJoin(userTag || user, display || user);
  if (r.error === "rodada_fechada") {
    await say(`${mention} gorjeta está FECHADA agora.`);
    return;
  }
  if (r.error) {
    await say(`${mention} erro ao entrar na gorjeta: ${r.error}`);
    return;
  }
  if (r.data?.alreadyJoined) {
    await say(`${mention} você já está na gorjeta ✅`);
    return;
  }
  await say(`${mention} entrou na gorjeta ✅`);
  return;
}

      if (cmd.type === "gorjeta_status") {
        const r = await gorjetaStatus();
        if (r.error) {
          await say(`${mention} não consegui ver o status da gorjeta agora.`);
          return;
        }
        if (!r.data?.isOpen) {
          await say(`${mention} gorjeta está FECHADA.`);
          return;
        }
        const n = Number(r.data?.participants || 0);
        await say(`${mention} gorjeta ABERTA ✅ participantes: ${n} • para entrar: !gorjeta`);
        return;
      }

      if (cmd.type === "cashback_link") {
        await say(`${mention} envie seu print aqui: ${publicUrl}`);
        return;
      }

      if (cmd.type === "cashback_status") {
        const st = await getCashbackStatus(userTag || user);
        if (st.notFound) {
          await say(`${mention} não encontrei seu print ainda. Envie em: ${publicUrl}`);
          return;
        }
        if (st.error) {
          await say(`${mention} não consegui ver seu status agora. Tenta de novo já já.`);
          return;
        }
        const status = String(st.data?.status || "").toUpperCase() || "PENDENTE";
        if (status === "APROVADO") await say(`${mention} seu print está APROVADO ✅`);
        else if (status === "REPROVADO") await say(`${mention} seu print foi REPROVADO ❌`);
        else await say(`${mention} seu print está PENDENTE ⏳`);
        return;
      }

      if (cmd.type === "time") {
        const rawChoice = String(cmd.payload || "").trim();

        if (!rawChoice) {
          await say(`${mention} use: !time <nome do time>`);
          return;
        }

        const st = await getTorneioState();
        if (st.error) {
          await say(`${mention} não consegui verificar o torneio agora.`);
          return;
        }

        if (!st.data?.active) {
          await say(`${mention} torneio não está ativo agora.`);
          return;
        }

        const phase = st.data?.phase;
        if (!phase) {
          await say(`${mention} torneio ativo, mas a fase não está disponível agora.`);
          return;
        }

        const status = String(phase.status || "").toUpperCase();
        if (status !== "ABERTA") {
          await say(`${mention} entradas fechadas.`);
          return;
        }

        const teams = getTeamsFromStatePhase(phase);
        const teamKey = resolveTeamKey(rawChoice, teams);

        if (!teamKey) {
          await say(`${mention} time inválido. ${formatTeamsHint(teams, 6)}`);
          return;
        }

        const r = await joinTeam(userTag || user, display || user, teamKey);

        if (r.error === "torneio_inativo") {
          await say(`${mention} torneio não está ativo agora.`);
          return;
        }
        if (r.error === "fase_fechada") {
          await say(`${mention} entradas fechadas.`);
          return;
        }
        if (r.error === "nao_classificado") {
          await say(`${mention} você não está classificado para esta fase.`);
          return;
        }
        if (r.error === "time_invalido") {
          await say(`${mention} time inválido. ${formatTeamsHint(teams, 6)}`);
          return;
        }
        if (r.error) {
          await say(`${mention} não consegui entrar agora. Tenta de novo já já.`);
          return;
        }

        const phaseNum = Number(r.data?.phase || phase.number || 1);
        if (shouldConfirmJoin(userKey, phaseNum, teamKey)) {
          const name = r.data?.teamName || getTeamNameByKey(teams, teamKey) || "";
          const label = name && name !== teamKey ? `${teamKey} (${name})` : teamKey;
          await say(`${mention} entrou no time ${label}.`);
        }
        return;
      }
    });
  });

  client.connect().catch((e) => log.error("[twitch-bot] falha ao conectar:", e));

  const api = { enabled: true, say, client };
  globalThis.__TWITCH_BOT_SINGLETON__ = api;

  return api;
}