import { Capacitor } from '@capacitor/core';
import { BiometricAuth, BiometryType } from '@aparajita/capacitor-biometric-auth';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Injectable, signal } from '@angular/core';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
}

interface StoredSession {
  refreshToken: string;
  memberName: string;
}

const KEYCLOAK_BASE = 'https://brianthedeveloper.com';
const REALM = 'trs-demo';
const CLIENT_ID = 'health-portal';
const SESSION_KEY = 'mytrs.mobile.session';

@Injectable({ providedIn: 'root' })
export class MobileAuthService {
  readonly authenticated = signal(false);
  readonly initialized = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly hasSavedSession = signal(false);
  readonly biometricLabel = signal('Face ID');
  readonly memberName = signal('Jordan Davis');
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);

  async initialize(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      this.initialized.set(true);
      return;
    }

    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));

    try {
      const biometry = await BiometricAuth.checkBiometry();
      if (biometry.biometryType === BiometryType.touchId) {
        this.biometricLabel.set('Touch ID');
      } else if (biometry.biometryType === BiometryType.faceId) {
        this.biometricLabel.set('Face ID');
      } else if (biometry.isAvailable) {
        this.biometricLabel.set('Biometric unlock');
      } else {
        this.biometricLabel.set('Device unlock');
      }
    } catch {
      this.biometricLabel.set('Device unlock');
    }

    this.hasSavedSession.set((await this.readStoredSession()) !== null);
    this.initialized.set(true);
  }

  async beginLogin(username: string, password: string, rememberDevice: boolean): Promise<void> {
    this.error.set('');
    this.busy.set(true);

    try {
      if (!username.trim() || !password) {
        throw new Error('Credentials are required.');
      }
      const response = await fetch(`${KEYCLOAK_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: CLIENT_ID,
          username: username.trim(),
          password,
          scope: 'openid profile'
        })
      });
      const tokens = (await response.json()) as TokenResponse & { error?: string };
      if (!response.ok || !tokens.access_token) {
        throw new Error(tokens.error ?? 'Direct mobile sign-in failed.');
      }
      await this.activateSession(tokens, this.claimMemberName(tokens.id_token), rememberDevice);
    } catch {
      this.error.set('The username or password could not be verified.');
      this.busy.set(false);
    }
  }

  async unlockSavedSession(): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await BiometricAuth.authenticate({
        reason: 'Unlock your secure MyTRS mobile session',
        allowDeviceCredential: true,
        iosFallbackTitle: 'Use device passcode'
      });
      const saved = await this.readStoredSession();
      if (!saved) {
        this.hasSavedSession.set(false);
        throw new Error('No saved session is available.');
      }
      const tokens = await this.exchangeRefreshToken(saved.refreshToken);
      await this.activateSession(tokens, saved.memberName, true);
    } catch {
      this.error.set('Unlock was cancelled or the saved session has expired. Sign in again.');
      this.busy.set(false);
    }
  }

  async logout(): Promise<void> {
    await SecureStorage.remove(SESSION_KEY).catch(() => false);
    this.hasSavedSession.set(false);
    this.authenticated.set(false);
    delete window.__mobileAuth;
    delete window.__healthAuth;
    this.error.set('');
  }

  private async exchangeRefreshToken(refreshToken: string): Promise<TokenResponse> {
    const response = await fetch(`${KEYCLOAK_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refreshToken })
    });
    if (!response.ok) {
      throw new Error('Refresh failed.');
    }
    return (await response.json()) as TokenResponse;
  }

  private async activateSession(tokens: TokenResponse, fallbackName: string, save: boolean): Promise<void> {
    if (!tokens.access_token) {
      throw new Error('Missing access token.');
    }
    const name = this.claimMemberName(tokens.id_token) || fallbackName || 'Jordan Davis';
    this.memberName.set(name);
    const snapshot = { authenticated: true, token: tokens.access_token, tokenType: tokens.token_type ?? 'Bearer', expiresIn: tokens.expires_in ?? 0 };
    window.__mobileAuth = snapshot;
    window.__healthAuth = { authenticated: true, token: tokens.access_token };
    window.dispatchEvent(new Event('health-auth-ready'));

    if (save && tokens.refresh_token) {
      const session: StoredSession = { refreshToken: tokens.refresh_token, memberName: name };
      await SecureStorage.set(
        SESSION_KEY,
        JSON.stringify(session),
        false,
        false,
        KeychainAccess.whenPasscodeSetThisDeviceOnly
      );
      this.hasSavedSession.set(true);
    } else if (!save) {
      await SecureStorage.remove(SESSION_KEY).catch(() => false);
      this.hasSavedSession.set(false);
    }
    this.authenticated.set(true);
    this.busy.set(false);
  }

  private async readStoredSession(): Promise<StoredSession | null> {
    try {
      const value = await SecureStorage.get(SESSION_KEY);
      if (typeof value === 'string') {
        return JSON.parse(value) as StoredSession;
      }
      return value as StoredSession | null;
    } catch {
      return null;
    }
  }

  private claimMemberName(idToken?: string): string {
    if (!idToken) {
      return '';
    }
    try {
      const payload = idToken.split('.')[1];
      const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as { name?: string; preferred_username?: string };
      return claims.name || claims.preferred_username || '';
    } catch {
      return '';
    }
  }

}
