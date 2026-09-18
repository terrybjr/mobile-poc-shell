import { Capacitor } from '@capacitor/core';
import { Component, OnInit, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import Keycloak from 'keycloak-js';
import { MobileHomeComponent } from './mobile/mobile-home.component';
import { MobileLoginComponent } from './mobile/mobile-login.component';
import { MobileAuthService } from './mobile/mobile-auth.service';

declare global {
  interface Window {
    __healthAuth?: { authenticated: boolean; token: string };
    __mobileAuth?: { authenticated: boolean; token: string; tokenType: string; expiresIn: number };
  }
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MobileHomeComponent, MobileLoginComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  // A hosted Shell page can also be loaded inside another Capacitor WebView
  // (for example the legacy Pension passthrough). Only the Shell's own local
  // Capacitor origin should render the dedicated native experience.
  protected readonly mobileMode = Capacitor.isNativePlatform()
    && (window.location.protocol === 'capacitor:' || window.location.hostname === 'localhost');
  protected readonly embeddedHostedMode = Capacitor.isNativePlatform() && !this.mobileMode;
  protected readonly mobileAuth = inject(MobileAuthService);

  private readonly keycloak = new Keycloak({
    url: 'https://brianthedeveloper.com',
    realm: 'trs-demo',
    clientId: 'health-portal'
  });

  protected readonly authReady = signal(false);
  protected readonly error = signal('');

  async ngOnInit(): Promise<void> {
    if (this.mobileMode) {
      await this.mobileAuth.initialize();
      this.authReady.set(true);
      return;
    }

    const redirectUri = `${window.location.origin}/mobile-poc/wss-apps/`;
    if (this.embeddedHostedMode && !this.hasKeycloakResponse()) {
      try {
        await this.redirectToHealthLogin(redirectUri);
        return;
      } catch (error) {
        console.error('[Health Shell] embedded browser login redirect failed', this.describeError(error));
      }
    }

    try {
      const authenticated = await this.keycloak.init({
        // The hosted Shell inside the Pension WebView follows the same
        // browser redirect flow; it must not use the native credential flow.
        onLoad: 'login-required',
        checkLoginIframe: false,
        redirectUri
      });
      if (!authenticated) {
        await this.redirectToHealthLogin(redirectUri);
        return;
      }

      window.__healthAuth = { authenticated: true, token: this.keycloak.token ?? '' };
      window.dispatchEvent(new Event('health-auth-ready'));
      this.authReady.set(true);
    } catch (error) {
      console.error('[Health Shell] browser sign-in failed', this.describeError(error));
      if (this.embeddedHostedMode) {
        try {
          await this.redirectToHealthLogin(`${window.location.origin}/mobile-poc/wss-apps/`);
          return;
        } catch {
          // Fall through to the same visible error used by the browser build.
        }
      }
      this.error.set('Unable to sign in to the Health application.');
    }
  }

  private async redirectToHealthLogin(redirectUri: string): Promise<void> {
    const loginUrl = await this.keycloak.createLoginUrl({ redirectUri });
    window.location.assign(loginUrl);
  }

  private hasKeycloakResponse(): boolean {
    return /(?:^|[&#?])(code|error)=/.test(`${window.location.search}${window.location.hash}`);
  }

  private describeError(error: unknown): unknown {
    if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack };
    return String(error);
  }

  logout(): void {
    void this.keycloak.logout({ redirectUri: `${window.location.origin}/mobile-poc/` });
  }
}
