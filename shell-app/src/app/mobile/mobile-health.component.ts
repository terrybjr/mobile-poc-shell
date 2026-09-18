import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CapacitorPluginMlKitTextRecognition } from '@pantrist/capacitor-plugin-ml-kit-text-recognition';

interface HealthSummary {
  memberName: string; plan: string; status: string; medical: string;
  deductible: number; fsaBalance: number; nextAppointment: string;
}

interface MbiRecord {
  name: string; relationship: string; medicareNumber: string; reentryMedicareNumber: string;
  partAStartDate: string; partBStartDate: string;
}

const INITIAL_HEALTH: HealthSummary = {
  memberName: 'Jordan Davis', plan: 'TRS-Care Premium Plus', status: 'Active', medical: 'PPO',
  deductible: 750, fsaBalance: 240, nextAppointment: 'September 28, 2026'
};
const INITIAL_MBI: MbiRecord[] = [
  { name: 'Jordan Davis', relationship: 'Policyholder', medicareNumber: '', reentryMedicareNumber: '', partAStartDate: '', partBStartDate: '' },
  { name: 'Alex Davis', relationship: 'Spouse', medicareNumber: '', reentryMedicareNumber: '', partAStartDate: '', partBStartDate: '' },
  { name: 'Taylor Davis', relationship: 'Child', medicareNumber: '', reentryMedicareNumber: '', partAStartDate: '', partBStartDate: '' }
];
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
  protected readonly actionMessage = signal('');
  protected readonly error = signal('');
  protected readonly member = signal<HealthSummary>({ ...INITIAL_HEALTH });
  protected draft: HealthSummary = { ...INITIAL_HEALTH };
  protected readonly mbiBusy = signal(false);
  protected readonly mbiSaved = signal(false);
  protected readonly mbiError = signal('');
  protected readonly mbiPhotoStatus = signal('');
  protected readonly selectedMbiIndex = signal(0);
  protected draftMbiRecords: MbiRecord[] = INITIAL_MBI.map(record => ({ ...record }));

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
      next: data => { this.apply(data); this.loadMbi(token); this.saved.set(true); this.busy.set(false); },
      error: error => { this.logApiError('DELETE', error); this.error.set(this.updateError(error)); this.busy.set(false); }
    });
  }

  protected selectAction(action: string): void {
    this.actionMessage.set(`${action} is ready for the next proof-of-concept step.`);
    if (action.includes('MBI')) document.getElementById('mobile-mbi-update')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected selectMbiPerson(index: number): void {
    this.selectedMbiIndex.set(index); this.mbiPhotoStatus.set(''); this.mbiSaved.set(false);
  }

  protected canSubmitMbi(): boolean {
    const record = this.draftMbiRecords[this.selectedMbiIndex()];
    return Boolean(record?.medicareNumber && record.reentryMedicareNumber && record.medicareNumber === record.reentryMedicareNumber);
  }

  protected submitMbi(): void {
    const token = window.__mobileAuth?.token;
    if (!token) { this.mbiError.set('Your mobile session is no longer available.'); return; }
    if (!this.canSubmitMbi()) { this.mbiError.set('Enter the MBI twice so the numbers can be verified.'); return; }
    this.mbiBusy.set(true); this.mbiSaved.set(false); this.mbiError.set('');
    this.http.put<MbiRecord[]>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/mbi`, this.draftMbiRecords, this.options(token)).subscribe({
      next: data => { this.draftMbiRecords = data.map(record => ({ ...record })); this.mbiSaved.set(true); this.mbiBusy.set(false); },
      error: error => { this.logApiError('PUT /mbi', error); this.mbiError.set(this.updateError(error)); this.mbiBusy.set(false); }
    });
  }

  protected cancelMbi(): void {
    const token = window.__mobileAuth?.token;
    if (token) this.loadMbi(token);
    this.mbiSaved.set(false); this.mbiError.set(''); this.mbiPhotoStatus.set('Changes cancelled.');
  }

  protected async takeMbiPhoto(): Promise<void> {
    if (!Capacitor.isNativePlatform()) {
      this.mbiError.set('Camera OCR is available in the installed mobile Shell.');
      return;
    }
    this.mbiError.set(''); this.mbiPhotoStatus.set('Opening camera…');
    try {
      const photo = await Camera.getPhoto({ source: CameraSource.Camera, resultType: CameraResultType.Base64, quality: 90, allowEditing: false });
      if (!photo.base64String) throw new Error('The camera did not return an image.');
      this.mbiPhotoStatus.set('Reading the Medicare card with on-device OCR…');
      const result = await CapacitorPluginMlKitTextRecognition.detectText({ base64Image: photo.base64String, rotation: 0 });
      this.mapOcrToSelectedMbi(result.text);
    } catch (error) {
      console.error('[Mobile Health] MBI camera OCR failed', error);
      this.mbiError.set('The MBI card could not be read. Try a brighter, closer photo.');
      this.mbiPhotoStatus.set('');
    }
  }

  private mapOcrToSelectedMbi(text: string): void {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const mbi = lines.map(line => line.toUpperCase().replace(/[^A-Z0-9]/g, '')).map(line => line.match(/[1-9][A-Z0-9]{10}/)?.[0]).find(Boolean);
    const dates = [...text.matchAll(/\b\d{2}[/-]\d{2}[/-]\d{4}\b/g)].map(match => match[0].replaceAll('/', '-'));
    const index = this.selectedMbiIndex();
    const selected = this.draftMbiRecords[index];
    if (!selected || !mbi) {
      this.mbiError.set('OCR could not identify an MBI number. Retake the photo with the card flat and in focus.');
      this.mbiPhotoStatus.set('');
      return;
    }
    this.draftMbiRecords = this.draftMbiRecords.map((record, recordIndex) => recordIndex === index ? {
      ...record,
      medicareNumber: mbi,
      partAStartDate: this.toDateInput(dates[0]) || record.partAStartDate,
      partBStartDate: this.toDateInput(dates[1]) || record.partBStartDate
    } : { ...record });
    this.mbiPhotoStatus.set(`OCR found an MBI for ${selected.name}. Review it, re-enter it, then submit.`);
  }

  private toDateInput(value?: string): string {
    if (!value) return '';
    const [month, day, year] = value.split('-');
    return `${year}-${month}-${day}`;
  }

  private load(): void {
    const token = window.__mobileAuth?.token;
    this.loading.set(true); this.error.set('');
    if (!token) { this.error.set('Your mobile session is no longer available.'); this.loading.set(false); return; }
    this.loadMbi(token);
    this.http.get<HealthSummary>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health`, this.options(token)).subscribe({
      next: data => { this.apply(data); this.loading.set(false); },
      error: error => { this.logApiError('GET', error); this.error.set(this.loadError(error)); this.loading.set(false); }
    });
  }

  private loadMbi(token: string): void {
    this.http.get<MbiRecord[]>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/mbi`, this.options(token)).subscribe({
      next: data => { this.draftMbiRecords = data.map(record => ({ ...record })); },
      error: error => { this.logApiError('GET /mbi', error); this.mbiError.set(this.loadError(error)); }
    });
  }

  private apply(data: HealthSummary): void { this.member.set(data); this.draft = { ...data }; }
  private options(token: string): { headers: { Authorization: string } } { return { headers: { Authorization: `Bearer ${token}` } }; }

  private logApiError(method: string, error: unknown): void {
    if (error instanceof HttpErrorResponse) console.error(`[Mobile Health] ${method} ${error.url ?? ''} failed`, { status: error.status, statusText: error.statusText, message: error.message, body: error.error });
    else console.error(`[Mobile Health] ${method} request failed`, error);
  }

  private loadError(error: unknown): string {
    if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) return `Health API rejected the mobile session (HTTP ${error.status}).`;
    if (error instanceof HttpErrorResponse && error.status === 0) return 'Health API could not be reached. Check the API deployment or CORS configuration.';
    return error instanceof HttpErrorResponse && error.status > 0 ? `Health API returned HTTP ${error.status}.` : 'Health data is temporarily unavailable.';
  }

  private updateError(error: unknown): string {
    if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403)) return `Health API rejected the mobile session (HTTP ${error.status}).`;
    if (error instanceof HttpErrorResponse && error.status === 0) return 'Health API could not be reached. Check the API deployment or CORS configuration.';
    return error instanceof HttpErrorResponse && error.status > 0 ? `Health API returned HTTP ${error.status}.` : 'Health information could not be updated.';
  }
}
