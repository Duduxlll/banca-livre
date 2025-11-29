const API = window.location.origin;

// Usa o notify do seu projeto, se existir, senão cai no alert
function notifySafe(msg) {
  if (typeof notify === 'function') {
    notify(msg);
  } else {
    alert(msg);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const form     = document.getElementById('sp-form');
  const nomeEl   = document.getElementById('sp-nomeTwitch');
  const msgEl    = document.getElementById('sp-mensagem');
  const statusEl = document.getElementById('sp-status');
  const btn      = document.getElementById('sp-btn-enviar');

  if (!form) {
    console.warn('[sorteio-publico] Formulário #sp-form não encontrado');
    return;
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const nomeTwitch = (nomeEl.value || '').trim();
    const mensagem   = (msgEl.value || '').trim();

    statusEl.textContent = '';
    statusEl.className = 'sp-status';

    if (!nomeTwitch) {
      statusEl.textContent = 'Informe seu nome da Twitch.';
      statusEl.classList.add('err');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Enviando...';

    console.log('[sorteio-publico] Enviando inscrição', { nomeTwitch, mensagem });

    try {
      const res = await fetch(`${API}/api/sorteio/inscrever`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nomeTwitch, mensagem })
      });

      const data = await res.json().catch(() => ({}));
      console.log('[sorteio-publico] Resposta da API', res.status, data);

      if (!res.ok || data.ok === false) {
        throw new Error(data.error || `Erro HTTP ${res.status}`);
      }

      statusEl.textContent = 'Seu nome entrou no sorteio! Boa sorte 🎉';
      statusEl.classList.add('ok');
      notifySafe('Nome enviado para o sorteio!');

      nomeEl.value = '';
      msgEl.value = '';
    } catch (err) {
      console.error('[sorteio-publico] Erro ao inscrever', err);
      statusEl.textContent = 'Não foi possível enviar agora. Tente novamente.';
      statusEl.classList.add('err');
      notifySafe('Erro ao enviar para o sorteio. Tente novamente.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Entrar no sorteio';
    }
  });

  const anoEl = document.getElementById('sp-ano');
  if (anoEl) anoEl.textContent = new Date().getFullYear();
});
