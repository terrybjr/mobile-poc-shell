import { Injectable } from '@angular/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';

const CACHE_PREFIX = 'mytrs.mobile.cache.';

@Injectable({ providedIn: 'root' })
export class MobileOfflineCacheService {
  async read<T>(key: string): Promise<T | null> {
    try {
      const value = await SecureStorage.get(`${CACHE_PREFIX}${key}`);
      if (typeof value === 'string') return JSON.parse(value) as T;
      return value as T | null;
    } catch {
      return null;
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    try {
      await SecureStorage.set(
        `${CACHE_PREFIX}${key}`,
        JSON.stringify(value),
        false,
        false,
        KeychainAccess.whenPasscodeSetThisDeviceOnly,
      );
    } catch {
      // Cached data is an enhancement; an unavailable secure store must not
      // interrupt the member experience or a successful API response.
    }
  }
}
