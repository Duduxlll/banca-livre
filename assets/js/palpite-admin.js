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
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    const method = (opts.method || "GET").toUpperCase();

    // CSRF nos métodos mutáveis
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
    el.buyValue     = qs("#palpiteBuyValue");        // input bonus buy
    el.winnersCount = qs("#palpiteWinnersCount");    // select top 1/2/3
    el.finalResult  = qs("#palpiteFinalResult");     // input resultado real
    el.logBox       = qs("#palpiteLogBox");          // log
    el.total        = qs("#palpiteTotalGuesses");    // total
    el.winnersBox   = qs("#palpiteWinnersBox");      // box winners

    el.btnOpen  = qs("#palpiteOpen");
    el.btnClose = qs("#palpiteClose");
    el.btnClear = qs("#palpiteClear");
    el.btnCalc  = qs("#palpiteCalc");
  }

  function escapeHtml(s = "") {
    return String(s).replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  function fmtMoneyBR(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return "0,00";
    return n.toFixed(2).replace(".", ",");
  }

  function fmtBRLFromCents(cents) {
    const n = Number(cents || 0);
    return (n / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function setTotal(n) {
    if (el.total) el.total.textContent = String(n || 0);
  }

  function clearLog(keepTotal = false) {
    if (el.logBox) el.logBox.innerHTML = "";
    if (!keepTotal) setTotal(0);
  }

  // ✅ evita bug do scroll: só autodesce se você estiver “perto do fim”
  function isNearBottom(box, threshold = 24) {
    if (!box) return true;
    const delta = box.scrollHeight - box.scrollTop - box.clientHeight;
    return delta <= threshold;
  }

  function addLogLine(name, valueCentsOrNumber) {
    if (!el.logBox) return;

    const nearBottom = isNearBottom(el.logBox);

    const div = document.createElement("div");
    div.className = "palpite-log-line";

    // value pode vir em cents (int) ou em número (float). Vamos tentar detectar:
    const vNum = Number(valueCentsOrNumber);
    const looksLikeCents = Number.isFinite(vNum) && Number.isInteger(vNum) && vNum >= 0 && vNum > 999;
    const shown = looksLikeCents ? fmtBRLFromCents(vNum) : ("R$ " + fmtMoneyBR(vNum));

    div.innerHTML = `[CHAT] <b>${escapeHtml(name || "—")}</b>: <span>${escapeHtml(shown)}</span>`;
    el.logBox.appendChild(div);

    // mantém só um limite (não explode)
    const max = 200;
    while (el.logBox.children.length > max) el.logBox.removeChild(el.logBox.firstChild);

    if (nearBottom) el.logBox.scrollTop = el.logBox.scrollHeight;
  }

  function renderWinnersList(winners, actualCents) {
    if (!el.winnersBox) return;

    if (!winners?.length) {
      el.winnersBox.textContent = "—";
      return;
    }

    el.winnersBox.innerHTML = `
      <div class="pw-head">
        <span>Resultado real: <b>${fmtBRLFromCents(actualCents)}</b></span>
      </div>
      <div class="pw-list">
        ${winners.map((w, i) => `
          <div class="pw-item">
            <span class="pw-rank">#${i + 1}</span>
            <span class="pw-name">${escapeHtml(w.name)}</span>
            <span class="pw-val">${fmtBRLFromCents(w.valueCents)}</span>
            <span class="pw-diff">± ${fmtBRLFromCents(w.deltaCents)}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  // ===== STATE (do server) =====
  async function refreshState() {
    try {
      const st = await apiFetch("/api/palpite/state");

      // Atualiza total e log (não força scroll)
      setTotal(st?.total ?? 0);

      // (recarrega log só se você quiser; eu deixei leve: só quando abrir/limpar)
      // Se quiser recarregar sempre, descomenta:
      // clearLog(true);
      // (st.entries || []).slice().reverse().forEach(e => addLogLine(e.user, e.guessCents));

      // Se o server já salvar winners no estado:
      if (Array.isArray(st?.winners) && st.winners.length && st.actualResultCents != null) {
        const winners = st.winners.map(w => ({
          name: w.name ?? w.user ?? w.nome ?? "—",
          valueCents: w.valueCents ?? w.guessCents ?? 0,
          deltaCents: w.deltaCents ?? w.diffCents ?? 0
        }));
        renderWinnersList(winners, st.actualResultCents);
      } else {
        if (el.winnersBox && !el.winnersBox.innerHTML.trim()) el.winnersBox.textContent = "—";
      }
    } catch (e) {
      // se não tiver logado, vai falhar aqui
      console.warn("refreshState:", e.message);
    }
  }

  // ===== AÇÕES =====
  function parseBuyToCents(v) {
    const s = String(v || "").trim().replace(",", ".");
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  }

  async function openRound() {
    const buyCents = parseBuyToCents(el.buyValue?.value || 0);
    let winnersCount = Number(el.winnersCount?.value || 3);
    if (!Number.isFinite(winnersCount) || winnersCount < 1) winnersCount = 1;
    if (winnersCount > 3) winnersCount = 3;

    await apiFetch("/api/palpite/open", {
      method: "POST",
      body: JSON.stringify({
        buyValueCents: buyCents,
        winnersCount
      })
    });

    // recarrega log/total
    clearLog(true);
    await refreshState();
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

  // ✅ Verificar vencedores:
  // 1) tenta uma rota no server (se você tiver implementado)
  // 2) se não existir, calcula no front e mostra no painel (overlay só recebe se o server salvar winners no estado)
  async function verifyWinners() {
    const actual = Number(String(el.finalResult?.value || "").trim().replace(",", "."));
    if (!Number.isFinite(actual)) {
      alert("Digite quanto pagou (resultado real).");
      return;
    }

    let winnersCount = Number(el.winnersCount?.value || 3);
    if (!Number.isFinite(winnersCount) || winnersCount < 1) winnersCount = 1;
    if (winnersCount > 3) winnersCount = 3;

    const actualCents = Math.round(actual * 100);

    // 1) tenta no server (se existir)
    const tryPaths = [
      "/api/palpite/winners",
      "/api/palpite/verify-winners",
      "/api/palpite/calc-winners"
    ];

    for (const p of tryPaths) {
      try {
        const out = await apiFetch(p, {
          method: "POST",
          body: JSON.stringify({ actualResultCents: actualCents, winnersCount })
        });

        // se o server retornar winners, renderiza
        if (out?.winners?.length) {
          const winners = out.winners.map(w => ({
            name: w.name ?? w.user ?? w.nome ?? "—",
            valueCents: w.valueCents ?? w.guessCents ?? 0,
            deltaCents: w.deltaCents ?? w.diffCents ?? 0
          }));
          renderWinnersList(winners.slice(0, winnersCount), actualCents);
          return;
        }
      } catch (e) {
        // se 404/erro, tenta próximo
      }
    }

    // 2) fallback: calcula no front usando state
    const st = await apiFetch("/api/palpite/state");
    const entries = Array.isArray(st?.entries) ? st.entries : [];
    if (!entries.length) {
      alert("Não tem palpites ainda.");
      return;
    }

    const winners = entries
      .map(e => {
        const name = e.user ?? e.name ?? e.nome ?? "—";
        const valueCents = Number(e.guessCents ?? e.valueCents ?? 0) || 0;
        const deltaCents = Math.abs(valueCents - actualCents);
        return { name, valueCents, deltaCents };
      })
      .sort((a, b) => a.deltaCents - b.deltaCents)
      .slice(0, winnersCount);

    renderWinnersList(winners, actualCents);

    alert("Mostrei os vencedores no painel. (Para aparecer no overlay, o server precisa salvar/emitir os winners no state-public.)");
  }

  // ===== SSE ADMIN (global) =====
  let es = null;
  function connectStream() {
    if (es) { try { es.close(); } catch {} es = null; }

    // ✅ seu server já tem /api/stream protegido por sessão
    es = new EventSource(`${API}/api/stream`);

    // O server manda: sseSendAll('palpite-changed', { reason:'guess', entry })
    es.addEventListener("palpite-changed", (e) => {
      try {
        const data = JSON.parse(e.data || "{}");

        if (data.reason === "guess" && data.entry) {
          // Atualiza log + total sem quebrar scroll
          addLogLine(data.entry.user, data.entry.guessCents);
          // Se o server não mandar total aqui, faz refresh leve:
          // (mais seguro p/ total real e winners)
          refreshState();
          return;
        }

        // open/close/clear -> puxa state completo
        refreshState();
      } catch {}
    });

    es.onerror = () => {
      try { es.close(); } catch {}
      es = null;
      setTimeout(connectStream, 1500);
    };
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bind();
    if (!el.buyValue) return; // se não existir a aba, não roda

    el.btnOpen?.addEventListener("click", () => openRound().catch(err => alert(err.message)));
    el.btnClose?.addEventListener("click", () => closeRound().catch(err => alert(err.message)));
    el.btnClear?.addEventListener("click", () => clearRound().catch(err => alert(err.message)));
    el.btnCalc?.addEventListener("click", () => verifyWinners().catch(err => alert(err.message)));

    // estado inicial
    await refreshState();

    // stream admin
    connectStream();
  });
})();
