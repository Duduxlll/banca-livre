import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../providers/SessionProvider';

interface RequireAuthProps {
  fallback?: JSX.Element | null;
}

export function RequireAuth({ fallback = null }: RequireAuthProps): JSX.Element | null {
  const { status } = useSession();
  const location = useLocation();

  if (status === 'loading') {
    return fallback;
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <Outlet />;
}
