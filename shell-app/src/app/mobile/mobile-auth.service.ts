import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { BiometricAuth, BiometryType } from '@aparajita/capacitor-biometric-auth';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Injectable, signal } from '@angular/core';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface StoredSession {
  refreshToken: string;
  memberName: string;
  accessToken?: string;
  tokenType?: string;
}

class NetworkAuthError extends Error {}

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
  readonly offlineMode = signal(false);
  readonly lockedForBackground = signal(false);
  private biometricPromptActive = false;

  async initialize(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      this.initialized.set(true);
      return;
    }

    window.addEventListener('online', () => {
      this.online.set(true);
      if (this.authenticated() && this.offlineMode()) void this.revalidateOnlineSession();
    });
    window.addEventListener('offline', () => this.online.set(false));

    await App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        this.lockForBackground();
      } else if (this.lockedForBackground()) {
        this.error.set('Unlock with biometrics to continue.');
      }
    });

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
        const description = tokens.error_description ?? tokens.error;
        throw new Error(description ?? 'Direct mobile sign-in failed.');
      }
      await this.activateSession(tokens, this.claimMemberName(tokens.id_token), rememberDevice);
      if (rememberDevice && Capacitor.isNativePlatform()) {
        this.biometricPromptActive = true;
        try {
          await BiometricAuth.authenticate({
            reason: 'Enable Face ID to unlock your saved MyTRS session',
            allowDeviceCredential: true,
            iosFallbackTitle: 'Use device passcode'
          });
        } catch {
          // The session remains active; biometric unlock can be enabled later.
        } finally {
          this.biometricPromptActive = false;
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      this.error.set(message || 'The username or password could not be verified.');
      this.busy.set(false);
    }
  }

  async unlockSavedSession(): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      this.biometricPromptActive = true;
      try {
        await BiometricAuth.authenticate({
          reason: 'Unlock your secure MyTRS mobile session',
          allowDeviceCredential: true,
          iosFallbackTitle: 'Use device passcode'
        });
      } finally {
        this.biometricPromptActive = false;
      }
      const saved = await this.readStoredSession();
      if (!saved) {
        this.hasSavedSession.set(false);
        throw new Error('No saved session is available.');
      }
      if (!this.online()) {
        await this.activateStoredSession(saved);
        return;
      }

      try {
        const tokens = await this.exchangeRefreshToken(saved.refreshToken);
        await this.activateSession(tokens, saved.memberName, true);
      } catch (error) {
        // A temporary network outage must not turn a valid local biometric
        // unlock into a forced credential login. An invalid/revoked refresh
        // token still requires a fresh sign-in.
        if (error instanceof NetworkAuthError && saved.accessToken) {
          await this.activateStoredSession(saved);
          return;
        }
        throw error;
      }
    } catch {
      this.error.set('Unlock was cancelled or the saved session has expired. Sign in again.');
      this.busy.set(false);
    }
  }

  async logout(): Promise<void> {
    // Sign out clears the active access token but retains the opt-in refresh
    // token so the user can return through biometric unlock.
    this.hasSavedSession.set((await this.readStoredSession()) !== null);
    this.authenticated.set(false);
    this.offlineMode.set(false);
    this.lockedForBackground.set(false);
    delete window.__mobileAuth;
    delete window.__healthAuth;
    this.error.set('');
  }

  private async exchangeRefreshToken(refreshToken: string): Promise<TokenResponse> {
    let response: Response;
    try {
      response = await fetch(`${KEYCLOAK_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: refreshToken })
      });
    } catch {
      throw new NetworkAuthError('Refresh could not reach the identity provider.');
    }
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
    const snapshot = { authenticated: true, token: tokens.access_token, tokenType: tokens.token_type ?? 'Bearer', expiresIn: tokens.expires_in ?? 0, offline: false };
    window.__mobileAuth = snapshot;
    window.__healthAuth = { authenticated: true, token: tokens.access_token };
    window.dispatchEvent(new Event('health-auth-ready'));

    if (save && tokens.refresh_token) {
      const session: StoredSession = {
        refreshToken: tokens.refresh_token,
        memberName: name,
        accessToken: tokens.access_token,
        tokenType: tokens.token_type ?? 'Bearer'
      };
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
    this.offlineMode.set(false);
    this.lockedForBackground.set(false);
    this.authenticated.set(true);
    this.busy.set(false);
  }

  private async activateStoredSession(saved: StoredSession): Promise<void> {
    const name = saved.memberName || 'Jordan Davis';
    this.memberName.set(name);
    window.__mobileAuth = {
      authenticated: true,
      token: saved.accessToken ?? '',
      tokenType: saved.tokenType ?? 'Bearer',
      expiresIn: 0,
      offline: true
    };
    window.__healthAuth = { authenticated: true, token: saved.accessToken ?? '' };
    window.dispatchEvent(new Event('health-auth-ready'));
    this.offlineMode.set(true);
    this.lockedForBackground.set(false);
    this.authenticated.set(true);
    this.busy.set(false);
  }

  private async revalidateOnlineSession(): Promise<void> {
    const saved = await this.readStoredSession();
    if (!saved) return;
    try {
      const tokens = await this.exchangeRefreshToken(saved.refreshToken);
      await this.activateSession(tokens, saved.memberName, true);
    } catch {
      // Keep the read-only offline session until the member explicitly signs
      // in again; an intermittent reconnect must not discard cached access.
    }
  }

  private lockForBackground(): void {
    if (!Capacitor.isNativePlatform() || this.biometricPromptActive || !this.authenticated()) return;

    this.authenticated.set(false);
    this.offlineMode.set(false);
    this.lockedForBackground.set(true);
    delete window.__mobileAuth;
    delete window.__healthAuth;
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
