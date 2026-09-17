import { Component, inject } from '@angular/core';
import { MobileAuthService } from './mobile-auth.service';

@Component({
  selector: 'app-mobile-home',
  templateUrl: './mobile-home.component.html',
  styleUrl: './mobile-home.component.css'
})
export class MobileHomeComponent {
  protected readonly auth = inject(MobileAuthService);

  signOut(): void {
    void this.auth.logout();
  }
}
