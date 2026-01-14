(() => {
  const API = window.location.origin;
  const params = new URLSearchParams(location.search);
  const key = params.get('key') || '';

  const qs = (s, r=document) => r.querySelector(s);

  const card     = qs('#palpiteCard');
  const statusEl = qs('#palpiteStatus');
  const buyEl    = qs('#palpiteBuy');
  const hintEl   = qs('#palpiteHint');
  const feedEl   = qs('#palpiteFeed');
  const winEl    = qs('#palpiteWinners');

  function setStatus(txt, mode){
    statusEl.textContent = txt;

    if (mode === 'open') {
      statusEl.style.background = 'rgba(0,255,136,.14)';
      statusEl.style.borderColor = 'rgba(0,255,136,.25)';
    } else if (mode === 'closed') {
      statusEl.style.background = 'rgba(255,71,87,.14)';
      statusEl.style.borderColor = 'rgba(255,71,87,.25)';
    } else if (mode === 'result') {
      statusEl.style.background = 'rgba(255,178,74,.16)';
      statusEl.style.borderColor = 'rgba(255,178,74,.28)';
    } else {
      statusEl.style.background = 'rgba(255,255,255,.06)';
      statusEl.style.borderColor = 'rgba(255,255,255,.12)';
    }
  }

  function showCard(){
    card.classList.add('show');
  }
  function hideCard(){
    card.classList.remove('show');
  }

  function clearFeed(){
    feedEl.innerHTML = '';
  }

  function addFeed(name, value){
    const div = document.createElement('div');
    div.className = 'palpite-item';
    div.innerHTML = `<span><b>${escapeHtml(name)}</b> <small>palpitou</small></span><span>R$ ${Number(value).toFixed(2)}</span>`;
    feedEl.prepend(div);
    while (feedEl.children.length > 3) feedEl.lastChild.remove();
  }

  function showWinners(actual, winners){
    winEl.innerHTML = '';
    winEl.style.display = 'flex';

    winners.forEach((w, idx) => {
      const row = document.createElement('div');
      row.className = 'palpite-win';
      row.innerHTML = `
        <div style="display:flex; align-items:center;">
          <span class="palpite-pos">#${idx+1}</span>
          <span>${escapeHtml(w.name)}</span>
        </div>
        <span>R$ ${Number(w.value).toFixed(2)}</span>
      `;
      winEl.appendChild(row);
    });

    setStatus(`RESULTADO: R$ ${Number(actual).toFixed(2)}`, 'result');
  }

  function showInfo(buyValue){
    winEl.style.display = 'none';
    showCard();
    clearFeed();
    buyEl.textContent = buyValue ? `COMPRA: R$ ${Number(buyValue).toFixed(2)}` : 'COMPRA: —';
    hintEl.innerHTML = `Digite no chat: <b>!231</b> (somente valor, acima da compra)`;
    setStatus('PALPITES ABERTOS', 'open');
  }

  function setClosed(){
    setStatus('PALPITES ENCERRADOS', 'closed');
  }

  function applyState(st){
    if (st.isOpen) {
      showInfo(st.buyValue);
      if (Array.isArray(st.lastGuesses)) {
        clearFeed();
        st.lastGuesses.slice(0, 3).forEach(g => addFeed(g.name, g.value));
      }
    } else {
      // se tiver winners, mostra; senão esconde
      if (st.winners && st.winners.length && st.actualResult != null) {
        showCard();
        buyEl.textContent = st.buyValue ? `COMPRA: R$ ${Number(st.buyValue).toFixed(2)}` : 'COMPRA: —';
        showWinners(st.actualResult, st.winners);
      } else {
        hideCard();
      }
    }
  }

  function escapeHtml(s=''){
    return String(s).replace(/[&<>"']/g, m => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[m]));
  }

  if (!key) {
    // sem key: só avisa e não conecta
    showCard();
    setStatus('SEM KEY', 'closed');
    buyEl.textContent = 'Configure a URL com ?key=...';
    hintEl.textContent = 'Ex: /palpite-overlay.html?key=SUA_CHAVE';
    return;
  }

  let es = null;
  function connect(){
    if (es) try { es.close(); } catch {}
    es = new EventSource(`${API}/api/palpite/stream?key=${encodeURIComponent(key)}`);

    es.addEventListener('state', (e) => applyState(JSON.parse(e.data)));

    es.addEventListener('start', (e) => {
      const d = JSON.parse(e.data || '{}');
      showInfo(d.buyValue || 0);
    });

    es.addEventListener('guess', (e) => {
      const d = JSON.parse(e.data || '{}');
      addFeed(d.name, d.value);
    });

    es.addEventListener('stop', () => setClosed());

    es.addEventListener('winners', (e) => {
      const d = JSON.parse(e.data || '{}');
      winEl.style.display = 'flex';
      showWinners(d.actualResult, d.winners || []);
    });

    es.addEventListener('clear', () => hideCard());

    es.onerror = () => {
      try { es.close(); } catch {}
      setTimeout(connect, 1500);
    };
  }

  connect();
})();
