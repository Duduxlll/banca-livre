// assets/js/palpiteadmin.js  (OVERLAY - OBS)
(() => {
  const API = window.location.origin;

  const qs = (s, r = document) => r.querySelector(s);

  // pega key da URL (?key=...)
  function getKeyFromUrl() {
    const u = new URL(window.location.href);
    return (u.searchParams.get("key") || "").trim();
  }
  const KEY = getKeyFromUrl();

  // elementos do overlay (seu overlay inline já tem esses IDs)
  const elLog = qs("#log");
  const elTotal = qs("#total");
  const elBuy = qs("#buyVal");
  const pill = qs("#statusPill");

  // fallback se você mudar IDs no futuro
  const elAltLog = qs("#overlayList") || qs("#logBox") || qs("#palpiteLogBox");
  const elAltTotal = qs("#overlayTotal") || qs("#totalGuesses") || qs("#palpiteTotalGuesses");
  const elAltBuy = qs("#overlayBuyValue") || qs("#buyValue") || qs("#palpiteBuyValue");
  const elAltPill = qs("#overlayStatus") || qs("#palpiteStatus");

  const LOG = elLog || elAltLog;
  const TOTAL = elTotal || elAltTotal;
  const BUY = elBuy || elAltBuy;
  const PILL = pill || elAltPill;

  const fmtBRL = (cents) =>
    (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

  function setStatus(isOpen) {
    if (!PILL) return;
    // seu overlay inline usa classes on/off
    PILL.classList.toggle("on", !!isOpen);
    PILL.classList.toggle("off", !isOpen);
    PILL.textContent = isOpen ? "ABERTO" : "FECHADO";
  }

  function clearList() {
    if (LOG) LOG.innerHTML = "";
    if (TOTAL) TOTAL.textContent = "0";
  }

  // mostra lista com limite e TTL
  const MAX = 18;
  const TTL = 12000;

  function addItem(user, guessCents, animate = true) {
    if (!LOG) return;

    const div = document.createElement("div");
    div.className = "item";

    // se seu overlay NÃO tiver .item/.name/.val, isso ainda mostra texto
    div.innerHTML = `
      <div class="name">${escapeHtml(user || "")}</div>
      <div class="val">${escapeHtml(fmtBRL(guessCents))}</div>
    `;

    if (!animate) div.style.animation = "none";

    // mais recente em cima
    LOG.prepend(div);
    while (LOG.children.length > MAX) LOG.removeChild(LOG.lastChild);

    // some depois do TTL
    setTimeout(() => {
      div.classList.add("hide");
      setTimeout(() => div.remove(), 380);
    }, TTL);
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[m]));
  }

  // render inicial do estado (payload do seu server.js)
  function renderInit(state) {
    // state: { isOpen, buyValueCents, total, entries }
    setStatus(!!state.isOpen);

    if (BUY) {
      BUY.textContent = state.buyValueCents ? fmtBRL(state.buyValueCents) : "—";
    }

    if (TOTAL) TOTAL.textContent = String(state.total || 0);

    if (LOG) {
      LOG.innerHTML = "";
      const entries = Array.isArray(state.entries) ? state.entries : [];
      // seu server manda entries já em ordem desc, então tá ok
      entries.slice(0, MAX).forEach((e) => addItem(e.user, e.guessCents, false));
    }
  }

  // conecta SSE certo
  let es = null;

  function connect() {
    if (!KEY) {
      console.error("Falta ?key= na URL do overlay");
      setStatus(false);
      return;
    }

    if (es) {
      try { es.close(); } catch {}
      es = null;
    }

    const url = `${API}/api/palpite/stream?key=${encodeURIComponent(KEY)}`;
    es = new EventSource(url);

    // eventos REAIS do seu server.js:
    es.addEventListener("palpite-init", (ev) => {
      try { renderInit(JSON.parse(ev.data || "{}")); } catch {}
    });

    es.addEventListener("palpite-open", (ev) => {
      try { renderInit(JSON.parse(ev.data || "{}")); } catch {}
    });

    es.addEventListener("palpite-close", (ev) => {
      try {
        const st = JSON.parse(ev.data || "{}");
        setStatus(false);
        if (TOTAL) TOTAL.textContent = String(st.total ?? TOTAL.textContent ?? "0");
      } catch {
        setStatus(false);
      }
    });

    es.addEventListener("palpite-clear", (ev) => {
      try { renderInit(JSON.parse(ev.data || "{}")); }
      catch { clearList(); }
    });

    es.addEventListener("palpite-guess", (ev) => {
      try {
        const data = JSON.parse(ev.data || "{}");
        const entry = data.entry || {};
        if (entry.user) addItem(entry.user, entry.guessCents, true);

        // seu server NÃO manda total no evento -> incrementa local
        if (TOTAL) TOTAL.textContent = String(Number(TOTAL.textContent || 0) + 1);
      } catch {}
    });

    es.onerror = () => {
      try { es.close(); } catch {}
      es = null;
      setTimeout(connect, 1500);
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    connect();
  });
})();
