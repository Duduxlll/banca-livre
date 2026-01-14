/* =========================================
   assets/js/palpite-admin.js
   Admin do "Palpite" (aba separada no area.html)

   ✅ O que esse arquivo faz:
   - Lista palpites vindos do formulário público
   - Busca/filtra por nome ou texto do palpite
   - Marca como "Pago" / "Não pago"
   - Define vencedor manualmente (ou remove vencedor)
   - Limpa todos (com confirmação)
   - Auto refresh (se quiser), e integra com area.js:
       window.PalpiteAdmin.init()
       window.PalpiteAdmin.refresh()
       window.PalpiteAdmin.onTabShown()

   ⚠️ Depende APENAS de:
   - window.location.origin (API)
   - cookie csrf (opcional, se seu backend usa)
   - função notify() (se existir). Se não existir, usa alert().
   - Elementos HTML dentro do #tab-palpite com IDs abaixo.

   ✅ IDs esperados no HTML (#tab-palpite):
   - #palpiteBusca
   - #palpiteFiltroStatus  (opções: all | pago | nao_pago)
   - #palpiteBtnAtualizar
   - #palpiteBtnLimparTodos
   - #palpiteTotal
   - #tblPalpites tbody   (tbody com id opcional: #tbodyPalpites)
   - #palpiteWinnerLabel
   - #palpiteBtnRemoverWinner

   ✅ Endpoints esperados no backend:
   - GET    /api/palpite            -> lista palpites
   - PATCH  /api/palpite/:id        -> { status: 'pago' | 'nao_pago' }
   - POST   /api/palpite/:id/winner -> define vencedor
   - DELETE /api/palpite/:id/winner -> remove vencedor
   - DELETE /api/palpite            -> limpa todos

   Se seus endpoints tiverem outro nome, me fala que eu adapto rapidinho.
========================================= */

