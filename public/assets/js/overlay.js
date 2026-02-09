/* public/assets/js/overlay.js */
(() => {
  const API = window.location.origin;
  const qs = (s, r=document) => r.querySelector(s);

  const KEY = (() => {
    const u = new URL(window.location.href);
    return (u.searchParams.get("key") || "").trim();
  })();

  const esc = (s="") => String(s).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[m]));

  const fmtBRL = (cents) => {
    const n = Number(cents || 0);
    return (n / 100).toLocaleString("pt-BR", { style:"currency", currency:"BRL" });
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

  function showError(msg){
    if (!el.err) return;
    el.err.style.display = "block";
    el.err.innerHTML = esc(msg);
  }

  function setView(mode){
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

  const seenUserTeam = new Map();
  const feedByTeam = new Map();
  const FEED_TTL = 60_000;
  const FEED_MAX = 10;

  function pushFeed(teamKey, userKey, displayName){
    const now = Date.now();
    const prevTeam = seenUserTeam.get(userKey);
    if (prevTeam && prevTeam !== teamKey) {
      const arrPrev = feedByTeam.get(prevTeam) || [];
      feedByTeam.set(prevTeam, arrPrev.filter(x => x.userKey !== userKey));
    }
    seenUserTeam.set(userKey, teamKey);

    const arr = feedByTeam.get(teamKey) || [];
    if (arr.some(x => x.userKey === userKey)) return;

    arr.unshift({ userKey, displayName, ts: now });
    feedByTeam.set(teamKey, arr.slice(0, FEED_MAX));
  }

  function cleanupFeed(){
    const now = Date.now();
    for (const [k, arr] of feedByTeam.entries()) {
      feedByTeam.set(k, (arr || []).filter(x => (now - x.ts) < FEED_TTL));
    }
  }

  function pickMode(){
    if (torneioState?.active) return "torneio";
    if (palpiteState?.roundId) return "palpite";
    return "idle";
  }

  function applyMode(){
    const m = pickMode();
    if (m !== modeNow) {
      modeNow = m;
      setView(m);
    }
  }

  function setPalpiteStatus(open){
    if (!el.pStatus) return;
    el.pStatus.textContent = open ? "ABERTO" : "FECHADO";
    el.pStatus.classList.toggle("ov-status--open", !!open);
    el.pStatus.classList.toggle("ov-status--closed", !open);
  }

  function renderPalpiteWinners(st){
    const winners = Array.isArray(st.winners) ? st.winners : [];
    const hasW = winners.length > 0 && st.actualResultCents != null;

    if (el.pRotateTitle) el.pRotateTitle.textContent = "🏆 Top 3";
    if (el.pRotateHint) {
      el.pRotateHint.textContent = hasW ? `Resultado: ${fmtBRL(st.actualResultCents)}` : "Aguardando resultado…";
    }

    if (el.pWinners) {
      if (!hasW) {
        el.pWinners.innerHTML = `<div class="mini">Sem vencedores ainda.</div>`;
      } else {
        el.pWinners.innerHTML = winners.slice(0, 3).map((w, i) => {
          const nm = w?.name ?? w?.user ?? "—";
          const val = w?.valueCents != null ? fmtBRL(w.valueCents) : "—";
          return `
            <div class="ov-win">
              <div class="nm">#${i+1} ${esc(nm)}</div>
              <div class="vl">${esc(val)}</div>
            </div>
          `;
        }).join("");
      }
    }
  }

  function renderPalpiteLast(st){
    const entries = Array.isArray(st.entries) ? st.entries : [];
    const last = entries.slice(0, 10);

    if (el.pRotateTitle) el.pRotateTitle.textContent = "🔥 Últimos palpites";
    if (el.pRotateHint) el.pRotateHint.textContent = last.length ? "Ao vivo" : "—";

    if (el.pLast) {
      if (!last.length) {
        el.pLast.innerHTML = `<div class="mini">—</div>`;
      } else {
        el.pLast.innerHTML = last.map((e) => {
          const nm = e?.user ?? "—";
          const cents = Number(e?.guessCents || 0);
          return `
            <div class="ov-row">
              <span class="nm">${esc(nm)}</span>
              <span class="vl">${esc(fmtBRL(cents))}</span>
            </div>
          `;
        }).join("");
      }
    }
  }

  function renderPalpiteInfo(st){
    const open = !!st.isOpen;
    if (el.pRotateTitle) el.pRotateTitle.textContent = "⌨️ Status";
    if (el.pRotateHint) el.pRotateHint.textContent = open ? "Rodada aberta" : "Rodada fechada";

    if (el.pInfoText) {
      if (!st.roundId) {
        el.pInfoText.textContent = "Nenhuma rodada ativa no momento.";
      } else if (open) {
        el.pInfoText.textContent = "Envie seu valor no chat. Um palpite por pessoa (atualiza se mandar de novo).";
      } else {
        el.pInfoText.textContent = "A rodada está fechada. Aguarde abrir ou o resultado.";
      }
    }
  }

  let palpiteRotateIdx = 0;

  function showPalpitePanel(which){
    if (el.pPanelWinners) el.pPanelWinners.style.display = which === "winners" ? "" : "none";
    if (el.pPanelLast) el.pPanelLast.style.display = which === "last" ? "" : "none";
    if (el.pPanelInfo) el.pPanelInfo.style.display = which === "info" ? "" : "none";
  }

  function renderPalpite(){
    const st = palpiteState || {};
    setPalpiteStatus(!!st.isOpen);

    if (el.pBuy) el.pBuy.textContent = st.buyValueCents ? fmtBRL(st.buyValueCents) : "—";
    if (el.pTotal) el.pTotal.textContent = String(st.total ?? 0);

    if (!st.roundId) {
      if (el.pSub) el.pSub.textContent = "Nenhuma rodada ativa…";
    } else if (st.isOpen) {
      if (el.pSub) el.pSub.textContent = "Rodada aberta — mande o valor no chat!";
    } else {
      if (el.pSub) el.pSub.textContent = "Rodada fechada — aguardando…";
    }

    const hasW = Array.isArray(st.winners) && st.winners.length > 0 && st.actualResultCents != null;
    const seq = hasW ? ["winners","last","info"] : ["last","info","winners"];
    const current = seq[palpiteRotateIdx % seq.length];

    if (current === "winners") {
      showPalpitePanel("winners");
      renderPalpiteWinners(st);
    } else if (current === "last") {
      showPalpitePanel("last");
      renderPalpiteLast(st);
    } else {
      showPalpitePanel("info");
      renderPalpiteInfo(st);
    }
  }

  function renderTorneio(){
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
    const teams = Array.isArray(ph.teamsList) ? ph.teamsList : [];
    const status = String(ph.status || "").trim();

    if (el.tName) el.tName.textContent = tor.name || "Torneio";

    if (el.tBadge) {
      const num = ph.number != null ? String(ph.number) : "—";
      el.tBadge.textContent = status ? `FASE ${num} • ${status}` : `FASE ${num}`;
    }

    if (el.tSub) {
      if (status === "ABERTA") el.tSub.textContent = "Primeira fase ativa — entradas abertas!";
      else if (status === "FECHADA") el.tSub.textContent = "Primeira fase fechada — aguardando decisão…";
      else if (status === "DECIDIDA") el.tSub.textContent = "Fase decidida — aguardando próxima fase…";
      else el.tSub.textContent = "Torneio ativo.";
    }

    const listsByKey = ph.listsByKey || {};
    if (teams.length) {
      for (const t of teams) {
        const k = String(t.key || "");
        const arr = Array.isArray(listsByKey[k]) ? listsByKey[k] : [];
        for (const u of arr.slice(0, 14)) {
          const userKey = String(u?.twitchName || u?.displayName || "").toLowerCase();
          if (!userKey) continue;
          pushFeed(k, userKey, String(u?.displayName || u?.twitchName || "—"));
        }
      }
    }

    cleanupFeed();

    if (el.tTeams) {
      el.tTeams.innerHTML = teams.map((t) => {
        const k = String(t.key || "");
        const name = String(t.name || k || "Time");
        const count = Number(t.count || 0) | 0;
        const pts = Number(t.points || 0) | 0;
        const feed = (feedByTeam.get(k) || []).slice(0, FEED_MAX);

        const feedHtml = feed.length
          ? feed.map((x) => `<div class="tr-pill">${esc(x.displayName)}</div>`).join("")
          : `<div class="mini">—</div>`;

        return `
          <div class="tr-team">
            <div class="tr-top">
              <div class="tr-name">${esc(name)}</div>
              <div class="tr-meta">${count} entradas<br>${pts} pts</div>
            </div>
            <div class="tr-feed">${feedHtml}</div>
          </div>
        `;
      }).join("");
    }

    const aliveCount = Number(ph.aliveCount || 0) | 0;
    if (el.tAliveCount) el.tAliveCount.textContent = String(aliveCount);

    const alive = Array.isArray(ph.alivePreview) ? ph.alivePreview : [];
    if (el.tAlive) {
      if (!alive.length) {
        el.tAlive.innerHTML = `<div class="mini">—</div>`;
      } else {
        el.tAlive.innerHTML = alive.slice(0, 80).map((u, i) => {
          const nm = u?.name || u?.twitchName || "—";
          return `<div class="alv"><span class="nm">#${i+1} ${esc(nm)}</span></div>`;
        }).join("");
      }
    }
  }

  async function fetchJSON(url){
    const r = await fetch(url, { method:"GET", headers:{ Accept:"application/json" }, cache:"no-store" });
    let data = null;
    try { data = await r.json(); } catch {}
    if (!r.ok) throw new Error(data?.error || `http_${r.status}`);
    return data;
  }

  async function tickTorneio(){
    try {
      const url = `${API}/api/torneio/state?key=${encodeURIComponent(KEY)}&include=lists,alive&listsLimit=60&aliveLimit=24`;
      torneioState = await fetchJSON(url);
    } catch {
      torneioState = torneioState || { active:false };
    }
    applyMode();
    if (modeNow === "torneio") renderTorneio();
  }

  async function tickPalpiteOnce(){
    try {
      const url = `${API}/api/palpite/state-public?key=${encodeURIComponent(KEY)}`;
      palpiteState = await fetchJSON(url);
    } catch {}
    applyMode();
    if (modeNow === "palpite") renderPalpite();
  }

  function startPalpiteSSE(){
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
        if (!palpiteState) return;

        const entry = payload.entry;
        const cur = Array.isArray(palpiteState.entries) ? palpiteState.entries : [];
        const next = [entry, ...cur].slice(0, 500);

        palpiteState = {
          ...palpiteState,
          total: payload.total ?? palpiteState.total,
          entries: next
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
    if (modeNow === "palpite") {
      palpiteRotateIdx++;
      renderPalpite();
    }
  }, 6500);

  setInterval(() => {
    cleanupFeed();
    if (modeNow === "torneio") renderTorneio();
  }, 1000);
})();
