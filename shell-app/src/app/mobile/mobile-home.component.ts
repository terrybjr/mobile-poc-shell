import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, inject, OnInit, signal } from '@angular/core';
import { MobileAuthService } from './mobile-auth.service';
import { MobileOfflineCacheService } from './mobile-offline-cache.service';
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
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  protected readonly auth = inject(MobileAuthService);
  private readonly http = inject(HttpClient);
  private readonly cache = inject(MobileOfflineCacheService);
  protected readonly activeTab = signal<MobileTab>('overview');
  protected readonly showIdCard = signal(false);
  protected readonly pensionLoading = signal(true);
  protected readonly pensionError = signal('');
  protected readonly pension = signal<PensionSummary>({
    memberName: 'Jordan Davis', memberId: 'TRS-2048-117', status: 'Active'
  });

  ngOnInit(): void {
    void this.loadPension();
  }

  private async loadPension(): Promise<void> {
    const cached = await this.cache.read<PensionSummary>('home-pension');
    if (cached) this.pension.set(cached);

    const token = window.__mobileAuth?.token;
    if (!token || !this.auth.online() || this.auth.offlineMode()) {
      if (!cached) this.pensionError.set('Offline. Member details have not been cached on this device yet.');
      this.pensionLoading.set(false);
      return;
    }
    this.http.get<PensionSummary>(`${API_BASE}/pension/api/pension`, {
      headers: { Authorization: `Bearer ${token}` }
    }).subscribe({
      next: data => { this.pension.set(data); void this.cache.write('home-pension', data); this.pensionLoading.set(false); },
      error: () => { this.pensionError.set('Pension member details are temporarily unavailable.'); this.pensionLoading.set(false); }
    });
  }

  protected toggleIdCard(): void { this.showIdCard.update((visible) => !visible); }

  selectTab(tab: MobileTab): void {
    this.activeTab.set(tab);
    const mobileHome = this.elementRef.nativeElement.querySelector('.mobile-home') as HTMLElement | null;
    mobileHome?.scrollTo({ top: 0, behavior: 'auto' });
  }

  signOut(): void {
    void this.auth.logout();
  }
}
