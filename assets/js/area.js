/* =========================================
   area.js — Bancas & Pagamentos (localStorage)
   - Bancas: Nome | Depósito | Banca(editável) | Ações
   - Pagamentos: Nome | Pagamento | Ações (Fazer PIX, Pago/Não pago, Excluir)
   - Menu de status flutuante (fora do scroll)
   ========================================= */

const K_BANCAS = 'bancas';
const K_PAGS   = 'pagamentos';

// ---------- helpers ----------
const read  = (k, def='[]') => JSON.parse(localStorage.getItem(k) || def);
const write = (k, v)        => localStorage.setItem(k, JSON.stringify(v));
const fmtBRL  = (c)=> (c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const toCents = (s)=> { const d = (s||'').toString().replace(/\D/g,''); return d ? parseInt(d,10) : 0; };
const esc     = (s='') => s.replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));

// ---------- elementos ----------
const tabBancasEl     = document.querySelector('#tab-bancas');
const tabPagamentosEl = document.querySelector('#tab-pagamentos');
const tbodyBancas     = document.querySelector('#tblBancas tbody');
const tbodyPags       = document.querySelector('#tblPagamentos tbody');
const buscaInput      = document.querySelector('#busca');

let TAB = localStorage.getItem('area_tab') || 'bancas';

// =========================================
// RENDER
// =========================================
function render(){
  if (TAB==='bancas'){
    tabBancasEl.classList.add('show');
    tabPagamentosEl.classList.remove('show');
    renderBancas();
  } else {
    tabPagamentosEl.classList.add('show');
    tabBancasEl.classList.remove('show');
    renderPagamentos();
  }
}

function renderBancas(){
  const lista = read(K_BANCAS).sort((a,b)=> (a.createdAt||'') < (b.createdAt||'') ? 1 : -1);

  tbodyBancas.innerHTML = lista.length ? lista.map(b => {
    const bancaTxt = typeof b.bancaCents === 'number' ? fmtBRL(b.bancaCents) : '';
    return `
      <tr data-id="${b.id}">
        <td>${esc(b.nome)}</td>
        <td>${fmtBRL(b.depositoCents||0)}</td>
        <td>
          <input type="text" class="input input-money" data-role="banca" data-id="${b.id}" placeholder="R$ 0,00" value="${bancaTxt}">
        </td>
        <td class="col-acoes">
          <div style="display:flex;gap:8px">
            <button class="btn btn--primary" data-action="to-pagamento" data-id="${b.id}">Pagamento</button>
            <button class="btn btn--danger"  data-action="del-banca"    data-id="${b.id}">Excluir</button>
          </div>
        </td>
      </tr>`;
  }).join('') : `<tr><td colspan="4" class="muted" style="padding:14px">Sem registros ainda.</td></tr>`;

  filtrarTabela(tbodyBancas, buscaInput?.value || '');
}

function renderPagamentos(){
  const lista = read(K_PAGS).sort((a,b)=> (a.createdAt||'') < (b.createdAt||'') ? 1 : -1);

  tbodyPags.innerHTML = lista.length ? lista.map(p => {
    const isPago = p.status === 'pago';
    const statusTxt = isPago ? 'Pago' : 'Não pago';
    const statusCls = isPago ? 'status--pago' : 'status--nao';

    return `
      <tr data-id="${p.id}">
        <td>${esc(p.nome)}</td>
        <td>${fmtBRL(p.pagamentoCents||0)}</td>
        <td class="col-acoes">
          <div style="display:flex;gap:8px;align-items:center">
            <button type="button"
                    class="status-btn ${statusCls}"
                    data-action="status-open"
                    data-id="${p.id}"
                    data-status="${p.status}">
              ${statusTxt} <span class="caret"></span>
            </button>

            <button class="btn btn--primary" data-action="fazer-pix" data-id="${p.id}">Fazer PIX</button>
            <button class="btn btn--danger"  data-action="del-pag"   data-id="${p.id}">Excluir</button>
          </div>
        </td>
      </tr>`;
  }).join('') : `<tr><td colspan="3" class="muted" style="padding:14px">Sem registros ainda.</td></tr>`;

  filtrarTabela(tbodyPags, buscaInput?.value || '');
}

