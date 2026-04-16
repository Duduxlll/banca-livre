import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { LoadingScreen } from './components/LoadingScreen';
import { RequireAuth } from './components/RequireAuth';
import { BancasPage } from './pages/BancasPage';
import { LegacyTabPage } from './pages/LegacyTabPage';
import { LoginPage } from './pages/LoginPage';
import { PagamentosPage } from './pages/PagamentosPage';
import { SessionProvider } from './providers/SessionProvider';
import { ToastProvider } from './providers/ToastProvider';

export function App(): JSX.Element {
  return (
    <BrowserRouter basename="/area">
      <ToastProvider>
        <SessionProvider>
          <Routes>
            <Route path="login" element={<LoginPage />} />

            <Route element={<RequireAuth fallback={<LoadingScreen label="Verificando sessão..." />} />}>
              <Route element={<AppLayout />}>
                <Route index element={<Navigate to="/bancas" replace />} />
                <Route path="bancas" element={<BancasPage />} />
                <Route path="pagamentos" element={<PagamentosPage />} />
                <Route path=":tabId" element={<LegacyTabPage />} />
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/bancas" replace />} />
          </Routes>
        </SessionProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
