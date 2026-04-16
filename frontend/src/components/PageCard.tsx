import type { PropsWithChildren, ReactNode } from 'react';

interface PageCardProps extends PropsWithChildren {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
}

export function PageCard({
  title,
  subtitle,
  actions,
  children
}: PageCardProps): JSX.Element {
  return (
    <section className="page-card">
      {(title || subtitle || actions) && (
        <header className="page-card__head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className="page-card__actions">{actions}</div> : null}
        </header>
      )}
      {children}
    </section>
  );
}
