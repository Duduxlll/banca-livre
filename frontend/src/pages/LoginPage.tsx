import { type FormEvent, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { usePageTitle, useStylesheets } from '../hooks/usePageAssets';
import { ApiError } from '../lib/api';
import { useSession } from '../providers/SessionProvider';

export function LoginPage(): JSX.Element {
  const { status, login } = useSession();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  usePageTitle('Guigz • Login');
  useStylesheets(['/assets/css/login.css?v=20260416a']);

  const fromPath =
    typeof location.state === 'object' &&
    location.state &&
    'from' in location.state &&
    typeof location.state.from === 'string'
      ? location.state.from
      : '/bancas';

  if (status === 'authenticated') {
    return <Navigate to={fromPath} replace />;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setErrorMessage('');

    try {
      await login(username.trim(), password);
      window.location.href = fromPath === '/login' ? '/area' : `/area${fromPath}`;
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_credentials') {
        setErrorMessage('Usuário ou senha inválidos.');
      } else {
        setErrorMessage('Falha ao entrar.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-wrap">
      <div className="card">
        <h1>Entrar</h1>
        <p className="muted">Acesse a área segura</p>

        <form id="loginForm" onSubmit={handleSubmit}>
          <label htmlFor="user">Usuário</label>
          <input
            className="input"
            id="user"
            autoComplete="username"
            required
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />

          <label htmlFor="pass">Senha</label>
          <input
            className="input"
            id="pass"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />

          <button className="cta" type="submit" disabled={submitting}>
            {submitting ? 'Entrando...' : 'Entrar'}
          </button>
          <div className="error" id="err" role="alert">
            {errorMessage}
          </div>
        </form>
      </div>
    </main>
  );
}
