// assets/js/palpiteadmin.js  (OVERLAY - para palpite-overlay.html)
(() => {
  const API = window.location.origin;
  const qs = (s, r = document) => r.querySelector(s);

  // DOM do seu overlay.html
  const elStatus = qs("#ovStatus"); // FECHADO/ABERTO
  const elSub = qs("#ovSub");       // Aguardando... / Compra... / Total...
  const elList = qs("#ovList");     // lista de palpites

  const fmtBRL = (cents) =>
    (Number(cents || 0) / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (m) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[m]));
  }

  function getKeyFromUrl() {
    const u = new URL(window.location.href);
    return (u.searchParams.get("key") || "").trim();
  }

  const KEY = getKeyFromUrl();

  function setStatus(isOpen) {
    if (!elStatus) return;
    elStatus.textContent = isOpen ? "ABERTO" : "FECHADO";
    elStatus.classList.toggle("is-open", !!isOpen);
    elStatus.classList.toggle("is-closed", !isOpen);
  }

  function setSub(text) {
    if (!elSub) return;
    elSub.textContent = text;
  }

  function clearList() {
    if (elList) elList.innerHTML = "";
  }

  // controla quantas linhas aparecem no overlay
  const MAX = 12;
  const TTL = 12000;

  function addLine(user, guessCents, animate = true) {
    if (!elList) return;

    const div = document.createElement("div");
    div.className = "ov-item";
    div.innerHTML = `
      <span class="ov-name">${escapeHtml(user || "—")}</span>
      <span class="ov-val">${escapeHtml(fmtBRL(guessCents))}</span>
    `;

    // mais recente em cima
    elList.prepend(div);

    // limita tamanho
    while (elList.children.length > MAX) {
      elList.removeChild(elList.lastChild);
    }

    if (animate) {
      setTimeout(() => {
        div.classList.add("ov-hide");
        setTimeout(() => div.remove(), 380);
      }, TTL);
    }
  }

  function renderInit(state) {
    // state: { isOpen, buyValueCents, total, entries }
    const open = !!state?.isOpen;
    setStatus(open);

    const buy = state?.buyValueCents ? fmtBRL(state.buyValueCents) : "—";
    const total = Number(state?.total || 0);

    setSub(open ? `Compra: ${buy} • Total: ${total}` : `Aguardando… • Compra: ${buy}`);

    clearList();
    const entries = Array.isArray(state?.entries) ? state.entries : [];
    // entries já vem desc no seu server, então ok
    entries.slice(0, MAX).forEach((e) => addLine(e.user, e.guessCents, false));
  }

  let es = null;

  function connect() {
    if (!KEY) {
      setStatus(false);
      setSub("Falta ?key= na URL do overlay");
      return;
    }

    // fecha SSE anterior
    if (es) {
      try { es.close(); } catch {}
      es = null;
    }

    const url = `${API}/api/palpite/stream?key=${encodeURIComponent(KEY)}`;
    es = new EventSource(url);

    // eventos do seu server.js
    es.addEventListener("palpite-init", (ev) => {
      try { renderInit(JSON.parse(ev.data || "{}")); } catch {}
    });

    es.addEventListener("palpite-open", (ev) => {
      try { renderInit(JSON.parse(ev.data || "{}")); } catch {}
    });

    es.addEventListener("palpite-close", (ev) => {
      setStatus(false);
      // tenta manter compra/total se tiver no payload
      try {
        const st = JSON.parse(ev.data || "{}");
        const buy = st?.buyValueCents ? fmtBRL(st.buyValueCents) : "—";
        const total = Number(st?.total || 0);
        setSub(`Fechado • Compra: ${buy} • Total: ${total}`);
      } catch {
        setSub("Fechado • Aguardando…");
      }
    });

    es.addEventListener("palpite-clear", (ev) => {
      try {
        renderInit(JSON.parse(ev.data || "{}"));
      } catch {
        clearList();
        setSub("Limpo • Aguardando…");
      }
    });

    es.addEventListener("palpite-guess", (ev) => {
      try {
        const data = JSON.parse(ev.data || "{}");
        const entry = data.entry || {};
        if (entry.user) addLine(entry.user, entry.guessCents, true);

        // atualiza o "Total" no sub (server não manda total aqui)
        const old = elSub?.textContent || "";
        // se tiver "... Total: N", incrementa
        const m = old.match(/Total:\s*(\d+)/i);
        const nextTotal = m ? (Number(m[1]) + 1) : null;

        if (nextTotal != null) {
          setSub(old.replace(/Total:\s*\d+/i, `Total: ${nextTotal}`));
        }
      } catch {}
    });

    es.onerror = () => {
      try { es.close(); } catch {}
      es = null;
      setTimeout(connect, 1500);
    };
  }

  document.addEventListener("DOMContentLoaded", () => {
    setStatus(false);
    setSub("Aguardando…");
    connect();
  });
})();
