import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

interface HealthSummary {
  memberName: string;
  plan: string;
  status: string;
  medical: string;
  deductible: number;
  fsaBalance: number;
  nextAppointment: string;
}

const INITIAL_HEALTH: HealthSummary = {
  memberName: 'Jordan Davis', plan: 'TRS-Care Premium Plus', status: 'Active', medical: 'PPO',
  deductible: 750, fsaBalance: 240, nextAppointment: 'September 28, 2026'
};
const API_BASE = 'https://brianthedeveloper.com';

@Component({
  selector: 'app-mobile-health', standalone: true, imports: [FormsModule],
  templateUrl: './mobile-health.component.html', styleUrl: './mobile-health.component.css'
})
export class MobileHealthComponent implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal('');
  protected readonly member = signal<HealthSummary>({ ...INITIAL_HEALTH });
  protected draft: HealthSummary = { ...INITIAL_HEALTH };

  ngOnInit(): void { this.load(); }
  protected refresh(): void { this.load(); }

  protected save(): void {
    const token = window.__mobileAuth?.token;
    if (!token) { this.error.set('Your mobile session is no longer available.'); return; }
    this.busy.set(true); this.saved.set(false); this.error.set('');
    this.http.put<HealthSummary>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health`, this.draft, this.options(token)).subscribe({
      next: data => { this.apply(data); this.saved.set(true); this.busy.set(false); },
      error: error => { this.logApiError('PUT', error); this.error.set(this.updateError(error)); this.busy.set(false); }
    });
  }

  protected reset(): void {
    const token = window.__mobileAuth?.token;
    if (!token) { this.error.set('Your mobile session is no longer available.'); return; }
    this.busy.set(true); this.saved.set(false); this.error.set('');
    this.http.delete<HealthSummary>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health`, this.options(token)).subscribe({
      next: data => { this.apply(data); this.saved.set(true); this.busy.set(false); },
      error: error => { this.logApiError('DELETE', error); this.error.set(this.updateError(error)); this.busy.set(false); }
    });
  }

  private load(): void {
    const token = window.__mobileAuth?.token;
    this.loading.set(true); this.error.set('');
    if (!token) { this.error.set('Your mobile session is no longer available.'); this.loading.set(false); return; }
    this.http.get<HealthSummary>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health`, this.options(token)).subscribe({
      next: data => { this.apply(data); this.loading.set(false); },
      error: error => { this.logApiError('GET', error); this.error.set(this.loadError(error)); this.loading.set(false); }
    });
  }

  private apply(data: HealthSummary): void { this.member.set(data); this.draft = { ...data }; }
  private options(token: string): { headers: { Authorization: string } } { return { headers: { Authorization: `Bearer ${token}` } }; }

  private logApiError(method: string, error: unknown): void {
    if (error instanceof HttpErrorResponse) {
      console.error(`[Mobile Health] ${method} ${error.url ?? ''} failed`, { status: error.status, statusText: error.statusText, message: error.message, body: error.error });
    } else {
      console.error(`[Mobile Health] ${method} request failed`, error);
    }
  }

  private loadError(error: unknown): string {
    if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
      return `Health API rejected the mobile session (HTTP ${error.status}).`;
    }
    if (error instanceof HttpErrorResponse && error.status === 0) {
      return 'Health API could not be reached. Check the API deployment or CORS configuration.';
    }
    return error instanceof HttpErrorResponse && error.status > 0
      ? `Health API returned HTTP ${error.status}.`
      : 'Health data is temporarily unavailable.';
  }

  private updateError(error: unknown): string {
    if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) {
      return `Health API rejected the mobile session (HTTP ${error.status}).`;
    }
    if (error instanceof HttpErrorResponse && error.status === 0) {
      return 'Health API could not be reached. Check the API deployment or CORS configuration.';
    }
    return error instanceof HttpErrorResponse && error.status > 0
      ? `Health API returned HTTP ${error.status}.`
      : 'Health information could not be updated.';
  }
}
