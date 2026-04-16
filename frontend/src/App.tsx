import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './components/RequireAuth';
import { AreaPage } from './pages/AreaPage';
import { LoginPage } from './pages/LoginPage';
import { SessionProvider } from './providers/SessionProvider';

export function App(): JSX.Element {
  return (
    <BrowserRouter basename="/area">
      <SessionProvider>
        <Routes>
          <Route path="login" element={<LoginPage />} />

          <Route element={<RequireAuth fallback={null} />}>
            <Route index element={<AreaPage />} />
            <Route path="*" element={<AreaPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </SessionProvider>
    </BrowserRouter>
  );
}
