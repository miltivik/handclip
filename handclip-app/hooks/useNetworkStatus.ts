import { useEffect, useState } from 'react';
import { api } from '../services/api';

export function useNetworkStatus(pollIntervalMs = 15000): boolean {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        await api.checkHealth();
        if (mounted) setIsOffline(false);
      } catch {
        if (mounted) setIsOffline(true);
      }
    };
    check();
    const interval = setInterval(check, pollIntervalMs);
    return () => { mounted = false; clearInterval(interval); };
  }, [pollIntervalMs]);

  return isOffline;
}