(() => {
  const API = window.location.origin;

  const qs = (s, r = document) => r.querySelector(s);

  const esc = (s = '') =>
    String(s).replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[m]));

 
  function getKeyFromUrl() {
    const u = new URL(window.location.href);
    return (u.searchParams.get('key') || '').trim();
  }

  async function getKeyFromServer() {
    try {
      const r = await fetch(`${API}/api/palpite/key`, { credentials: 'include' });
      if (!r.ok) return '';
      const j = await r.json();
      return (j?.key || '').trim();
    } catch {
      return '';
    }
  }

  function showError(msg) {
    const box = qs('#overlayError') || qs('#palpiteOverlayError');
    if (box) {
      box.style.display = 'block';
      box.innerHTML = esc(msg);
    } else {
      console.error(msg);
    }
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

    // limita linhas
    const max = 12;
    const kids = [...el.list.children];
    if (kids.length > max) kids.slice(max).forEach(k => k.remove());
  }

  function renderState(st) {
    // st compat: { buyValue, totalGuesses, lastGuesses, open? }
    // st novo (do server): { roundId,isOpen,buyValueCents,total,entries }
    if (!st || typeof st !== 'object') return;

    const open =
      st.open != null ? !!st.open :
      st.isOpen != null ? !!st.isOpen :
      false;

    const buy =
      st.buyValue != null ? Number(st.buyValue) :
      st.buyValueCents != null ? Number(st.buyValueCents) / 100 :
      null;

    const total =
      st.totalGuesses != null ? Number(st.totalGuesses) :
      st.total != null ? Number(st.total) :
      0;

    // lista:
    // - compat: lastGuesses [{name,value}]
    // - novo: entries [{user,guessCents}]
    let list = [];
    if (Array.isArray(st.lastGuesses)) {
      list = st.lastGuesses.map(g => ({ name: g.name, value: g.value }));
    } else if (Array.isArray(st.entries)) {
      list = st.entries.map(e => ({ name: e.user, value: Number(e.guessCents || 0) / 100 }));
    }

    if (el.buyValue && buy != null) setText(el.buyValue, `Bonus: R$ ${fmtMoney(buy)}`);

    if (el.status) {
      setText(el.status, open ? 'ABERTO' : 'FECHADO');
      el.status.classList.toggle('is-open', open);
      el.status.classList.toggle('is-closed', !open);
    }

    if (el.total) setText(el.total, String(total || 0));

    if (el.list && Array.isArray(list)) {
      clearList();
      list.slice().reverse().forEach(g => addGuessLine(g.name, g.value));
    }
  }

  function renderWinners(payload) {
    // payload pode vir em 2 formatos:
    // 1) compat: { winners:[{name,value,delta}], actualResult, winnersCount }
    // 2) novo: { actualCents, winners:[{user,guessCents,diffCents}] }
    if (!el.winners) return;

    let winners = payload?.winners || [];
    if (winners.length && winners[0] && winners[0].user != null) {
      winners = winners.map(w => ({
        name: w.user,
        value: Number(w.guessCents || 0) / 100,
        delta: w.diffCents != null ? Number(w.diffCents) / 100 : null
      }));
    }

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
  // SSE
  // =========================
  let es = null;

  function closeES() {
    if (es) {
      try { es.close(); } catch {}
      es = null;
    }
  }

  function connect(KEY) {
    closeES();

    const url = `${API}/api/palpite/stream?key=${encodeURIComponent(KEY)}`;
    es = new EventSource(url);

    // compat
    es.addEventListener('state', (e) => {
      try { renderState(JSON.parse(e.data || '{}')); } catch {}
    });

    es.addEventListener('guess', (e) => {
      try {
        const d = JSON.parse(e.data || '{}');
        addGuessLine(d.name, d.value);
        if (el.total) setText(el.total, String(d.totalGuesses || 0));
      } catch {}
    });

    es.addEventListener('winners', (e) => {
      try { renderWinners(JSON.parse(e.data || '{}')); } catch {}
    });

    es.addEventListener('clear', () => {
      clearList();
      if (el.total) setText(el.total, '0');
      if (el.winners) setHtml(el.winners, `<div class="overlay-winners-empty">—</div>`);
    });

    // novo (do overlay HTML do server)
    es.addEventListener('palpite-init', (e) => {
      try { renderState(JSON.parse(e.data || '{}')); } catch {}
    });
    es.addEventListener('palpite-open', (e) => {
      try { renderState(JSON.parse(e.data || '{}')); } catch {}
    });
    es.addEventListener('palpite-close', (e) => {
      try { renderState(JSON.parse(e.data || '{}')); } catch {}
    });
    es.addEventListener('palpite-clear', () => {
      clearList();
      if (el.total) setText(el.total, '0');
      if (el.winners) setHtml(el.winners, `<div class="overlay-winners-empty">—</div>`);
    });
    es.addEventListener('palpite-guess', (e) => {
      try {
        const d = JSON.parse(e.data || '{}');
        const entry = d.entry || {};
        if (entry.user) addGuessLine(entry.user, Number(entry.guessCents || 0) / 100);
        if (d.total != null && el.total) setText(el.total, String(d.total));
      } catch {}
    });
    es.addEventListener('palpite-winners', (e) => {
      try { renderWinners(JSON.parse(e.data || '{}')); } catch {}
    });

    es.onerror = () => {
      closeES();
      setTimeout(() => connect(KEY), 1500);
    };
  }

  // =========================
  // START
  // =========================
  document.addEventListener('DOMContentLoaded', async () => {
    if (el.hint && !el.hint.textContent.trim()) {
      setText(el.hint, 'Digite no chat: !231  (somente o valor)');
    }
    if (el.winners) setHtml(el.winners, `<div class="overlay-winners-empty">—</div>`);

    // 1) tenta pegar key por URL
    let KEY = getKeyFromUrl();

    // 2) se não tiver na URL, tenta pegar do servidor (se estiver logado)
    if (!KEY) KEY = await getKeyFromServer();

    if (!KEY) {
      showError(
        'Sem key. Opções:\n' +
        '1) Abra assim: /palpite-overlay.html?key=SUA_KEY\n' +
        '2) Ou abra o overlay estando logado no painel (pra puxar a key do servidor).'
      );
      return;
    }

    connect(KEY);
  });
})();
