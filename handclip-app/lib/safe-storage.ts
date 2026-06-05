import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

type StorageLike = {
  getItem: (name: string) => string | null | Promise<string | null>;
  setItem: (name: string, value: string) => void | Promise<void>;
  removeItem: (name: string) => void | Promise<void>;
};

const memoryStorage = new Map<string, string>();

function getWebStorage(): StorageLike | null {
  if (Platform.OS !== 'web') return null;
  if (typeof globalThis.localStorage === 'undefined') return null;
  return globalThis.localStorage;
}

function isNativeStorageMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes('Native module is null') ||
      error.message.includes('legacy storage'))
  );
}

function logStorageFallback(error: unknown): void {
  if (__DEV__ && isNativeStorageMissing(error)) {
    console.warn('AsyncStorage unavailable; using in-memory storage fallback.');
  }
}

export const safeStorage: StorageLike = {
  async getItem(name) {
    const webStorage = getWebStorage();
    if (webStorage) return webStorage.getItem(name);

    try {
      return await AsyncStorage.getItem(name);
    } catch (error) {
      logStorageFallback(error);
      return memoryStorage.get(name) ?? null;
    }
  },

  async setItem(name, value) {
    const webStorage = getWebStorage();
    if (webStorage) {
      webStorage.setItem(name, value);
      return;
    }

    try {
      await AsyncStorage.setItem(name, value);
    } catch (error) {
      logStorageFallback(error);
      memoryStorage.set(name, value);
    }
  },

  async removeItem(name) {
    const webStorage = getWebStorage();
    if (webStorage) {
      webStorage.removeItem(name);
      return;
    }

    try {
      await AsyncStorage.removeItem(name);
    } catch (error) {
      logStorageFallback(error);
      memoryStorage.delete(name);
    }
  },
};
