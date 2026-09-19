import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { BiometricAuth, BiometryType } from '@aparajita/capacitor-biometric-auth';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { inject, Injectable, InjectionToken, signal } from '@angular/core';
import { MobileDeviceSecurity } from './mobile-device-security';

export const MOBILE_SECURE_STORAGE = new InjectionToken<typeof SecureStorage>(
  'Mobile secure storage',
  {
    providedIn: 'root',
    factory: () => SecureStorage,
  },
);

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
class InvalidSessionError extends Error {}

export function refreshResponseRequiresSignIn(status: number): boolean {
  return status === 400 || status === 401 || status === 403;
}

const KEYCLOAK_BASE = 'https://brianthedeveloper.com';
const REALM = 'trs-demo';
const CLIENT_ID = 'health-portal';
const SESSION_KEY = 'mytrs.mobile.session';
const REFRESH_TIMEOUT_MS = 10_000;

@Injectable({ providedIn: 'root' })
export class MobileAuthService {
  private readonly storage = inject(MOBILE_SECURE_STORAGE);
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
  readonly reconnecting = signal(false);
  readonly connectionRestored = signal(0);
  readonly onlineSignInRequired = signal(false);
  private biometricPromptActive = false;
  private revalidationInFlight = false;
  private sessionGeneration = 0;
  private activeSession: StoredSession | null = null;
  private retryTimer?: number;
  private retryDelay = 5_000;

