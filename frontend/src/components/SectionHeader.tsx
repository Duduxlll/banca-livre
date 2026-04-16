import type { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  description: string;
  actions?: ReactNode;
}

export function SectionHeader({
  title,
  description,
  actions
}: SectionHeaderProps): JSX.Element {
  return (
    <header className="section-header">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions ? <div className="section-header__actions">{actions}</div> : null}
    </header>
  );
}
