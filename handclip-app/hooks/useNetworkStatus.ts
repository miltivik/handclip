import { useEffect, useState } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { api } from '../services/api';

type Listener = () => void;

const listeners = new Set<Listener>();

/** Register a callback to run when the device transitions from offline to online. */
export function onNetworkReconnect(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitReconnect() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      // ignore listener errors
    }
  }
}

export function useNetworkStatus(pollIntervalMs = 15000): boolean {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      try {
        await api.checkHealth();
        if (mounted) {
          setIsOffline((prev) => {
            if (prev) emitReconnect();
            return false;
          });
        }
      } catch {
        if (mounted) setIsOffline(true);
      }
    };
    void check();
    const interval = setInterval(check, pollIntervalMs);

    // Re-check on app foreground — covers the case where the user returns to
    // the app after losing connectivity in the background.
    const onAppStateChange = (state: AppStateStatus) => {
      if (state === 'active') void check();
    };
    const sub = AppState.addEventListener('change', onAppStateChange);

    return () => {
      mounted = false;
      clearInterval(interval);
      sub.remove();
    };
  }, [pollIntervalMs]);

  return isOffline;
}
