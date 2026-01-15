// assets/js/palpite-admin.js  (PAINEL / area.html)
(() => {
  const API = window.location.origin;
  const qs = (s, r = document) => r.querySelector(s);

  // =========================
  // Helpers (cookies / fetch)
  // =========================
  function getCookie(name) {
    const m = document.cookie.match(
      new RegExp("(?:^|; )" + name.replace(/([$?*|{}\\^])/g, "\\$1") + "=([^;]*)")
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function apiFetch(path, opts = {}) {
    const method = (opts.method || "GET").toUpperCase();
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };

    // CSRF só em métodos que alteram estado
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const csrf = getCookie("csrf");
      if (csrf) headers["X-CSRF-Token"] = csrf;
    }

    const res = await fetch(`${API}${path}`, {
      credentials: "include",
      ...opts,
      method,
      headers,
    });

    if (!res.ok) {
      let err;
      try { err = await res.json(); } catch {}
      const msg = err?.error || err?.message || `HTTP ${res.status}`;
      const e = new Error(msg);
      e.status = res.status;
      throw e;
    }

    return res.status === 204 ? null : res.json();
  }

  // Tenta uma lista de rotas (pra compatibilidade com versões diferentes do server)
  async function apiFetchFirstOk(paths, opts) {
    let lastErr = null;

    for (const p of paths) {
      try {
        return await apiFetch(p, opts);
      } catch (e) {
        lastErr = e;
        // se for 404, tenta a próxima; se for outro erro, ainda tenta a próxima, mas guarda
      }
    }

    throw lastErr || new Error("Falha ao chamar API");
  }

  // =========================
  // DOM
  // =========================
  const el = {};

  function bind() {
    // inputs/boxes
    el.buyValue     = qs("#palpiteBuyValue");
    el.winnersCount = qs("#palpiteWinnersCount");
    el.finalResult  = qs("#palpiteFinalResult");

    el.logBox       = qs("#palpiteLogBox");
    el.total        = qs("#palpiteTotalGuesses");
    el.winnersBox   = qs("#palpiteWinnersBox");

    // IDs reais do seu HTML
    el.btnOpen    = qs("#btnPalpiteOpen");
    el.btnClose   = qs("#btnPalpiteClose");
    el.btnClear   = qs("#btnPalpiteClear");
    el.btnWinners = qs("#btnPalpiteWinners");
  }

  function escapeHtml(s = "") {
    return String(s).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  const fmtBRLFromCents = (cents) => {
    const n = Number(cents || 0);
    return (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  };

  function parseMoneyToCents(v) {
    const s = String(v ?? "").trim().replace(",", ".");
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  }

  function setTotal(n) {
    if (el.total) el.total.textContent = String(n || 0);
  }

  // =========================
  // LOG (scroll sem “bugar”)
  // - Só auto-desce se estiver perto do final
  // =========================
  function isNearBottom(box, threshold = 24) {
    if (!box) return true;
    const delta = box.scrollHeight - box.scrollTop - box.clientHeight;
    return delta <= threshold;
  }

  function clearLog(keepTotal = false) {
    if (el.logBox) el.logBox.innerHTML = "";
    if (!keepTotal) setTotal(0);
  }

  function addLogLine(name, guessCents) {
    if (!el.logBox) return;

    const nearBottom = isNearBottom(el.logBox);

    const div = document.createElement("div");
    div.className = "palpite-log-line";
    div.innerHTML = `[CHAT] <b>${escapeHtml(name || "—")}</b>: ${escapeHtml(fmtBRLFromCents(guessCents || 0))}`;

    el.logBox.appendChild(div);

    // limita (não explode)
    const max = 250;
    while (el.logBox.children.length > max) el.logBox.removeChild(el.logBox.firstChild);

    if (nearBottom) el.logBox.scrollTop = el.logBox.scrollHeight;
  }

  // =========================
  // WINNERS (painel)
  // =========================
  function renderWinnersList(winners, actualCents) {
    if (!el.winnersBox) return;

    if (!Array.isArray(winners) || winners.length === 0) {
      el.winnersBox.textContent = "—";
      return;
    }

    el.winnersBox.innerHTML = `
      <div class="pw-head">
        <span>Resultado real: <b>${escapeHtml(fmtBRLFromCents(actualCents))}</b></span>
      </div>
      <div class="pw-list">
        ${winners.map((w, i) => `
          <div class="pw-item">
            <span class="pw-rank">#${i + 1}</span>
            <span class="pw-name">${escapeHtml(w.name || "—")}</span>
            <span class="pw-val">${escapeHtml(fmtBRLFromCents(w.valueCents || 0))}</span>
            <span class="pw-diff">± ${escapeHtml(fmtBRLFromCents(w.deltaCents || 0))}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  // =========================
  // STATE
  // =========================
  async function fetchState() {
    // Compat:
    // - /api/palpite/state (novo)
    // - /api/palpite/admin/state (antigo)
    return apiFetchFirstOk(
      ["/api/palpite/state", "/api/palpite/admin/state"],
      { method: "GET" }
    );
  }

  async function refreshState({ reloadLog = false } = {}) {
    const st = await fetchState();

    // total
    setTotal(st?.total ?? st?.totalGuesses ?? 0);

    // compra
    if (el.buyValue && st?.buyValueCents != null) {
      el.buyValue.value = (Number(st.buyValueCents) / 100).toFixed(2);
    } else if (el.buyValue && st?.buyValue != null) {
      // caso o server mande em reais
      const n = Number(st.buyValue);
      el.buyValue.value = Number.isFinite(n) ? n.toFixed(2) : "";
    }

    // winnersCount
    if (el.winnersCount && st?.winnersCount != null) {
      el.winnersCount.value = String(st.winnersCount);
    }

    // log (recarrega sem “puxar” o scroll do usuário)
    if (reloadLog && el.logBox) {
      const keepBottom = isNearBottom(el.logBox);
      const oldTop = el.logBox.scrollTop;

      clearLog(true);

      // entries pode vir como entries OR lastGuesses etc
      const entries =
        Array.isArray(st?.entries) ? st.entries :
        Array.isArray(st?.lastGuesses) ? st.lastGuesses :
        [];

      entries.forEach((e) => {
        const name = e.user ?? e.name ?? e.nome ?? "—";
        const cents =
          e.guessCents != null ? Number(e.guessCents) :
          e.valueCents != null ? Number(e.valueCents) :
          e.value != null ? Math.round(Number(e.value) * 100) :
          0;

        addLogLine(name, cents);
      });

      if (!keepBottom) el.logBox.scrollTop = oldTop;
    }

    // winners já salvos no estado (para refletir no painel)
    if (Array.isArray(st?.winners) && st.winners.length && st.actualResultCents != null) {
      const winners = st.winners.map((w) => ({
        name: w.name ?? w.user ?? w.nome ?? "—",
        valueCents: w.valueCents ?? w.guessCents ?? 0,
        deltaCents: w.deltaCents ?? w.diffCents ?? w.delta ?? w.diff ?? 0,
      }));
      const topN = Math.max(1, Math.min(3, Number(st.winnersCount || 3)));
      renderWinnersList(winners.slice(0, topN), st.actualResultCents);
    } else {
      if (el.winnersBox) el.winnersBox.textContent = "—";
    }

    return st;
  }

  // =========================
  // AÇÕES
  // =========================
  async function openRound() {
    const buyCents = parseMoneyToCents(el.buyValue?.value || 0) ?? 0;

    let winnersCount = Number(el.winnersCount?.value || 3);
    winnersCount = Math.max(1, Math.min(3, winnersCount));

    // Compat payloads (manda os dois jeitos)
    const payload = {
      buyValueCents: buyCents,
      buyValue: Number((buyCents / 100).toFixed(2)),
      winnersCount
    };

    await apiFetchFirstOk(
      ["/api/palpite/open", "/api/palpite/admin/start"],
      { method: "POST", body: JSON.stringify(payload) }
    );

    await refreshState({ reloadLog: true });
  }

  async function closeRound() {
    await apiFetchFirstOk(
      ["/api/palpite/close", "/api/palpite/admin/stop"],
      { method: "POST", body: "{}" }
    );

    await refreshState({ reloadLog: false });
  }

  async function clearRound() {
    // alguns servers usam POST, outros DELETE
    try {
      await apiFetchFirstOk(
        ["/api/palpite/clear", "/api/palpite/admin/clear"],
        { method: "POST", body: "{}" }
      );
    } catch (e) {
      await apiFetchFirstOk(
        ["/api/palpite/clear", "/api/palpite/admin/clear"],
        { method: "DELETE" }
      );
    }

    clearLog(false);
    if (el.winnersBox) el.winnersBox.textContent = "—";

    await refreshState({ reloadLog: true });
  }

  // Verificar vencedores:
  // - chama o server (pra salvar winners e o overlay receber)
  // - se falhar, calcula só no painel como fallback
  async function verifyWinners() {
    const actualCents = parseMoneyToCents(el.finalResult?.value || "");
    if (actualCents == null) {
      alert("Digite quanto pagou (resultado real).");
      return;
    }

    let winnersCount = Number(el.winnersCount?.value || 3);
    winnersCount = Math.max(1, Math.min(3, winnersCount));

    // 1) tenta server (salva/emit winners)
    try {
      const out = await apiFetchFirstOk(
        ["/api/palpite/winners", "/api/palpite/admin/winners"],
        {
          method: "POST",
          body: JSON.stringify({
            actualResultCents: actualCents,
            actualResult: Number((actualCents / 100).toFixed(2)),
            winnersCount
          })
        }
      );

      const winners = (out?.winners || []).map((w) => ({
        name: w.name ?? w.user ?? w.nome ?? "—",
        valueCents: w.valueCents ?? w.guessCents ?? 0,
        deltaCents: w.deltaCents ?? w.diffCents ?? w.delta ?? w.diff ?? 0,
      }));

      renderWinnersList(winners.slice(0, winnersCount), actualCents);

      // puxa state pra refletir winners salvos (e manter tudo consistente)
      await refreshState({ reloadLog: false });
      return;
    } catch (err) {
      console.warn("Server winners falhou, fallback local:", err?.message || err);
      // cai pro fallback abaixo
    }

    // 2) fallback local (painel)
    const st = await fetchState();
    const entries =
      Array.isArray(st?.entries) ? st.entries :
      Array.isArray(st?.lastGuesses) ? st.lastGuesses :
      [];

    if (!entries.length) {
      alert("Não tem palpites ainda.");
      return;
    }

    const winners = entries
      .map((e) => {
        const name = e.user ?? e.name ?? e.nome ?? "—";
        const valueCents =
          e.guessCents != null ? Number(e.guessCents) :
          e.valueCents != null ? Number(e.valueCents) :
          e.value != null ? Math.round(Number(e.value) * 100) :
          0;

        const deltaCents = Math.abs(valueCents - actualCents);
        return { name, valueCents, deltaCents };
      })
      .filter(w => w.name && Number.isFinite(w.valueCents))
      .sort((a, b) => a.deltaCents - b.deltaCents)
      .slice(0, winnersCount);

    renderWinnersList(winners, actualCents);
    alert("Mostrei no painel. Para aparecer no overlay, o server precisa salvar/emitir winners no state-public.");
  }

  // =========================
  // SSE (admin) — tenta duas rotas
  // =========================
  let es = null;
  let streamPathIndex = 0;

  const STREAM_PATHS = [
    // mais comum pro palpite
    { path: "/api/palpite/admin/stream", mode: "palpite" },
    // stream global do teu projeto (se existir)
    { path: "/api/stream", mode: "global" },
  ];

  function connectStream() {
    if (es) { try { es.close(); } catch {} es = null; }

    const current = STREAM_PATHS[streamPathIndex] || STREAM_PATHS[0];
    es = new EventSource(`${API}${current.path}`);

    if (current.mode === "palpite") {
      // state (puxa tudo)
      es.addEventListener("state", () => {
        refreshState({ reloadLog: true }).catch(() => {});
      });

      // guess (atualiza log na hora)
      es.addEventListener("guess", (e) => {
        try {
          const d = JSON.parse(e.data || "{}");
          const entry = d.entry || d;

          const name = entry.user ?? entry.name ?? entry.nome ?? "—";
          const cents =
            entry.guessCents != null ? Number(entry.guessCents) :
            entry.valueCents != null ? Number(entry.valueCents) :
            entry.value != null ? Math.round(Number(entry.value) * 100) :
            0;

          addLogLine(name, cents);

          // total se vier no payload, usa; senão soma +1
          if (el.total) {
            const hinted = d.total ?? d.totalGuesses;
            if (hinted != null) el.total.textContent = String(hinted);
            else el.total.textContent = String((Number(el.total.textContent || 0) || 0) + 1);
          }
        } catch {}
      });

      // winners/clear etc
      es.addEventListener("winners", () => {
        refreshState({ reloadLog: false }).catch(() => {});
      });

      es.addEventListener("clear", () => {
        clearLog(false);
        if (el.winnersBox) el.winnersBox.textContent = "—";
        refreshState({ reloadLog: false }).catch(() => {});
      });
    } else {
      // mode === "global": escuta evento do seu server (palpite-changed)
      es.addEventListener("palpite-changed", (e) => {
        try {
          const data = JSON.parse(e.data || "{}");

          // quando chegar palpite novo
          if (data.reason === "guess" && data.entry) {
            addLogLine(data.entry.user, data.entry.guessCents);
            if (data.total != null) setTotal(data.total);
            else refreshState({ reloadLog: false }).catch(() => {});
            return;
          }

          // open/close/clear/winners
          refreshState({ reloadLog: false }).catch(() => {});
        } catch {}
      });
    }

    // fallback automático de rota
    es.onerror = () => {
      try { es.close(); } catch {}
      es = null;

      // tenta próxima rota se a atual não responder
      streamPathIndex = (streamPathIndex + 1) % STREAM_PATHS.length;

      setTimeout(connectStream, 1500);
    };
  }

  // =========================
  // START
  // =========================
  document.addEventListener("DOMContentLoaded", async () => {
    bind();

    // se não tiver os elementos do palpite, não roda
    if (!el.buyValue || !el.btnOpen) return;

    // listeners
    el.btnOpen.addEventListener("click", () => openRound().catch(err => alert(err.message)));
    el.btnClose.addEventListener("click", () => closeRound().catch(err => alert(err.message)));
    el.btnClear.addEventListener("click", () => clearRound().catch(err => alert(err.message)));
    el.btnWinners.addEventListener("click", () => verifyWinners().catch(err => alert(err.message)));

    // estado inicial + log inicial
    try {
      await refreshState({ reloadLog: true });
    } catch (e) {
      console.warn("Falha ao carregar state inicial:", e?.message || e);
    }

    // stream
    connectStream();
  });
})();
