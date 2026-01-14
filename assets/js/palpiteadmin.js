// assets/js/palpiteadmin.js  (OVERLAY)
(() => {
  const API = window.location.origin;
  const qs = (s, r = document) => r.querySelector(s);

  const esc = (s = '') =>
    String(s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));

  // key vem da URL: /palpite-overlay.html?key=SUA_KEY
  const KEY = new URL(location.href).searchParams.get('key')?.trim() || '';

  // IDs do overlay (bate com o overlay que seu server gera hoje)
  const el = {
    status: qs('#statusPill') || qs('#overlayStatus'),
    buy: qs('#buyVal') || qs('#overlayBuyValue'),
    total: qs('#total') || qs('#overlayTotal'),
    log: qs('#log') || qs('#overlayList'),
    winners: qs('#overlayWinners') || qs('#winners'),
    error: qs('#overlayError') || qs('#palpiteOverlayError'),
  };

  const fmtBRL = (cents) =>
    (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const MAX = 18;
  const TTL = 12000;

  function showError(msg) {
    if (el.error) {
      el.error.style.display = 'block';
      el.error.innerHTML = esc(msg);
    } else {
      console.error(msg);
    }
  }

  function setStatus(isOpen) {
    if (!el.status) return;
    el.status.classList.toggle('on', !!isOpen);
    el.status.classList.toggle('off', !isOpen);
    el.status.textContent = isOpen ? 'ABERTO' : 'FECHADO';
  }

  function clearLog() {
    if (el.log) el.log.innerHTML = '';
  }

  function addItem(user, guessCents, animate = true) {
    if (!el.log) return;

    const div = document.createElement('div');
    div.className = 'item';
    div.innerHTML = `
      <div class="name">${esc(user || '')}</div>
      <div class="val">${esc(fmtBRL(guessCents || 0))}</div>
    `;

    if (!animate) div.style.animation = 'none';

    el.log.prepend(div);
    while (el.log.children.length > MAX) el.log.removeChild(el.log.lastChild);

    // some depois de um tempo (efeito overlay)
    setTimeout(() => {
      div.classList.add('hide');
      setTimeout(() => div.remove(), 380);
    }, TTL);
  }

  function renderState(state) {
    // state vindo do server: { isOpen, buyValueCents, total, entries: [{user, guessCents}] }
    setStatus(!!state?.isOpen);

    if (el.buy) el.buy.textContent = state?.buyValueCents ? fmtBRL(state.buyValueCents) : '—';
    if (el.total) el.total.textContent = String(state?.total || 0);

    clearLog();
    (state?.entries || []).slice(0, MAX).forEach(e => addItem(e.user, e.guessCents, false));
  }

  function renderWinners(payload) {
    if (!el.winners) return;
    const winners = payload?.winners || [];
    if (!winners.length) {
      el.winners.innerHTML = `<div class="overlay-winners-empty">—</div>`;
      return;
    }

    el.winners.innerHTML = winners.map((w, i) => `
      <div class="overlay-winner">
        <span class="overlay-winner-rank">#${i + 1}</span>
        <span class="overlay-winner-name">${esc(w.user || w.name || '—')}</span>
        <span class="overlay-winner-value">${esc(fmtBRL(w.guessCents ?? w.valueCents ?? 0))}</span>
        <span class="overlay-winner-delta">(± ${esc(fmtBRL(w.deltaCents ?? 0))})</span>
      </div>
    `).join('');
  }

  function connect() {
    if (!KEY) {
      showError('Falta a key na URL. Use: /palpite-overlay.html?key=SUA_KEY');
      return;
    }

    const es = new EventSource(`${API}/api/palpite/stream?key=${encodeURIComponent(KEY)}`);

    es.addEventListener('palpite-init', (ev) => {
      try { renderState(JSON.parse(ev.data || '{}')); } catch {}
    });

    es.addEventListener('palpite-open', (ev) => {
      try { renderState(JSON.parse(ev.data || '{}')); } catch {}
    });

    es.addEventListener('palpite-close', () => {
      setStatus(false);
    });

    es.addEventListener('palpite-clear', (ev) => {
      try { renderState(JSON.parse(ev.data || '{}')); } catch { clearLog(); }
      if (el.total) el.total.textContent = '0';
    });

    es.addEventListener('palpite-guess', (ev) => {
      try {
        const d = JSON.parse(ev.data || '{}');
        const entry = d.entry || {};
        if (entry.user) addItem(entry.user, entry.guessCents, true);

        // se o server mandar total, usa
        if (d.total != null && el.total) el.total.textContent = String(d.total);
      } catch {}
    });

    es.addEventListener('palpite-winners', (ev) => {
      try { renderWinners(JSON.parse(ev.data || '{}')); } catch {}
    });

    es.onerror = () => {
      // overlay pode reconectar sozinho ao recarregar o OBS
    };
  }

  document.addEventListener('DOMContentLoaded', connect);
})();
