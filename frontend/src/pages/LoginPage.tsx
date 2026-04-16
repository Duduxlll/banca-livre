import { type FormEvent, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../lib/api';
import { useSession } from '../providers/SessionProvider';
import { useToast } from '../providers/ToastProvider';

export function LoginPage(): JSX.Element {
  const { status, login } = useSession();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

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
      showToast('Login realizado com sucesso.', 'success');
      navigate(fromPath, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_credentials') {
        setErrorMessage('Usuário ou senha inválidos.');
      } else {
        setErrorMessage('Não foi possível entrar agora.');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-card">
        <div className="auth-card__intro">
          <span className="hero-banner__eyebrow">Área administrativa</span>
          <h1>Entrar no Banquinhas</h1>
          <p>
            Você está entrando na sua área principal. O backend, a autenticação e as regras
            continuam os mesmos; só a interface está sendo modernizada.
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Usuário</span>
            <input
              className="input"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="admin"
            />
          </label>

          <label className="field">
            <span>Senha</span>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Sua senha"
            />
          </label>

          {errorMessage ? <div className="form-error">{errorMessage}</div> : null}

          <button type="submit" className="btn btn--primary btn--full" disabled={submitting}>
            {submitting ? 'Entrando...' : 'Entrar na área'}
          </button>
        </form>
      </section>
    </main>
  );
}
