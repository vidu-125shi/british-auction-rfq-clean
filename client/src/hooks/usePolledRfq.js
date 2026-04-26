import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';

export function usePolledRfq(id, intervalMs = 3000) {
  const [rfq, setRfq] = useState(null);
  const [error, setError] = useState(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getRfq(id);
      if (!cancelledRef.current) setRfq(data);
    } catch (e) {
      if (!cancelledRef.current) setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();

    let timer = null;
    function start() {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        if (rfq && (rfq.status === 'Closed' || rfq.status === 'ForceClosed')) return;
        refresh();
      }, intervalMs);
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
    }
    start();
    document.addEventListener('visibilitychange', start);
    return () => {
      cancelledRef.current = true;
      stop();
      document.removeEventListener('visibilitychange', start);
    };
  }, [id, intervalMs, refresh, rfq?.status]);

  return { rfq, error, refresh, setRfq };
}
