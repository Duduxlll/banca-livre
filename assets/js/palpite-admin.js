// assets/js/palpite-admin.js  (PAINEL / area.html)
(() => {
  const API = window.location.origin;
  const qs = (s, r = document) => r.querySelector(s);

  function getCookie(name) {
    const m = document.cookie.match(
      new RegExp("(?:^|; )" + name.replace(/([$?*|{}\\^])/g, "\\$1") + "=([^;]*)")
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function apiFetch(path, opts = {}) {
    const method = (opts.method || "GET").toUpperCase();
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };

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
      throw new Error(err?.error || `HTTP ${res.status}`);
    }

    return res.status === 204 ? null : res.json();
  }

  // ===== DOM =====
  const el = {};

  function bind() {
    // inputs/boxes
    el.buyValue     = qs("#palpiteBuyValue");
    el.winnersCount = qs("#palpiteWinnersCount");
    el.finalResult  = qs("#palpiteFinalResult");

    el.logBox       = qs("#palpiteLogBox");
    el.total        = qs("#palpiteTotalGuesses");
    el.winnersBox   = qs("#palpiteWinnersBox");

    // ✅ IDs reais do seu HTML
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

  // ✅ evita “scroll bugando”: só auto-desce se estiver perto do final
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

  // ===== WINNERS (painel) =====
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
            <span class="pw-val">${escapeHtml(fmtBRLFromCents(w.valueCents))}</span>
            <span class="pw-diff">± ${escapeHtml(fmtBRLFromCents(w.deltaCents))}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  // ===== STATE =====
  async function refreshState({ reloadLog = false } = {}) {
    const st = await apiFetch("/api/palpite/state");

    // total
    setTotal(st?.total ?? 0);

    // compra
    if (el.buyValue && st?.buyValueCents != null) {
      el.buyValue.value = (Number(st.buyValueCents) / 100).toFixed(2);
    }

    // winnersCount
    if (el.winnersCount && st?.winnersCount != null) {
      el.winnersCount.value = String(st.winnersCount);
    }

    // log (opcional)
    if (reloadLog) {
      clearLog(true);
      const entries = Array.isArray(st?.entries) ? st.entries : [];
      // servidor geralmente guarda em ordem antiga -> vamos exibir do mais antigo pro mais novo
      entries.forEach((e) => addLogLine(e.user, e.guessCents));
    }

    // winners já salvos no estado
    if (Array.isArray(st?.winners) && st.winners.length && st.actualResultCents != null) {
      const winners = st.winners.map((w) => ({
        name: w.name ?? w.user ?? w.nome ?? "—",
        valueCents: w.valueCents ?? w.guessCents ?? 0,
        deltaCents: w.deltaCents ?? w.diffCents ?? w.delta ?? w.diff ?? 0,
      }));
      renderWinnersList(winners.slice(0, Number(st.winnersCount || 3)), st.actualResultCents);
    } else {
      if (el.winnersBox && !el.winnersBox.dataset.keep) el.winnersBox.textContent = "—";
    }

    return st;
  }

  // ===== AÇÕES =====
  async function openRound() {
    const buyCents = parseMoneyToCents(el.buyValue?.value || 0) ?? 0;
    let winnersCount = Number(el.winnersCount?.value || 3);
    winnersCount = Math.max(1, Math.min(3, winnersCount));

    await apiFetch("/api/palpite/open", {
      method: "POST",
      body: JSON.stringify({ buyValueCents: buyCents, winnersCount }),
    });

    await refreshState({ reloadLog: true });
  }

  async function closeRound() {
    await apiFetch("/api/palpite/close", { method: "POST", body: "{}" });
    await refreshState();
  }

  async function clearRound() {
    await apiFetch("/api/palpite/clear", { method: "POST", body: "{}" });
    clearLog(false);
    if (el.winnersBox) el.winnersBox.textContent = "—";
    await refreshState();
  }

  // ✅ verificar vencedores:
  // 1) tenta pedir pro server calcular e SALVAR (para o overlay receber)
  // 2) se não tiver rota no server, calcula só pro painel
  async function verifyWinners() {
  const actualCents = parseMoneyToCents(el.finalResult?.value || "");
  if (actualCents == null) {
    alert("Digite quanto pagou (resultado real).");
    return;
  }

  let winnersCount = Number(el.winnersCount?.value || 3);
  winnersCount = Math.max(1, Math.min(3, winnersCount));

  try {
    const out = await apiFetch("/api/palpite/winners", {
      method: "POST",
      body: JSON.stringify({ actualResultCents: actualCents, winnersCount })
    });

    const winners = (out?.winners || []).map(w => ({
      name: w.name ?? w.user ?? w.nome ?? "—",
      valueCents: w.valueCents ?? w.guessCents ?? 0,
      deltaCents: w.deltaCents ?? w.diffCents ?? w.delta ?? w.diff ?? 0,
    }));

    renderWinnersList(winners.slice(0, winnersCount), actualCents);

    // puxa state (se o server salvou winners, o overlay vai pegar daqui)
    await refreshState();
  } catch (err) {
    alert("Erro ao verificar vencedores: " + err.message);
  }



    // fallback: calcula no painel (overlay só recebe se o server salvar winners)
    const st = await apiFetch("/api/palpite/state");
    const entries = Array.isArray(st?.entries) ? st.entries : [];
    if (!entries.length) {
      alert("Não tem palpites ainda.");
      return;
    }

    const winners = entries
      .map((e) => {
        const name = e.user ?? e.name ?? e.nome ?? "—";
        const valueCents = Number(e.guessCents ?? e.valueCents ?? 0) || 0;
        const deltaCents = Math.abs(valueCents - actualCents);
        return { name, valueCents, deltaCents };
      })
      .sort((a, b) => a.deltaCents - b.deltaCents)
      .slice(0, winnersCount);

    renderWinnersList(winners, actualCents);
    alert("Mostrei no painel. Para aparecer no overlay, o server precisa salvar/emitir winners no state-public.");
  }

  // ===== SSE (ADMIN GLOBAL) =====
  let es = null;

  function connectStream() {
    if (es) { try { es.close(); } catch {} es = null; }

    // ✅ stream global do seu server
    es = new EventSource(`${API}/api/stream`);

    es.addEventListener("palpite-changed", (e) => {
      try {
        const data = JSON.parse(e.data || "{}");

        // quando chegar palpite novo
        if (data.reason === "guess" && data.entry) {
          addLogLine(data.entry.user, data.entry.guessCents);
          // atualiza total certinho
          refreshState({ reloadLog: false }).catch(() => {});
          return;
        }

        // open/close/clear/winners
        refreshState({ reloadLog: false }).catch(() => {});
      } catch {}
    });

    es.onerror = () => {
      try { es.close(); } catch {}
      es = null;
      setTimeout(connectStream, 1500);
    };
  }

  // ===== START =====
  document.addEventListener("DOMContentLoaded", async () => {
    bind();

    // Se a aba/página não tiver os elementos do palpite, não roda
    if (!el.buyValue || !el.btnOpen) return;

    // listeners (✅ ids corretos)
    el.btnOpen.addEventListener("click", () => openRound().catch(err => alert(err.message)));
    el.btnClose.addEventListener("click", () => closeRound().catch(err => alert(err.message)));
    el.btnClear.addEventListener("click", () => clearRound().catch(err => alert(err.message)));
    el.btnWinners.addEventListener("click", () => verifyWinners().catch(err => alert(err.message)));

    // estado inicial + log inicial
    await refreshState({ reloadLog: true });

    // stream
    connectStream();
  });
})();
