(function () {
  const API = window.location.origin;

  let inscritos = [];
  let spinning = false;
  let startAngle = 0;
  let animId = null;
  let ultimoVencedor = null;

  const canvas = document.getElementById('sorteioWheel');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  const colors = [
    '#ffd76b', '#ffb366', '#ff8a80', '#ff9ecd',
    '#b39fff', '#7ecbff', '#80e8c2', '#c6ff8f'
  ];

  async function carregarInscritosSorteio() {
    try {
      const res = await fetch(`${API}/api/sorteio/inscricoes`);
      inscritos = await res.json();
      if (!Array.isArray(inscritos)) inscritos = [];
      atualizarTabelaSorteio();
      desenharRoletaSorteio();
    } catch (err) {
      console.error('Erro ao carregar inscritos do sorteio', err);
    }
  }

  function atualizarTabelaSorteio() {
    const tbody = document.getElementById('tbodySorteio');
    const totalEl = document.getElementById('sorteioTotalInscritos');
    if (!tbody || !totalEl) return;

    tbody.innerHTML = '';

    totalEl.textContent =
      `${inscritos.length} inscrito${inscritos.length === 1 ? '' : 's'}`;

    for (const ins of inscritos) {
      const tr = document.createElement('tr');

      const tdNome = document.createElement('td');
      tdNome.textContent = ins.nome_twitch;
      tr.appendChild(tdNome);

      const tdData = document.createElement('td');
      const d = new Date(ins.criado_em);
      tdData.textContent =
        `${d.toLocaleDateString('pt-BR')} ` +
        d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      tr.appendChild(tdData);

      const tdAcoes = document.createElement('td');
      const btnDel = document.createElement('button');
      btnDel.textContent = 'Excluir';
      btnDel.className = 'btn-mini-del';
      btnDel.onclick = () => excluirInscritoSorteio(ins.id);
      tdAcoes.appendChild(btnDel);
      tr.appendChild(tdAcoes);

      tbody.appendChild(tr);
    }
  }

  async function excluirInscritoSorteio(id) {
    if (!confirm('Remover este inscrito do sorteio?')) return;
    try {
      const res = await fetch(`${API}/api/sorteio/inscricoes/${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!data.ok) throw new Error();
      inscritos = inscritos.filter(i => i.id !== id);
      atualizarTabelaSorteio();
      desenharRoletaSorteio();
    } catch (err) {
      alert('Erro ao excluir inscrito do sorteio');
    }
  }

  async function limparTodosSorteio() {
    if (!inscritos.length) return;
    if (!confirm('Tem certeza que deseja apagar TODAS as inscrições do sorteio?')) return;
    try {
      const res = await fetch(`${API}/api/sorteio/inscricoes`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!data.ok) throw new Error();
      inscritos = [];
      atualizarTabelaSorteio();
      desenharRoletaSorteio();
    } catch (err) {
      alert('Erro ao limpar inscrições do sorteio');
    }
  }

  function desenharRoletaSorteio() {
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const outsideRadius = Math.min(w, h) / 2 - 10;
    const textRadius = outsideRadius - 24;

    ctx.clearRect(0, 0, w, h);

    const n = inscritos.length || 1;
    const arc = (Math.PI * 2) / n;

    for (let i = 0; i < n; i++) {
      const angle = startAngle + i * arc;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, outsideRadius, angle, angle + arc, false);
      ctx.closePath();
      ctx.fillStyle = inscritos.length ? colors[i % colors.length] : '#333';
      ctx.fill();

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle + arc / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#111';
      ctx.font = '12px system-ui';
      const label = inscritos.length ? (inscritos[i].nome_twitch || '') : 'Sem inscritos';
      ctx.fillText(label, textRadius, 4);
      ctx.restore();
    }

    ctx.beginPath();
    ctx.arc(cx, cy, 55, 0, Math.PI * 2);
    ctx.fillStyle = '#120806';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,180,120,.5)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#ffd76b';
    ctx.font = 'bold 16px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('SORTEIO', cx, cy + 6);
  }

  function calcularIndiceVencedorPeloAngulo(angleFinal) {
    if (!inscritos.length) return -1;
    const n = inscritos.length;
    const arc = (Math.PI * 2) / n;
    const pointerAngle = (3 * Math.PI) / 2;
    const twoPi = Math.PI * 2;

    let diff = pointerAngle - angleFinal;
    diff = ((diff % twoPi) + twoPi) % twoPi;

    const idx = Math.floor(diff / arc);
    return idx % n;
  }

  function girarRoletaSorteio() {
    if (spinning || !inscritos.length) return;
    spinning = true;

    if (animId) {
      cancelAnimationFrame(animId);
      animId = null;
    }

    const twoPi = Math.PI * 2;
    const initialAngle = ((startAngle % twoPi) + twoPi) % twoPi;
    const voltasExtras = 5 + Math.random() * 3;
    const offsetAleatorio = Math.random() * twoPi;
    const finalAngle = initialAngle + voltasExtras * twoPi + offsetAleatorio;

    const duration = 3500;
    const startTime = performance.now();

    const winnerLabel = document.getElementById('sorteioWinnerLabel');
    const btnGirar = document.getElementById('btnSorteioGirar');
    const btnVerCodigo = document.getElementById('btnSorteioVerCodigo');

    if (winnerLabel) winnerLabel.textContent = 'Girando…';
    if (btnVerCodigo) btnVerCodigo.style.display = 'none';

    if (btnGirar) {
      btnGirar.disabled = true;
      btnGirar.classList.add('is-spinning');
    }

    function easeOutCubic(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function step(now) {
      const t = Math.min(1, (now - startTime) / duration);
      const eased = easeOutCubic(t);
      startAngle = initialAngle + (finalAngle - initialAngle) * eased;
      desenharRoletaSorteio();

      if (t < 1) {
        animId = requestAnimationFrame(step);
      } else {
        animId = null;
        spinning = false;

        const normalized = ((startAngle % twoPi) + twoPi) % twoPi;
        startAngle = normalized;

        const winnerIndex = calcularIndiceVencedorPeloAngulo(normalized);
        const vencedor = inscritos[winnerIndex] || null;
        ultimoVencedor = vencedor || null;

        if (winnerLabel) {
          if (vencedor && vencedor.nome_twitch) {
            winnerLabel.innerHTML = `Vencedor: <strong>${vencedor.nome_twitch}</strong>`;
          } else {
            winnerLabel.textContent = 'Vencedor: —';
          }
        }

        if (btnVerCodigo) {
          if (vencedor && vencedor.mensagem) {
            btnVerCodigo.style.display = 'inline-block';
          } else {
            btnVerCodigo.style.display = 'none';
          }
        }

        if (btnGirar) {
          btnGirar.disabled = false;
          btnGirar.classList.remove('is-spinning');
        }

        if (vencedor && typeof notify === 'function') {
          notify(`Vencedor: ${vencedor.nome_twitch}`);
        }
      }
    }

    animId = requestAnimationFrame(step);
  }

  const btnGirarEl = document.getElementById('btnSorteioGirar');
  const btnAtualizarEl = document.getElementById('btnSorteioAtualizar');
  const btnLimparEl = document.getElementById('btnSorteioLimpar');
  const btnVerCodigoEl = document.getElementById('btnSorteioVerCodigo');

  if (btnGirarEl) btnGirarEl.addEventListener('click', girarRoletaSorteio);
  if (btnAtualizarEl) btnAtualizarEl.addEventListener('click', carregarInscritosSorteio);
  if (btnLimparEl) btnLimparEl.addEventListener('click', limparTodosSorteio);

  if (btnVerCodigoEl) {
    btnVerCodigoEl.addEventListener('click', () => {
      if (!ultimoVencedor || !ultimoVencedor.mensagem) return;
      const id = ultimoVencedor.mensagem;
      if (typeof notify === 'function') {
        notify(`ID do vencedor: ${id}`);
      } else {
        alert(`ID do vencedor: ${id}`);
      }
    });
  }

  carregarInscritosSorteio();
})();
