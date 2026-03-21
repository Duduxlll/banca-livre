(() => {
  const API = window.location.origin;
  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([$?*|{}\\^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function apiFetch(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const method = (opts.method || 'GET').toUpperCase();
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
      const csrf = getCookie('csrf');
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    const res = await fetch(`${API}${path}`, { credentials: 'include', ...opts, headers });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    return data;
  }

  function notify(msg, type = 'ok') {
    if (typeof window.notify === 'function') return window.notify(msg, type);
    alert(String(msg || ''));
  }

  const esc = (s = '') => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  function toReaisInput(cents = 0) {
    const n = Number(cents || 0) / 100;
    if (!Number.isFinite(n)) return '0,00';
    return n.toFixed(2).replace('.', ',');
  }

  function fromReaisInput(value) {
    const s = String(value || '').trim().replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  }

  function brRoundLabel(roundName = '') {
    return String(roundName || '').toUpperCase();
  }

  function readCardPayload(card) {
    return {
      playerAName: qs('[data-role="playerAName"]', card)?.value?.trim() || '',
      bonusA: qs('[data-role="bonusA"]', card)?.value?.trim() || '',
      valueA: fromReaisInput(qs('[data-role="valueA"]', card)?.value || '0'),
      resultA: qs('[data-role="result"][data-side="A"]', card)?.value || 'LOSE',
      playerBName: qs('[data-role="playerBName"]', card)?.value?.trim() || '',
      bonusB: qs('[data-role="bonusB"]', card)?.value?.trim() || '',
      valueB: fromReaisInput(qs('[data-role="valueB"]', card)?.value || '0'),
      resultB: qs('[data-role="result"][data-side="B"]', card)?.value || 'LOSE'
    };
  }

  function battleFinished() {
    return String(state?.battle?.status || '').toUpperCase() === 'FINISHED';
  }

  let state = null;
  let poll = null;
  let initialized = false;
  let resizeBound = false;
  const saveTimers = new Map();
  const savingMatches = new Set();

  function ensureUI() {
    const tab = qs('#tab-batalha-bonus');
    if (!tab) return null;
    if (qs('#mbbRoot', tab)) return tab;

    tab.innerHTML = `
      <div id="mbbRoot" class="mbb-root">
        <section id="mbbCreateStage" class="mbb-create-stage">
          <div class="mbb-create-noise"></div>
          <div class="mbb-create-card">
            <div class="mbb-create-badge">BATALHA BÔNUS</div>
            <h2 class="mbb-create-title">Monta a chave manual e resolve tudo dentro do site.</h2>
            <p class="mbb-create-copy">Escolhe 8, 16 ou 32 vagas. Depois a estrutura completa aparece em formato de campeonato para tu preencher nome, bônus, valor e WIN ou LOSE direto na chave.</p>
            <div class="mbb-create-form">
              <label class="mbb-field">
                <span>Nome da batalha</span>
                <input id="mbbName" class="mbb-input" placeholder="Ex.: Batalha da Madrugada">
              </label>
              <label class="mbb-field">
                <span>Vagas</span>
                <select id="mbbSlots" class="mbb-select">
                  <option value="8">8 vagas</option>
                  <option value="16">16 vagas</option>
                  <option value="32" selected>32 vagas</option>
                </select>
              </label>
              <button id="mbbCreateBtn" class="mbb-btn mbb-btn--primary">Criar batalha</button>
            </div>
          </div>
        </section>

        <section id="mbbBattleStage" class="mbb-battle-stage" style="display:none">
          <div class="mbb-board-actions">
            <button id="mbbFinalizeBtn" class="mbb-btn mbb-btn--danger" data-mbb-action="finalize">Finalizar batalha</button>
          </div>
          <div class="mbb-bracket-wrap" id="mbbBracketWrap">
            <div class="mbb-bracket-stage" id="mbbBracketStage"></div>
          </div>
        </section>
      </div>
    `;

    qs('#mbbCreateBtn', tab)?.addEventListener('click', createBattle);

    tab.addEventListener('change', (ev) => {
      const target = ev.target;
      const card = target.closest('[data-match-card="1"]');
      if (!card) return;
      if (target.matches('[data-role="result"]')) {
        const side = target.dataset.side;
        const other = qs(`[data-role="result"][data-side="${side === 'A' ? 'B' : 'A'}"]`, card);
        if (target.value === 'WIN' && other) other.value = 'LOSE';
        scheduleSave(card, 40);
        return;
      }
      if (target.matches('[data-role^="player"], [data-role^="bonus"], [data-role^="value"]')) {
        scheduleSave(card, 200);
      }
    });

    tab.addEventListener('input', (ev) => {
      const target = ev.target;
      const card = target.closest('[data-match-card="1"]');
      if (!card) return;
      if (target.matches('[data-role^="player"], [data-role^="bonus"], [data-role^="value"]')) {
        markCardState(card, 'pending', 'Salvando...');
        scheduleSave(card, 700);
      }
    });

    tab.addEventListener('focusin', () => stopPolling());
    tab.addEventListener('focusout', () => startPolling());

    tab.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-mbb-action]');
      if (!btn) return;
      if (btn.dataset.mbbAction === 'finalize') {
        await finalizeBattle();
      }
    });

    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', () => {
        if (!qs('#mbbBattleStage') || !state?.battle) return;
        renderBattle();
      });
    }

    return tab;
  }

  function markCardState(card, kind, label) {
    if (!card) return;
    card.dataset.saveStateKind = kind || '';
    const node = qs('[data-role="saveState"]', card);
    if (node) node.textContent = label || 'Pronto';
  }

  function scheduleSave(card, delay = 500) {
    const matchId = String(card?.dataset.matchId || '');
    if (!matchId || battleFinished()) return;
    clearTimeout(saveTimers.get(matchId));
    const timer = setTimeout(() => saveMatch(card), delay);
    saveTimers.set(matchId, timer);
  }

  async function saveMatch(card) {
    const matchId = String(card?.dataset.matchId || '');
    if (!matchId || savingMatches.has(matchId) || battleFinished()) return;
    savingMatches.add(matchId);
    markCardState(card, 'saving', 'Salvando...');

    try {
      const res = await apiFetch(`/api/batalha-bonus/admin/matches/${encodeURIComponent(matchId)}`, {
        method: 'PATCH',
        body: JSON.stringify(readCardPayload(card))
      });
      state = res || state;
      renderBattle();
    } catch (e) {
      markCardState(card, 'error', e.message || 'Erro');
      if (String(e.message || '') === 'duplo_win') {
        notify('Só um lado pode ficar com WIN.', 'error');
      }
    } finally {
      savingMatches.delete(matchId);
    }
  }

  function computeBoardGeometry(rounds) {
    const cardWidth = 380;
    const cardHeight = 138;
    const laneGap = 118;
    const baseGap = 24;
    const leftPadding = 28;
    const topPadding = 54;
    const firstRoundCount = Number(rounds?.[0]?.matches?.length || 0);
    const totalHeight = topPadding + firstRoundCount * cardHeight + Math.max(0, firstRoundCount - 1) * baseGap + 24;
    const totalWidth = leftPadding * 2 + rounds.length * cardWidth + Math.max(0, rounds.length - 1) * laneGap;

    const roundMeta = rounds.map((round, roundIdx) => {
      const step = (cardHeight + baseGap) * Math.pow(2, roundIdx);
      const firstTop = topPadding + (step / 2) - (cardHeight / 2);
      const x = leftPadding + roundIdx * (cardWidth + laneGap);
      const cards = round.matches.map((match, matchIdx) => ({
        match,
        x,
        y: Math.round(firstTop + matchIdx * step)
      }));
      return {
        round,
        x,
        cards
      };
    });

    const posMap = new Map();
    for (const meta of roundMeta) {
      for (const c of meta.cards) {
        posMap.set(String(c.match.id), { x: c.x, y: c.y });
      }
    }

    const lines = [];
    for (const meta of roundMeta) {
      for (const c of meta.cards) {
        const m = c.match;
        if (!m.nextRoundNumber || !m.nextMatchNumber) continue;
        const nextRound = roundMeta.find((r) => r.round.roundNumber === m.nextRoundNumber);
        const nextCard = nextRound?.cards.find((n) => Number(n.match.matchNumber) === Number(m.nextMatchNumber));
        if (!nextCard) continue;
        const startX = c.x + cardWidth;
        const startY = c.y + cardHeight / 2;
        const endX = nextCard.x;
        const endY = nextCard.y + cardHeight / 2;
        const midX = startX + laneGap / 2;
        lines.push(`M ${startX} ${startY} H ${midX} V ${endY} H ${endX}`);
      }
    }

    return {
      cardWidth,
      cardHeight,
      laneGap,
      totalWidth,
      totalHeight,
      roundMeta,
      lines
    };
  }

  function renderBattle() {
    const createStage = qs('#mbbCreateStage');
    const battleStage = qs('#mbbBattleStage');
    const hasBattle = !!state?.battle;
    if (createStage) createStage.style.display = hasBattle ? 'none' : '';
    if (battleStage) battleStage.style.display = hasBattle ? '' : 'none';
    if (!hasBattle) return;

    const rounds = Array.isArray(state?.rounds) ? state.rounds : [];
    const stage = qs('#mbbBracketStage');
    const wrap = qs('#mbbBracketWrap');
    const finalizeBtn = qs('#mbbFinalizeBtn');

    if (!stage || !wrap) return;

    if (finalizeBtn) finalizeBtn.disabled = battleFinished() || !state?.battle?.championName;

    if (!rounds.length) {
      stage.innerHTML = '<div class="mbb-empty">Nenhuma estrutura encontrada.</div>';
      return;
    }

    const geo = computeBoardGeometry(rounds);
    const availableWidth = Math.max(620, wrap.clientWidth - 14);
    const maxHeight = Math.max(560, Math.min(window.innerHeight - 220, 880));
    const naturalScale = Math.min(1, availableWidth / geo.totalWidth, maxHeight / geo.totalHeight);
    const scale = naturalScale < 0.58 ? 0.58 : naturalScale;
    const scaledHeight = Math.round(geo.totalHeight * scale);

    stage.style.height = `${scaledHeight}px`;
    stage.innerHTML = `
      <div class="mbb-board" style="width:${geo.totalWidth}px;height:${geo.totalHeight}px;transform:scale(${scale})">
        <svg class="mbb-board-lines" viewBox="0 0 ${geo.totalWidth} ${geo.totalHeight}" preserveAspectRatio="none">
          ${geo.lines.map((d) => `<path d="${d}" />`).join('')}
        </svg>

        ${geo.roundMeta.map((meta) => `
          <div class="mbb-round-title" style="left:${meta.x}px;width:${geo.cardWidth}px;">${esc(brRoundLabel(meta.round.roundName))}</div>
        `).join('')}

        ${geo.roundMeta.flatMap((meta) => meta.cards.map((card) => renderCard(card.match, card.x, card.y, geo.cardWidth, geo.cardHeight))).join('')}
      </div>
    `;
  }

  function renderCard(match, x, y, cardWidth, cardHeight) {
    const winnerSide = String(match.winnerSide || '').toUpperCase();
    const isAWin = winnerSide === 'A';
    const isBWin = winnerSide === 'B';
    const disabled = battleFinished() ? 'disabled' : '';

    return `
      <article class="mbb-match-card ${winnerSide ? 'is-resolved' : ''}" data-match-card="1" data-match-id="${esc(match.id)}" style="left:${x}px;top:${y}px;width:${cardWidth}px;height:${cardHeight}px">
        <div class="mbb-match-card-bg"></div>

        <div class="mbb-side-row ${isAWin ? 'is-win' : ''}">
          <div class="mbb-player-stack">
            <input class="mbb-mini-input mbb-mini-input--name" data-role="playerAName" placeholder="Nome do jogador" value="${esc(match.playerAName || '')}" ${disabled}>
            <input class="mbb-mini-input mbb-mini-input--bonus" data-role="bonusA" placeholder="Nome do bônus / jogo" value="${esc(match.bonusA || '')}" ${disabled}>
          </div>
          <input class="mbb-mini-input mbb-mini-input--value" data-role="valueA" placeholder="0,00" value="${esc(toReaisInput(match.valueA))}" ${disabled}>
          <select class="mbb-mini-select ${isAWin ? 'is-win' : ''}" data-role="result" data-side="A" ${disabled}>
            <option value="LOSE" ${match.resultA === 'LOSE' ? 'selected' : ''}>LOSE</option>
            <option value="WIN" ${match.resultA === 'WIN' ? 'selected' : ''}>WIN</option>
          </select>
        </div>

        <div class="mbb-side-row ${isBWin ? 'is-win' : ''}">
          <div class="mbb-player-stack">
            <input class="mbb-mini-input mbb-mini-input--name" data-role="playerBName" placeholder="Nome do jogador" value="${esc(match.playerBName || '')}" ${disabled}>
            <input class="mbb-mini-input mbb-mini-input--bonus" data-role="bonusB" placeholder="Nome do bônus / jogo" value="${esc(match.bonusB || '')}" ${disabled}>
          </div>
          <input class="mbb-mini-input mbb-mini-input--value" data-role="valueB" placeholder="0,00" value="${esc(toReaisInput(match.valueB))}" ${disabled}>
          <select class="mbb-mini-select ${isBWin ? 'is-win' : ''}" data-role="result" data-side="B" ${disabled}>
            <option value="LOSE" ${match.resultB === 'LOSE' ? 'selected' : ''}>LOSE</option>
            <option value="WIN" ${match.resultB === 'WIN' ? 'selected' : ''}>WIN</option>
          </select>
        </div>
      </article>
    `;
  }

  async function refresh() {
    ensureUI();
    const res = await apiFetch('/api/batalha-bonus/admin/state');
    state = res?.state || null;
    renderBattle();
  }

  async function createBattle() {
    try {
      const name = qs('#mbbName')?.value?.trim() || '';
      const maxPlayers = Number(qs('#mbbSlots')?.value || '32');
      if (!name) {
        notify('Preenche o nome da batalha.', 'error');
        return;
      }
      await apiFetch('/api/batalha-bonus/admin/create', {
        method: 'POST',
        body: JSON.stringify({ name, maxPlayers })
      });
      notify('Batalha criada.', 'ok');
      await refresh();
    } catch (e) {
      notify(e.message || 'Erro ao criar batalha.', 'error');
    }
  }

  async function finalizeBattle() {
    try {
      await apiFetch('/api/batalha-bonus/admin/finalize', { method: 'POST', body: '{}' });
      notify('Batalha finalizada.', 'ok');
      await refresh();
    } catch (e) {
      notify(e.message || 'Erro ao finalizar batalha.', 'error');
    }
  }

  function startPolling() {
    stopPolling();
    poll = setInterval(() => {
      const current = document.querySelector('.nav-btn.active')?.dataset.tab;
      const activeInsideBoard = !!document.activeElement?.closest?.('#mbbBattleStage');
      if (current !== 'batalha-bonus' || activeInsideBoard) return;
      refresh().catch(() => {});
    }, 4500);
  }

  function stopPolling() {
    if (poll) {
      clearInterval(poll);
      poll = null;
    }
  }

  function onTabShown() {
    ensureUI();
    refresh().catch(() => {});
    startPolling();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else startPolling();
  });

  window.BatalhaBonusAdmin = { refresh, onTabShown };

  if (!initialized) {
    initialized = true;
    ensureUI();
  }
})();
