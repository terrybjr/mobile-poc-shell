import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MobileAuthService } from './mobile-auth.service';

@Component({
  selector: 'app-mobile-login',
  imports: [FormsModule],
  templateUrl: './mobile-login.component.html',
  styleUrl: './mobile-login.component.css'
})
export class MobileLoginComponent {
  protected readonly auth = inject(MobileAuthService);
  protected rememberDevice = true;

  signIn(): void {
    void this.auth.beginLogin(this.rememberDevice);
  }

  unlock(): void {
    void this.auth.unlockSavedSession();
  }
}
