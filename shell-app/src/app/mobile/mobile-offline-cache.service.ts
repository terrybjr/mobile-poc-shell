import { inject, Injectable } from '@angular/core';
import { KeychainAccess } from '@aparajita/capacitor-secure-storage';
import { MOBILE_SECURE_STORAGE } from './mobile-auth.service';

const CACHE_PREFIX = 'mytrs.mobile.cache.';

@Injectable({ providedIn: 'root' })
export class MobileOfflineCacheService {
  private readonly storage = inject(MOBILE_SECURE_STORAGE);
  // Shared-device users must never receive another member's cached records.
  private storageKey(key: string): string | null {
    try {
      const token = window.__mobileAuth?.token;
      if (!token) return null;
      const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      const claims = JSON.parse(atob(payload)) as { sub?: string };
      return claims.sub ? `${CACHE_PREFIX}${encodeURIComponent(claims.sub)}.${key}` : null;
    } catch {
      return null;
    }
  }

  async read<T>(key: string): Promise<T | null> {
    const storageKey = this.storageKey(key);
    if (!storageKey) return null;
    try {
      const value = await this.storage.get(storageKey);
      if (typeof value === 'string') return JSON.parse(value) as T;
      return value as T | null;
    } catch {
      return null;
    }
  }

  async write<T>(key: string, value: T): Promise<void> {
    const storageKey = this.storageKey(key);
    if (!storageKey) return;
    try {
      await this.storage.set(
        storageKey,
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
