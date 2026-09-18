import { HttpClient } from '@angular/common/http';
import { Component, inject, OnInit, signal } from '@angular/core';
import { MobileAuthService } from './mobile-auth.service';
import { MobileHealthComponent } from './mobile-health.component';
import { MobilePensionComponent } from './mobile-pension.component';
import { MobileDocumentsComponent } from './mobile-documents.component';
import { MobileContactComponent } from './mobile-contact.component';

type MobileTab = 'overview' | 'pension' | 'health' | 'documents' | 'contact';

interface PensionSummary {
  memberName: string;
  memberId: string;
  status: string;
}
const API_BASE = 'https://brianthedeveloper.com';

@Component({
  selector: 'app-mobile-home',
  imports: [MobileHealthComponent, MobilePensionComponent, MobileDocumentsComponent, MobileContactComponent],
  templateUrl: './mobile-home.component.html',
  styleUrls: ['./mobile-home.component.css', './mobile-toolbar.css']
})
export class MobileHomeComponent implements OnInit {
  protected readonly auth = inject(MobileAuthService);
  private readonly http = inject(HttpClient);
  protected readonly activeTab = signal<MobileTab>('overview');
  protected readonly pensionLoading = signal(true);
  protected readonly pensionError = signal('');
  protected readonly pension = signal<PensionSummary>({
    memberName: 'Jordan Davis', memberId: 'TRS-2048-117', status: 'Active'
  });

  ngOnInit(): void {
    const token = window.__mobileAuth?.token;
    if (!token) {
      this.pensionError.set('Pension member details are unavailable.');
      this.pensionLoading.set(false);
      return;
    }
    this.http.get<PensionSummary>(`${API_BASE}/pension/api/pension`, {
      headers: { Authorization: `Bearer ${token}` }
    }).subscribe({
      next: data => { this.pension.set(data); this.pensionLoading.set(false); },
      error: () => { this.pensionError.set('Pension member details are temporarily unavailable.'); this.pensionLoading.set(false); }
    });
  }

  selectTab(tab: MobileTab): void {
    this.activeTab.set(tab);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  signOut(): void {
    void this.auth.logout();
  }
}
