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
    if (!res.ok) {
      let err = null;
      try { err = await res.json(); } catch {}
      throw new Error(err?.error || `HTTP ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  }

  function notify(msg, type = 'ok') {
    if (typeof window.notify === 'function') return window.notify(msg, type);
    alert(String(msg || ''));
  }

  const esc = (s = '') => String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const brl = (cents = 0) => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const toReaisInput = (cents = 0) => {
    const n = Number(cents || 0) / 100;
    return Number.isFinite(n) ? String(n).replace('.', ',') : '0';
  };
  const fromReaisInput = (value) => {
    const s = String(value || '').trim().replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  };

  let state = null;
  let initialized = false;
  let poll = null;

  function ensureUI() {
    const tab = qs('#tab-batalha-bonus');
    if (!tab) return null;
    if (qs('#bbRoot', tab)) return tab;

    tab.innerHTML = `
      <div id="bbRoot" class="bb-root">
        <div class="card bb-card">
          <div class="bb-top">
            <div>
              <h2 class="bb-title">Batalha bônus</h2>
              <div id="bbStatusText" class="bb-status-text">Nenhuma batalha ativa.</div>
            </div>
            <div class="bb-actions">
              <button class="btn btn--primary" id="bbRefreshBtn">Atualizar</button>
              <button class="btn" id="bbOpenRegBtn">Abrir inscrições</button>
              <button class="btn" id="bbCloseRegBtn">Fechar inscrições</button>
              <button class="btn" id="bbOpenChoicesBtn">Abrir escolhas</button>
              <button class="btn" id="bbCloseChoicesBtn">Fechar escolhas</button>
              <button class="btn" id="bbNextRoundBtn">Próxima fase</button>
              <button class="btn btn--danger" id="bbFinishBtn">Finalizar</button>
            </div>
          </div>
          <div class="bb-pills" id="bbPills"></div>
        </div>

        <div class="card bb-card" id="bbCreateCard">
          <div class="bb-top">
            <div>
              <h3 class="bb-subtitle">Criar batalha</h3>
              <div class="bb-muted">Limite configurado até 32 jogadores.</div>
            </div>
            <button class="btn btn--primary" id="bbCreateBtn">Criar batalha</button>
          </div>
          <div class="bb-form-grid">
            <div>
              <label class="bb-label">Nome</label>
              <input id="bbName" class="input" placeholder="Batalha da madrugada">
            </div>
            <div>
              <label class="bb-label">Vagas</label>
              <select id="bbSlots" class="input">
                <option value="8">8</option>
                <option value="16">16</option>
                <option value="32" selected>32</option>
              </select>
            </div>
            <div>
              <label class="bb-label">Comando de entrada</label>
              <input id="bbEntryCommand" class="input" placeholder="!batalha" value="!batalha">
            </div>
          </div>
        </div>

        <div class="bb-grid">
          <div class="card bb-card">
            <div class="bb-section-head">
              <h3 class="bb-subtitle">Participantes</h3>
              <span id="bbParticipantsCount" class="bb-chip">0</span>
            </div>
            <div id="bbParticipants" class="bb-list bb-list--table"></div>
          </div>

          <div class="card bb-card">
            <div class="bb-section-head">
              <h3 class="bb-subtitle">Confrontos da fase</h3>
              <span id="bbRoundName" class="bb-chip">—</span>
            </div>
            <div id="bbMatches" class="bb-matches"></div>
          </div>
        </div>

        <div class="card bb-card">
          <div class="bb-section-head">
            <h3 class="bb-subtitle">Histórico</h3>
            <span id="bbHistoryCount" class="bb-chip">0</span>
          </div>
          <div id="bbHistory" class="bb-history"></div>
        </div>
      </div>
    `;

    qs('#bbRefreshBtn', tab)?.addEventListener('click', () => refresh());
    qs('#bbCreateBtn', tab)?.addEventListener('click', createBattle);
    qs('#bbOpenRegBtn', tab)?.addEventListener('click', () => runAction('/api/batalha-bonus/admin/open-registration', 'Inscrições abertas.'));
    qs('#bbCloseRegBtn', tab)?.addEventListener('click', () => runAction('/api/batalha-bonus/admin/close-registration', 'Inscrições fechadas.'));
    qs('#bbOpenChoicesBtn', tab)?.addEventListener('click', () => runAction('/api/batalha-bonus/admin/open-choices', 'Escolhas abertas.'));
    qs('#bbCloseChoicesBtn', tab)?.addEventListener('click', () => runAction('/api/batalha-bonus/admin/close-choices', 'Escolhas fechadas.'));
    qs('#bbNextRoundBtn', tab)?.addEventListener('click', () => runAction('/api/batalha-bonus/admin/next-round', 'Próxima fase criada.'));
    qs('#bbFinishBtn', tab)?.addEventListener('click', () => runAction('/api/batalha-bonus/admin/finalize', 'Batalha finalizada.'));

    tab.addEventListener('click', async (ev) => {
      const btn = ev.target.closest('[data-bb-action]');
      if (!btn) return;
      const action = btn.dataset.bbAction;
      const matchId = btn.dataset.matchId;
      if (!action || !matchId) return;

      const card = btn.closest('[data-match-card="1"]');
      const valueA = fromReaisInput(qs('[data-role="valueA"]', card)?.value || '0');
      const valueB = fromReaisInput(qs('[data-role="valueB"]', card)?.value || '0');

      if (action === 'auto') {
        await saveMatch(matchId, { valueA, valueB, winnerMode: 'auto' });
        return;
      }

      if (action === 'manualA') {
        await saveMatch(matchId, { valueA, valueB, winnerMode: 'manual', winnerPlayerId: btn.dataset.playerId });
        return;
      }

      if (action === 'manualB') {
        await saveMatch(matchId, { valueA, valueB, winnerMode: 'manual', winnerPlayerId: btn.dataset.playerId });
      }
    });

    return tab;
  }

  function statusLabel(status) {
    const map = {
      DRAFT: 'Rascunho',
      REGISTRATION_OPEN: 'Inscrições abertas',
      REGISTRATION_CLOSED: 'Inscrições fechadas',
      CHOICES_OPEN: 'Escolhas abertas',
      CHOICES_CLOSED: 'Escolhas fechadas',
      ROUND_RESOLVED: 'Fase resolvida',
      FINISHED: 'Finalizada'
    };
    return map[String(status || '').toUpperCase()] || (status || '—');
  }

  function setButtons() {
    const battle = state?.battle || null;
    const status = String(battle?.status || '');
    const setDisabled = (id, disabled) => { const el = qs(id); if (el) el.disabled = !!disabled; };
    setDisabled('#bbOpenRegBtn', !battle || status !== 'DRAFT');
    setDisabled('#bbCloseRegBtn', !battle || status !== 'REGISTRATION_OPEN');
    setDisabled('#bbOpenChoicesBtn', !battle || status !== 'REGISTRATION_CLOSED');
    setDisabled('#bbCloseChoicesBtn', !battle || status !== 'CHOICES_OPEN');
    setDisabled('#bbNextRoundBtn', !battle || status !== 'ROUND_RESOLVED');
    setDisabled('#bbFinishBtn', !battle || status === 'FINISHED');
    const createCard = qs('#bbCreateCard');
    if (createCard) createCard.style.display = battle ? 'none' : '';
  }

  function renderHeader() {
    const battle = state?.battle || null;
    const counts = state?.counts || { filled: 0, maxPlayers: 0, alive: 0, resolvedCurrentMatches: 0, totalCurrentMatches: 0 };
    const statusText = qs('#bbStatusText');
    const pills = qs('#bbPills');
    if (!battle) {
      if (statusText) statusText.textContent = 'Nenhuma batalha ativa.';
      if (pills) pills.innerHTML = '';
      setButtons();
      return;
    }

    if (statusText) {
      statusText.textContent = `${battle.name} • ${statusLabel(battle.status)} • ${battle.currentRoundName || '—'}`;
    }

    if (pills) {
      pills.innerHTML = `
        <span class="bb-pill">Comando: <strong>${esc(battle.entryCommand)}</strong></span>
        <span class="bb-pill">Vagas: <strong>${counts.filled}/${battle.maxPlayers}</strong></span>
        <span class="bb-pill">Vivos: <strong>${counts.alive}</strong></span>
        <span class="bb-pill">Resolvidos: <strong>${counts.resolvedCurrentMatches}/${counts.totalCurrentMatches}</strong></span>
        <span class="bb-pill">Fase: <strong>${esc(battle.currentRoundName || '—')}</strong></span>
      `;
    }

    setButtons();
  }

  function renderParticipants() {
    const wrap = qs('#bbParticipants');
    const countEl = qs('#bbParticipantsCount');
    const list = state?.participants || [];
    if (countEl) countEl.textContent = String(list.length);
    if (!wrap) return;
    if (!list.length) {
      wrap.innerHTML = '<div class="bb-empty">Sem participantes.</div>';
      return;
    }

    wrap.innerHTML = `
      <div class="bb-row bb-row--head">
        <span>#</span>
        <span>Nick</span>
        <span>Status</span>
      </div>
      ${list.map((p) => `
        <div class="bb-row">
          <span>${p.joinOrder}</span>
          <span>${esc(p.displayName || p.twitchName)}</span>
          <span>${p.isActive ? 'Vivo' : `Eliminado${p.eliminatedRound ? ` R${p.eliminatedRound}` : ''}`}</span>
        </div>
      `).join('')}
    `;
  }

  function renderMatches() {
    const wrap = qs('#bbMatches');
    const roundNameEl = qs('#bbRoundName');
    const battle = state?.battle || null;
    const matches = state?.currentMatches || [];
    if (roundNameEl) roundNameEl.textContent = battle?.currentRoundName || '—';
    if (!wrap) return;
    if (!battle) {
      wrap.innerHTML = '<div class="bb-empty">Crie uma batalha.</div>';
      return;
    }
    if (!matches.length) {
      wrap.innerHTML = '<div class="bb-empty">Ainda não existem confrontos para a fase atual.</div>';
      return;
    }

    wrap.innerHTML = matches.map((m) => {
      const aWinner = m.winnerPlayerId && m.winnerPlayerId === m.playerAId;
      const bWinner = m.winnerPlayerId && m.winnerPlayerId === m.playerBId;
      return `
        <div class="bb-match-card" data-match-card="1">
          <div class="bb-match-head">
            <strong>Confronto ${m.matchNumber}</strong>
            <span class="bb-chip">${m.status === 'RESOLVED' ? 'Resolvido' : 'Pendente'}</span>
          </div>
          <div class="bb-player ${aWinner ? 'is-winner' : ''}">
            <div class="bb-player-top">
              <strong>${esc(m.playerADisplay || m.playerAName || 'Jogador A')}</strong>
              <span>${esc(m.bonusA || 'Sem bônus')}</span>
            </div>
            <input class="input" data-role="valueA" placeholder="Valor A" value="${esc(toReaisInput(m.valueA))}">
            <button class="btn ${aWinner ? 'btn--primary' : ''}" data-bb-action="manualA" data-match-id="${m.id}" data-player-id="${m.playerAId}">Vencedor A</button>
          </div>
          <div class="bb-vs">VS</div>
          <div class="bb-player ${bWinner ? 'is-winner' : ''}">
            <div class="bb-player-top">
              <strong>${esc(m.playerBDisplay || m.playerBName || 'Jogador B')}</strong>
              <span>${esc(m.bonusB || 'Sem bônus')}</span>
            </div>
            <input class="input" data-role="valueB" placeholder="Valor B" value="${esc(toReaisInput(m.valueB))}">
            <button class="btn ${bWinner ? 'btn--primary' : ''}" data-bb-action="manualB" data-match-id="${m.id}" data-player-id="${m.playerBId}">Vencedor B</button>
          </div>
          <div class="bb-match-actions">
            <button class="btn btn--primary" data-bb-action="auto" data-match-id="${m.id}">Definir automático</button>
            <div class="bb-match-result">${m.winnerName ? `Vencedor: ${esc(m.winnerName)} • ${brl(Math.max(m.valueA, m.valueB))}` : 'Aguardando resultado'}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderHistory() {
    const wrap = qs('#bbHistory');
    const countEl = qs('#bbHistoryCount');
    const matches = state?.matches || [];
    if (countEl) countEl.textContent = String(matches.length);
    if (!wrap) return;
    if (!matches.length) {
      wrap.innerHTML = '<div class="bb-empty">Sem histórico ainda.</div>';
      return;
    }
    wrap.innerHTML = matches.map((m) => `
      <div class="bb-history-row">
        <span>R${m.roundNumber} • ${esc(m.roundName || 'Fase')}</span>
        <span>${esc(m.playerAName || 'A')} (${esc(m.bonusA || '—')}) ${brl(m.valueA)} x ${brl(m.valueB)} ${esc(m.playerBName || 'B')} (${esc(m.bonusB || '—')})</span>
        <strong>${esc(m.winnerName || '—')}</strong>
      </div>
    `).join('');
  }

  function render() {
    renderHeader();
    renderParticipants();
    renderMatches();
    renderHistory();
  }

  async function refresh() {
    ensureUI();
    const res = await apiFetch('/api/batalha-bonus/admin/state');
    state = res?.state || null;
    render();
  }

  async function createBattle() {
    try {
      const name = qs('#bbName')?.value?.trim() || '';
      const maxPlayers = Number(qs('#bbSlots')?.value || '32');
      const entryCommand = qs('#bbEntryCommand')?.value?.trim() || '!batalha';
      if (!name) {
        notify('Preencha o nome da batalha.', 'error');
        return;
      }
      await apiFetch('/api/batalha-bonus/admin/create', {
        method: 'POST',
        body: JSON.stringify({ name, maxPlayers, entryCommand })
      });
      notify('Batalha criada.', 'ok');
      await refresh();
    } catch (e) {
      notify(e.message || 'Erro ao criar batalha.', 'error');
    }
  }

  async function runAction(path, okMsg) {
    try {
      await apiFetch(path, { method: 'POST', body: '{}' });
      if (okMsg) notify(okMsg, 'ok');
      await refresh();
    } catch (e) {
      notify(e.message || 'Erro na ação.', 'error');
    }
  }

  async function saveMatch(matchId, payload) {
    try {
      await apiFetch(`/api/batalha-bonus/admin/matches/${encodeURIComponent(matchId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      notify('Confronto atualizado.', 'ok');
      await refresh();
    } catch (e) {
      if (String(e.message || '') === 'empate_manual') {
        notify('Empate. Escolhe o vencedor manualmente.', 'error');
        return;
      }
      notify(e.message || 'Erro ao salvar confronto.', 'error');
    }
  }

  function startPolling() {
    stopPolling();
    poll = setInterval(() => {
      const current = document.querySelector('.nav-btn.active')?.dataset.tab;
      if (current !== 'batalha-bonus') return;
      refresh().catch(() => {});
    }, 5000);
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

  window.BatalhaBonusAdmin = {
    refresh,
    onTabShown
  };

  if (!initialized) {
    initialized = true;
    ensureUI();
  }
})();
