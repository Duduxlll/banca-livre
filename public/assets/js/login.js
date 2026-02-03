const err = document.querySelector('#err');
const form = document.querySelector('#loginForm');
const API = window.location.origin;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.textContent = '';

  const username = String(document.querySelector('#user')?.value || '').trim();
  const password = String(document.querySelector('#pass')?.value || '');

  if (!username || !password) {
    err.textContent = 'Preencha usuário e senha.';
    return;
  }

  try {
    const r = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password })
    });

    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      err.textContent =
        j.error === 'invalid_credentials'
          ? 'Usuário ou senha inválidos.'
          : 'Falha ao entrar.';
      return;
    }

    location.href = '/area';
  } catch {
    err.textContent = 'Erro de rede.';
  }
});
