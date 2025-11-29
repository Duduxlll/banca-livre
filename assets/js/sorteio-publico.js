const SP_API = window.location.origin;

function spSetYear() {
  const el = document.getElementById('sp-ano');
  if (el) el.textContent = new Date().getFullYear();
}

async function spOnSubmit(e) {
  e.preventDefault();

  const nomeEl = document.getElementById('sp-nomeTwitch');
  const msgEl  = document.getElementById('sp-mensagem');
  const status = document.getElementById('sp-status');
  const btn    = document.getElementById('sp-btn-enviar');

  const nomeTwitch = (nomeEl.value || '').trim();
  const mensagem   = (msgEl.value || '').trim();

  status.textContent = '';
  status.className = 'sp-status';

  if (!nomeTwitch) {
    status.textContent = 'Informe seu nome da Twitch.';
    status.classList.add('err');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const res = await fetch(`${SP_API}/api/sorteio/inscrever`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomeTwitch, mensagem })
    });

    const data = await res.json();

    if (!res.ok || !data.ok) {
      throw new Error(data.error || 'Erro ao enviar sua inscrição');
    }

    status.textContent = 'Inscrição enviada com sucesso! Boa sorte 🎉';
    status.classList.add('ok');

    nomeEl.value = '';
    msgEl.value = '';
  } catch (err) {
    console.error(err);
    status.textContent = 'Não foi possível enviar agora. Tente novamente em alguns segundos.';
    status.classList.add('err');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar no sorteio';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  spSetYear();
  const form = document.getElementById('sp-form');
  if (form) form.addEventListener('submit', spOnSubmit);
});
