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

    try {
      const redirectUri = `${window.location.origin}/mobile-poc/wss-apps/`;
      const authenticated = await this.keycloak.init({
        // A hosted Shell inside the Pension WebView must follow the same OIDC
        // flow as the browser. Check for the existing SSO session first, then
        // explicitly enter Keycloak when the WebView has no session yet.
        onLoad: this.embeddedHostedMode ? 'check-sso' : 'login-required',
        checkLoginIframe: false,
        redirectUri
      });
      if (!authenticated) {
        await this.keycloak.login({ redirectUri });
        return;
      }

      window.__healthAuth = { authenticated: true, token: this.keycloak.token ?? '' };
      window.dispatchEvent(new Event('health-auth-ready'));
      this.authReady.set(true);
    } catch (error) {
      console.error('[Health Shell] browser sign-in failed', error);
      if (this.embeddedHostedMode) {
        try {
          await this.keycloak.login({ redirectUri: `${window.location.origin}/mobile-poc/wss-apps/` });
          return;
        } catch {
          // Fall through to the same visible error used by the browser build.
        }
      }
      this.error.set('Unable to sign in to the Health application.');
    }
  }

  logout(): void {
    void this.keycloak.logout({ redirectUri: `${window.location.origin}/mobile-poc/` });
  }
}
