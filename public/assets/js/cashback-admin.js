(() => {
  const API = window.location.origin;
  const qs = (s, r = document) => r.querySelector(s);

  function getCookie(name) {
    const m = document.cookie.match(
      new RegExp('(?:^|; )' + name.replace(/([$?*|{}\\^])/g, '\\$1') + '=([^;]*)')
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  async function apiFetch(path, opts = {}) {
    if (typeof window.apiFetch === 'function') return window.apiFetch(path, opts);

    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const method = (opts.method || 'GET').toUpperCase();

    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const csrf = getCookie('csrf');
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }

    const res = await fetch(`${API}${path}`, { credentials: 'include', ...opts, headers });
    if (!res.ok) {
      let err;
      try { err = await res.json(); } catch {}
      throw new Error(err?.error || `HTTP ${res.status}`);
    }
    return res.status === 204 ? null : res.json();
  }

  const esc = (s = '') =>
    String(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const fmtDT = (d) => {
    if (!d) return '—';
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return '—';
    return dt.toLocaleString('pt-BR');
  };

  function ensureToastEl() {
    let el = document.querySelector('#appToast');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'appToast';
    el.className = 'toast';
    document.body.appendChild(el);
    return el;
  }

  function toast(msg, type = 'ok') {
    const el = ensureToastEl();
    el.textContent = String(msg || '');
    el.classList.remove('show', 'toast--ok', 'toast--error', 'toast--info');
    const t = (type === 'error') ? 'toast--error' : (type === 'info' ? 'toast--info' : 'toast--ok');
    el.classList.add(t);
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  if (typeof window.notify !== 'function') {
    window.notify = (msg, type) => {
      const v = String(type || 'ok').toLowerCase();
      if (v === 'error' || v === 'no' || v === 'bad') return toast(msg, 'error');
      if (v === 'info') return toast(msg, 'info');
      return toast(msg, 'ok');
    };
  }

  function notify(msg, type = 'ok') {
    window.notify(msg, type);
  }

  function maskPixKey(key = '') {
    const k = String(key || '').trim();
    if (!k) return '—';
    const clean = k.replace(/\s+/g, '');
    return '*'.repeat(Math.max(clean.length, 10));
  }

  function statusBadge(status = '') {
    const s = String(status || '').toUpperCase();
    if (s === 'APROVADO') return `<span class="badge live">APROVADO</span>`;
    if (s === 'REPROVADO') return `<span class="badge">REPROVADO</span>`;
    return `<span class="badge soft">PENDENTE</span>`;
  }

  function ensureUI() {
    const tab = qs('#tab-cashbacks');
    if (!tab) return null;

    if (qs('#cbTbl', tab)) return tab;

    tab.innerHTML = `
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;gap:12px;align-items:flex-end;justify-content:space-between;flex-wrap:wrap">
          <div>
            <h2 style="margin:0">Print dos depositos</h2>
            <div class="muted" style="margin-top:6px">Chat: !cashback • Status: !status</div>
          </div>

          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="btn" id="cbReload" type="button">Atualizar</button>
            <button class="btn ghost" id="cbCopyLink" type="button">Copiar link</button>
          </div>
        </div>

        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;align-items:center">
          <input id="cbSearch" class="input" placeholder="Buscar por nick...">
          <select id="cbStatus" class="input">
            <option value="PENDENTE" selected>Pendentes</option>
            <option value="APROVADO">Aprovados</option>
            <option value="REPROVADO">Reprovados</option>
            <option value="ALL">Todos</option>
          </select>

          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-left:auto">
            <div class="chip">Pendentes: <strong id="cbCountPend">0</strong></div>
            <div class="chip">Aprovados: <strong id="cbCountApr">0</strong></div>
            <div class="chip">Reprovados: <strong id="cbCountRep">0</strong></div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:12px">
        <div class="table-wrap">
          <table class="table" id="cbTbl">
            <thead>
              <tr>
                <th>Data</th>
                <th>Nick Twitch</th>
                <th>PIX</th>
                <th>Status</th>
                <th>Comprovante</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    `;

    return tab;
  }

  let decisionDlg = null;
  function ensureDecisionModal() {
    if (decisionDlg) return decisionDlg;

    const dlg = document.createElement('dialog');
    dlg.className = 'cb-modal';
    dlg.innerHTML = `
      <div class="cb-modal-card">
        <div class="cb-modal-head" style="display:flex;justify-content:space-between;gap:10px;align-items:center">
          <div>
            <div style="font-weight:800" id="cbMTitle">Decidir</div>
            <div class="muted" id="cbMSub">—</div>
          </div>
          <button type="button" class="btn ghost" data-close>Fechar</button>
        </div>

        <div style="margin-top:12px;display:grid;gap:10px">
          <label class="field">
            <span>Status</span>
            <select id="cbMStatus" class="input">
              <option value="APROVADO">APROVADO</option>
              <option value="REPROVADO">REPROVADO</option>
              <option value="PENDENTE">PENDENTE</option>
            </select>
          </label>

          <label class="field">
            <span>Motivo / Observação</span>
            <textarea id="cbMMotivo" class="input" rows="3" placeholder="Ex: print ilegível / sem data"></textarea>
          </label>

          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button type="button" class="btn ghost" data-close>Cancelar</button>
            <button type="button" class="btn" id="cbMSave">Salvar</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(dlg);

    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });

    decisionDlg = dlg;
    return dlg;
  }

  let proofDlg = null;
  function ensureProofModal() {
    if (proofDlg) return proofDlg;

    const dlg = document.createElement('dialog');
    dlg.className = 'cb-modal cb-proof';
    dlg.innerHTML = `
      <div class="cb-modal-card">
        <div class="cb-modal-head" style="display:flex;justify-content:space-between;gap:10px;align-items:center">
          <div>
            <div style="font-weight:800">Comprovante</div>
            <div class="muted" id="cbPSub">—</div>
          </div>
          <button type="button" class="cb-x" data-close aria-label="Fechar">×</button>
        </div>

        <div class="cb-proof-body" style="margin-top:12px">
          <img id="cbPImg" alt="" />
        </div>

        <div class="muted cb-proof-hint">Clique na imagem para dar zoom.</div>
      </div>
    `;
    document.body.appendChild(dlg);

    dlg.addEventListener('click', (e) => {
      if (e.target === dlg || e.target.closest('[data-close]')) dlg.close();
    });

    const img = dlg.querySelector('#cbPImg');
    img.addEventListener('click', () => {
      dlg.classList.toggle('is-zoom');
    });

    dlg.addEventListener('close', () => {
      dlg.classList.remove('is-zoom');
    });

    proofDlg = dlg;
    return dlg;
  }

  const STATE = {
    list: [],
    status: 'PENDENTE',
    search: ''
  };

  function updateCounters(allRows) {
    const pend = allRows.filter(x => String(x.status || '') === 'PENDENTE').length;
    const apr  = allRows.filter(x => String(x.status || '') === 'APROVADO').length;
    const rep  = allRows.filter(x => String(x.status || '') === 'REPROVADO').length;

    const a = qs('#cbCountPend'); if (a) a.textContent = String(pend);
    const b = qs('#cbCountApr');  if (b) b.textContent = String(apr);
    const c = qs('#cbCountRep');  if (c) c.textContent = String(rep);
  }

  function renderTable() {
    const tab = qs('#tab-cashbacks');
    if (!tab) return;

    const tbody = qs('#cbTbl tbody', tab);
    if (!tbody) return;

    const q = String(STATE.search || '').trim().toLowerCase();
    let arr = Array.isArray(STATE.list) ? [...STATE.list] : [];

    if (q) arr = arr.filter(x => String(x.twitchName || '').toLowerCase().includes(q));

    if (!arr.length) {
      tbody.innerHTML = `<tr><td colspan="6" class="muted" style="padding:14px">Sem registros.</td></tr>`;
      return;
    }

    tbody.innerHTML = arr.map(x => {
  const st = String(x.status || '').toUpperCase();

  const statusNote = (() => {
    if (st === 'REPROVADO') return x.reason ? `Motivo: <strong>${esc(x.reason)}</strong>` : '';
    if (st === 'PENDENTE')  return x.reason ? `Obs: <strong>${esc(x.reason)}</strong>` : '';
    return '';
  })();

  const statusHtml = `
    <div class="cb-status-cell">
      ${statusBadge(x.status)}
      ${statusNote ? `<div class="cb-status-note">${statusNote}</div>` : ``}
    </div>
  `;

  const pixHtml = `
    <div class="cb-pix">
      <div class="cb-pix-key">${esc(maskPixKey(x.pixKey || ''))}</div>
      <div class="cb-pix-type">${x.pixType ? `(${esc(x.pixType)})` : ''}</div>
    </div>
  `;

  const proofHtml = x.hasScreenshot
    ? `<button class="btn ghost cb-proof-btn" data-act="proof" data-id="${esc(x.id)}">Abrir</button>`
    : `<span class="muted">—</span>`;

  return `
    <tr>
      <td>${esc(fmtDT(x.createdAt))}</td>
      <td><strong>${esc(x.twitchName || '')}</strong></td>
      <td>${pixHtml}</td>
      <td>${statusHtml}</td>
      <td class="cb-proof-td">${proofHtml}</td>
      <td>
        <div class="cb-actions-grid">
          <button class="btn" data-act="approve" data-id="${esc(x.id)}">Aprovar</button>
          <button class="btn ghost" data-act="reject" data-id="${esc(x.id)}">Reprovar</button>
          <button class="btn ghost cb-action-full" data-act="copy" data-id="${esc(x.id)}">Copiar PIX</button>
        </div>
      </td>
    </tr>
  `;
}).join('');


  }

  async function loadList() {
    const st = String(STATE.status || 'PENDENTE');
    const q = st === 'ALL' ? '?limit=500' : `?status=${encodeURIComponent(st)}&limit=500`;
    const data = await apiFetch(`/api/cashback/admin/list${q}`, { method: 'GET' });
    STATE.list = Array.isArray(data?.rows) ? data.rows : [];
  }

  async function loadCounters() {
    const data = await apiFetch(`/api/cashback/admin/list?limit=2000`, { method: 'GET' });
    const allRows = Array.isArray(data?.rows) ? data.rows : [];
    updateCounters(allRows);
  }

  function openDecision(item, mode) {
    const dlg = ensureDecisionModal();
    dlg.dataset.id = item.id;

    dlg.querySelector('#cbMTitle').textContent = 'Decidir Cashback';
    dlg.querySelector('#cbMSub').textContent = `${item.twitchName || '—'} • ${item.id || ''}`;

    dlg.querySelector('#cbMStatus').value = (mode === 'reject') ? 'REPROVADO' : 'APROVADO';
    dlg.querySelector('#cbMMotivo').value = item.reason || '';

    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  async function saveDecision() {
    const dlg = ensureDecisionModal();
    const id = dlg.dataset.id;
    if (!id) return;

    const st = dlg.querySelector('#cbMStatus').value;
    const motivo = String(dlg.querySelector('#cbMMotivo').value || '').trim();
    const btn = dlg.querySelector('#cbMSave');

    if (st === 'REPROVADO' && !motivo) {
      notify('Pra reprovado, informe um motivo.', 'error');
      return;
    }

    btn.disabled = true;
    try {
      await apiFetch(`/api/cashback/admin/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          status: st,
          reason: motivo || null,
          payoutWindow: null
        })
      });

      dlg.close();
      await CashbackAdmin.refresh();
      notify('Atualizado.', 'ok');
    } catch (e) {
      notify(`Erro: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
    }
  }

  async function openProof(id) {
    const dlg = ensureProofModal();
    dlg.classList.remove('is-zoom');

    try {
      const data = await apiFetch(`/api/cashback/admin/${encodeURIComponent(id)}`, { method: 'GET' });
      const row = data?.row;
      const img = dlg.querySelector('#cbPImg');
      const sub = dlg.querySelector('#cbPSub');

      sub.textContent = `${row?.twitchName || '—'} • ${row?.id || ''}`;
      img.src = row?.screenshotDataUrl || '';

      if (typeof dlg.showModal === 'function') dlg.showModal();
      else dlg.setAttribute('open', '');
    } catch (e) {
      notify(`Erro: ${e.message}`, 'error');
    }
  }

  function bindUI() {
    const tab = ensureUI();
    if (!tab) return;

    qs('#cbReload', tab)?.addEventListener('click', () => CashbackAdmin.refresh());

    qs('#cbCopyLink', tab)?.addEventListener('click', async () => {
      const link = `${window.location.origin}/cashback-publico`;
      try {
        await navigator.clipboard.writeText(link);
        notify('Link copiado!', 'ok');
      } catch {
        notify('Não consegui copiar automaticamente. Copie manualmente: ' + link, 'error');
      }
    });

    const search = qs('#cbSearch', tab);
    search?.addEventListener('input', () => {
      STATE.search = search.value || '';
      renderTable();
    });

    const status = qs('#cbStatus', tab);
    status?.addEventListener('change', async () => {
      STATE.status = status.value || 'PENDENTE';
      await CashbackAdmin.refresh(false);
    });

    tab.addEventListener('click', async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;

      const act = btn.dataset.act;
      const id = btn.dataset.id;

      const item = (STATE.list || []).find(x => String(x.id) === String(id));
      if (!item) return;

      if (act === 'approve') return openDecision(item, 'approve');
      if (act === 'reject') return openDecision(item, 'reject');

      if (act === 'copy') {
        const raw = item.pixKey || '';
        if (!raw) return notify('Esse envio não tem PIX.', 'error');
        try {
          await navigator.clipboard.writeText(String(raw));
          notify('PIX copiado!', 'ok');
        } catch {
          notify('Não consegui copiar automaticamente.', 'error');
        }
        return;
      }

      if (act === 'proof') return openProof(id);
    });

    const dlg = ensureDecisionModal();
    dlg.querySelector('#cbMSave')?.addEventListener('click', saveDecision);
  }

  const CashbackAdmin = {
    init() {
      ensureUI();
      bindUI();
    },
    async refresh(withCounters = true) {
      try {
        await loadList();
        renderTable();
        if (withCounters) await loadCounters();
      } catch (e) {
        console.error(e);
        notify(`Erro ao carregar: ${e.message}`, 'error');
        renderTable();
      }
    }
  };

  window.CashbackAdmin = CashbackAdmin;

  document.addEventListener('DOMContentLoaded', () => {
    if (qs('#tab-cashbacks')) {
      CashbackAdmin.init();
      CashbackAdmin.refresh();
    }
  });
})();
