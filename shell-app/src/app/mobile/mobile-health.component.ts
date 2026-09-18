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

interface CoverageRow {
  coverage: string; plan: string; effectiveDate: string; status: string;
}

interface MbiRecord {
  name: string; relationship: string; medicareNumber: string; reentryMedicareNumber: string;
  partAStartDate: string; partBStartDate: string;
}

interface EnrollmentDependent { id: string; name: string; relationship: string; selected: boolean; }
interface EnrollmentDraft {
  id: string; startDate: string; dateSubmitted: string; status: string; currentStep: number;
  eligibilityReviewed: boolean; eligibilityDecision: string; legalAccepted: boolean; demographicVerified: boolean;
  memberName: string; mailingAddress: string; effectiveDate: string; medicalCoverage: string;
  dentalCoverage: string; visionCoverage: string; acknowledgmentAccepted: boolean; signature: string;
  dependents: EnrollmentDependent[];
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
  protected readonly actionMessage = signal('');
  protected readonly error = signal('');
  protected readonly resetMessage = signal('');
  protected readonly member = signal<HealthSummary>({ ...INITIAL_HEALTH });
  protected readonly mbiBusy = signal(false);
  protected readonly mbiSaved = signal(false);
  protected readonly mbiError = signal('');
  protected readonly mbiPhotoStatus = signal('');
  protected readonly selectedMbiIndex = signal(0);
  protected readonly enrollmentModal = signal<'none' | 'eligibility' | 'resume'>('none');
  protected readonly dependentModal = signal<'none' | 'select' | 'new'>('none');
  protected readonly enrollmentOpen = signal(false);
  protected readonly enrollmentSaving = signal(false);
  protected readonly enrollmentMessage = signal('');
  protected readonly enrollmentError = signal('');
  protected readonly enrollmentStep = signal(1);
  protected readonly activePage = signal<'home' | 'mbi' | 'enrollment'>('home');
  protected draftMbiRecords: MbiRecord[] = INITIAL_MBI.map(record => ({ ...record }));
  protected enrollment: EnrollmentDraft | null = null;
  protected newDependent: EnrollmentDependent = { id: '', name: '', relationship: 'Child', selected: true };

  ngOnInit(): void { this.load(); }
  protected refresh(): void { this.load(); }

