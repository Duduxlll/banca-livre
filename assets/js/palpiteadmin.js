

(() => {
  const API = window.location.origin;

  const qs = (s, r = document) => r.querySelector(s);

  const esc = (s = '') =>
    String(s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));

  // =========================
  // KEY pela URL (?key=...)
  // =========================
  function getKeyFromUrl() {
    const u = new URL(window.location.href);
    return (u.searchParams.get('key') || '').trim();
  }

  const KEY = getKeyFromUrl();

  function showError(msg) {
    const box = qs('#overlayError') || qs('#palpiteOverlayError');
    if (box) {
      box.style.display = 'block';
      box.innerHTML = esc(msg);
    } else {
      console.error(msg);
    }
  }

  if (!KEY) {
    showError('Falta a key na URL. Use: .../palpite-overlay.html?key=SUA_KEY');
  }

  // =========================
  // DOM (IDs esperados no overlay)
  // =========================
  const el = {
    title: qs('#overlayTitle') || qs('#palpiteTitle'),
    subtitle: qs('#overlaySubtitle') || qs('#palpiteSubtitle'),
    buyValue: qs('#overlayBuyValue') || qs('#buyValue'),
    status: qs('#overlayStatus') || qs('#palpiteStatus'),
    total: qs('#overlayTotal') || qs('#totalGuesses'),
    list: qs('#overlayList') || qs('#logBox') || qs('#palpiteLogBox'),
    winners: qs('#overlayWinners') || qs('#palpiteWinnersBox'),
    hint: qs('#overlayHint') || qs('#palpiteHint'),
  };

  function setText(node, txt) {
    if (!node) return;
    node.textContent = txt;
  }

  function setHtml(node, html) {
    if (!node) return;
    node.innerHTML = html;
  }

  function fmtMoney(n) {
    const v = Number(n);
    if (!Number.isFinite(v)) return '0,00';
    return v.toFixed(2).replace('.', ',');
  }

  function clearList() {
    if (el.list) el.list.innerHTML = '';
  }

  function addGuessLine(name, value) {
    if (!el.list) return;

    const row = document.createElement('div');
    row.className = 'overlay-line';
    row.innerHTML = `
      <span class="overlay-name">${esc(name || '—')}</span>
      <span class="overlay-value">R$ ${esc(fmtMoney(value))}</span>
    `;

    // adiciona no topo (mais recente primeiro)
    el.list.prepend(row);

    // limita linhas (pra não crescer infinito)
    const max = 12;
    const kids = [...el.list.children];
    if (kids.length > max) {
      kids.slice(max).forEach(k => k.remove());
    }
  }

  function renderState(st) {
    // st: { open, buyValue, totalGuesses, lastGuesses }
    if (!st || typeof st !== 'object') return;

    if (el.buyValue && st.buyValue != null) {
      setText(el.buyValue, `Bonus: R$ ${fmtMoney(st.buyValue)}`);
    }

    if (el.status) {
      setText(el.status, st.open ? 'ABERTO' : 'FECHADO');
      el.status.classList.toggle('is-open', !!st.open);
      el.status.classList.toggle('is-closed', !st.open);
    }

    if (el.total) setText(el.total, String(st.totalGuesses || 0));

    // lista inicial (lastGuesses vindo do backend)
    if (el.list && Array.isArray(st.lastGuesses)) {
      clearList();
      // backend pode mandar do mais antigo pro mais novo
      // vamos colocar o mais novo primeiro
      st.lastGuesses.slice().reverse().forEach(g => addGuessLine(g.name, g.value));
    }
  }

  function renderWinners(payload) {
    // payload: { winners: [{name,value,delta}], actualResult, winnersCount }
    if (!el.winners) return;
    const winners = payload?.winners || [];
    if (!winners.length) {
      setHtml(el.winners, `<div class="overlay-winners-empty">—</div>`);
      return;
    }

    setHtml(el.winners, winners.map((w, i) => `
      <div class="overlay-winner">
        <span class="overlay-winner-rank">#${i + 1}</span>
        <span class="overlay-winner-name">${esc(w.name || '—')}</span>
        <span class="overlay-winner-value">R$ ${esc(fmtMoney(w.value))}</span>
        ${w.delta != null ? `<span class="overlay-winner-delta">(± ${esc(fmtMoney(w.delta))})</span>` : ''}
      </div>
    `).join(''));
  }

  // =========================
  // SSE (tempo real)
  // =========================
  let es = null;

  function connect() {
    if (!KEY) return;

    // fecha anterior
    if (es) {
      try { es.close(); } catch {}
      es = null;
    }

    const url = `${API}/api/palpite/stream?key=${encodeURIComponent(KEY)}`;
    es = new EventSource(url);

    es.addEventListener('state', (e) => {
      try {
        const st = JSON.parse(e.data || '{}');
        renderState(st);
      } catch (err) {
        console.error('state parse error', err);
      }
    });

    es.addEventListener('guess', (e) => {
      try {
        const d = JSON.parse(e.data || '{}');
        addGuessLine(d.name, d.value);
        if (el.total) setText(el.total, String(d.totalGuesses || 0));
      } catch (err) {
        console.error('guess parse error', err);
      }
    });

    es.addEventListener('winners', (e) => {
      try {
        const d = JSON.parse(e.data || '{}');
        renderWinners(d);
      } catch (err) {
        console.error('winners parse error', err);
      }
    });

    es.addEventListener('clear', () => {
      clearList();
      if (el.total) setText(el.total, '0');
      if (el.winners) setHtml(el.winners, `<div class="overlay-winners-empty">—</div>`);
    });

    es.onerror = () => {
      // reconecta sem travar
      try { es.close(); } catch {}
      es = null;
      setTimeout(connect, 1500);
    };
  }

  // =========================
  // Start
  // =========================
  document.addEventListener('DOMContentLoaded', () => {
    // texto padrão opcional
    if (el.hint && !el.hint.textContent.trim()) {
      setText(el.hint, 'Digite no chat: !231  (somente o valor)');
    }
    if (el.winners) setHtml(el.winners, `<div class="overlay-winners-empty">—</div>`);

    connect();
  });
})();
