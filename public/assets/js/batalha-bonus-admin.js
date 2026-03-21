(() => {
  const API = window.location.origin;
  const qs = (s, r = document) => r.querySelector(s);

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

  const brl = (cents = 0) => (Number(cents || 0) / 100).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });

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

  function statusLabel(status) {
    const s = String(status || '').toUpperCase();
    if (s === 'ACTIVE') return 'Batalha ativa';
    if (s === 'FINISHED') return 'Batalha finalizada';
    return s || '—';
  }

  function roundGlowClass(roundName = '') {
    const s = String(roundName || '').toLowerCase();
    if (s.includes('top 32')) return 'is-top32';
    if (s.includes('oitavas')) return 'is-oitavas';
    if (s.includes('quartas')) return 'is-quartas';
    if (s.includes('semi')) return 'is-semi';
    if (s.includes('final')) return 'is-final';
    return 'is-default';
  }

  let state = null;
  let poll = null;
  let initialized = false;

  function ensureUI() {
    const tab = qs('#tab-batalha-bonus');
    if (!tab) return null;
    if (qs('#mbbRoot', tab)) return tab;

    tab.innerHTML = `
      <div id="mbbRoot" class="mbb-root">
        <section id="mbbCreateStage" class="mbb-create-stage">
          <div class="mbb-create-backdrop"></div>
          <div class="mbb-create-grid">
            <div class="mbb-intro-card">
              <span class="mbb-kicker">BATALHA BÔNUS MANUAL</span>
              <h2 class="mbb-main-title">Cria a chave completa e controla tudo dentro do site.</h2>
              <p class="mbb-main-copy">Sem Twitch, sem planilha, sem histórico separado. Tu monta os confrontos, escreve nome, bônus, valor e escolhe win ou lose direto na estrutura da batalha.</p>
              <div class="mbb-intro-pills">
                <span>8 vagas</span>
                <span>16 vagas</span>
                <span>32 vagas</span>
                <span>Brackets automáticos</span>
                <span>Manual total</span>
              </div>
            </div>

            <div class="mbb-create-card">
              <div class="mbb-create-glow"></div>
              <div class="mbb-create-inner">
                <div class="mbb-card-head">
                  <div class="mbb-card-icon">⚔️</div>
                  <div>
                    <h3>Criar batalha</h3>
                    <p>Escolhe o nome e o tamanho da chave.</p>
                  </div>
                </div>
                <label class="mbb-field">
                  <span>Nome da batalha</span>
                  <input id="mbbName" class="mbb-input" placeholder="Batalha da madrugada">
                </label>
                <label class="mbb-field">
                  <span>Vagas</span>
                  <select id="mbbSlots" class="mbb-input">
                    <option value="8">8 jogadores</option>
                    <option value="16">16 jogadores</option>
                    <option value="32" selected>32 jogadores</option>
                  </select>
                </label>
                <button id="mbbCreateBtn" class="mbb-btn mbb-btn--primary">Criar batalha</button>
              </div>
            </div>
          </div>
        </section>

        <section id="mbbBattleStage" class="mbb-battle-stage" style="display:none;">
          <div class="mbb-hero">
            <div class="mbb-hero-orb mbb-hero-orb--one"></div>
            <div class="mbb-hero-orb mbb-hero-orb--two"></div>
            <div class="mbb-hero-top">
              <div>
                <span class="mbb-kicker" id="mbbHeroKicker">BATALHA ATIVA</span>
                <h2 id="mbbBattleName" class="mbb-battle-name">Batalha bônus</h2>
                <p id="mbbBattleSubtitle" class="mbb-battle-subtitle">Controle manual completo</p>
              </div>
              <div class="mbb-hero-actions">
                <button class="mbb-btn mbb-btn--ghost" data-mbb-action="refresh">Atualizar</button>
                <button id="mbbFinalizeBtn" class="mbb-btn mbb-btn--danger" data-mbb-action="finalize">Finalizar batalha</button>
              </div>
            </div>
            <div id="mbbStats" class="mbb-stats"></div>
            <div id="mbbChampionWrap" class="mbb-champion-wrap"></div>
          </div>

          <div class="mbb-board-wrap">
            <div id="mbbRounds" class="mbb-rounds"></div>
          </div>
        </section>
      </div>
    `;

    qs('#mbbCreateBtn', tab)?.addEventListener('click', createBattle);

    tab.addEventListener('change', (ev) => {
      const select = ev.target.closest('[data-role="result"]');
      if (!select) return;
      const card = select.closest('[data-match-card="1"]');
      if (!card) return;
      const side = select.dataset.side;
      const other = qs(`[data-role="result"][data-side="${side === 'A' ? 'B' : 'A'}"]`, card);
      if (select.value === 'WIN' && other) other.value = 'LOSE';
    });

    tab.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-mbb-action]');
      if (!btn) return;
      const action = btn.dataset.mbbAction;

      if (action === 'refresh') {
        await refresh();
        return;
      }

      if (action === 'finalize') {
        await finalizeBattle();
        return;
      }

      if (action === 'save-match') {
        const card = btn.closest('[data-match-card="1"]');
        if (!card) return;
        const matchId = card.dataset.matchId;
        await saveMatch(matchId, readCardPayload(card));
      }
    });

    return tab;
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

  function render() {
    const hasBattle = !!state?.battle;
    const createStage = qs('#mbbCreateStage');
    const battleStage = qs('#mbbBattleStage');
    if (createStage) createStage.style.display = hasBattle ? 'none' : '';
    if (battleStage) battleStage.style.display = hasBattle ? '' : 'none';
    if (!hasBattle) return;
    renderHero();
    renderRounds();
  }

  function renderHero() {
    const battle = state?.battle || null;
    const counts = state?.counts || {};
    if (!battle) return;

    const filled = Number(counts.filledSlots || 0);
    const maxPlayers = Number(counts.maxPlayers || battle.maxPlayers || 0);
    const resolvedMatches = Number(counts.resolvedMatches || 0);
    const totalMatches = Number(counts.totalMatches || 0);
    const remainingMatches = Number(counts.remainingMatches || Math.max(0, totalMatches - resolvedMatches));

    const battleName = qs('#mbbBattleName');
    const battleSubtitle = qs('#mbbBattleSubtitle');
    const heroKicker = qs('#mbbHeroKicker');
    const stats = qs('#mbbStats');
    const championWrap = qs('#mbbChampionWrap');
    const finalizeBtn = qs('#mbbFinalizeBtn');

    if (battleName) battleName.textContent = battle.name || 'Batalha bônus';
    if (battleSubtitle) battleSubtitle.textContent = `${statusLabel(battle.status)} • ${battle.currentRoundName || 'Estrutura pronta'}`;
    if (heroKicker) heroKicker.textContent = battle.status === 'FINISHED' ? 'FINALIZADA' : 'MANUAL TOTAL';

    if (stats) {
      stats.innerHTML = `
        <div class="mbb-stat-card">
          <span>Vagas preenchidas</span>
          <strong>${filled}/${maxPlayers}</strong>
          <small>${Math.max(0, maxPlayers - filled)} restantes</small>
        </div>
        <div class="mbb-stat-card">
          <span>Confrontos resolvidos</span>
          <strong>${resolvedMatches}/${totalMatches}</strong>
          <small>${remainingMatches} pendentes</small>
        </div>
        <div class="mbb-stat-card">
          <span>Fase atual</span>
          <strong>${esc(battle.currentRoundName || '—')}</strong>
          <small>Estrutura completa visível</small>
        </div>
      `;
    }

    if (championWrap) {
      championWrap.innerHTML = battle.championName
        ? `<div class="mbb-champion-card"><span>🏆 Campeão atual</span><strong>${esc(battle.championName)}</strong></div>`
        : `<div class="mbb-champion-card is-empty"><span>🏆 Campeão atual</span><strong>Aguardando final</strong></div>`;
    }

    if (finalizeBtn) finalizeBtn.disabled = battle.status === 'FINISHED' || !battle.championName;
  }

  function renderRounds() {
    const roundsWrap = qs('#mbbRounds');
    if (!roundsWrap) return;
    const rounds = state?.rounds || [];
    const battleFinished = String(state?.battle?.status || '').toUpperCase() === 'FINISHED';

    if (!rounds.length) {
      roundsWrap.innerHTML = '<div class="mbb-empty">Nenhuma estrutura encontrada.</div>';
      return;
    }

    roundsWrap.innerHTML = rounds.map((round) => {
      const resolved = Number(round.resolvedMatches || 0);
      const total = Number(round.totalMatches || 0);
      return `
        <section class="mbb-round ${roundGlowClass(round.roundName)}">
          <div class="mbb-round-head">
            <div>
              <span class="mbb-round-kicker">Fase ${round.roundNumber}</span>
              <h3>${esc(round.roundName || 'Fase')}</h3>
            </div>
            <div class="mbb-round-badge">${resolved}/${total}</div>
          </div>

          <div class="mbb-round-list">
            ${round.matches.map((match) => {
              const winnerSide = String(match.winnerSide || '').toUpperCase();
              const isAWin = winnerSide === 'A';
              const isBWin = winnerSide === 'B';
              const disabled = battleFinished ? 'disabled' : '';
              return `
                <article class="mbb-match-card ${winnerSide ? 'is-resolved' : ''}" data-match-card="1" data-match-id="${esc(match.id)}">
                  <div class="mbb-match-head">
                    <div>
                      <span class="mbb-match-label">Confronto ${match.matchNumber}</span>
                      <strong>${esc(round.roundName || 'Fase')}</strong>
                    </div>
                    <div class="mbb-match-score">${brl(match.valueA)} <span>vs</span> ${brl(match.valueB)}</div>
                  </div>

                  <div class="mbb-player ${isAWin ? 'is-win' : ''}">
                    <div class="mbb-player-side">A</div>
                    <div class="mbb-fields">
                      <input class="mbb-input" data-role="playerAName" placeholder="Nome do jogador" value="${esc(match.playerAName || '')}" ${disabled}>
                      <input class="mbb-input" data-role="bonusA" placeholder="Nome do bônus" value="${esc(match.bonusA || '')}" ${disabled}>
                    </div>
                    <div class="mbb-mini-fields">
                      <input class="mbb-input" data-role="valueA" placeholder="0,00" value="${esc(toReaisInput(match.valueA))}" ${disabled}>
                      <select class="mbb-select ${isAWin ? 'is-win' : ''}" data-role="result" data-side="A" ${disabled}>
                        <option value="LOSE" ${match.resultA === 'LOSE' ? 'selected' : ''}>LOSE</option>
                        <option value="WIN" ${match.resultA === 'WIN' ? 'selected' : ''}>WIN</option>
                      </select>
                    </div>
                  </div>

                  <div class="mbb-versus">VS</div>

                  <div class="mbb-player ${isBWin ? 'is-win' : ''}">
                    <div class="mbb-player-side">B</div>
                    <div class="mbb-fields">
                      <input class="mbb-input" data-role="playerBName" placeholder="Nome do jogador" value="${esc(match.playerBName || '')}" ${disabled}>
                      <input class="mbb-input" data-role="bonusB" placeholder="Nome do bônus" value="${esc(match.bonusB || '')}" ${disabled}>
                    </div>
                    <div class="mbb-mini-fields">
                      <input class="mbb-input" data-role="valueB" placeholder="0,00" value="${esc(toReaisInput(match.valueB))}" ${disabled}>
                      <select class="mbb-select ${isBWin ? 'is-win' : ''}" data-role="result" data-side="B" ${disabled}>
                        <option value="LOSE" ${match.resultB === 'LOSE' ? 'selected' : ''}>LOSE</option>
                        <option value="WIN" ${match.resultB === 'WIN' ? 'selected' : ''}>WIN</option>
                      </select>
                    </div>
                  </div>

                  <div class="mbb-match-footer">
                    <div class="mbb-pathing">
                      ${match.nextRoundNumber ? `<span>Avança para ${esc((state.rounds || []).find((r) => r.roundNumber === match.nextRoundNumber)?.roundName || `Fase ${match.nextRoundNumber}`)}</span>` : `<span>Decide o campeão</span>`}
                    </div>
                    <button class="mbb-btn mbb-btn--save" data-mbb-action="save-match" ${disabled}>Salvar confronto</button>
                  </div>
                </article>
              `;
            }).join('')}
          </div>
        </section>
      `;
    }).join('');
  }

  async function refresh() {
    ensureUI();
    const res = await apiFetch('/api/batalha-bonus/admin/state');
    state = res?.state || null;
    render();
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

  async function saveMatch(matchId, payload) {
    try {
      await apiFetch(`/api/batalha-bonus/admin/matches/${encodeURIComponent(matchId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      notify('Confronto salvo.', 'ok');
      await refresh();
    } catch (e) {
      if (String(e.message || '') === 'duplo_win') {
        notify('Só um lado pode ficar com WIN.', 'error');
        return;
      }
      notify(e.message || 'Erro ao salvar confronto.', 'error');
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
      if (current !== 'batalha-bonus') return;
      refresh().catch(() => {});
    }, 4000);
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