// =========================================
/* AÇÕES PRINCIPAIS */
// =========================================
function setTab(tab){
  TAB = tab;
  localStorage.setItem('area_tab', tab);
  document.querySelectorAll('.nav-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  render();
}

function toPagamento(id){
  const bancas = read(K_BANCAS);
  const ix = bancas.findIndex(x=>x.id===id);
  if(ix<0) return;
  const b = bancas[ix];

  // valor que vai para pagamentos: bancaCents (se informado) senão depósito
  const valor = (typeof b.bancaCents === 'number' && b.bancaCents > 0) ? b.bancaCents : (b.depositoCents||0);

  bancas.splice(ix,1);
  write(K_BANCAS, bancas);

  const pags = read(K_PAGS);
  pags.push({
    id: b.id,
    nome: b.nome,
    pagamentoCents: valor,
    pixType: b.pixType || null,
    pixKey:  b.pixKey  || null,
    status: 'nao_pago',
    createdAt: b.createdAt
  });
  write(K_PAGS, pags);

  setTab('pagamentos'); // mostra a aba de pagamentos logo após mover
}

function deleteBanca(id){
  write(K_BANCAS, read(K_BANCAS).filter(x=>x.id!==id));
  render();
}
function deletePagamento(id){
  write(K_PAGS, read(K_PAGS).filter(x=>x.id!==id));
  render();
}
function setStatus(id, value){
  const pags = read(K_PAGS);
  const p = pags.find(x=>x.id===id);
  if(!p) return;

  if (value === 'pago') {
    p.status = 'pago';
    p.paidAt = Date.now();              // marca quando virou pago
    // agenda exclusão em 3 minutos
    scheduleAutoDelete(id, 3 * 60 * 1000);
  } else {
    p.status = 'nao_pago';
    delete p.paidAt;                    // cancela relógio caso volte a "não pago"
  }

  write(K_PAGS, pags);
  render();
}

function scheduleAutoDelete(id, ms){
  // Se a aba recarregar, faremos limpeza no DOMContentLoaded (ver abaixo)
  setTimeout(()=>{
    const list = read(K_PAGS);
    const item = list.find(x=>x.id===id);
    if (!item) return;                  // já foi apagado
    if (item.status !== 'pago') return; // só remove se ainda estiver pago
    const age = Date.now() - (item.paidAt || 0);
    if (age >= 3*60*1000) {             // 3 minutos
      write(K_PAGS, list.filter(x=>x.id!==id));
      render();
    }
  }, ms);
}

// limpeza ao carregar a página (remove pagos antigos, caso o relógio tenha passado off-line)
function cleanupPaidOlderThan3Min(){
  const list = read(K_PAGS);
  const now = Date.now();
  const kept = list.filter(x => !(x.status==='pago' && x.paidAt && (now - x.paidAt >= 3*60*1000)));
  if (kept.length !== list.length){
    write(K_PAGS, kept);
  }
  // re-agenda os que faltam (se ainda não passaram 3 min)
  kept.forEach(x=>{
    if (x.status==='pago' && x.paidAt){
      const left = (x.paidAt + 3*60*1000) - now;
      if (left > 0) scheduleAutoDelete(x.id, left);
    }
  });
}


// =========================================
// Modal simples “Fazer PIX” (mostra a chave)
// =========================================
function abrirPixModal(id){
  const p = read(K_PAGS).find(x=>x.id===id);
  if(!p) return;
  let dlg = document.querySelector('#payModal');
  if(!dlg){
    dlg = document.createElement('dialog');
    dlg.id = 'payModal';
    dlg.style.border='0'; dlg.style.padding='0'; dlg.style.background='transparent';
    const box = document.createElement('div');
    box.style.width='min(94vw,520px)';
    box.style.background='linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))';
    box.style.border='1px solid rgba(255,255,255,.12)';
    box.style.borderRadius='14px';
    box.style.boxShadow='0 28px 80px rgba(0,0,0,.55)';
    box.style.padding='16px'; box.style.color='#e7e9f3';
    box.innerHTML = `
      <h3 style="margin:0 0 6px">Fazer PIX para <span data-field="nome"></span></h3>
      <p class="muted" style="margin:0 0 10px">Chave (<span data-field="tipo"></span>)</p>
      <div style="display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center">
        <input class="input" data-field="key" readonly>
        <button class="btn btn--primary" data-action="copy">Copiar</button>
      </div>
      <div style="display:flex;gap:8px;justify-content:center;margin-top:10px">
        <button class="btn btn--ghost" data-action="close">Fechar</button>
      </div>
    `;
    dlg.appendChild(box);
    document.body.appendChild(dlg);

    dlg.addEventListener('click', (e)=>{
      const b = e.target.closest('[data-action]');
      if(!b) return;
      if(b.dataset.action==='close') dlg.close();
      if(b.dataset.action==='copy'){
        const input = dlg.querySelector('[data-field="key"]');
        if(input?.value) navigator.clipboard.writeText(input.value);
      }
    });
  }
  dlg.querySelector('[data-field="nome"]').textContent = p.nome;
  dlg.querySelector('[data-field="tipo"]').textContent = (p.pixType||'—').toUpperCase();
  dlg.querySelector('[data-field="key"]').value = p.pixKey || '—';
  dlg.showModal();
}

// =========================================
// MENU FLUTUANTE (PORTAL) — Pago / Não pago
// =========================================
let statusMenuEl = null;
let statusMenuId = null;

function ensureStatusMenu(){
  if(statusMenuEl) return statusMenuEl;
  const el = document.createElement('div');
  el.className = 'status-float';
  el.innerHTML = `
    <button class="status-item pago" data-value="pago">Pago</button>
    <button class="status-item nao"  data-value="nao_pago">Não pago</button>
  `;
  document.body.appendChild(el);

  el.addEventListener('click', (e)=>{
    const btn = e.target.closest('button.status-item');
    if(!btn) return;
    if(statusMenuId){
      setStatus(statusMenuId, btn.dataset.value); // salva + rerender
    }
    hideStatusMenu();
  });

  statusMenuEl = el;
  return el;
}

function showStatusMenu(anchorBtn, id, current){
  const m = ensureStatusMenu();
  statusMenuId = id;

  // marca a atual
  [...m.querySelectorAll('.status-item')].forEach(b=>{
    b.classList.toggle('active', b.dataset.value === current);
  });

  // posiciona (abre pra cima se faltar espaço)
  const r = anchorBtn.getBoundingClientRect();
  m.style.display = 'block';
  m.style.visibility = 'hidden';
  const mh = m.getBoundingClientRect().height;
  const mw = m.getBoundingClientRect().width;
  m.style.visibility = '';

  const spaceBelow = window.innerHeight - r.bottom;
  let top = r.bottom + 6;
  if(spaceBelow < mh + 8){
    top = r.top - mh - 6;  // dropup
  }
  const left = Math.min(Math.max(8, r.left), window.innerWidth - mw - 8);

  m.style.top  = `${Math.round(top)}px`;
  m.style.left = `${Math.round(left)}px`;
  m.classList.add('show');
}

function hideStatusMenu(){
  if(statusMenuEl){
    statusMenuEl.classList.remove('show');
    statusMenuEl.style.display = 'none';
  }
  statusMenuId = null;
}

// abre/fecha via clique
document.addEventListener('click', (e)=>{
  const openBtn = e.target.closest('button[data-action="status-open"]');
  if(openBtn){
    const id = openBtn.dataset.id;
    const current = openBtn.dataset.status || 'nao_pago';
    hideStatusMenu();
    showStatusMenu(openBtn, id, current);
    e.stopPropagation();
    return;
  }
  if(!e.target.closest('.status-float')) hideStatusMenu();
});

// rolar/resize fecha menu
['scroll','resize'].forEach(ev=>{
  window.addEventListener(ev, hideStatusMenu, {passive:true});
});
document.querySelectorAll('.table-wrap').forEach(w=> w.addEventListener('scroll', hideStatusMenu, {passive:true}));

// =========================================
// EVENTOS GLOBAIS
// =========================================
document.querySelectorAll('.nav-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> setTab(btn.dataset.tab));
});

