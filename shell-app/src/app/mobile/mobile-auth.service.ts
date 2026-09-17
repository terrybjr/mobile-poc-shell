import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { BiometricAuth, BiometryType } from '@aparajita/capacitor-biometric-auth';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';
import { Injectable, signal } from '@angular/core';

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

interface StoredSession {
  refreshToken: string;
  memberName: string;
}

const KEYCLOAK_BASE = 'https://brianthedeveloper.com';
const REALM = 'trs-demo';
const CLIENT_ID = 'health-portal';
const REDIRECT_URI = 'com.brianthedeveloper.mobilepoc.health://oauth/callback';
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

  private oauthState = '';
  private codeVerifier = '';
  private rememberDevice = true;

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
    await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
      if (url.startsWith('com.brianthedeveloper.mobilepoc.health://oauth/callback')) {
        void this.handleCallback(url);
      }
    });
    this.initialized.set(true);
  }

  async beginLogin(rememberDevice: boolean): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    this.rememberDevice = rememberDevice;
    this.oauthState = this.randomString(32);
    this.codeVerifier = this.randomString(64);

    try {
      const challenge = await this.createCodeChallenge(this.codeVerifier);
      const authorizeUrl = new URL(`${KEYCLOAK_BASE}/realms/${REALM}/protocol/openid-connect/auth`);
      authorizeUrl.search = new URLSearchParams({
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'code',
        scope: 'openid profile',
        state: this.oauthState,
        code_challenge: challenge,
        code_challenge_method: 'S256'
      }).toString();
      // Keep OAuth inside the native app's secure browser sheet. The Capacitor
      // Browser plugin uses SFSafariViewController on iOS; this is deliberately
      // not an embedded WebView and never puts the member password in our app.
      await Browser.open({
        url: authorizeUrl.toString(),
        presentationStyle: 'popover',
        toolbarColor: '#0b3d62'
      });
    } catch {
      this.error.set('Unable to open the secure TRS sign-in.');
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
    this.error.set('');
  }

  private async handleCallback(url: string): Promise<void> {
    const callback = new URL(url);
    const error = callback.searchParams.get('error');
    const code = callback.searchParams.get('code');
    const state = callback.searchParams.get('state');
    await Browser.close().catch(() => undefined);

    if (error) {
      this.error.set('TRS sign-in was cancelled.');
      this.busy.set(false);
      return;
    }
    if (!code || state !== this.oauthState) {
      this.error.set('The TRS sign-in response could not be verified.');
      this.busy.set(false);
      return;
    }

    try {
      const response = await fetch(`${KEYCLOAK_BASE}/realms/${REALM}/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLIENT_ID,
          code,
          code_verifier: this.codeVerifier,
          redirect_uri: REDIRECT_URI
        })
      });
      if (!response.ok) {
        throw new Error('Token exchange failed.');
      }
      const tokens = (await response.json()) as TokenResponse;
      await this.activateSession(tokens, this.claimMemberName(tokens.id_token), this.rememberDevice);
    } catch {
      this.error.set('TRS sign-in completed, but the mobile session could not be established.');
      this.busy.set(false);
    }
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

  private randomString(length: number): string {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  private async createCodeChallenge(verifier: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return this.base64Url(new Uint8Array(digest));
  }

  private base64Url(bytes: Uint8Array): string {
    let binary = '';
    bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
}
