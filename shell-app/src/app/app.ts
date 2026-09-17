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
  }
}

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MobileHomeComponent, MobileLoginComponent],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App implements OnInit {
  protected readonly mobileMode = Capacitor.isNativePlatform();
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
      const authenticated = await this.keycloak.init({
        onLoad: 'login-required',
        checkLoginIframe: false,
        redirectUri: `${window.location.origin}/pension/shell/`
      });
      if (!authenticated) {
        this.error.set('Unable to establish a Health session.');
        return;
      }

      window.__healthAuth = { authenticated: true, token: this.keycloak.token ?? '' };
      window.dispatchEvent(new Event('health-auth-ready'));
      this.authReady.set(true);
    } catch {
      this.error.set('Unable to sign in to the Health application.');
    }
  }

  logout(): void {
    void this.keycloak.logout({ redirectUri: `${window.location.origin}/pension/` });
  }
}
