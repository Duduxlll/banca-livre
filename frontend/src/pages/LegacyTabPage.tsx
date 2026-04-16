import { useEffect, useRef, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { PageCard } from '../components/PageCard';
import { SectionHeader } from '../components/SectionHeader';
import { isAdminTab } from '../lib/legacy';
import { ADMIN_TABS } from '../types';

export function LegacyTabPage(): JSX.Element {
  const { tabId } = useParams();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [frameVersion, setFrameVersion] = useState(0);
  const [frameHeight, setFrameHeight] = useState(980);
  const tab = isAdminTab(tabId) ? ADMIN_TABS.find((item) => item.id === tabId) || null : null;
  const tabIdForSync = tab?.id || null;
  const frameSrc = tab
    ? `/legacy-area?tab=${encodeURIComponent(tab.id)}&embed=1&v=${frameVersion}`
    : '';

  useEffect(() => {
    setFrameHeight(980);
  }, [tabIdForSync]);

  useEffect(() => {
    if (!tabIdForSync) return;

    function handleMessage(event: MessageEvent): void {
      if (event.origin !== window.location.origin) return;

      const payload = event.data;
      if (!payload || payload.type !== 'legacy-area:height' || payload.tab !== tabIdForSync) {
        return;
      }

      const nextHeight = Number(payload.height || 0);
      if (nextHeight > 0) {
        setFrameHeight(Math.max(720, Math.ceil(nextHeight) + 12));
      }
    }

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [tabIdForSync]);

  if (!tab) {
    return <Navigate to="/bancas" replace />;
  }

  if (tab.implemented) {
    return <Navigate to={`/${tab.id}`} replace />;
  }

  function handleFrameLoad(): void {
    const iframe = iframeRef.current;
    if (!iframe) return;

    try {
      const path = iframe.contentWindow?.location?.pathname || '';
      if (path.startsWith('/login') || path.startsWith('/area/login')) {
        window.location.href = '/area/login';
        return;
      }

      const doc = iframe.contentDocument;
      if (!doc) return;
      const nextHeight = Math.max(
        doc.documentElement?.scrollHeight || 0,
        doc.body?.scrollHeight || 0,
        iframe.clientHeight || 0
      );

      if (nextHeight > 0) {
        setFrameHeight(Math.max(720, nextHeight + 12));
      }
    } catch {}
  }

  return (
    <>
      <SectionHeader
        title={tab.label}
        description="Essa aba ainda usa a lógica legada por trás, mas já está integrada na sua área principal para manter tudo funcionando."
        actions={
          <div className="header-actions">
            <a href={`/legacy-area?tab=${encodeURIComponent(tab.id)}`} className="btn btn--ghost">
              Abrir compatibilidade desta aba
            </a>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setFrameVersion((current) => current + 1)}
            >
              Recarregar aba
            </button>
          </div>
        }
      />

      <PageCard
        title={`${tab.label} integrada`}
        subtitle="O módulo abaixo continua ativo por compatibilidade enquanto a versão nativa dessa aba ainda não foi portada."
      >
        <div className="legacy-frame-head">
          <p>
            A interface principal já é esta. O bloco abaixo só reaproveita o módulo legado dessa
            aba nos bastidores.
          </p>
          <a href="/legacy-area" className="btn btn--ghost">
            Abrir compatibilidade completa
          </a>
        </div>

        <div className="legacy-frame-wrap">
          <iframe
            key={frameSrc}
            ref={iframeRef}
            title={`Painel legado - ${tab.label}`}
            src={frameSrc}
            className="legacy-frame"
            style={{ height: `${frameHeight}px` }}
            onLoad={handleFrameLoad}
          />
        </div>
      </PageCard>
    </>
  );
}
