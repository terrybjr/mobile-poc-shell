import { HttpClient } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

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
  retirementEligibility: 'June 2049'
};

@Component({
  selector: 'app-mobile-pension',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './mobile-pension.component.html',
  styleUrl: './mobile-pension.component.css'
})
export class MobilePensionComponent implements OnInit {
  private readonly http = inject(HttpClient);
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly saved = signal(false);
  protected readonly error = signal('');
  protected readonly member = signal<PensionSummary>({ ...INITIAL_PENSION });
  protected draft: PensionSummary = { ...INITIAL_PENSION };

  ngOnInit(): void { this.load(); }

  protected refresh(): void { this.load(); }

  protected save(): void {
    const token = window.__mobileAuth?.token;
    if (!token) { this.error.set('Your mobile session is no longer available.'); return; }
    this.busy.set(true); this.saved.set(false); this.error.set('');
    this.http.put<PensionSummary>('/pension/api/pension', this.draft, this.options(token)).subscribe({
      next: data => { this.apply(data); this.saved.set(true); this.busy.set(false); },
      error: () => { this.error.set('The mocked Pension data could not be updated.'); this.busy.set(false); }
    });
  }

  protected reset(): void {
    const token = window.__mobileAuth?.token;
    if (!token) { this.error.set('Your mobile session is no longer available.'); return; }
    this.busy.set(true); this.saved.set(false); this.error.set('');
    this.http.delete<PensionSummary>('/pension/api/pension', this.options(token)).subscribe({
      next: data => { this.apply(data); this.saved.set(true); this.busy.set(false); },
      error: () => { this.error.set('The mocked Pension data could not be reset.'); this.busy.set(false); }
    });
  }

  private load(): void {
    const token = window.__mobileAuth?.token;
    this.loading.set(true); this.error.set('');
    if (!token) { this.error.set('Your mobile session is no longer available.'); this.loading.set(false); return; }
    this.http.get<PensionSummary>('/pension/api/pension', this.options(token)).subscribe({
      next: data => { this.apply(data); this.loading.set(false); },
      error: () => { this.error.set('Pension data is temporarily unavailable.'); this.loading.set(false); }
    });
  }

  private apply(data: PensionSummary): void { this.member.set(data); this.draft = { ...data }; }
  private options(token: string): { headers: { Authorization: string } } { return { headers: { Authorization: `Bearer ${token}` } }; }
}