(() => {
  const API = window.location.origin;

  const qs  = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => [...r.querySelectorAll(s)];

  const esc = (s='') => String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));

  function notifySafe(msg, type='ok'){
    if (typeof window.notify === 'function') return window.notify(msg, type);
    alert(msg);
  }

  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([$?*|{}\\^])/g, '\\$1') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function apiFetch(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers||{}) };
    const method = (opts.method || 'GET').toUpperCase();

    // CSRF se seu backend usa
    if (['POST','PUT','PATCH','DELETE'].includes(method)) {
      const csrf = getCookie('csrf');
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    const res = await fetch(`${API}${path}`, { credentials:'include', ...opts, headers });

    if (!res.ok) {
      let err;
      try { err = await res.json(); } catch {}
      throw new Error(err?.error || `HTTP ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  }

  function debounce(fn, wait=250){
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  // =========================
  // STATE
  // =========================
  const STATE = {
    all: [],
    winnerId: null,
    winnerName: '',
    lastLoadAt: 0,
    autoTimer: null
  };

  // =========================
  // DOM refs (lazy)
  // =========================
  function getRoot(){ return qs('#tab-palpite'); }

  function dom(){
    const root = getRoot();
    if (!root) return {};

    return {
      root,
      busca: qs('#palpiteBusca', root) || qs('#palpiteBusca'),
      filtroStatus: qs('#palpiteFiltroStatus', root) || qs('#palpiteFiltroStatus'),
      btnAtualizar: qs('#palpiteBtnAtualizar', root) || qs('#palpiteBtnAtualizar'),
      btnLimparTodos: qs('#palpiteBtnLimparTodos', root) || qs('#palpiteBtnLimparTodos'),
      total: qs('#palpiteTotal', root) || qs('#palpiteTotal'),
      tbody: qs('#tbodyPalpites', root) || qs('#tblPalpites tbody', root) || qs('#tblPalpites tbody'),
      winnerLabel: qs('#palpiteWinnerLabel', root) || qs('#palpiteWinnerLabel'),
      btnRemoverWinner: qs('#palpiteBtnRemoverWinner', root) || qs('#palpiteBtnRemoverWinner'),
    };
  }

  // =========================
  // Helpers de normalização
  // =========================
  function normalizeStatus(s){
    const v = String(s || '').toLowerCase();
    if (v === 'pago') return 'pago';
    return 'nao_pago';
  }

  function statusLabel(s){
    return s === 'pago' ? 'Pago' : 'Não pago';
  }

  function statusClass(s){
    return s === 'pago' ? 'badge badge--ativo' : 'badge badge--expirado';
  }

  function fmtDateBR(raw){
    if (!raw) return '—';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('pt-BR');
  }

  // =========================
  // LOAD / RENDER
  // =========================
  async function loadPalpites(){
    // backend deve responder lista (array)
    const list = await apiFetch('/api/palpite');

    // aceita vários formatos de retorno
    // - array direto
    // - { data: [...] }
    // - { palpites: [...], winnerId, winnerName }
    const arr = Array.isArray(list) ? list : (list?.data || list?.palpites || []);

    STATE.all = (arr || []).map(p => {
      const id = String(p.id ?? p._id ?? '');
      const nome = p.nome || p.name || p.user || p.twitch || '';
      const palpite = p.palpite || p.texto || p.guess || p.msg || '';
      const createdAt = p.createdAt || p.created_at || p.data || p.date || null;
      const status = normalizeStatus(p.status);
      const isWinner = !!(p.isWinner || p.winner || p.vencedor);

      return { id, nome, palpite, createdAt, status, isWinner };
    }).sort((a,b)=>{
      const da = new Date(a.createdAt || 0).getTime();
      const db = new Date(b.createdAt || 0).getTime();
      return db - da;
    });

    // winner vindo do backend (opcional)
    const wid = list?.winnerId ?? list?.winner_id ?? null;
    const wnm = list?.winnerName ?? list?.winner_name ?? '';
    if (wid) {
      STATE.winnerId = String(wid);
      STATE.winnerName = String(wnm || '');
    } else {
      // tenta descobrir pelo array
      const w = STATE.all.find(x => x.isWinner);
      if (w) {
        STATE.winnerId = w.id;
        STATE.winnerName = w.nome || '';
      } else {
        STATE.winnerId = null;
        STATE.winnerName = '';
      }
    }

    STATE.lastLoadAt = Date.now();
    return STATE.all;
  }

  function getFiltered(){
    const { busca, filtroStatus } = dom();
    let arr = [...STATE.all];

    const q = String(busca?.value || '').trim().toLowerCase();
    const fs = String(filtroStatus?.value || 'all');

    if (fs === 'pago') arr = arr.filter(x => x.status === 'pago');
    if (fs === 'nao_pago') arr = arr.filter(x => x.status === 'nao_pago');

    if (q) {
      arr = arr.filter(x =>
        (x.nome || '').toLowerCase().includes(q) ||
        (x.palpite || '').toLowerCase().includes(q)
      );
    }

    return arr;
  }

  function render(){
    const { tbody, total, winnerLabel, btnRemoverWinner } = dom();
    if (!tbody) return;

    const arr = getFiltered();

    if (total) total.textContent = `${arr.length} palpites`;

    // winner UI
    if (winnerLabel) {
      if (STATE.winnerId) {
        const w = STATE.all.find(x => x.id === STATE.winnerId);
        const name = (w?.nome || STATE.winnerName || '—');
        winnerLabel.textContent = `Vencedor: ${name}`;
      } else {
        winnerLabel.textContent = 'Vencedor: —';
      }
    }
    if (btnRemoverWinner) {
      btnRemoverWinner.style.display = STATE.winnerId ? '' : 'none';
    }

    if (!arr.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="muted" style="padding:14px">Sem palpites ainda.</td></tr>`;
      return;
    }

    tbody.innerHTML = arr.map(p => {
      const isW = STATE.winnerId && p.id === STATE.winnerId;
      const rowCls = isW ? 'palpite-row-winner' : '';

      return `
        <tr class="${rowCls}" data-id="${esc(p.id)}">
          <td>${esc(p.nome || '—')}</td>
          <td>${esc(p.palpite || '—')}</td>
          <td>${fmtDateBR(p.createdAt)}</td>
          <td><span class="${statusClass(p.status)}">${statusLabel(p.status)}</span></td>
          <td class="col-acoes">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <button class="btn btn--primary" data-action="palpite-status" data-id="${esc(p.id)}" data-next="${p.status === 'pago' ? 'nao_pago' : 'pago'}">
                ${p.status === 'pago' ? 'Marcar Não pago' : 'Marcar Pago'}
              </button>
              <button class="btn ${isW ? 'btn--ghost' : 'btn--primary'}" data-action="palpite-winner" data-id="${esc(p.id)}">
                ${isW ? 'Vencedor' : 'Definir vencedor'}
              </button>
              <button class="btn btn--ghost" data-action="palpite-copy" data-id="${esc(p.id)}">Copiar</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // =========================
  // Actions
  // =========================
  async function setPalpiteStatus(id, status){
    await apiFetch(`/api/palpite/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    // atualiza local pra ficar instantâneo
    const item = STATE.all.find(x => x.id === id);
    if (item) item.status = normalizeStatus(status);
    render();
  }

  async function setWinner(id){
    await apiFetch(`/api/palpite/${encodeURIComponent(id)}/winner`, {
      method:'POST'
    });

    STATE.winnerId = id;
    const w = STATE.all.find(x => x.id === id);
    STATE.winnerName = w?.nome || '';

    // marca local
    STATE.all.forEach(x => x.isWinner = false);
    if (w) w.isWinner = true;

    render();
    notifySafe('Vencedor definido!', 'ok');
  }

  async function removeWinner(){
    if (!STATE.winnerId) return;

    await apiFetch(`/api/palpite/${encodeURIComponent(STATE.winnerId)}/winner`, {
      method:'DELETE'
    });

    STATE.winnerId = null;
    STATE.winnerName = '';
    STATE.all.forEach(x => x.isWinner = false);

    render();
    notifySafe('Vencedor removido.', 'ok');
  }

  async function clearAll(){
    const ok = confirm('Tem certeza que deseja limpar TODOS os palpites? Essa ação não pode ser desfeita.');
    if (!ok) return;

    await apiFetch('/api/palpite', { method:'DELETE' });

    STATE.all = [];
    STATE.winnerId = null;
    STATE.winnerName = '';
    render();

    notifySafe('Palpites limpos.', 'ok');
  }

  async function copyPalpite(id){
    const item = STATE.all.find(x => x.id === id);
    if (!item) return;

    const text = `Nome: ${item.nome || '—'}\nPalpite: ${item.palpite || '—'}\nData: ${fmtDateBR(item.createdAt)}\nStatus: ${statusLabel(item.status)}`;
    try{
      await navigator.clipboard.writeText(text);
      notifySafe('Copiado!', 'ok');
    }catch(e){
      console.error(e);
      notifySafe('Não consegui copiar.', 'error');
    }
  }

  // =========================
  // Bindings
  // =========================
  function bindOnce(){
    const d = dom();
    if (!d.root) return;

    // evita bind duplicado
    if (d.root.dataset.palpiteBound === '1') return;
    d.root.dataset.palpiteBound = '1';

    d.btnAtualizar?.addEventListener('click', async ()=>{
      try{
        await loadPalpites();
        render();
      }catch(e){
        console.error(e);
        notifySafe('Erro ao atualizar palpites.', 'error');
      }
    });

    d.btnLimparTodos?.addEventListener('click', ()=> clearAll().catch(e=>{
      console.error(e);
      notifySafe('Erro ao limpar palpites.', 'error');
    }));

    d.btnRemoverWinner?.addEventListener('click', ()=> removeWinner().catch(e=>{
      console.error(e);
      notifySafe('Erro ao remover vencedor.', 'error');
    }));

    d.busca?.addEventListener('input', debounce(()=> render(), 150));
    d.filtroStatus?.addEventListener('change', ()=> render());

    // delegação ações na tabela
    d.root.addEventListener('click', (e)=>{
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;

      const action = btn.dataset.action;
      const id = btn.dataset.id;

      if (action === 'palpite-status') {
        const next = btn.dataset.next || 'nao_pago';
        setPalpiteStatus(id, next).catch(err=>{
          console.error(err);
          notifySafe('Erro ao alterar status.', 'error');
        });
      }

      if (action === 'palpite-winner') {
        setWinner(id).catch(err=>{
          console.error(err);
          notifySafe('Erro ao definir vencedor.', 'error');
        });
      }

      if (action === 'palpite-copy') {
        copyPalpite(id).catch(console.error);
      }
    });
  }

  // =========================
  // Auto-refresh
  // =========================
  function startAuto(ms=4000){
    if (STATE.autoTimer) return;
    STATE.autoTimer = setInterval(async ()=>{
      // só atualiza quando aba estiver visível
      const root = getRoot();
      if (!root || !root.classList.contains('show')) return;

      try{
        await loadPalpites();
        render();
      }catch(e){
        // não spamma erro
        console.error('palpite auto refresh fail', e);
      }
    }, ms);
  }

  function stopAuto(){
    if (!STATE.autoTimer) return;
    clearInterval(STATE.autoTimer);
    STATE.autoTimer = null;
  }

  // =========================
  // Public API para area.js
  // =========================
  async function init(){
    bindOnce();
    // primeira carga (se aba já estiver ativa, já renderiza)
    try{
      await loadPalpites();
      render();
    }catch(e){
      console.error(e);
      // não trava a página
    }
    startAuto(4000);
  }

  async function refresh(){
    bindOnce();
    await loadPalpites();
    render();
  }

  function onTabShown(){
    // quando a aba abrir, força render + refresh
    refresh().catch(console.error);
  }

  // expõe global
  window.PalpiteAdmin = {
    init,
    refresh,
    onTabShown,
    startAuto,
    stopAuto
  };

  // se o script carregar depois do DOM, tenta bind
  document.addEventListener('DOMContentLoaded', ()=>{
    // só inicia se existir a seção no HTML
    if (getRoot()) {
      // não obriga iniciar agora (area.js pode chamar),
      // mas deixa funcionando caso você esqueça:
      if (!window.__palpiteAutoInitDone) {
        window.__palpiteAutoInitDone = true;
        init().catch(console.error);
      }
    }
  });
})();
