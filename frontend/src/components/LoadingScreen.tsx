interface LoadingScreenProps {
  label?: string;
}

export function LoadingScreen({
  label = 'Carregando a área...'
}: LoadingScreenProps): JSX.Element {
  return (
    <main className="loading-screen">
      <div className="loading-card">
        <span className="loading-dot" aria-hidden="true" />
        <p>{label}</p>
      </div>
    </main>
  );
}
