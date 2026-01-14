(() => {
  const API = window.location.origin;
  const KEY_STORAGE = 'palpite_overlay_key';

  const qs = (s, r=document) => r.querySelector(s);

  function getKey(forceAsk = false) {
    let k = localStorage.getItem(KEY_STORAGE) || '';
    if (!k && forceAsk) {
      k = prompt('Cole sua PALPITE_OVERLAY_KEY (a mesma da Render):') || '';
      k = k.trim();
      if (k) localStorage.setItem(KEY_STORAGE, k);
    }
    return k;
  }

  async function post(path, body) {
    const k = getKey(true);
    if (!k) throw new Error('Sem key');

    const res = await fetch(`${API}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-Palpite-Key': k
      },
      body: JSON.stringify(body || {})
    });

    if (!res.ok) {
      let err;
      try { err = await res.json(); } catch {}
      throw new Error(err?.error || `HTTP ${res.status}`);
    }
    return res.json();
  }

  // IDs esperados (usa fallback pra não quebrar)
  const el = {};
  function bind() {
    el.buyValue     = qs('#buyValue')     || qs('#palpiteBuyValue');
    el.winnersCount = qs('#winnersCount') || qs('#palpiteWinnersCount');
    el.finalResult  = qs('#finalResult')  || qs('#palpiteFinalResult');

    el.logBox       = qs('#logBox')       || qs('#palpiteLogBox');
    el.total        = qs('#totalGuesses') || qs('#palpiteTotalGuesses');

    el.btnOpen  = qs('#btnPalpiteOpen');
    el.btnClose = qs('#btnPalpiteClose');
    el.btnClear = qs('#btnPalpiteClear');
    el.btnWin   = qs('#btnPalpiteWinners');
  }

  function setTotal(n) {
    if (el.total) el.total.textContent = String(n || 0);
  }

  function clearLog() {
    if (el.logBox) el.logBox.innerHTML = '';
    setTotal(0);
  }

  function addLogLine(name, value) {
    if (!el.logBox) return;
    const div = document.createElement('div');
    div.innerHTML = `[CHAT] <b>${escapeHtml(name)}</b>: R$ ${Number(value).toFixed(2)}`;
    el.logBox.appendChild(div);
    el.logBox.scrollTop = el.logBox.scrollHeight;
  }

  function escapeHtml(s=''){
    return String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }

  async function startRound() {
    const buyValue = Number(el.buyValue?.value || 0) || 0;
    clearLog();
    await post('/api/palpite/start', { buyValue });
  }

  async function closeRound() {
    await post('/api/palpite/stop', {});
  }

  async function clearRound() {
    clearLog();
    await post('/api/palpite/clear', {});
  }

  async function winners() {
    const actual = String(el.finalResult?.value || '').trim().replace(',', '.');
    const actualResult = Number(actual);
    const winnersCount = Number(el.winnersCount?.value || 1) || 1;

    if (!Number.isFinite(actualResult)) {
      alert('Digite quanto pagou (resultado real).');
      return;
    }

    await post('/api/palpite/winners', { actualResult, winnersCount });
  }

  // Admin também escuta o stream pra atualizar log/total em tempo real
  let es = null;
  function connectStream() {
    const k = getKey(false);
    if (!k) return; // só conecta depois que você salvar a key (clicando Abrir etc)

    if (es) try { es.close(); } catch {}
    es = new EventSource(`${API}/api/palpite/stream?key=${encodeURIComponent(k)}`);

    es.addEventListener('state', (e) => {
      const st = JSON.parse(e.data || '{}');
      if (el.buyValue && st.buyValue != null) el.buyValue.value = st.buyValue;
      setTotal(st.totalGuesses || 0);

      if (el.logBox && Array.isArray(st.lastGuesses)) {
        el.logBox.innerHTML = '';
        st.lastGuesses.slice().reverse().forEach(g => addLogLine(g.name, g.value));
      }
    });

    es.addEventListener('guess', (e) => {
      const d = JSON.parse(e.data || '{}');
      addLogLine(d.name, d.value);
      setTotal(d.totalGuesses || 0);
    });

    es.onerror = () => {
      try { es.close(); } catch {}
      setTimeout(connectStream, 1500);
    };
  }

  document.addEventListener('DOMContentLoaded', () => {
    bind();

    // Se seus botões não tiverem esses IDs, coloca eles no HTML (é só “adicionar”, não quebra)
    el.btnOpen?.addEventListener('click', () => startRound().catch(console.error));
    el.btnClose?.addEventListener('click', () => closeRound().catch(console.error));
    el.btnClear?.addEventListener('click', () => clearRound().catch(console.error));
    el.btnWin?.addEventListener('click', () => winners().catch(console.error));

    // tenta conectar (se ainda não tiver key, conecta depois quando você apertar Abrir e salvar)
    connectStream();

    // opcional: quando salvar key pela primeira vez, recarrega stream
    const oldPost = post;
    post = async (...args) => {
      const out = await oldPost(...args);
      if (!es) connectStream();
      return out;
    };
  });
})();
