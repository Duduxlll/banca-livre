(() => {
  const API = window.location.origin;
  const qs = (s, r = document) => r.querySelector(s);

  const KEY = (() => {
    const u = new URL(window.location.href);
    return (u.searchParams.get("key") || "").trim();
  })();

  const esc = (s = "") =>
    String(s).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[m]);

  const fmtBRL = (cents) => {
    const n = Number(cents || 0);
    return (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  const el = {
    err: qs("#ovError"),

    idle: qs("#viewIdle"),
    palpite: qs("#viewPalpite"),
    torneio: qs("#viewTorneio"),

    pBuy: qs("#pBuy"),
    pTotal: qs("#pTotal"),
    pSub: qs("#pSub"),
    pStatus: qs("#pStatus"),

    pRotateTitle: qs("#pRotateTitle"),
    pRotateHint: qs("#pRotateHint"),

    pPanelWinners: qs("#pPanelWinners"),
    pPanelLast: qs("#pPanelLast"),
    pPanelInfo: qs("#pPanelInfo"),

    pWinners: qs("#pWinners"),
    pLast: qs("#pLast"),
    pInfoText: qs("#pInfoText"),

    tName: qs("#tName"),
    tSub: qs("#tSub"),
    tBadge: qs("#tBadge"),
    tTeams: qs("#tTeams"),
    tAlive: qs("#tAlive"),
    tAliveCount: qs("#tAliveCount")
  };

  function showError(msg) {
    if (!el.err) return;
    el.err.style.display = "block";
    el.err.innerHTML = esc(msg);
  }

  function setView(mode) {
    if (el.idle) el.idle.style.display = mode === "idle" ? "" : "none";
    if (el.palpite) el.palpite.style.display = mode === "palpite" ? "" : "none";
    if (el.torneio) el.torneio.style.display = mode === "torneio" ? "" : "none";
  }

  if (!KEY) {
    showError("Faltou a key na URL. Use: /overlay.html?key=SUA_OVERLAY_PUBLIC_KEY");
    setView("idle");
    return;
  }

  let palpiteState = null;
  let torneioState = null;
  let modeNow = "idle";

  const FEED_TTL = 60_000;
  const FEED_MAX = 6;
  const MAX_TEAMS_SHOW = 6;
  const MAX_ALIVE_SHOW = 18;

  const PALPITE_SHOW_MAX = 3;
  const PALPITE_TTL_MS = 2 * 60 * 1000;

  const seenUserTeam = new Map();
  const feedByTeam = new Map();

  function nowMs() {
    return Date.now();
  }

  function getTsFromEntry(e) {
    const t =
      e?.updatedAt ??
      e?.createdAt ??
      e?.updated_at ??
      e?.created_at ??
      e?._ts ??
      e?.__ts;

    if (!t) return null;

    if (typeof t === "number" && Number.isFinite(t)) return t;

    const ms = Date.parse(String(t));
    return Number.isFinite(ms) ? ms : null;
  }

  function normalizeUserKey(v) {
    return String(v || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
  }

  function pushFeed(teamKey, userKey, displayName) {
    const ts = nowMs();

    const prevTeam = seenUserTeam.get(userKey);
    if (prevTeam && prevTeam !== teamKey) {
      const arrPrev = feedByTeam.get(prevTeam) || [];
      feedByTeam.set(prevTeam, arrPrev.filter((x) => x.userKey !== userKey));
    }
    seenUserTeam.set(userKey, teamKey);

    const arr = feedByTeam.get(teamKey) || [];
    if (arr.some((x) => x.userKey === userKey)) return;

    arr.unshift({ userKey, displayName, ts });
    feedByTeam.set(teamKey, arr.slice(0, FEED_MAX));
  }

  function cleanupFeed() {
    const ts = nowMs();
    for (const [k, arr] of feedByTeam.entries()) {
      feedByTeam.set(k, (arr || []).filter((x) => (ts - x.ts) < FEED_TTL));
    }
  }

  function palpiteHasResult(st) {
    const winners = Array.isArray(st?.winners) ? st.winners : [];
    return winners.length > 0 && st?.actualResultCents != null;
  }

  function palpiteShouldShow(st) {
    if (!st?.roundId) return false;
    if (st?.isOpen) return true;
    return palpiteHasResult(st);
  }

  function pickMode() {
    if (torneioState?.active) return "torneio";
    if (palpiteShouldShow(palpiteState)) return "palpite";
    return "idle";
  }

  function applyMode() {
    const m = pickMode();
    if (m !== modeNow) {
      modeNow = m;
      setView(m);
    }
  }

  function setPalpiteStatus(open, show) {
    if (!el.pStatus) return;
    if (!show) {
      el.pStatus.style.display = "none";
      return;
    }
    el.pStatus.style.display = "";
    el.pStatus.textContent = open ? "ABERTO" : "FECHADO";
    el.pStatus.classList.toggle("ov-status--open", !!open);
    el.pStatus.classList.toggle("ov-status--closed", !open);
  }

  function showPalpitePanel(which) {
    if (el.pPanelWinners) el.pPanelWinners.style.display = which === "winners" ? "" : "none";
    if (el.pPanelLast) el.pPanelLast.style.display = which === "last" ? "" : "none";
    if (el.pPanelInfo) el.pPanelInfo.style.display = which === "info" ? "" : "none";
  }

  function renderPalpiteWinners(st) {
    const winners = Array.isArray(st.winners) ? st.winners : [];
    const hasW = palpiteHasResult(st);

    if (el.pRotateTitle) el.pRotateTitle.textContent = `🏆 Top ${Math.min(3, winners.length || 3)}`;
    if (el.pRotateHint) {
      el.pRotateHint.textContent = hasW ? `Resultado: ${fmtBRL(st.actualResultCents)}` : "Aguardando resultado…";
    }

    if (!el.pWinners) return;

    if (!hasW) {
      el.pWinners.innerHTML = `<div class="mini">Aguardando resultado…</div>`;
      return;
    }

    el.pWinners.innerHTML = winners.slice(0, 3).map((w, i) => {
      const nm = w?.name ?? w?.user ?? "—";
      const val = w?.valueCents != null ? fmtBRL(w.valueCents) : "—";
      return `
        <div class="ov-win">
          <div class="nm">#${i + 1} ${esc(nm)}</div>
          <div class="vl">${esc(val)}</div>
        </div>
      `;
    }).join("");
  }

  function renderPalpiteLast(st) {
    const entries = Array.isArray(st.entries) ? st.entries : [];
    const tsNow = nowMs();

    const cleaned = entries
      .map((e) => {
        const ts = getTsFromEntry(e) ?? tsNow;
        return { ...e, __ts: ts };
      })
      .filter((e) => (tsNow - (e.__ts || tsNow)) < PALPITE_TTL_MS);

    const last = cleaned.slice(0, PALPITE_SHOW_MAX);

    if (el.pRotateTitle) el.pRotateTitle.textContent = "🔥 Últimos palpites";
    if (el.pRotateHint) el.pRotateHint.textContent = last.length ? "Ao vivo" : "—";

    if (!el.pLast) return;

    if (!last.length) {
      el.pLast.innerHTML = `<div class="mini">—</div>`;
      return;
    }

    el.pLast.innerHTML = last.map((e) => {
      const nm = e?.user ?? e?.user_name ?? "—";
      const cents = Number(e?.guessCents ?? e?.guess_cents ?? 0);
      return `
        <div class="ov-row">
          <span class="nm">${esc(nm)}</span>
          <span class="vl">${esc(fmtBRL(cents))}</span>
        </div>
      `;
    }).join("");
  }

  function renderPalpite() {
    const st = palpiteState || {};

    if (el.pBuy) el.pBuy.textContent = st.buyValueCents ? fmtBRL(st.buyValueCents) : "—";
    if (el.pTotal) el.pTotal.textContent = String(st.total ?? 0);

    if (st.isOpen) {
      setPalpiteStatus(true, true);
      if (el.pSub) el.pSub.textContent = "Rodada aberta — mande o valor no chat!";
      showPalpitePanel("last");
      renderPalpiteLast(st);
      return;
    }

    const hasW = palpiteHasResult(st);
    setPalpiteStatus(false, false);

    if (hasW) {
      if (el.pSub) el.pSub.textContent = "Rodada fechada — resultado!";
      showPalpitePanel("winners");
      renderPalpiteWinners(st);
      return;
    }

    setView("idle");
    modeNow = "idle";
  }

  function renderTorneio() {
    const data = torneioState || {};
    if (!data.active) {
      if (el.tName) el.tName.textContent = "Torneio";
      if (el.tSub) el.tSub.textContent = "Nenhum torneio ativo…";
      if (el.tBadge) el.tBadge.textContent = "—";
      if (el.tTeams) el.tTeams.innerHTML = "";
      if (el.tAlive) el.tAlive.innerHTML = `<div class="mini">—</div>`;
      if (el.tAliveCount) el.tAliveCount.textContent = "0";
      return;
    }

    const tor = data.torneio || {};
    const ph = data.phase || {};
    const status = String(ph.status || "").trim();
    const winnerKey = String(ph.winnerTeam || ph.winner || "").trim();

    let teamsAll = Array.isArray(ph.teamsList) ? ph.teamsList : [];

    if (status === "DECIDIDA" && winnerKey) {
      teamsAll = teamsAll.filter((t) => String(t?.key || "") === winnerKey);
    }

    const teamsShown = teamsAll.slice(0, MAX_TEAMS_SHOW);
    const teamsHidden = Math.max(0, teamsAll.length - teamsShown.length);

    if (el.tName) el.tName.textContent = tor.name || "Torneio";

    if (el.tBadge) {
      const num = ph.number != null ? String(ph.number) : "—";
      el.tBadge.textContent = status ? `FASE ${num} • ${status}` : `FASE ${num}`;
    }

    if (el.tSub) {
      if (status === "ABERTA") el.tSub.textContent = "Fase ativa — entradas abertas!";
      else if (status === "FECHADA") el.tSub.textContent = "Fase fechada — aguardando decisão…";
      else if (status === "DECIDIDA") el.tSub.textContent = "Vencedor decidido!";
      else el.tSub.textContent = "Torneio ativo.";
    }

    const listsByKey = ph.listsByKey || ph.lists || {};

    if (teamsShown.length) {
      for (const t of teamsShown) {
        const k = String(t.key || "");
        const arr = Array.isArray(listsByKey?.[k]) ? listsByKey[k] : [];
        for (const u of arr.slice(0, 12)) {
          const userKey = normalizeUserKey(u?.twitchName || u?.displayName || u?.name || "");
          if (!userKey) continue;
          pushFeed(k, userKey, String(u?.displayName || u?.twitchName || u?.name || "—"));
        }
      }
    }

    cleanupFeed();

    if (el.tTeams) {
      const htmlTeams = teamsShown.map((t) => {
        const k = String(t.key || "");
        const name = String(t.name || k || "Time");
        const count = Number(t.count || 0) | 0;
        const valor = Number(t.points || 0) | 0;

        const feed = (feedByTeam.get(k) || []).slice(0, FEED_MAX);
        const feedHtml = feed.length
          ? feed.map((x) => `<div class="tr-pill">${esc(x.displayName)}</div>`).join("")
          : `<div class="mini">—</div>`;

        return `
          <div class="tr-team">
            <div class="tr-top">
              <div class="tr-name">${esc(name)}</div>
              <div class="tr-meta">${count} entradas<br>${valor} valor</div>
            </div>
            <div class="tr-feed">${feedHtml}</div>
          </div>
        `;
      }).join("");

      const moreTeamsHtml = teamsHidden > 0 ? `<div class="mini">+${teamsHidden} times</div>` : "";
      el.tTeams.innerHTML = htmlTeams + moreTeamsHtml;
    }

    const aliveCount = Number(ph.aliveCount || 0) | 0;
    if (el.tAliveCount) el.tAliveCount.textContent = String(aliveCount);

    const alive = Array.isArray(ph.alivePreview) ? ph.alivePreview : [];
    const aliveShown = alive.slice(0, MAX_ALIVE_SHOW);
    const aliveHidden = Math.max(0, aliveCount - aliveShown.length);

    if (el.tAlive) {
      if (!aliveShown.length) {
        el.tAlive.innerHTML = `<div class="mini">—</div>`;
      } else {
        const listHtml = aliveShown.map((u, i) => {
          const nm = u?.name || u?.twitchName || "—";
          return `<div class="alv"><span class="nm">#${i + 1} ${esc(nm)}</span></div>`;
        }).join("");

        const moreHtml = aliveHidden > 0 ? `<div class="mini">+${aliveHidden} classificados</div>` : "";
        el.tAlive.innerHTML = listHtml + moreHtml;
      }
    }
  }

  async function fetchJSON(url) {
    const r = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
    let data = null;
    try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error(data?.error || `http_${r.status}`);
    return data;
  }

  async function tickTorneio() {
    try {
      const url = `${API}/api/torneio/state?key=${encodeURIComponent(KEY)}&include=lists,alive&listsLimit=60&aliveLimit=24`;
      torneioState = await fetchJSON(url);
    } catch {
      torneioState = torneioState || { active: false };
    }
    applyMode();
    if (modeNow === "torneio") renderTorneio();
  }

  async function tickPalpiteOnce() {
    try {
      const url = `${API}/api/palpite/state-public?key=${encodeURIComponent(KEY)}`;
      palpiteState = await fetchJSON(url);
    } catch {}
    applyMode();
    if (modeNow === "palpite") renderPalpite();
  }

  function startPalpiteSSE() {
    const url = `${API}/api/palpite/stream?key=${encodeURIComponent(KEY)}`;
    let es = null;

    try {
      es = new EventSource(url);

      const onState = (raw) => {
        let st = null;
        try { st = JSON.parse(raw || "{}"); } catch { st = null; }
        if (!st) return;
        palpiteState = st;
        applyMode();
        if (modeNow === "palpite") renderPalpite();
      };

      es.addEventListener("palpite-init", (e) => onState(e.data));
      es.addEventListener("palpite-open", (e) => onState(e.data));
      es.addEventListener("palpite-close", (e) => onState(e.data));
      es.addEventListener("palpite-clear", (e) => onState(e.data));
      es.addEventListener("palpite-winners", (e) => onState(e.data));

      es.addEventListener("palpite-guess", (e) => {
        let payload = null;
        try { payload = JSON.parse(e.data || "{}"); } catch {}
        if (!payload?.entry) return;

        const entry = payload.entry || {};
        const withTs = { ...entry, __ts: nowMs() };

        const cur = Array.isArray(palpiteState?.entries) ? palpiteState.entries : [];
        const userKey = normalizeUserKey(withTs.user || withTs.user_name || "");
        const next = userKey ? cur.filter((x) => normalizeUserKey(x?.user || x?.user_name) !== userKey) : cur;
        const merged = [withTs, ...next].slice(0, 500);

        palpiteState = {
          ...(palpiteState || {}),
          total: payload.total ?? palpiteState?.total,
          entries: merged
        };

        applyMode();
        if (modeNow === "palpite") renderPalpite();
      });

      es.onerror = () => {
        try { es.close(); } catch {}
        setTimeout(() => startPalpiteSSE(), 1200);
      };
    } catch {}
  }

  setView("idle");
  tickPalpiteOnce();
  startPalpiteSSE();

  tickTorneio();
  setInterval(tickTorneio, 1500);

  setInterval(() => {
    const tsNow = nowMs();

    if (palpiteState?.isOpen && Array.isArray(palpiteState.entries)) {
      palpiteState.entries = palpiteState.entries.filter((e) => {
        const ts = getTsFromEntry(e) ?? tsNow;
        return (tsNow - ts) < PALPITE_TTL_MS;
      });
    }

    cleanupFeed();
    if (modeNow === "palpite") renderPalpite();
    if (modeNow === "torneio") renderTorneio();
    applyMode();
  }, 1000);
})();