  protected resetDemo(): void {
    const token = window.__mobileAuth?.token;
    if (!token) { this.error.set('Your mobile session is no longer available.'); return; }
    this.busy.set(true); this.resetMessage.set(''); this.error.set('');
    this.http.delete<HealthSummary>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health`, this.options(token)).subscribe({
      next: data => { this.apply(data); this.enrollment = null; this.draftMbiRecords = []; this.loadMbi(token); this.resetMessage.set('Demo reset. No current coverage or submitted MBI remains.'); this.busy.set(false); },
      error: error => { this.logApiError('DELETE', error); this.error.set(this.updateError(error)); this.busy.set(false); }
    });
  }

  protected currentCoverage(): CoverageRow[] {
    const rows: CoverageRow[] = [];
    if (this.enrollment?.status === 'SUBMITTED') {
      const selections: Array<[string, string, string]> = [
        ['Medical / Rx', 'TRS-Care Medical and Prescription', this.enrollment.medicalCoverage],
        ['Dental', 'TRS-Care Dental', this.enrollment.dentalCoverage],
        ['Vision', 'TRS-Care Vision', this.enrollment.visionCoverage]
      ];
      for (const [coverage, plan, selection] of selections) {
        if (selection === 'Enroll') rows.push({ coverage, plan, effectiveDate: this.formatDate(this.enrollment.effectiveDate), status: 'Enrolled' });
      }
    }
    for (const record of this.draftMbiRecords) {
      if (record.medicareNumber && record.medicareNumber === record.reentryMedicareNumber) {
        rows.push({ coverage: 'Medicare', plan: `MBI — ${record.name}`, effectiveDate: this.mbiEffectiveDate(record), status: 'Submitted' });
      }
    }
    return rows;
  }

  private formatDate(value: string): string {
    if (!value) return 'Not provided';
    const [year, month, day] = value.split('-');
    return year && month && day ? `${month}/${day}/${year}` : value;
  }

  private mbiEffectiveDate(record: MbiRecord): string {
    const dates = [record.partAStartDate && `Part A ${this.formatDate(record.partAStartDate)}`, record.partBStartDate && `Part B ${this.formatDate(record.partBStartDate)}`].filter(Boolean);
    return dates.length ? dates.join(' · ') : 'Not provided';
  }

  protected selectAction(action: string): void {
    if (action.includes('Initial Enrollment')) { this.beginEnrollment(); return; }
    if (action.includes('MBI')) { this.activePage.set('mbi'); this.actionMessage.set(''); return; }
    this.actionMessage.set(`${action} is ready for the next proof-of-concept step.`);
    if (action.includes('MBI')) document.getElementById('mobile-mbi-update')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected beginEnrollment(): void {
    const token = window.__mobileAuth?.token;
    if (!token) { this.enrollmentError.set('Your mobile session is no longer available.'); return; }
    this.activePage.set('enrollment'); this.enrollmentError.set(''); this.enrollmentMessage.set('');
    this.http.get<EnrollmentDraft | null>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/enrollment`, this.options(token)).subscribe({
      next: draft => draft?.status === 'INCOMPLETE' ? (this.enrollment = { ...draft }, this.enrollmentStep.set(draft.currentStep || 1), this.enrollmentModal.set('resume')) : draft?.status === 'SUBMITTED' ? this.enrollmentMessage.set('This demo enrollment has already been submitted.') : this.createEnrollment(),
      error: error => { this.logApiError('GET /enrollment', error); this.enrollmentError.set(this.loadError(error)); }
    });
  }

  private createEnrollment(): void {
    const token = window.__mobileAuth?.token; if (!token) return;
    this.http.post<EnrollmentDraft>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/enrollment/start`, {}, this.options(token)).subscribe({
      next: draft => { this.enrollment = { ...draft }; this.enrollmentStep.set(1); this.enrollmentModal.set('eligibility'); },
      error: error => { this.logApiError('POST /enrollment/start', error); this.enrollmentError.set(this.updateError(error)); }
    });
  }

  protected continueEnrollment(): void { this.enrollmentModal.set('none'); this.enrollmentOpen.set(true); }

  protected chooseEligibility(decision: 'CONTINUE' | 'MEDICARE'): void {
    if (!this.enrollment) return;
    this.enrollment.eligibilityReviewed = true; this.enrollment.eligibilityDecision = decision;
    if (decision === 'MEDICARE') { this.persistEnrollment(() => { this.enrollmentModal.set('none'); this.enrollmentMessage.set('Medicare-dependent enrollment would continue through a downloadable form in this demo.'); }); return; }
    this.persistEnrollment(() => { this.enrollmentModal.set('none'); this.enrollmentOpen.set(true); });
  }

  protected closeEnrollment(): void { if (this.enrollment) this.persistEnrollment(() => { this.enrollmentOpen.set(false); this.activePage.set('home'); this.enrollmentMessage.set('Enrollment draft saved.'); }); }
  protected returnToHealthHome(): void { this.activePage.set('home'); this.enrollmentOpen.set(false); this.enrollmentModal.set('none'); this.dependentModal.set('none'); this.enrollmentError.set(''); this.enrollmentMessage.set(''); this.actionMessage.set(''); }
  protected cancelEnrollment(): void { const token = window.__mobileAuth?.token; if (!token) return; this.http.delete<EnrollmentDraft>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/enrollment`, this.options(token)).subscribe({ next: draft => { this.enrollment = { ...draft }; this.enrollmentOpen.set(false); this.enrollmentModal.set('none'); this.enrollmentMessage.set('Enrollment draft cancelled.'); }, error: error => this.enrollmentError.set(this.updateError(error)) }); }
  protected previousEnrollmentStep(): void { this.enrollmentStep.update(step => Math.max(1, step - 1)); }

  protected nextEnrollmentStep(): void {
    if (!this.enrollment) return;
    const step = this.enrollmentStep();
    if (step === 1 && !this.enrollment.legalAccepted) { this.enrollmentError.set('Accept the disclosure before continuing.'); return; }
    if (step === 2 && !this.enrollment.demographicVerified) { this.enrollmentError.set('Confirm your information before continuing.'); return; }
    if (step === 4 && (!this.enrollment.acknowledgmentAccepted || !this.enrollment.signature.trim())) { this.enrollmentError.set('Choose Yes and enter a signature before continuing.'); return; }
    this.enrollmentError.set(''); this.enrollment.currentStep = Math.min(5, step + 1); this.enrollmentStep.set(this.enrollment.currentStep); this.persistEnrollment();
  }

  protected submitEnrollment(): void { const token = window.__mobileAuth?.token; if (!token) return; this.enrollmentSaving.set(true); this.http.post<EnrollmentDraft>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/enrollment/submit`, {}, this.options(token)).subscribe({ next: draft => { this.enrollment = { ...draft }; this.enrollmentSaving.set(false); this.enrollmentOpen.set(false); this.activePage.set('home'); this.enrollmentMessage.set('Enrollment submitted for TRS review in this proof-of-concept.'); }, error: error => { this.enrollmentSaving.set(false); this.enrollmentError.set(this.updateError(error)); } }); }

  protected openDependentModal(): void { this.dependentModal.set('select'); }
  protected addExistingDependent(id: string): void { if (!this.enrollment) return; this.enrollment.dependents = this.enrollment.dependents.map(dependent => dependent.id === id ? { ...dependent, selected: true } : dependent); this.dependentModal.set('none'); this.persistEnrollment(); }
  protected openNewDependent(): void { this.newDependent = { id: '', name: '', relationship: 'Child', selected: true }; this.dependentModal.set('new'); }
  protected saveNewDependent(): void { if (!this.enrollment || !this.newDependent.name.trim()) return; this.enrollment.dependents = [...this.enrollment.dependents, { ...this.newDependent, id: `new-${Date.now()}`, name: this.newDependent.name.trim() }]; this.dependentModal.set('none'); this.persistEnrollment(); }
  protected enrollmentPeople(): Array<{ name: string; relationship: string }> { return this.enrollment ? [{ name: this.enrollment.memberName, relationship: 'Policyholder' }, ...this.enrollment.dependents.filter(dependent => dependent.selected)] : []; }
  protected premium(coverage: 'medicalCoverage' | 'dentalCoverage' | 'visionCoverage'): number { return this.enrollment?.[coverage] === 'Enroll' ? (coverage === 'medicalCoverage' ? this.enrollmentPeople().length * 200 : 0) : 0; }
  protected totalPremium(): number { return this.premium('medicalCoverage') + this.premium('dentalCoverage') + this.premium('visionCoverage'); }

  private persistEnrollment(done?: () => void): void { const token = window.__mobileAuth?.token; if (!token || !this.enrollment) { done?.(); return; } this.enrollmentSaving.set(true); this.http.put<EnrollmentDraft>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/enrollment`, this.enrollment, this.options(token)).subscribe({ next: draft => { this.enrollment = { ...draft }; this.enrollmentSaving.set(false); done?.(); }, error: error => { this.enrollmentSaving.set(false); this.enrollmentError.set(this.updateError(error)); } }); }

  protected selectMbiPerson(index: number): void {
    this.selectedMbiIndex.set(index); this.mbiPhotoStatus.set(''); this.mbiSaved.set(false);
  }

  protected canSubmitMbi(): boolean {
    return !this.invalidSelectedMbi();
  }

  protected submitMbi(): void {
    const token = window.__mobileAuth?.token;
    if (!token) { this.mbiError.set('Your mobile session is no longer available.'); return; }
    if (!this.canSubmitMbi()) { const invalid = this.invalidSelectedMbi(); this.mbiError.set(`Enter and re-enter the same MBI for ${invalid?.name ?? 'the selected person'}.`); return; }
    this.mbiBusy.set(true); this.mbiSaved.set(false); this.mbiError.set('');
    this.http.put<MbiRecord[]>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/mbi`, this.draftMbiRecords, this.options(token)).subscribe({
      next: data => { this.draftMbiRecords = data.map(record => ({ ...record })); this.mbiSaved.set(true); this.mbiBusy.set(false); this.activePage.set('home'); this.actionMessage.set('Medicare information submitted.'); },
      error: error => { this.logApiError('PUT /mbi', error); this.mbiError.set(this.updateError(error)); this.mbiBusy.set(false); }
    });
  }

  private invalidSelectedMbi(): MbiRecord | undefined {
    const record = this.draftMbiRecords[this.selectedMbiIndex()];
    if (!record) return undefined;
    const mbi = this.normalizeMbi(record.medicareNumber);
    const reentry = this.normalizeMbi(record.reentryMedicareNumber);
    return !mbi || !reentry || mbi !== reentry ? record : undefined;
  }

  private normalizeMbi(value: string): string { return (value || '').replace(/[\s-]/g, '').toUpperCase(); }

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
    this.loadEnrollmentState(token);
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

  private loadEnrollmentState(token: string): void {
    this.http.get<EnrollmentDraft | null>(`${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/enrollment`, this.options(token)).subscribe({
      next: draft => { this.enrollment = draft ? { ...draft } : null; },
      error: () => { this.enrollment = null; }
    });
  }

  private apply(data: HealthSummary): void { this.member.set(data); }
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
