import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useState
} from 'react';
import { fetchSessionUser, loginRequest, logoutRequest } from '../lib/api';
import type { SessionUser } from '../types';

type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

interface SessionContextValue {
  status: SessionStatus;
  user: SessionUser | null;
  refreshSession: () => Promise<boolean>;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: PropsWithChildren): JSX.Element {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);

  async function refreshSession(): Promise<boolean> {
    const nextUser = await fetchSessionUser();
    setUser(nextUser);
    setStatus(nextUser ? 'authenticated' : 'anonymous');
    return !!nextUser;
  }

  async function login(username: string, password: string): Promise<void> {
    await loginRequest(username, password);
    await refreshSession();
  }

  async function logout(): Promise<void> {
    await logoutRequest();
    setUser(null);
    setStatus('anonymous');
  }

  useEffect(() => {
    let cancelled = false;

    async function boot(): Promise<void> {
      try {
        const nextUser = await fetchSessionUser();
        if (cancelled) return;
        setUser(nextUser);
        setStatus(nextUser ? 'authenticated' : 'anonymous');
      } catch (error) {
        if (cancelled) return;
        console.error('Falha ao verificar sessão:', error);
        setUser(null);
        setStatus('anonymous');
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, []);

  const value: SessionContextValue = {
    status,
    user,
    refreshSession,
    login,
    logout
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession deve ser usado dentro de SessionProvider.');
  }
  return context;
}
