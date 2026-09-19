import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MobileAuthService } from './mobile-auth.service';
import { MobileOfflineCacheService } from './mobile-offline-cache.service';

interface PensionSummary {
  memberName: string;
  memberId: string;
  plan: string;
  status: string;
  communication: string;
  lastUpdated: string;
  serviceYears: number;
  estimatedMonthlyBenefit: number;
  retirementEligibility: string;
}

const INITIAL_PENSION: PensionSummary = {
  memberName: 'Jordan Davis',
  memberId: 'TRS-2048-117',
  plan: 'Teacher Retirement Plan',
  status: 'Active',
  communication: 'Email',
  lastUpdated: 'September 16, 2026',
  serviceYears: 12,
  estimatedMonthlyBenefit: 2486,
  retirementEligibility: 'June 2049',
};
const API_BASE = 'https://brianthedeveloper.com';

@Component({
  selector: 'app-mobile-pension',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './mobile-pension.component.html',
  styleUrl: './mobile-pension.component.css',
})
export class MobilePensionComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(MobileAuthService);
  private readonly cache = inject(MobileOfflineCacheService);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal('');
  protected readonly member = signal<PensionSummary>({ ...INITIAL_PENSION });
  protected draft: PensionSummary = { ...INITIAL_PENSION };

  ngOnInit(): void {
    this.load();
  }

  protected refresh(): void {
    if (this.auth.online() && !this.auth.offlineMode()) this.load();
  }

  protected canMutate(): boolean {
    return this.auth.online() && !this.auth.offlineMode();
  }

  protected save(): void {
    if (!this.canMutate()) {
      this.error.set('You are offline. Pension changes are disabled until you reconnect.');
      return;
    }
    const token = window.__mobileAuth?.token;
    if (!token) {
      this.error.set('Your mobile session is no longer available.');
      return;
    }
    this.busy.set(true);
    this.saved.set(false);
    this.error.set('');
    this.http
      .put<PensionSummary>(`${API_BASE}/pension/api/pension`, this.draft, this.options(token))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.apply(data);
          this.saved.set(true);
          this.busy.set(false);
        },
        error: (error) => {
          this.logApiError('PUT', error);
          this.error.set(this.apiError(error, 'updated'));
          this.busy.set(false);
        },
      });
  }

  protected reset(): void {
    if (!this.canMutate()) {
      this.error.set('You are offline. Restoring sample values is disabled until you reconnect.');
      return;
    }
    const token = window.__mobileAuth?.token;
    if (!token) {
      this.error.set('Your mobile session is no longer available.');
      return;
    }
    this.busy.set(true);
    this.saved.set(false);
    this.error.set('');
    this.http
      .delete<PensionSummary>(`${API_BASE}/pension/api/pension`, this.options(token))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.apply(data);
          this.saved.set(true);
          this.busy.set(false);
        },
        error: (error) => {
          this.logApiError('DELETE', error);
          this.error.set(this.apiError(error, 'reset'));
          this.busy.set(false);
        },
      });
  }

  private load(): void {
    void this.loadCachedThenRefresh();
  }

  private async loadCachedThenRefresh(): Promise<void> {
    const cached = await this.cache.read<PensionSummary>('pension');
    if (this.destroyRef.destroyed) return;
    if (cached) this.apply(cached);

    const token = window.__mobileAuth?.token;
    this.loading.set(true);
    this.error.set('');
    if (!token || !this.auth.online() || this.auth.offlineMode()) {
      if (!cached)
        this.error.set('Offline. Pension information has not been cached on this device yet.');
      this.loading.set(false);
      return;
    }
    this.http
      .get<PensionSummary>(`${API_BASE}/pension/api/pension`, this.options(token))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.apply(data);
          void this.cache.write('pension', data);
          this.loading.set(false);
        },
        error: (error) => {
          this.logApiError('GET', error);
          this.error.set(this.apiError(error, 'loaded'));
          this.loading.set(false);
        },
      });
  }

  private apply(data: PensionSummary): void {
    this.member.set(data);
    this.draft = { ...data };
    void this.cache.write('pension', data);
  }
  private options(token: string): { headers: { Authorization: string } } {
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  private logApiError(method: string, error: unknown): void {
    if (error instanceof HttpErrorResponse) {
      console.error(`[Mobile Pension] ${method} ${error.url ?? ''} failed`, {
        status: error.status,
        statusText: error.statusText,
        message: error.message,
        body: error.error,
      });
    } else {
      console.error(`[Mobile Pension] ${method} request failed`, error);
    }
  }

  private apiError(error: unknown, action: string): string {
    if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
      return `Pension API rejected the mobile session (HTTP ${error.status}).`;
    }
    if (error instanceof HttpErrorResponse && error.status === 0) {
      return action === 'loaded'
        ? 'Unable to refresh right now. Previously loaded information is still available.'
        : 'We could not confirm this update. Your entries are still here; reconnect and check before saving again.';
    }
    if (error instanceof HttpErrorResponse && error.status > 0) {
      return `Pension API returned HTTP ${error.status}.`;
    }
    return `Pension information could not be ${action}.`;
  }
}
