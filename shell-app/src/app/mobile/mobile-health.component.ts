import { HttpClient } from '@angular/common/http';
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
    this.http.put<HealthSummary>('/mobile-poc/wss-apps/health-ws/api/health', this.draft, this.options(token)).subscribe({
      next: data => { this.apply(data); this.saved.set(true); this.busy.set(false); },
      error: () => { this.error.set('The mocked Health data could not be updated.'); this.busy.set(false); }
    });
  }

  protected reset(): void {
    const token = window.__mobileAuth?.token;
    if (!token) { this.error.set('Your mobile session is no longer available.'); return; }
    this.busy.set(true); this.saved.set(false); this.error.set('');
    this.http.delete<HealthSummary>('/mobile-poc/wss-apps/health-ws/api/health', this.options(token)).subscribe({
      next: data => { this.apply(data); this.saved.set(true); this.busy.set(false); },
      error: () => { this.error.set('The mocked Health data could not be reset.'); this.busy.set(false); }
    });
  }

  private load(): void {
    const token = window.__mobileAuth?.token;
    this.loading.set(true); this.error.set('');
    if (!token) { this.error.set('Your mobile session is no longer available.'); this.loading.set(false); return; }
    this.http.get<HealthSummary>('/mobile-poc/wss-apps/health-ws/api/health', this.options(token)).subscribe({
      next: data => { this.apply(data); this.loading.set(false); },
      error: () => { this.error.set('Health data is temporarily unavailable.'); this.loading.set(false); }
    });
  }

  private apply(data: HealthSummary): void { this.member.set(data); this.draft = { ...data }; }
  private options(token: string): { headers: { Authorization: string } } { return { headers: { Authorization: `Bearer ${token}` } }; }
}
