import { useEffect, useRef } from 'react';

export function useAdminStream(events: string[], onRefresh: () => void): void {
  const refreshRef = useRef(onRefresh);
  const eventsKey = events.join('|');

  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);

  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let active = true;

    const connect = () => {
      if (!active) return;

      eventSource = new EventSource('/api/stream');
      const refresh = () => {
        void Promise.resolve(refreshRef.current());
      };

      events.forEach((eventName) => {
        eventSource?.addEventListener(eventName, refresh);
      });

      eventSource.addEventListener('ping', () => {});
      eventSource.onerror = () => {
        try {
          eventSource?.close();
        } catch {}

        if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
        reconnectTimer = window.setTimeout(connect, 3000);
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
      try {
        eventSource?.close();
      } catch {}
    };
  }, [eventsKey]);
}
