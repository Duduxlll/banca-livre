// assets/js/palpite-admin.js  (ADMIN - painel /area.html)
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
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    const method = (opts.method || "GET").toUpperCase();

    // CSRF do seu server.js
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      const csrf = getCookie("csrf");
      if (csrf) headers["X-CSRF-Token"] = csrf;
    }

    const res = await fetch(`${API}${path}`, { credentials: "include", ...opts, headers });

    if (!res.ok) {
      let err;
      try { err = await res.json(); } catch {}
      throw new Error(err?.error || `HTTP ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  }

  const el = {};
  function bind() {
    // inputs (com fallback)
    el.buyValue     = qs("#palpiteBuyValue")     || qs("#buyValue");
    el.winnersCount = qs("#palpiteWinnersCount") || qs("#winnersCount");
    el.finalResult  = qs("#palpiteFinalResult")  || qs("#finalResult");

    // UI
    el.logBox     = qs("#palpiteLogBox")         || qs("#logBox");
    el.total      = qs("#palpiteTotalGuesses")   || qs("#totalGuesses");
    el.winnersBox = qs("#palpiteWinnersBox");

    // botões (com fallback)
    el.btnOpen  = qs("#palpiteOpen")  || qs("#btnPalpiteOpen");
    el.btnClose = qs("#palpiteClose") || qs("#btnPalpiteClose");
    el.btnClear = qs("#palpiteClear") || qs("#btnPalpiteClear");
    el.btnCalc  = qs("#palpiteCalc")  || qs("#btnPalpiteWinners");
  }

  const esc = (s = "") =>
    String(s).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));

  const fmtBRL = (cents) =>
    (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  function setTotal(n) {
    if (el.total) el.total.textContent = String(n || 0);
  }

  function clearLog() {
    if (el.logBox) el.logBox.innerHTML = "";
    setTotal(0);
  }

  function addLogLine(user, guessCents) {
    if (!el.logBox) return;
    const div = document.createElement("div");
    div.innerHTML = `[CHAT] <b>${esc(user || "—")}</b>: ${esc(fmtBRL(guessCents))}`;
    el.logBox.appendChild(div);
    el.logBox.scrollTop = el.logBox.scrollHeight;
  }

  function renderState(state) {
    // state do seu server: { roundId,isOpen,buyValueCents,winnersCount,total,entries }
    if (!state || typeof state !== "object") return;

    // preenche buyValue no input (mostra em reais, sem quebrar)
    if (el.buyValue && state.buyValueCents != null) {
      const reais = (Number(state.buyValueCents || 0) / 100).toFixed(2).replace(".", ",");
      // só escreve se o input estiver vazio (pra não atrapalhar você digitando)
      if (!String(el.buyValue.value || "").trim()) el.buyValue.value = reais;
    }

    clearLog();

    const entries = Array.isArray(state.entries) ? state.entries : [];
    // mostra do mais recente pro mais antigo
    entries.slice(0, 120).forEach((e) => addLogLine(e.user, e.guessCents));

    setTotal(state.total || entries.length || 0);
  }

  function renderWinnersList(winners, actualCents) {
    if (!el.winnersBox) return;

    if (!winners || !winners.length) {
      el.winnersBox.innerHTML = "—";
      return;
    }

    el.winnersBox.innerHTML = `
      <div style="margin-bottom:8px;opacity:.9">
        Resultado real: <b>${esc(fmtBRL(actualCents))}</b>
      </div>
      <div style="display:grid;gap:8px">
        ${winners.map((w, i) => `
          <div style="display:flex;gap:10px;align-items:center;justify-content:space-between;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px">
            <div style="display:flex;gap:10px;align-items:center">
              <b>#${i + 1}</b>
              <span>${esc(w.user)}</span>
            </div>
            <div style="display:flex;gap:10px;align-items:center">
              <span>${esc(fmtBRL(w.guessCents))}</span>
              <span style="opacity:.8">± ${esc(fmtBRL(w.diffCents))}</span>
            </div>
          </div>
        `).join("")}
      </div>
    `;
  }

  function parseToCents(v) {
    const s = String(v || "").trim().replace(/\s/g, "");
    if (!s) return null;
    const n = Number(s.replace(",", "."));
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
  }

  // ====== ROTAS CERTAS (igual no seu server.js)
  async function openRound() {
    const buyValue = String(el.buyValue?.value || "").trim(); // pode ser "200" ou "200,50"
    const winnersCount = Number(el.winnersCount?.value || 3) || 3;

    await apiFetch("/api/palpite/open", {
      method: "POST",
      body: JSON.stringify({ buyValue, winnersCount })
    });

    // atualiza logo depois de abrir
    const st = await apiFetch("/api/palpite/state");
    renderState(st);
  }

  async function closeRound() {
    await apiFetch("/api/palpite/close", { method: "POST", body: "{}" });
    const st = await apiFetch("/api/palpite/state");
    renderState(st);
  }

  async function clearRound() {
    await apiFetch("/api/palpite/clear", { method: "POST", body: "{}" });
    const st = await apiFetch("/api/palpite/state");
    renderState(st);
    if (el.winnersBox) el.winnersBox.innerHTML = "—";
  }

  // ✅ Verificar vencedores (calcula no FRONT agora, sem precisar rota no server)
  async function calcWinners() {
    const actualCents = parseToCents(el.finalResult?.value);
    const winnersCount = Math.max(1, Math.min(10, Number(el.winnersCount?.value || 3) || 3));

    if (actualCents == null) {
      alert("Digite quanto pagou (resultado real). Ex: 240,50");
      return;
    }

    const st = await apiFetch("/api/palpite/state");
    const entries = Array.isArray(st.entries) ? st.entries : [];

    const ranked = entries
      .map((e) => ({
        user: e.user,
        guessCents: Number(e.guessCents || 0),
        diffCents: Math.abs(Number(e.guessCents || 0) - actualCents)
      }))
      .sort((a, b) => a.diffCents - b.diffCents);

    renderWinnersList(ranked.slice(0, winnersCount), actualCents);
  }

  // ====== loop de atualização (admin)
  let pollTimer = null;
  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      try {
        const st = await apiFetch("/api/palpite/state");
        renderState(st);
      } catch {}
    }, 2000);
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bind();
    if (!el.btnOpen && !el.buyValue) return; // não é a página

    el.btnOpen?.addEventListener("click", () => openRound().catch(console.error));
    el.btnClose?.addEventListener("click", () => closeRound().catch(console.error));
    el.btnClear?.addEventListener("click", () => clearRound().catch(console.error));
    el.btnCalc?.addEventListener("click", () => calcWinners().catch(console.error));

    // carrega estado inicial
    try {
      const st = await apiFetch("/api/palpite/state");
      renderState(st);
    } catch {}

    startPoll();
  });
})();
