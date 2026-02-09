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

  function setView(mode){
  if (el.idle) el.idle.style.display = mode === "idle" ? "" : "none";
  if (el.palpite) el.palpite.style.display = mode === "palpite" ? "" : "none";
  if (el.torneio) el.torneio.style.display = mode === "torneio" ? "" : "none";

  document.documentElement.dataset.ovMode = mode; 
}


  if (!KEY) {
    showError("Faltou a key na URL. Use: /overlay.html?key=SUA_OVERLAY_PUBLIC_KEY");
    setView("idle");
    return;
  }

  const PALPITE_SHOW_MAX = 3;
  const PALPITE_TTL_MS = 2 * 60 * 1000;

  const TORNEIO_TEAMS_MAX = 6;
  const ALIVE_MAX = 24;

  const JOIN_TTL_MS = 60 * 1000;

  let palpiteState = null;
  let torneioState = null;
  let modeNow = "idle";
  let palpiteCleared = false;

  const lastJoinByTeam = new Map();

  function nowMs() {
    return Date.now();
  }

  function normalizeUserKey(v) {
    return String(v || "")
      .trim()
      .replace(/^@+/, "")
      .toLowerCase();
  }

  function getAnyTs(v) {
    if (!v) return null;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    const ms = Date.parse(String(v));
    return Number.isFinite(ms) ? ms : null;
  }

  function getTsFromEntry(e) {
    const t =
      e?.updatedAt ??
      e?.createdAt ??
      e?.updated_at ??
      e?.created_at ??
      e?._ts ??
      e?.__ts;
    return getAnyTs(t);
  }

  function palpiteHasResult(st) {
    const winners = Array.isArray(st?.winners) ? st.winners : [];
    return winners.length > 0 && st?.actualResultCents != null;
  }

  function palpiteShouldShow(st) {
    return !!st?.roundId && !palpiteCleared;
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

    el.pLast.innerHTML = last
      .map((e) => {
        const nm = e?.user ?? e?.user_name ?? "—";
        const cents = Number(e?.guessCents ?? e?.guess_cents ?? 0);
        return `
          <div class="ov-row">
            <span class="nm">${esc(nm)}</span>
            <span class="vl">${esc(fmtBRL(cents))}</span>
          </div>
        `;
      })
      .join("");
  }

  function renderPalpiteWinnersOrPlaceholder(st) {
    const winners = Array.isArray(st.winners) ? st.winners : [];
    const topN = Math.min(3, Math.max(1, Number(st.winnersCount || 3) || 3));
    const hasW = palpiteHasResult(st);

    if (el.pRotateTitle) el.pRotateTitle.textContent = `🏆 Top ${topN}`;
    if (el.pRotateHint) {
      el.pRotateHint.textContent =
        st.actualResultCents != null ? `Resultado: ${fmtBRL(st.actualResultCents)}` : "Aguardando resultado…";
    }

    if (!el.pWinners) return;

    if (hasW) {
      el.pWinners.innerHTML = winners.slice(0, topN).map((w, i) => {
        const nm = w?.name ?? w?.user ?? "—";
        const val = w?.valueCents != null ? fmtBRL(w.valueCents) : "—";
        return `
          <div class="ov-win">
            <div class="nm">#${i + 1} ${esc(nm)}</div>
            <div class="vl">${esc(val)}</div>
          </div>
        `;
      }).join("");
      return;
    }

    el.pWinners.innerHTML = Array.from({ length: topN }).map((_, i) => {
      return `
        <div class="ov-win">
          <div class="nm">#${i + 1} ${esc("Aguardando…")}</div>
          <div class="vl">${esc("—")}</div>
        </div>
      `;
    }).join("");
  }

  function renderPalpite() {
    const st = palpiteState || {};

    if (el.pBuy) el.pBuy.textContent = st.buyValueCents ? fmtBRL(st.buyValueCents) : "—";
    if (el.pTotal) el.pTotal.textContent = String(st.total ?? 0);

    if (st.isOpen) {
      palpiteCleared = false;
      setPalpiteStatus(true, true);
      if (el.pSub) el.pSub.textContent = "Rodada aberta";
      showPalpitePanel("last");
      renderPalpiteLast(st);
      return;
    }

    setPalpiteStatus(false, false);
    if (el.pSub) el.pSub.textContent = "Rodada fechada";
    showPalpitePanel("winners");
    renderPalpiteWinnersOrPlaceholder(st);
  }

  function cleanupJoins() {
    const tsNow = nowMs();
    for (const [k, v] of lastJoinByTeam.entries()) {
      if (!v || (tsNow - (v.ts || 0)) > JOIN_TTL_MS) {
        lastJoinByTeam.delete(k);
      }
    }
  }

  function pickLatestUser(arr) {
    if (!Array.isArray(arr) || !arr.length) return null;

    let best = null;
    let bestTs = -1;

    for (const u of arr) {
      const ts =
        getAnyTs(u?.joinedAt) ??
        getAnyTs(u?.createdAt) ??
        getAnyTs(u?.updatedAt) ??
        getAnyTs(u?.ts) ??
        null;

      if (ts != null && ts > bestTs) {
        bestTs = ts;
        best = u;
      }
    }

    if (best) return best;
    return arr[0];
  }

  function updateJoinsFromState(data) {
    const ph = data?.phase || {};
    const listsByKey = ph?.listsByKey || {};
    const tsNow = nowMs();

    for (const [teamKey, list] of Object.entries(listsByKey)) {
      const u = pickLatestUser(list);
      if (!u) continue;

      const name = String(u?.displayName || u?.twitchName || u?.name || "").trim();
      if (!name) continue;

      const cur = lastJoinByTeam.get(teamKey);
      if (!cur || cur.name !== name) {
        lastJoinByTeam.set(teamKey, { name, ts: tsNow });
      } else {
        lastJoinByTeam.set(teamKey, { name: cur.name, ts: cur.ts || tsNow });
      }
    }
  }

  function renderTorneio() {
    const data = torneioState || {};
    if (!data.active) {
      if (el.tName) el.tName.textContent = "Torneio";
      if (el.tSub) el.tSub.textContent = "Aguardando…";
      if (el.tBadge) el.tBadge.textContent = "—";
      if (el.tTeams) el.tTeams.innerHTML = "";
      if (el.tAlive) el.tAlive.innerHTML = `<div class="mini">—</div>`;
      if (el.tAliveCount) el.tAliveCount.textContent = "0";
      return;
    }

    cleanupJoins();

    const tor = data.torneio || {};
    const ph = data.phase || {};
    const status = String(ph.status || "").trim();
    const winnerKey = String(
      ph.winnerTeamKey || ph.winnerTeam || ph.winner_key || ph.winnerKey || ph.winner || ""
    ).trim();

    let teamsAll = Array.isArray(ph.teamsList) ? ph.teamsList : [];
    if (status === "DECIDIDA" && winnerKey) {
      teamsAll = teamsAll.filter((t) => String(t?.key || "") === winnerKey);
    }

    const teamsShown = teamsAll.slice(0, TORNEIO_TEAMS_MAX);
    const teamsHidden = Math.max(0, teamsAll.length - teamsShown.length);

    if (el.tName) el.tName.textContent = tor.name || "Torneio";

    if (el.tBadge) {
      const num = ph.number != null ? String(ph.number) : "—";
      el.tBadge.textContent = status ? `FASE ${num} • ${status}` : `FASE ${num}`;
    }

    if (el.tSub) {
      if (status === "ABERTA") el.tSub.textContent = "Fase ativa";
      else if (status === "FECHADA") el.tSub.textContent = "Fase fechada";
      else if (status === "DECIDIDA") el.tSub.textContent = "Vencedor decidido";
      else el.tSub.textContent = "Torneio ativo";
    }

    if (el.tTeams) {
      const htmlTeams = teamsShown.map((t) => {
        const k = String(t.key || "");
        const name = String(t.name || k || "Time");
        const count = Number(t.count || 0) | 0;
        const valor = Number(t.points || 0) | 0;

        const last = lastJoinByTeam.get(k);
        const lastName = last && (nowMs() - (last.ts || 0)) <= JOIN_TTL_MS ? last.name : "";

        const lastHtml = lastName
          ? `<div class="mini" style="margin-top:6px; opacity:.95;">${esc(lastName)}</div>`
          : `<div class="mini" style="margin-top:6px; opacity:.0;">&nbsp;</div>`;

        return `
          <div class="tr-team">
            <div class="tr-top">
              <div class="tr-name">${esc(name)}</div>
              <div class="tr-meta">${count} entradas<br>${valor} valor</div>
            </div>
            ${lastHtml}
          </div>
        `;
      }).join("");

      const moreTeamsHtml = teamsHidden > 0 ? `<div class="mini">+${teamsHidden} times</div>` : "";
      el.tTeams.innerHTML = htmlTeams + moreTeamsHtml;
    }

    const aliveCount = Number(ph.aliveCount || 0) | 0;
    if (el.tAliveCount) el.tAliveCount.textContent = String(aliveCount);

    const alive = Array.isArray(ph.alivePreview) ? ph.alivePreview : [];
    const aliveShown = alive.slice(0, ALIVE_MAX);
    const aliveHidden = Math.max(0, aliveCount - aliveShown.length);

    if (el.tAlive) {
      el.tAlive.style.display = "flex";
      el.tAlive.style.flexWrap = "wrap";
      el.tAlive.style.gap = "6px";
      el.tAlive.style.alignItems = "flex-start";

      if (!aliveShown.length) {
        el.tAlive.innerHTML = `<div class="mini">—</div>`;
      } else {
        const listHtml = aliveShown.map((u, i) => {
          const nm = u?.name || u?.twitchName || "—";
          return `<div class="alv" style="font-size:12px; line-height:1; white-space:nowrap;"><span class="nm">#${i + 1} ${esc(nm)}</span></div>`;
        }).join("");

        const moreHtml = aliveHidden > 0 ? `<div class="mini" style="width:100%; margin-top:6px;">+${aliveHidden} classificados</div>` : "";
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
      const url = `${API}/api/torneio/state?key=${encodeURIComponent(KEY)}&include=lists,alive&listsLimit=10&aliveLimit=${ALIVE_MAX}`;
      torneioState = await fetchJSON(url);
      updateJoinsFromState(torneioState);
    } catch {
      torneioState = torneioState || { active: false };
    }
    applyMode();
    if (modeNow === "torneio") renderTorneio();
  }

  async function tickPalpiteOnce() {
    try {
      const url = `${API}/api/palpite/state-public?key=${encodeURIComponent(KEY)}`;
      const st = await fetchJSON(url);
      palpiteState = st?.roundId ? st : null;
      if (palpiteState?.roundId) palpiteCleared = false;
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

        palpiteState = st?.roundId ? st : null;
        if (palpiteState?.roundId) palpiteCleared = false;

        applyMode();
        if (modeNow === "palpite") renderPalpite();
      };

      es.addEventListener("palpite-init", (e) => onState(e.data));
      es.addEventListener("palpite-open", (e) => onState(e.data));
      es.addEventListener("palpite-close", (e) => onState(e.data));
      es.addEventListener("palpite-winners", (e) => onState(e.data));

      es.addEventListener("palpite-clear", () => {
        palpiteCleared = true;
        palpiteState = null;
        applyMode();
      });

      es.addEventListener("palpite-guess", (e) => {
        let payload = null;
        try { payload = JSON.parse(e.data || "{}"); } catch {}
        if (!payload?.entry) return;

        const entry = payload.entry || {};
        const withTs = { ...entry, __ts: nowMs() };

        if (!palpiteState) return;

        const cur = Array.isArray(palpiteState.entries) ? palpiteState.entries : [];
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

  function hideJoinCardAndExpandClassificados() {
    const root = el.torneio || document;

    const direct = [
      "#tJoin",
      "#tJoinCard",
      "#join",
      "#joinCard",
      ".join-card",
      ".ov-join",
      "[data-ov='join']"
    ];

    let hidden = false;

    for (const sel of direct) {
      const node = root.querySelector(sel);
      if (node) {
        node.style.display = "none";
        hidden = true;
      }
    }

    if (!hidden) {
      const all = Array.from(root.querySelectorAll("*"));
      const titleNode = all.find((n) => (n.textContent || "").trim().toLowerCase() === "entrar no time");
      if (titleNode) {
        const card = titleNode.closest(".card") || titleNode.closest(".ov-card") || titleNode.parentElement;
        if (card) card.style.display = "none";
      }
    }

    const aliveCard = el.tAlive ? (el.tAlive.closest(".card") || el.tAlive.closest(".ov-card")) : null;
    if (aliveCard) {
      aliveCard.style.width = "100%";
      aliveCard.style.flex = "1 1 auto";

      const parent = aliveCard.parentElement;
      if (parent) {
        const disp = window.getComputedStyle(parent).display;
        if (disp === "grid") {
          aliveCard.style.gridColumn = "1 / -1";
        }
      }
    }
  }

  setView("idle");
  hideJoinCardAndExpandClassificados();

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

    cleanupJoins();
    applyMode();

    if (modeNow === "palpite") renderPalpite();
    if (modeNow === "torneio") renderTorneio();
  }, 1000);
})();