document.addEventListener('click', (e)=>{
  const btn = e.target.closest('button[data-action]');
  if(!btn) return;

  const {action, id} = btn.dataset;
  if(action==='to-pagamento') return toPagamento(id);
  if(action==='del-banca')    return deleteBanca(id);
  if(action==='fazer-pix')    return abrirPixModal(id);
  if(action==='del-pag')      return deletePagamento(id);
});

// edição da Banca (R$)
document.addEventListener('input', (e)=>{
  const inp = e.target.closest('input[data-role="banca"]');
  if(!inp) return;
  let v = inp.value.replace(/\D/g,'');
  if(!v){ inp.value=''; return; }
  v = v.replace(/^0+/, '');
  if(v.length<3) v = v.padStart(3,'0');
  inp.value = fmtBRL(parseInt(v,10));
});
document.addEventListener('blur', (e)=>{
  const inp = e.target.closest('input[data-role="banca"]');
  if(!inp) return;
  const id = inp.dataset.id;
  const cents = toCents(inp.value);
  const list = read(K_BANCAS);
  const item = list.find(x=>x.id===id);
  if(item){ item.bancaCents = cents; write(K_BANCAS, list); }
}, true);
document.addEventListener('keydown', (e)=>{
  const inp = e.target.closest('input[data-role="banca"]');
  if(!inp) return;
  if(e.key==='Enter'){ e.preventDefault(); inp.blur(); }
});

// busca
function filtrarTabela(tbody, q){
  if(!tbody) return;
  const query = (q||'').trim().toLowerCase();
  [...tbody.querySelectorAll('tr')].forEach(tr=>{
    tr.style.display = tr.textContent.toLowerCase().includes(query) ? '' : 'none';
  });
}
buscaInput?.addEventListener('input', ()=>{
  const q = buscaInput.value || '';
  if (TAB==='bancas') filtrarTabela(tbodyBancas, q);
  else                filtrarTabela(tbodyPags,   q);
});

// start
document.addEventListener('DOMContentLoaded', ()=>{
  document.querySelectorAll('.nav-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.tab === TAB);
  });
  cleanupPaidOlderThan3Min(); // <-- NOVO
  render();
});

