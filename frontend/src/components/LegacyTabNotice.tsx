import { openLegacyArea } from '../lib/legacy';
import type { AdminTabDefinition } from '../types';

interface LegacyTabNoticeProps {
  tab: AdminTabDefinition;
}

export function LegacyTabNotice({ tab }: LegacyTabNoticeProps): JSX.Element {
  return (
    <section className="legacy-notice">
      <div className="legacy-notice__badge">Compatibilidade interna ativa</div>
      <h2>{tab.label}</h2>
      <p>{tab.description}</p>
      <p>
        Essa aba ainda usa o módulo legado por trás para garantir estabilidade enquanto a versão
        nativa dela não fica pronta.
      </p>

      <div className="legacy-notice__actions">
        <button type="button" className="btn btn--primary" onClick={() => openLegacyArea(tab.id)}>
          Abrir compatibilidade de {tab.label}
        </button>
        <a href="/legacy-area" className="btn btn--ghost">
          Abrir compatibilidade completa
        </a>
      </div>
    </section>
  );
}