  async initialize(): Promise<void> {
    if (this.initialized()) return;
    if (!Capacitor.isNativePlatform()) {
      this.initialized.set(true);
      return;
    }

    window.addEventListener('online', () => this.applyNetworkStatus(true));
    window.addEventListener('offline', () => this.applyNetworkStatus(false));

    try {
      this.applyNetworkStatus((await Network.getStatus()).connected);
      await Network.addListener('networkStatusChange', ({ connected }) => {
        this.applyNetworkStatus(connected);
      });
    } catch {
      // Browser events remain as a fallback for an older native package that
      // has not yet synchronized the Capacitor Network plugin.
    }

    if (Capacitor.getPlatform() === 'ios') {
      try {
        await MobileDeviceSecurity.addListener('deviceLocked', () => this.lockForBackground());
      } catch {
        await App.addListener('pause', () => this.lockForBackground());
      }
    } else {
      await App.addListener('pause', () => this.lockForBackground());
    }

    await App.addListener('resume', () => {
      void this.handleNativeResume();
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
    const generation = ++this.sessionGeneration;
    this.cancelRetry();
    this.activeSession = null;
    this.authenticated.set(false);
    this.lockedForBackground.set(false);
    this.onlineSignInRequired.set(false);
    delete window.__mobileAuth;
    delete window.__healthAuth;
    this.error.set('');
    this.busy.set(true);

    try {
      if (!username.trim() || !password) {
        throw new Error('Credentials are required.');
      }
      const response = await fetch(
        `${KEYCLOAK_BASE}/realms/${REALM}/protocol/openid-connect/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'password',
            client_id: CLIENT_ID,
            username: username.trim(),
            password,
            // Keycloak offline tokens are not tied to the normal short SSO
            // idle window. Realms that permit this client scope can therefore
            // keep remembered-device biometric access online for much longer.
            scope: 'openid profile offline_access',
          }),
        },
      );
      const tokens = (await response.json()) as TokenResponse & { error?: string };
      if (generation !== this.sessionGeneration) return;
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
            iosFallbackTitle: 'Use device passcode',
          });
        } catch {
          // The session remains active; biometric unlock can be enabled later.
        } finally {
          this.biometricPromptActive = false;
        }
      }
    } catch (error) {
      if (generation !== this.sessionGeneration) return;
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
          iosFallbackTitle: 'Use device passcode',
        });
      } finally {
        this.biometricPromptActive = false;
      }
      const saved = this.activeSession ?? (await this.readStoredSession());
      if (!saved) {
        this.hasSavedSession.set(false);
        throw new Error('No saved session is available.');
      }
      this.activeSession = saved;
      if (this.onlineSignInRequired()) {
        await this.activateStoredSession(saved, true);
        return;
      }
      if (!this.online()) {
        await this.activateStoredSession(saved);
        return;
      }

      try {
        const tokens = await this.exchangeRefreshToken(saved.refreshToken);
        await this.activateSession(tokens, saved.memberName, this.hasSavedSession());
      } catch (error) {
        // A temporary network outage or expired server refresh session must
        // not turn a valid local biometric unlock into a forced credential
        // login. Only server-backed updates require fresh credentials.
        if (error instanceof NetworkAuthError) {
          await this.activateStoredSession(saved);
          return;
        }
        if (error instanceof InvalidSessionError) {
          await this.activateStoredSession(saved, true);
          return;
        }
        throw error;
      }
    } catch (error) {
      if (!this.error()) {
        this.error.set(
          error instanceof InvalidSessionError
            ? 'Your saved session has expired. Sign in again.'
            : 'Unlock was cancelled or the saved session has expired. Sign in again.',
        );
      }
      this.busy.set(false);
    }
  }

  async logout(): Promise<void> {
    // Sign out clears the active access token but retains the opt-in refresh
    // token so the user can return through biometric unlock.
    this.sessionGeneration++;
    this.cancelRetry();
    this.activeSession = null;
    this.authenticated.set(false);
    this.offlineMode.set(false);
    this.lockedForBackground.set(false);
    this.onlineSignInRequired.set(false);
    delete window.__mobileAuth;
    delete window.__healthAuth;
    this.error.set('');
    this.busy.set(false);
    this.hasSavedSession.set((await this.readStoredSession()) !== null);
  }

  /** Network availability never determines whether the member is authenticated. */
  markUnavailable(): void {
    if (!this.authenticated()) return;
    this.offlineMode.set(true);
    if (window.__mobileAuth) window.__mobileAuth.offline = true;
    this.scheduleRetry();
  }

  retryConnection(): void {
    if (this.authenticated() && this.online()) void this.revalidateOnlineSession();
  }

  private applyNetworkStatus(connected: boolean): void {
    const wasOnline = this.online();
    this.online.set(connected);
    if (!connected) {
      this.cancelRetry();
      if (this.authenticated()) this.markUnavailable();
      return;
    }
    if (
      this.authenticated() &&
      !this.onlineSignInRequired() &&
      (!wasOnline || this.offlineMode())
    ) {
      void this.revalidateOnlineSession();
    }
  }

  private async handleNativeResume(): Promise<void> {
    try {
      this.applyNetworkStatus((await Network.getStatus()).connected);
    } catch {
      this.applyNetworkStatus(navigator.onLine);
    }
    if (this.lockedForBackground()) {
      this.error.set('Unlock with biometrics to continue.');
    } else if (
      this.authenticated() &&
      this.online() &&
      !this.onlineSignInRequired()
    ) {
      void this.revalidateOnlineSession();
    }
  }

  private cancelRetry(): void {
    window.clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  private scheduleRetry(delay?: number): void {
    this.cancelRetry();
    if (!this.authenticated() || !this.online()) return;
    this.retryTimer = window.setTimeout(
      () => void this.revalidateOnlineSession(),
      delay ?? this.retryDelay,
    );
    if (delay === undefined) this.retryDelay = Math.min(this.retryDelay * 2, 60_000);
  }

  private async exchangeRefreshToken(refreshToken: string): Promise<TokenResponse> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${KEYCLOAK_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: CLIENT_ID,
          refresh_token: refreshToken,
        }),
        signal: controller.signal,
      });
    } catch {
      window.clearTimeout(timeout);
      throw new NetworkAuthError('Refresh could not reach the identity provider.');
    }

    try {
      return await this.parseRefreshResponse(response);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  private async parseRefreshResponse(response: Response): Promise<TokenResponse> {
    if (refreshResponseRequiresSignIn(response.status)) {
      throw new InvalidSessionError('Refresh session is no longer valid.');
    }
    if (!response.ok) {
      throw new NetworkAuthError(`Refresh service returned HTTP ${response.status}.`);
    }

    let tokens: TokenResponse;
    try {
      tokens = (await response.json()) as TokenResponse;
    } catch {
      throw new NetworkAuthError('Refresh service returned an invalid response.');
    }
    if (!tokens.access_token) {
      throw new NetworkAuthError('Refresh service returned no access token.');
    }
    return tokens;
  }

  private async activateSession(
    tokens: TokenResponse,
    fallbackName: string,
    save: boolean,
  ): Promise<void> {
    const generation = this.sessionGeneration;
    const wasOffline = this.offlineMode();
    if (!tokens.access_token) {
      throw new Error('Missing access token.');
    }
    const name = this.claimMemberName(tokens.id_token) || fallbackName || 'Jordan Davis';
    this.activeSession = {
      refreshToken: tokens.refresh_token ?? this.activeSession?.refreshToken ?? '',
      memberName: name,
      accessToken: tokens.access_token,
      tokenType: tokens.token_type ?? 'Bearer',
    };
    this.memberName.set(name);
    const snapshot = {
      authenticated: true,
      token: tokens.access_token,
      tokenType: tokens.token_type ?? 'Bearer',
      expiresIn: tokens.expires_in ?? 0,
      offline: !this.online(),
    };
    window.__mobileAuth = snapshot;
    window.__healthAuth = { authenticated: true, token: tokens.access_token };
    window.dispatchEvent(new Event('health-auth-ready'));

    if (save && this.activeSession.refreshToken) {
      const session: StoredSession = {
        refreshToken: this.activeSession.refreshToken,
        memberName: name,
        accessToken: tokens.access_token,
        tokenType: tokens.token_type ?? 'Bearer',
      };
      await this.storage.set(
        SESSION_KEY,
        JSON.stringify(session),
        false,
        false,
        KeychainAccess.whenPasscodeSetThisDeviceOnly,
      );
      this.hasSavedSession.set(true);
    } else if (!save) {
      await this.storage.remove(SESSION_KEY).catch(() => false);
      this.hasSavedSession.set(false);
    }
    if (generation !== this.sessionGeneration) return;
    this.offlineMode.set(!this.online());
    this.onlineSignInRequired.set(false);
    this.lockedForBackground.set(false);
    this.authenticated.set(true);
    this.busy.set(false);
    if (wasOffline && this.online()) this.connectionRestored.update((value) => value + 1);
    this.retryDelay = 5_000;
    this.scheduleRetry(Math.max(10_000, ((tokens.expires_in || 60) - 30) * 1_000));
  }

  private async activateStoredSession(
    saved: StoredSession,
    onlineSignInRequired = false,
  ): Promise<void> {
    this.activeSession = saved;
    const name = saved.memberName || 'Jordan Davis';
    this.memberName.set(name);
    window.__mobileAuth = {
      authenticated: true,
      token: saved.accessToken ?? '',
      tokenType: saved.tokenType ?? 'Bearer',
      expiresIn: 0,
      offline: true,
    };
    window.__healthAuth = { authenticated: true, token: saved.accessToken ?? '' };
    window.dispatchEvent(new Event('health-auth-ready'));
    this.offlineMode.set(true);
    this.onlineSignInRequired.set(onlineSignInRequired);
    this.lockedForBackground.set(false);
    this.authenticated.set(true);
    this.busy.set(false);
    if (!onlineSignInRequired) this.scheduleRetry();
  }

  private async revalidateOnlineSession(): Promise<void> {
    if (this.revalidationInFlight || !this.authenticated() || !this.online()) return;
    this.revalidationInFlight = true;
    this.reconnecting.set(true);
    const generation = this.sessionGeneration;

    try {
      const saved = this.activeSession ?? (await this.readStoredSession());
      if (generation !== this.sessionGeneration || !this.authenticated()) return;
      if (!saved?.refreshToken) {
        this.markUnavailable();
        return;
      }
      const tokens = await this.exchangeRefreshToken(saved.refreshToken);
      if (generation !== this.sessionGeneration || !this.authenticated()) return;
      await this.activateSession(tokens, saved.memberName, this.hasSavedSession());
    } catch (error) {
      if (generation !== this.sessionGeneration || !this.authenticated()) return;
      if (error instanceof InvalidSessionError) {
        if (this.hasSavedSession() && this.activeSession) {
          this.cancelRetry();
          await this.activateStoredSession(this.activeSession, true);
        } else {
          await this.clearSavedSession();
          this.error.set('Your online session has expired. Sign in again.');
        }
      } else {
        this.markUnavailable();
      }
      // Transient failures retain the session and retry with bounded backoff.
    } finally {
      this.revalidationInFlight = false;
      this.reconnecting.set(false);
    }
  }

  private async clearSavedSession(): Promise<void> {
    this.sessionGeneration++;
    this.cancelRetry();
    this.activeSession = null;
    await this.storage.remove(SESSION_KEY).catch(() => false);
    this.hasSavedSession.set(false);
    this.authenticated.set(false);
    this.offlineMode.set(false);
    this.lockedForBackground.set(false);
    this.onlineSignInRequired.set(false);
    delete window.__mobileAuth;
    delete window.__healthAuth;
  }

  private lockForBackground(): void {
    if (!Capacitor.isNativePlatform() || this.biometricPromptActive || !this.authenticated())
      return;

    this.sessionGeneration++;
    this.cancelRetry();
    this.authenticated.set(false);
    this.offlineMode.set(false);
    this.lockedForBackground.set(true);
    delete window.__mobileAuth;
    delete window.__healthAuth;
  }

  private async readStoredSession(): Promise<StoredSession | null> {
    try {
      const value = await this.storage.get(SESSION_KEY);
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
      const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as {
        name?: string;
        preferred_username?: string;
      };
      return claims.name || claims.preferred_username || '';
    } catch {
      return '';
    }
  }
}
