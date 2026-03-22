(() => {
  const API = window.location.origin;
  const qs = (s, r = document) => r.querySelector(s);
  const LOCAL_VIEW_KEY = 'mbb:viewOpen';
  const LOCAL_ACTIVE_KEY = 'mbb:activeBattleId';

  let forceBracketView = false;

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

  function extractMoneyDigits(value) {
    return String(value || '').replace(/\D/g, '').slice(0, 9);
  }

  function formatMoneyDigits(digits, allowEmpty = false) {
    const clean = extractMoneyDigits(digits);
    if (!clean) return allowEmpty ? '' : '0,00';
    return toReaisInput(Number(clean));
  }

  function applyMoneyMask(input, { allowEmpty = false } = {}) {
    if (!input) return;
    const digits = extractMoneyDigits(input.value);
    input.dataset.moneyDigits = digits;
    input.value = formatMoneyDigits(digits, allowEmpty);
  }

  function fromReaisInput(value) {
    const digits = extractMoneyDigits(value);
    if (digits) return Number(digits);
    const s = String(value || '').trim().replace(/\./g, '').replace(',', '.');
    const n = Number(s);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.round(n * 100);
  }

  function toBrlLabel(cents = 0) {
    const value = Math.max(0, Number(cents || 0)) / 100;
    return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function maskPixKey(value = '') {
    const raw = String(value || '').trim();
    if (!raw) return '—';
    if (raw.length <= 8) return raw;
    return `${raw.slice(0, 4)}••••${raw.slice(-4)}`;
  }

  function championStatusLabel(status = '') {
    const s = String(status || '').toUpperCase();
    if (s === 'APROVADO') return 'Aprovado';
    if (s === 'REPROVADO') return 'Reprovado';
    if (s === 'PENDENTE') return 'Pendente';
    return 'Sem print';
  }

  async function copyToClipboard(textToCopy, okMessage) {
    const value = String(textToCopy || '').trim();
    if (!value) {
      notify('Nada para copiar.', 'error');
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      notify(okMessage || 'Copiado.', 'ok');
    } catch {
      notify('Não consegui copiar automaticamente.', 'error');
    }
  }

  function readCardPayload(card) {
    const valueAInput = qs('[data-role="valueA"]', card)?.value || '';
    const valueBInput = qs('[data-role="valueB"]', card)?.value || '';
    return {
      playerAName: qs('[data-role="playerAName"]', card)?.value?.trim() || '',
      bonusA: qs('[data-role="bonusA"]', card)?.value?.trim() || '',
      valueA: fromReaisInput(valueAInput),
      valueADisplay: valueAInput,
      resultA: qs('[data-role="result"][data-side="A"]', card)?.value || 'LOSE',
      playerBName: qs('[data-role="playerBName"]', card)?.value?.trim() || '',
      bonusB: qs('[data-role="bonusB"]', card)?.value?.trim() || '',
      valueB: fromReaisInput(valueBInput),
      valueBDisplay: valueBInput,
      resultB: qs('[data-role="result"][data-side="B"]', card)?.value || 'LOSE'
    };
  }

  function getMatchIdFromCard(card) {
    return String(card?.dataset.matchId || '');
  }

  function rememberDraft(card) {
    const matchId = getMatchIdFromCard(card);
    if (!matchId) return;
    draftMatches.set(matchId, readCardPayload(card));
  }

  function getRenderedMatch(match) {
    const draft = draftMatches.get(String(match?.id || ''));
    if (!draft) return match;
    return {
      ...match,
      playerAName: draft.playerAName,
      bonusA: draft.bonusA,
      valueA: draft.valueA,
      valueADisplay: draft.valueADisplay,
      resultA: draft.resultA,
      playerBName: draft.playerBName,
      bonusB: draft.bonusB,
      valueB: draft.valueB,
      valueBDisplay: draft.valueBDisplay,
      resultB: draft.resultB,
      winnerSide:
        draft.resultA === 'WIN' ? 'A'
        : draft.resultB === 'WIN' ? 'B'
        : null
    };
  }

  function bindDelegatedEvents() {
    if (delegatedBound) return;
    delegatedBound = true;

    document.addEventListener('click', async (ev) => {
      const inside = ev.target.closest('#mbbBattleStage, #mbbFullscreenOverlay, #tab-batalha-bonus');
      if (!inside) return;

      const btn = ev.target.closest('[data-mbb-action]');
      if (!btn) return;

      if (btn.dataset.mbbAction === 'finalize') {
        await finalizeBattle();
        return;
      }

      if (btn.dataset.mbbAction === 'back') {
        setBoardOpen(false);
        renderBattle();
        return;
      }

      if (btn.dataset.mbbAction === 'toggle-champion-view') {
        forceBracketView = !forceBracketView;
        renderBattle();
        return;
      }

      
    });

    document.addEventListener('focusin', (ev) => {
      const target = ev.target;
      if (!target.closest('#mbbBattleStage')) return;
      if (!target.matches('[data-role^="value"]')) return;
      requestAnimationFrame(() => target.select());
    });

    document.addEventListener('change', (ev) => {
      const target = ev.target;
      if (!target.closest('#mbbBattleStage')) return;

      const card = target.closest('[data-match-card="1"]');
      if (!card) return;

      if (target.matches('[data-role="result"]')) {
        const side = target.dataset.side;
        const other = qs(`[data-role="result"][data-side="${side === 'A' ? 'B' : 'A'}"]`, card);
        if (target.value === 'WIN' && other) other.value = 'LOSE';
        rememberDraft(card);
        scheduleSave(card, 50);
        return;
      }

      if (target.matches('[data-role^="value"]')) {
        applyMoneyMask(target, { allowEmpty: false });
        rememberDraft(card);
        scheduleSave(card, 120);
        return;
      }

      if (target.matches('[data-role^="player"], [data-role^="bonus"]')) {
        rememberDraft(card);
        scheduleSave(card, 180);
      }
    });

    document.addEventListener('input', (ev) => {
      const target = ev.target;
      if (!target.closest('#mbbBattleStage')) return;

      const card = target.closest('[data-match-card="1"]');
      if (!card) return;

      if (target.matches('[data-role^="value"]')) {
        applyMoneyMask(target, { allowEmpty: true });
        rememberDraft(card);
        markCardState(card, 'pending');
        scheduleSave(card, 420);
        return;
      }

      if (target.matches('[data-role^="player"], [data-role^="bonus"]')) {
        rememberDraft(card);
        markCardState(card, 'pending');
        scheduleSave(card, 500);
      }
    });
  }

  function battleFinished() {
    return String(state?.battle?.status || '').toUpperCase() === 'FINISHED';
  }

  function shouldOpenBoard() {
    return localStorage.getItem(LOCAL_VIEW_KEY) === '1' && !!state?.battle;
  }

  function setBoardOpen(open) {
    if (open && state?.battle?.id) {
      localStorage.setItem(LOCAL_VIEW_KEY, '1');
      localStorage.setItem(LOCAL_ACTIVE_KEY, String(state.battle.id));
    } else {
      localStorage.removeItem(LOCAL_VIEW_KEY);
    }
  }

  let state = null;
  let poll = null;
  let initialized = false;
  let resizeBound = false;
  let delegatedBound = false;
  const saveTimers = new Map();
  const savingMatches = new Set();
  const draftMatches = new Map();

  function ensureUI() {
    const tab = qs('#tab-batalha-bonus');
    if (!tab) return null;
    if (qs('#mbbRoot', tab)) return tab;

    tab.innerHTML = `
      <div id="mbbRoot" class="mbb-root">
        <section id="mbbCreateStage" class="mbb-create-stage">
          <div class="mbb-create-shell">
            <div class="mbb-create-card">
              <div class="mbb-create-head">
                <div class="mbb-create-title-block">
                  <h2 class="mbb-create-title">Batalha de bônus</h2>
                  <p class="mbb-create-subtitle">Cria a batalha, escolhe as vagas e abre a chave no mesmo painel.</p>
                </div>
                <div class="mbb-create-badge">Painel ativo</div>
              </div>

              <div class="mbb-create-form">
                <label class="mbb-field">
                  <span>Nome da batalha</span>
                  <input id="mbbName" class="mbb-input" placeholder="Ex.: Batalha do Guigz">
                </label>
                <label class="mbb-field">
                  <span>Vagas</span>
                  <select id="mbbSlots" class="mbb-select">
                    <option value="8">8 vagas</option>
                    <option value="16">16 vagas</option>
                    <option value="32">32 vagas</option>
                  </select>
                </label>
                <label class="mbb-field">
                  <span>Premiação</span>
                  <input id="mbbPrize" class="mbb-input" inputmode="numeric" autocomplete="off" placeholder="0,00" value="0,00">
                </label>
                <button id="mbbCreateBtn" class="mbb-btn mbb-btn--primary">Criar batalha</button>
              </div>

              <div id="mbbActiveResume" class="mbb-active-resume" style="display:none">
                <div class="mbb-active-resume__text">
                  <span class="mbb-active-resume__dot"></span>
                  <div class="mbb-active-resume__stack">
                    <strong>Tem uma batalha ativa agora</strong>
                    <span>Abre a batalha atual e continua de onde parou.</span>
                  </div>
                </div>
                <button id="mbbGoActiveBtn" class="mbb-btn mbb-btn--ghost">Abrir batalha ativa</button>
              </div>
            </div>
          </div>
        </section>

        <section id="mbbBattleStage" class="mbb-battle-stage" style="display:none">
          <div class="mbb-board-header">
            <div class="mbb-board-brand">
              <div class="mbb-board-kicker">Batalha de bônus</div>
              <div class="mbb-board-title-line">
                <h2 id="mbbBattleTitle" class="mbb-board-title">Batalha</h2>
                <span id="mbbBattleStatus" class="mbb-status-pill">Ativa</span>
                <span id="mbbBattlePrize" class="mbb-prize-pill" style="display:none">Premiação R$ 0,00</span>
              </div>
            </div>
            <div class="mbb-board-actions">
              <button id="mbbChampionToggleBtn" class="mbb-btn mbb-btn--ghost" data-mbb-action="toggle-champion-view" style="display:none">Ver chave</button>
              <button id="mbbBackBtn" class="mbb-btn mbb-btn--ghost" data-mbb-action="back">Voltar</button>
              <button id="mbbFinalizeBtn" class="mbb-btn mbb-btn--danger" data-mbb-action="finalize">Finalizar batalha</button>
            </div>
          </div>
          <div class="mbb-bracket-wrap" id="mbbBracketWrap">
            <div class="mbb-bracket-stage" id="mbbBracketStage"></div>
          </div>
        </section>
      </div>
    `;

    qs('#mbbCreateBtn', tab)?.addEventListener('click', createBattle);

    const prizeInput = qs('#mbbPrize', tab);
    if (prizeInput) {
      applyMoneyMask(prizeInput, { allowEmpty: false });
      prizeInput.addEventListener('focus', () => requestAnimationFrame(() => prizeInput.select()));
      prizeInput.addEventListener('input', () => applyMoneyMask(prizeInput, { allowEmpty: true }));
      prizeInput.addEventListener('change', () => applyMoneyMask(prizeInput, { allowEmpty: false }));
      prizeInput.addEventListener('blur', () => applyMoneyMask(prizeInput, { allowEmpty: false }));
    }

    qs('#mbbGoActiveBtn', tab)?.addEventListener('click', async () => {
      try {
        await refresh();
      } catch {}
      setBoardOpen(true);
      window.scrollTo({ top: 0, behavior: 'auto' });
      requestAnimationFrame(() => renderBattle());
    });

    bindDelegatedEvents();

    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', () => {
        if (!qs('#mbbBattleStage') || !state?.battle) return;
        renderBattle();
      });
    }

    ensureOverlay();
    return tab;
  }

  function markCardState(card, kind) {
    if (!card) return;
    card.dataset.saveStateKind = kind || '';
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
    markCardState(card, 'saving');

    try {
      rememberDraft(card);
      const res = await apiFetch(`/api/batalha-bonus/admin/matches/${encodeURIComponent(matchId)}`, {
        method: 'PATCH',
        body: JSON.stringify(readCardPayload(card))
      });
      draftMatches.delete(matchId);
      state = res || state;
      renderBattle();
    } catch (e) {
      markCardState(card, 'error');
      if (String(e.message || '') === 'duplo_win') {
        notify('Só um lado pode ficar com WIN.', 'error');
      } else {
        notify(e.message || 'Erro ao salvar confronto.', 'error');
      }
    } finally {
      savingMatches.delete(matchId);
    }
  }

  function getBoardPreset(firstRoundCount) {
    if (firstRoundCount <= 4) {
      return { cardWidth: 520, cardHeight: 186, laneGap: 124, baseGap: 24, minScale: 0.88 };
    }
    if (firstRoundCount <= 8) {
      return { cardWidth: 500, cardHeight: 186, laneGap: 112, baseGap: 18, minScale: 0.76 };
    }
    return { cardWidth: 470, cardHeight: 176, laneGap: 96, baseGap: 12, minScale: 0.66 };
  }

  function computeBoardGeometry(rounds) {
    const firstRoundCount = Number(rounds?.[0]?.matches?.length || 0);
    const preset = getBoardPreset(firstRoundCount);
    const { cardWidth, cardHeight, laneGap, baseGap } = preset;
    const leftPadding = 36;
    const topPadding = 16;
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
      return { round, x, cards };
    });

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
      minScale: preset.minScale,
      totalWidth,
      totalHeight,
      roundMeta,
      lines
    };
  }

  function ensureOverlay() {
    let overlay = document.getElementById('mbbFullscreenOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'mbbFullscreenOverlay';
      overlay.innerHTML = '<div class="mbb-fullscreen-shell"></div>';
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function setBattleMode(enabled) {
    const overlay = ensureOverlay();
    const shell = overlay.querySelector('.mbb-fullscreen-shell');
    const root = qs('#mbbRoot');
    const battleStage = document.getElementById('mbbBattleStage');

    document.body.classList.toggle('mbb-battle-active', !!enabled);

    if (!battleStage || !root || !shell) return;

    if (enabled) {
      overlay.classList.add('is-open');
      if (battleStage.parentElement !== shell) shell.appendChild(battleStage);
      battleStage.style.display = 'flex';
      stopPolling();
      window.scrollTo({ top: 0, behavior: 'auto' });
    } else {
      overlay.classList.remove('is-open');
      if (battleStage.parentElement !== root) root.appendChild(battleStage);
      battleStage.style.display = 'none';
      startPolling();
    }
  }

  function renderBattle() {
    const createStage = qs('#mbbCreateStage');
    const activeResume = qs('#mbbActiveResume');
    const hasBattle = !!state?.battle;
    const boardOpen = hasBattle && shouldOpenBoard();
    const battleTitle = qs('#mbbBattleTitle');
    const battleStatus = qs('#mbbBattleStatus');
    const battlePrize = qs('#mbbBattlePrize');
    const championToggleBtn = qs('#mbbChampionToggleBtn');
    const championReady = !!state?.battle?.championName;
    const showChampionScreen = championReady && !forceBracketView;

    if (createStage) createStage.style.display = !boardOpen ? '' : 'none';
    if (activeResume) activeResume.style.display = hasBattle && !boardOpen ? 'flex' : 'none';
    if (battleTitle) battleTitle.textContent = state?.battle?.name || 'Batalha de bônus';
    if (battleStatus) battleStatus.textContent = battleFinished() ? 'Finalizada' : 'Ativa';
    if (battlePrize) {
      const cents = Number(state?.battle?.prizeCents || 0);
      battlePrize.style.display = cents > 0 ? '' : 'none';
      battlePrize.textContent = `Premiação ${toBrlLabel(cents)}`;
    }
    if (championToggleBtn) {
      championToggleBtn.style.display = championReady ? '' : 'none';
      championToggleBtn.textContent = showChampionScreen ? 'Ver chave' : 'Ver campeão';
    }

    setBattleMode(boardOpen);

    const battleStage = document.getElementById('mbbBattleStage');
    if (!boardOpen || !battleStage) return;

    const rounds = Array.isArray(state?.rounds) ? state.rounds : [];
    const stage = qs('#mbbBracketStage');
    const wrap = qs('#mbbBracketWrap');
    const finalizeBtn = qs('#mbbFinalizeBtn');

    if (!stage || !wrap) return;
    if (finalizeBtn) finalizeBtn.disabled = battleFinished() || !state?.battle?.championName;

    if (showChampionScreen) {
      wrap.classList.add('is-champion-view');
      stage.style.height = 'auto';
      stage.innerHTML = renderChampionScreen();
      return;
    }

    wrap.classList.remove('is-champion-view');

    if (!rounds.length) {
      stage.innerHTML = '<div class="mbb-empty">Nenhuma estrutura encontrada.</div>';
      return;
    }

    const geo = computeBoardGeometry(rounds);
    const availableWidth = Math.max(1040, wrap.clientWidth - 44);
    const widthScale = availableWidth / geo.totalWidth;
    const scale = Math.min(1, Math.max(geo.minScale, widthScale));
    const scaledHeight = Math.ceil(geo.totalHeight * scale) + 18;

    stage.style.height = `${scaledHeight}px`;
    stage.innerHTML = `
      <div class="mbb-board" style="width:${geo.totalWidth}px;height:${geo.totalHeight}px;transform:scale(${scale})">
        <svg class="mbb-board-lines" viewBox="0 0 ${geo.totalWidth} ${geo.totalHeight}" preserveAspectRatio="none">
          ${geo.lines.map((d) => `<path d="${d}" />`).join('')}
        </svg>
        ${geo.roundMeta.flatMap((meta) => meta.cards.map((card) => renderCard(card.match, card.x, card.y, geo.cardWidth, geo.cardHeight))).join('')}
      </div>
    `;
  }

  function renderChampionScreen() {
    const payout = state?.championPayout || null;
    const championName = payout?.championName || state?.battle?.championName || 'Campeão';
    const prizeCents = Number(payout?.amountCents ?? state?.battle?.prizeCents ?? 0);
    const status = String(payout?.status || '').toUpperCase();
    const approved = !!payout?.approved;
    const hasQr = !!payout?.qrCodeDataUrl;
    const statusClass = approved ? 'is-approved' : (status === 'REPROVADO' ? 'is-reproved' : (status === 'PENDENTE' ? 'is-pending' : 'is-empty'));
    const helper = approved
      ? 'Print aprovado e Pix pronto para pagamento.'
      : (status === 'REPROVADO'
        ? 'O último print foi reprovado. Ajusta no painel de prints antes de pagar.'
        : (status === 'PENDENTE'
          ? 'O print ainda está pendente. Aprova no painel de prints para liberar o Pix.'
          : 'Esse campeão ainda não tem print aprovado cadastrado.'));

    return `
      <section class="mbb-champion-screen">
        <div class="mbb-champion-card">
          <div class="mbb-champion-kicker">Campeão da batalha</div>
          <h3 class="mbb-champion-battle">${esc(state?.battle?.name || 'Batalha de bônus')}</h3>
          <div class="mbb-champion-name">${esc(championName)}</div>
          <div class="mbb-champion-row">
            <span class="mbb-champion-status ${statusClass}">${esc(championStatusLabel(status))}</span>
            <span class="mbb-champion-prize">Premiação ${esc(toBrlLabel(prizeCents))}</span>
          </div>
          <p class="mbb-champion-helper">${esc(helper)}</p>
          ${payout?.reason ? `<div class="mbb-champion-note">Motivo: <strong>${esc(payout.reason)}</strong></div>` : ''}
        </div>

        <div class="mbb-payout-card">
          <div class="mbb-payout-head">
            <strong>Pagamento Pix</strong>
            <span>${esc(payout?.pixType ? `Pix ${payout.pixType}` : 'Pix do print')}</span>
          </div>

          ${hasQr ? `
            <div class="mbb-payout-qr-wrap">
              <img class="mbb-payout-qr" src="${esc(payout.qrCodeDataUrl)}" alt="QR Code Pix">
            </div>
            
          ` : `
            <div class="mbb-payout-empty">
              <div class="mbb-payout-empty__title">QR Code ainda não liberado</div>
              <div class="mbb-payout-empty__text">${esc(helper)}</div>
            </div>
          `}
        </div>
      </section>
    `;
  }

  function renderCard(match, x, y, cardWidth, cardHeight) {
    const vm = getRenderedMatch(match);
    const winnerSide = String(vm.winnerSide || '').toUpperCase();
    const isAWin = winnerSide === 'A';
    const isBWin = winnerSide === 'B';
    const disabled = battleFinished() ? 'disabled' : '';

    return `
      <article class="mbb-match-card ${winnerSide ? 'is-resolved' : ''}" data-match-card="1" data-match-id="${esc(vm.id)}" style="left:${x}px;top:${y}px;width:${cardWidth}px;height:${cardHeight}px">
        <div class="mbb-side-row ${isAWin ? 'is-win' : ''}">
          <div class="mbb-player-stack">
            <input class="mbb-mini-input mbb-mini-input--name" data-role="playerAName" placeholder="Nome do jogador" value="${esc(vm.playerAName || '')}" ${disabled}>
            <input class="mbb-mini-input mbb-mini-input--bonus" data-role="bonusA" placeholder="Nome do bônus / jogo" value="${esc(vm.bonusA || '')}" ${disabled}>
          </div>
          <div class="mbb-side-controls">
            <select class="mbb-mini-select ${isAWin ? 'is-win' : ''}" data-role="result" data-side="A" ${disabled}>
              <option value="LOSE" ${vm.resultA === 'LOSE' ? 'selected' : ''}>LOSE</option>
              <option value="WIN" ${vm.resultA === 'WIN' ? 'selected' : ''}>WIN</option>
            </select>
            <input class="mbb-mini-input mbb-mini-input--value" data-role="valueA" inputmode="numeric" autocomplete="off" placeholder="0,00" value="${esc(vm.valueADisplay ?? toReaisInput(vm.valueA))}" ${disabled}>
          </div>
        </div>

        <div class="mbb-side-row ${isBWin ? 'is-win' : ''}">
          <div class="mbb-player-stack">
            <input class="mbb-mini-input mbb-mini-input--name" data-role="playerBName" placeholder="Nome do jogador" value="${esc(vm.playerBName || '')}" ${disabled}>
            <input class="mbb-mini-input mbb-mini-input--bonus" data-role="bonusB" placeholder="Nome do bônus / jogo" value="${esc(vm.bonusB || '')}" ${disabled}>
          </div>
          <div class="mbb-side-controls">
            <select class="mbb-mini-select ${isBWin ? 'is-win' : ''}" data-role="result" data-side="B" ${disabled}>
              <option value="LOSE" ${vm.resultB === 'LOSE' ? 'selected' : ''}>LOSE</option>
              <option value="WIN" ${vm.resultB === 'WIN' ? 'selected' : ''}>WIN</option>
            </select>
            <input class="mbb-mini-input mbb-mini-input--value" data-role="valueB" inputmode="numeric" autocomplete="off" placeholder="0,00" value="${esc(vm.valueBDisplay ?? toReaisInput(vm.valueB))}" ${disabled}>
          </div>
        </div>
      </article>
    `;
  }

  async function refresh() {
    ensureUI();
    const res = await apiFetch('/api/batalha-bonus/admin/state');
    state = res?.state || null;

    if (!state?.battle) {
      setBoardOpen(false);
      draftMatches.clear();
      forceBracketView = false;
      localStorage.removeItem(LOCAL_ACTIVE_KEY);
    } else {
      if (!state.battle.championName) forceBracketView = false;
      const remembered = localStorage.getItem(LOCAL_ACTIVE_KEY);
      if (remembered && remembered !== String(state.battle.id)) {
        setBoardOpen(false);
        draftMatches.clear();
      }
      localStorage.setItem(LOCAL_ACTIVE_KEY, String(state.battle.id));
    }

    renderBattle();
  }

  async function createBattle() {
    try {
      const name = qs('#mbbName')?.value?.trim() || '';
      const maxPlayers = Number(qs('#mbbSlots')?.value || '8');
      const prizeCents = fromReaisInput(qs('#mbbPrize')?.value || '');
      if (!name) {
        notify('Preenche o nome da batalha.', 'error');
        return;
      }
      if (prizeCents <= 0) {
        notify('Preenche a premiação da batalha.', 'error');
        return;
      }
      await apiFetch('/api/batalha-bonus/admin/create', {
        method: 'POST',
        body: JSON.stringify({ name, maxPlayers, prizeCents })
      });
      forceBracketView = false;
      await refresh();
      setBoardOpen(true);
      requestAnimationFrame(() => renderBattle());
      notify('Batalha criada.', 'ok');
    } catch (e) {
      notify(e.message || 'Erro ao criar batalha.', 'error');
    }
  }

  async function finalizeBattle() {
    try {
      await apiFetch('/api/batalha-bonus/admin/finalize', { method: 'POST', body: '{}' });
      setBoardOpen(false);
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
      if (shouldOpenBoard()) return;
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
