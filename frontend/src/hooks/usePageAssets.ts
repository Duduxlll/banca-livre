import { useEffect } from 'react';

export function usePageTitle(title: string): void {
  useEffect(() => {
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}

export function useStylesheets(hrefs: string[]): void {
  useEffect(() => {
    const added: HTMLLinkElement[] = [];

    hrefs.forEach((href) => {
      const existing = document.querySelector<HTMLLinkElement>(`link[data-react-page-asset="${href}"]`);
      if (existing) return;

      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.reactPageAsset = href;
      document.head.appendChild(link);
      added.push(link);
    });

    return () => {
      added.forEach((link) => link.remove());
    };
  }, [hrefs.join('|')]);
}
