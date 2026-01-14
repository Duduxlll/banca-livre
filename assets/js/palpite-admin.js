// assets/js/palpite-admin.js
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
    el.buyValue     = qs("#palpiteBuyValue");
    el.winnersCount = qs("#palpiteWinnersCount");
    el.finalResult  = qs("#palpiteFinalResult");
    el.logBox       = qs("#palpiteLogBox");
    el.total        = qs("#palpiteTotalGuesses");
    el.winnersBox   = qs("#palpiteWinnersBox");

    // seus IDs no HTML:
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

  function setTotal(n) {
    if (el.total) el.total.textContent = String(n || 0);
  }

  function clearLog() {
    if (el.logBox) el.logBox.innerHTML = "";
    setTotal(0);
  }

  function addLogLine(name, value) {
    if (!el.logBox) return;
    const div = document.createElement("div");
    div.innerHTML = `[CHAT] <b>${escapeHtml(name)}</b>: R$ ${Number(value).toFixed(2)}`;
    el.logBox.appendChild(div);
    el.logBox.scrollTop = el.logBox.scrollHeight;
  }

  function renderWinners(data) {
    if (!el.winnersBox) return;

    const winners = data?.winners || [];
    const actual  = data?.actual;

    if (!winners.length) {
      el.winnersBox.textContent = "—";
      return;
    }

    el.winnersBox.innerHTML = `
      <div class="pw-head">
        <span>Resultado real: <b>R$ ${Number(actual).toFixed(2)}</b></span>
      </div>
      <div class="pw-list">
        ${winners.map((w, i) => `
          <div class="pw-item">
            <span class="pw-rank">#${i + 1}</span>
            <span class="pw-name">${escapeHtml(w.name)}</span>
            <span class="pw-val">R$ ${Number(w.value).toFixed(2)}</span>
            <span class="pw-diff">± ${Number(w.diff).toFixed(2)}</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  function renderState(st) {
    if (el.buyValue && st.buyValue != null) el.buyValue.value = st.buyValue;

    clearLog();
    const last = Array.isArray(st.lastGuesses) ? st.lastGuesses : [];
    // lastGuesses vem do server “do mais recente pro mais antigo”
    last.slice().reverse().forEach((g) => addLogLine(g.name, g.value));
    setTotal(st.totalGuesses || 0);

    if (st.winners && st.winners.length) {
      renderWinners({ winners: st.winners, actual: st.actualResult });
    } else {
      if (el.winnersBox) el.winnersBox.textContent = "—";
    }
  }

  async function startRound() {
    const buyValue = Number(String(el.buyValue?.value || "0").replace(",", ".")) || 0;
    await apiFetch("/api/palpite/admin/start", {
      method: "POST",
      body: JSON.stringify({ buyValue })
    });
  }

  async function closeRound() {
    await apiFetch("/api/palpite/admin/stop", { method: "POST", body: "{}" });
  }

  async function clearRound() {
    await apiFetch("/api/palpite/admin/clear", { method: "DELETE" });
  }

  async function calcWinners() {
    const actual = Number(String(el.finalResult?.value || "").trim().replace(",", "."));
    const winnersCount = Number(el.winnersCount?.value || 1) || 1;

    if (!Number.isFinite(actual)) {
      alert("Digite quanto pagou (resultado real).");
      return;
    }

    const out = await apiFetch("/api/palpite/admin/winners", {
      method: "POST",
      body: JSON.stringify({ actualResult: actual, winnersCount })
    });

    renderWinners({ winners: out.winners || [], actual });
  }

  // SSE (admin) – não precisa key, só estar logado
  let es = null;
  function connectStream() {
    if (es) try { es.close(); } catch {}
    es = new EventSource(`${API}/api/palpite/admin/stream`);

    es.addEventListener("state", (e) => {
      const st = JSON.parse(e.data || "{}");
      renderState(st);
    });

    es.addEventListener("guess", (e) => {
      const d = JSON.parse(e.data || "{}");
      addLogLine(d.name, d.value);
      setTotal(d.totalGuesses || 0);
    });

    es.addEventListener("winners", (e) => {
      const d = JSON.parse(e.data || "{}");
      renderWinners(d);
    });

    es.onerror = () => {
      try { es.close(); } catch {}
      setTimeout(connectStream, 1500);
    };
  }

  document.addEventListener("DOMContentLoaded", async () => {
    bind();
    if (!el.buyValue) return;

    el.btnOpen?.addEventListener("click", () => startRound().catch(console.error));
    el.btnClose?.addEventListener("click", () => closeRound().catch(console.error));
    el.btnClear?.addEventListener("click", () => clearRound().catch(console.error));
    el.btnCalc?.addEventListener("click", () => calcWinners().catch(console.error));

    try {
      const st = await apiFetch("/api/palpite/admin/state");
      renderState(st);
    } catch {}

    connectStream();
  });
})();
