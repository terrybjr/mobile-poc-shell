import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Component, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CapacitorPluginMlKitTextRecognition } from '@pantrist/capacitor-plugin-ml-kit-text-recognition';
import { MobileVisionTextRecognition } from './mobile-vision-text-recognition';
import { MobileAuthService } from './mobile-auth.service';
import { MobileOfflineCacheService } from './mobile-offline-cache.service';

interface HealthSummary {
  memberName: string;
  plan: string;
  status: string;
  medical: string;
  deductible: number;
  fsaBalance: number;
  nextAppointment: string;
}

interface CoverageRow {
  coverage: string;
  plan: string;
  effectiveDate: string;
  status: string;
}

interface MbiRecord {
  name: string;
  relationship: string;
  medicareNumber: string;
  reentryMedicareNumber: string;
  partAStartDate: string;
  partBStartDate: string;
}

interface EnrollmentDependent {
  id: string;
  name: string;
  relationship: string;
  selected: boolean;
}

interface NewDependentForm {
  prefix: string;
  firstName: string;
  middleName: string;
  lastName: string;
  suffix: string;
  relationship: string;
  dateOfBirth: string;
  gender: string;
  ssn: string;
}

interface CoverageOption {
  label: string;
  key: 'medicalCoverage' | 'dentalCoverage' | 'visionCoverage';
  description: string;
}

interface EnrollmentDraft {
  id: string;
  startDate: string;
  dateSubmitted: string;
  status: string;
  currentStep: number;
  eligibilityReviewed: boolean;
  eligibilityDecision: string;
  legalAccepted: boolean;
  demographicVerified: boolean;
  memberName: string;
  mailingAddress: string;
  effectiveDate: string;
  medicalCoverage: string;
  dentalCoverage: string;
  visionCoverage: string;
  acknowledgmentAccepted: boolean;
  signature: string;
  dependents: EnrollmentDependent[];
}

const INITIAL_HEALTH: HealthSummary = {
  memberName: 'Jordan Davis',
  plan: 'TRS-Care Premium Plus',
  status: 'Active',
  medical: 'PPO',
  deductible: 750,
  fsaBalance: 240,
  nextAppointment: 'September 28, 2026',
};
const INITIAL_MBI: MbiRecord[] = [
  {
    name: 'Jordan Davis',
    relationship: 'Policyholder',
    medicareNumber: '',
    reentryMedicareNumber: '',
    partAStartDate: '',
    partBStartDate: '',
  },
  {
    name: 'Alex Davis',
    relationship: 'Spouse',
    medicareNumber: '',
    reentryMedicareNumber: '',
    partAStartDate: '',
    partBStartDate: '',
  },
  {
    name: 'Taylor Davis',
    relationship: 'Child',
    medicareNumber: '',
    reentryMedicareNumber: '',
    partAStartDate: '',
    partBStartDate: '',
  },
];
const API_BASE = 'https://brianthedeveloper.com';

@Component({
  selector: 'app-mobile-health',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './mobile-health.component.html',
  styleUrl: './mobile-health.component.css',
})
export class MobileHealthComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly auth = inject(MobileAuthService);
  private readonly cache = inject(MobileOfflineCacheService);

  protected readonly enrollmentSteps = ['Disclosure', 'Verify', 'Plans', 'Accept', 'Submit'];
  protected readonly coverageOptions: CoverageOption[] = [
    {
      label: 'Medical / Rx',
      key: 'medicalCoverage',
      description: 'Medical and prescription coverage',
    },
    { label: 'Dental', key: 'dentalCoverage', description: 'Routine and major dental services' },
    { label: 'Vision', key: 'visionCoverage', description: 'Vision exams and eyewear benefits' },
  ];
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
  protected readonly enrollmentLoading = signal(false);
  protected readonly enrollmentSaving = signal(false);
  protected readonly enrollmentMessage = signal('');
  protected readonly enrollmentError = signal('');
  protected readonly enrollmentStep = signal(1);
  protected readonly highestCompletedEnrollmentStep = signal(0);
  protected readonly activePage = signal<'home' | 'mbi' | 'enrollment'>('home');
  protected draftMbiRecords: MbiRecord[] = INITIAL_MBI.map((record) => ({ ...record }));
  protected enrollment: EnrollmentDraft | null = null;
  protected newDependent: NewDependentForm = this.emptyDependentForm();

  ngOnInit(): void {
    this.load();
  }

  protected canMutate(): boolean {
    return this.auth.online() && !this.auth.offlineMode();
  }

  protected refresh(): void {
    if (this.canMutate() && !this.loading()) this.load();
  }

  protected resetDemo(): void {
    if (!this.canMutate()) {
      this.error.set('You are offline. Restoring sample coverage is disabled until you reconnect.');
      return;
    }
    const token = window.__mobileAuth?.token;
    if (!token) {
      this.error.set('Your mobile session is no longer available.');
      return;
    }
    this.busy.set(true);
    this.resetMessage.set('');
    this.error.set('');
    this.http
      .delete<HealthSummary>(
        `${API_BASE}/mobile-poc/wss-apps/health-ws/api/health`,
        this.options(token),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.apply(data);
          this.enrollment = null;
          this.draftMbiRecords = [];
          this.loadMbi(token);
          this.resetMessage.set('Sample coverage has been restored.');
          this.busy.set(false);
        },
        error: (error) => {
          this.logApiError('DELETE', error);
          this.error.set(this.updateError(error));
          this.busy.set(false);
        },
      });
  }

  protected currentCoverage(): CoverageRow[] {
    const rows: CoverageRow[] = [];
    if (this.enrollment?.status === 'SUBMITTED') {
      const selections: Array<[string, string, string]> = [
        ['Medical / Rx', 'TRS-Care Medical and Prescription', this.enrollment.medicalCoverage],
        ['Dental', 'TRS-Care Dental', this.enrollment.dentalCoverage],
        ['Vision', 'TRS-Care Vision', this.enrollment.visionCoverage],
      ];
      for (const [coverage, plan, selection] of selections) {
        if (selection === 'Enroll')
          rows.push({
            coverage,
            plan,
            effectiveDate: this.formatDate(this.enrollment.effectiveDate),
            status: 'Enrolled',
          });
      }
    }
    for (const record of this.draftMbiRecords) {
      if (record.medicareNumber && record.medicareNumber === record.reentryMedicareNumber) {
        rows.push({
          coverage: 'Medicare',
          plan: `MBI — ${record.name}`,
          effectiveDate: this.mbiEffectiveDate(record),
          status: 'Submitted',
        });
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
    const dates = [
      record.partAStartDate && `Part A ${this.formatDate(record.partAStartDate)}`,
      record.partBStartDate && `Part B ${this.formatDate(record.partBStartDate)}`,
    ].filter(Boolean);
    return dates.length ? dates.join(' · ') : 'Not provided';
  }

  protected selectAction(action: string): void {
    if (!this.canMutate() && !action.includes('MBI')) {
      this.actionMessage.set(
        'You are offline. Updates and submissions are disabled until you reconnect.',
      );
      return;
    }
    if (action.includes('Initial Enrollment')) {
      this.beginEnrollment();
      return;
    }

    if (action.includes('MBI')) {
      this.activePage.set('mbi');
      this.actionMessage.set('');
      this.error.set('');
      this.mbiError.set('');
      this.mbiPhotoStatus.set('');
    }
  }

  protected beginEnrollment(): void {
    if (!this.canMutate()) {
      this.enrollmentError.set(
        'You are offline. Enrollment changes are disabled until you reconnect.',
      );
      return;
    }
    const token = window.__mobileAuth?.token;
    if (!token) {
      this.enrollmentError.set('Your mobile session is no longer available.');
      return;
    }

    this.activePage.set('enrollment');
    this.enrollmentError.set('');
    this.enrollmentMessage.set('');
    this.actionMessage.set('');
    this.enrollmentLoading.set(true);

    this.http
      .get<EnrollmentDraft | null>(
        `${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/enrollment`,
        this.options(token),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (draft) => {
          this.enrollmentLoading.set(false);

          if (draft?.status === 'INCOMPLETE') {
            this.enrollment = { ...draft };
            this.restoreEnrollmentProgress(draft.currentStep || 1);
            this.enrollmentModal.set('resume');
            return;
          }

          if (draft?.status === 'SUBMITTED') {
            this.enrollmentMessage.set('This enrollment has already been submitted.');
            return;
          }

          this.createEnrollment();
        },
        error: (error) => {
          this.enrollmentLoading.set(false);
          this.logApiError('GET /enrollment', error);
          this.enrollmentError.set(this.loadError(error));
        },
      });
  }

  private createEnrollment(): void {
    const token = window.__mobileAuth?.token;
    if (!token) return;

    this.http
      .post<EnrollmentDraft>(
        `${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/enrollment/start`,
        {},
        this.options(token),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (draft) => {
          this.enrollment = { ...draft };
          this.restoreEnrollmentProgress(1);
          this.enrollmentModal.set('eligibility');
        },
        error: (error) => {
          this.logApiError('POST /enrollment/start', error);
          this.enrollmentError.set(this.updateError(error));
        },
      });
  }

  protected continueEnrollment(): void {
    this.enrollmentModal.set('none');
    this.enrollmentOpen.set(true);
  }

  protected closeEnrollmentPrompt(): void {
    this.enrollmentModal.set('none');
    if (!this.enrollmentOpen()) {
      this.activePage.set('home');
    }
  }

  protected chooseEligibility(decision: 'CONTINUE' | 'MEDICARE'): void {
    if (!this.enrollment) return;

    this.enrollment.eligibilityReviewed = true;
    this.enrollment.eligibilityDecision = decision;

    if (decision === 'MEDICARE') {
      this.persistEnrollment(() => {
        this.enrollmentModal.set('none');
        this.activePage.set('home');
        this.enrollmentMessage.set(
          'A Medicare-dependent application would continue through a separate form.',
        );
      });
      return;
    }

    this.persistEnrollment(() => {
      this.enrollmentModal.set('none');
      this.enrollmentOpen.set(true);
    });
  }

  protected closeEnrollment(): void {
    if (!this.enrollment || this.enrollmentSaving()) return;

    this.persistEnrollment(() => {
      this.enrollmentOpen.set(false);
      this.activePage.set('home');
      this.enrollmentMessage.set('Enrollment draft saved.');
    });
  }

  protected returnToHealthHome(): void {
    this.activePage.set('home');
    this.enrollmentOpen.set(false);
    this.enrollmentModal.set('none');
    this.dependentModal.set('none');
    this.enrollmentError.set('');
    this.enrollmentMessage.set('');
    this.mbiError.set('');
    this.mbiPhotoStatus.set('');
    this.actionMessage.set('');
  }

  protected cancelEnrollment(): void {
    const token = window.__mobileAuth?.token;
    if (!token || this.enrollmentSaving()) return;

    this.enrollmentSaving.set(true);
    this.enrollmentError.set('');
    this.http
      .delete<EnrollmentDraft>(
        `${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/enrollment`,
        this.options(token),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (draft) => {
          this.enrollment = draft ? { ...draft } : null;
          this.enrollmentSaving.set(false);
          this.enrollmentOpen.set(false);
          this.enrollmentModal.set('none');
          this.activePage.set('home');
          this.enrollmentMessage.set('Enrollment draft cancelled.');
        },
        error: (error) => {
          this.enrollmentSaving.set(false);
          this.enrollmentError.set(this.updateError(error));
        },
      });
  }

  protected previousEnrollmentStep(): void {
    this.enrollmentError.set('');
    this.enrollmentStep.update((step) => Math.max(1, step - 1));
  }

  protected canNavigateToEnrollmentStep(step: number): boolean {
    const currentStep = this.enrollmentStep();
    if (
      !this.enrollment ||
      this.enrollmentSaving() ||
      step < 1 ||
      step > this.enrollmentSteps.length
    ) {
      return false;
    }

    const highestCompletedStep = this.highestCompletedEnrollmentStep();
    if (step <= highestCompletedStep) {
      return this.areEnrollmentStepsValidThrough(step);
    }

    return step === currentStep + 1 && this.areEnrollmentStepsValidThrough(currentStep);
  }

  protected isEnrollmentStepComplete(step: number): boolean {
    return (
      step !== this.enrollmentStep() &&
      step <= this.highestCompletedEnrollmentStep() &&
      this.areEnrollmentStepsValidThrough(step)
    );
  }

  protected goToEnrollmentStep(step: number): void {
    const currentStep = this.enrollmentStep();
    if (!this.canNavigateToEnrollmentStep(step) || !this.enrollment) return;

    if (step === currentStep + 1 && step > this.highestCompletedEnrollmentStep()) {
      this.nextEnrollmentStep();
      return;
    }

    this.enrollmentError.set('');
    this.enrollmentStep.set(step);
  }

  protected advanceEnrollment(): void {
    if (this.enrollmentStep() < this.enrollmentSteps.length) {
      this.nextEnrollmentStep();
    } else {
      this.submitEnrollment();
    }
  }

  protected nextEnrollmentStep(): void {
    if (!this.enrollment) return;

    const step = this.enrollmentStep();
    const validationError = this.enrollmentStepError(step);
    if (validationError) {
      this.enrollmentError.set(validationError);
      return;
    }

    this.enrollmentError.set('');
    const nextStep = Math.min(this.enrollmentSteps.length, step + 1);
    this.highestCompletedEnrollmentStep.update((completedStep) => Math.max(completedStep, step));
    this.enrollment.currentStep = Math.max(this.enrollment.currentStep, nextStep);
    this.enrollmentStep.set(nextStep);
    this.persistEnrollment();
  }

  private restoreEnrollmentProgress(currentStep: number): void {
    const normalizedStep = Math.min(this.enrollmentSteps.length, Math.max(1, currentStep || 1));
    this.enrollmentStep.set(normalizedStep);
    this.highestCompletedEnrollmentStep.set(Math.max(0, normalizedStep - 1));
  }

  private isEnrollmentStepValid(step: number): boolean {
    return Boolean(this.enrollment) && !this.enrollmentStepError(step);
  }

  private areEnrollmentStepsValidThrough(step: number): boolean {
    for (let candidate = 1; candidate <= step; candidate += 1) {
      if (!this.isEnrollmentStepValid(candidate)) return false;
    }
    return true;
  }

  private enrollmentStepError(step: number): string {
    if (!this.enrollment) return 'Your enrollment is not available.';

    if (step === 1 && !this.enrollment.legalAccepted) {
      return 'Accept the disclosure before continuing.';
    }

    if (
      step === 2 &&
      (!this.enrollment.memberName.trim() ||
        !this.enrollment.mailingAddress.trim() ||
        !this.enrollment.demographicVerified)
    ) {
      return 'Review your information and confirm that it is correct.';
    }

    if (step === 3 && (!this.enrollment.effectiveDate || !this.hasPlanSelection())) {
      return 'Choose an effective date and at least one plan.';
    }

    if (
      step === 4 &&
      (!this.enrollment.acknowledgmentAccepted || !this.enrollment.signature.trim())
    ) {
      return 'Choose Yes and enter a signature before continuing.';
    }

    return '';
  }

  protected submitEnrollment(): void {
    if (!this.canMutate()) {
      this.enrollmentError.set(
        'You are offline. Enrollment submission is disabled until you reconnect.',
      );
      return;
    }
    const token = window.__mobileAuth?.token;
    if (!token || !this.enrollment || this.enrollmentSaving()) return;

    if (
      !this.enrollment.acknowledgmentAccepted ||
      !this.enrollment.signature.trim() ||
      !this.hasPlanSelection()
    ) {
      this.enrollmentError.set(
        'Review the required acceptance, signature, and plan selections before submitting.',
      );
      return;
    }

    this.enrollmentSaving.set(true);
    this.enrollmentError.set('');
    this.http
      .post<EnrollmentDraft>(
        `${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/enrollment/submit`,
        {},
        this.options(token),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (draft) => {
          this.enrollment = { ...draft };
          this.enrollmentSaving.set(false);
          this.enrollmentOpen.set(false);
          this.activePage.set('home');
          this.enrollmentMessage.set('Enrollment submitted for TRS review.');
        },
        error: (error) => {
          this.enrollmentSaving.set(false);
          this.enrollmentError.set(this.updateError(error));
        },
      });
  }

  private hasPlanSelection(): boolean {
    if (!this.enrollment) return false;
    return [
      this.enrollment.medicalCoverage,
      this.enrollment.dentalCoverage,
      this.enrollment.visionCoverage,
    ].some((selection) => selection === 'Enroll');
  }

  protected openDependentModal(): void {
    if (!this.canMutate()) return;
    this.dependentModal.set('select');
  }

  protected closeDependentModal(): void {
    this.dependentModal.set('none');
  }

  protected addExistingDependent(id: string): void {
    if (!this.enrollment) return;

    this.enrollment.dependents = this.enrollment.dependents.map((dependent) =>
      dependent.id === id ? { ...dependent, selected: true } : dependent,
    );
    this.dependentModal.set('none');
    this.persistEnrollment();
  }

  protected openNewDependent(): void {
    this.newDependent = this.emptyDependentForm();
    this.dependentModal.set('new');
  }

  protected saveNewDependent(): void {
    if (!this.canMutate()) return;
    if (!this.enrollment) return;

    const firstName = this.newDependent.firstName.trim();
    const lastName = this.newDependent.lastName.trim();
    if (
      !firstName ||
      !lastName ||
      !this.newDependent.dateOfBirth ||
      !this.newDependent.gender ||
      !this.newDependent.ssn.trim()
    ) {
      return;
    }

    const name = [firstName, this.newDependent.middleName.trim(), lastName]
      .filter(Boolean)
      .join(' ');

    this.enrollment.dependents = [
      ...this.enrollment.dependents,
      {
        id: `new-${Date.now()}`,
        name,
        relationship: this.newDependent.relationship,
        selected: true,
      },
    ];
    this.dependentModal.set('none');
    this.persistEnrollment();
  }

  private emptyDependentForm(): NewDependentForm {
    return {
      prefix: '',
      firstName: '',
      middleName: '',
      lastName: '',
      suffix: '',
      relationship: 'Child',
      dateOfBirth: '',
      gender: '',
      ssn: '',
    };
  }

  protected enrollmentPeople(): Array<{ name: string; relationship: string }> {
    return this.enrollment
      ? [
          { name: this.enrollment.memberName, relationship: 'Policyholder' },
          ...this.enrollment.dependents
            .filter((dependent) => dependent.selected)
            .map((dependent) => ({ name: dependent.name, relationship: dependent.relationship })),
        ]
      : [];
  }

  protected premium(coverage: 'medicalCoverage' | 'dentalCoverage' | 'visionCoverage'): number {
    return this.enrollment?.[coverage] === 'Enroll'
      ? coverage === 'medicalCoverage'
        ? this.enrollmentPeople().length * 200
        : 0
      : 0;
  }

  protected totalPremium(): number {
    return (
      this.premium('medicalCoverage') +
      this.premium('dentalCoverage') +
      this.premium('visionCoverage')
    );
  }

  private persistEnrollment(done?: () => void): void {
    const token = window.__mobileAuth?.token;
    if (!token || !this.enrollment) {
      done?.();
      return;
    }

    this.enrollmentSaving.set(true);
    this.enrollmentError.set('');
    this.http
      .put<EnrollmentDraft>(
        `${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/enrollment`,
        this.enrollment,
        this.options(token),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (draft) => {
          this.enrollment = { ...draft };
          this.enrollmentSaving.set(false);
          done?.();
        },
        error: (error) => {
          this.enrollmentSaving.set(false);
          this.enrollmentError.set(this.updateError(error));
        },
      });
  }

  protected selectMbiPerson(index: number): void {
    this.selectedMbiIndex.set(index);
    this.mbiPhotoStatus.set('');
    this.mbiError.set('');
    this.mbiSaved.set(false);
  }

  protected canSubmitMbi(): boolean {
    return !this.invalidSelectedMbi();
  }

  protected submitMbi(): void {
    if (!this.canMutate()) {
      this.mbiError.set('You are offline. Medicare updates are disabled until you reconnect.');
      return;
    }
    const token = window.__mobileAuth?.token;
    if (!token) {
      this.mbiError.set('Your mobile session is no longer available.');
      return;
    }
    if (!this.canSubmitMbi()) {
      const invalid = this.invalidSelectedMbi();
      this.mbiError.set(
        `Enter and re-enter the same MBI for ${invalid?.name ?? 'the selected person'}.`,
      );
      return;
    }
    this.mbiBusy.set(true);
    this.mbiSaved.set(false);
    this.mbiError.set('');
    this.http
      .put<MbiRecord[]>(
        `${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/mbi`,
        this.draftMbiRecords,
        this.options(token),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.draftMbiRecords = data.map((record) => ({ ...record }));
          this.mbiSaved.set(true);
          this.mbiBusy.set(false);
          this.activePage.set('home');
          this.actionMessage.set('Medicare information submitted.');
        },
        error: (error) => {
          this.logApiError('PUT /mbi', error);
          this.mbiError.set(this.updateError(error));
          this.mbiBusy.set(false);
        },
      });
  }

  private invalidSelectedMbi(): MbiRecord | undefined {
    const record = this.draftMbiRecords[this.selectedMbiIndex()];
    if (!record) return undefined;
    const mbi = this.normalizeMbi(record.medicareNumber);
    const reentry = this.normalizeMbi(record.reentryMedicareNumber);
    return !mbi || !reentry || mbi !== reentry ? record : undefined;
  }

  private normalizeMbi(value: string): string {
    return (value || '').replace(/[\s-]/g, '').toUpperCase();
  }

  protected cancelMbi(): void {
    const token = window.__mobileAuth?.token;
    if (token) this.loadMbi(token);
    this.mbiSaved.set(false);
    this.mbiError.set('');
    this.mbiPhotoStatus.set('');
    this.activePage.set('home');
    this.actionMessage.set('Medicare changes cancelled.');
  }

  protected async takeMbiPhoto(): Promise<void> {
    if (!this.canMutate()) {
      this.mbiError.set('You are offline. Medicare updates are disabled until you reconnect.');
      return;
    }
    if (!Capacitor.isNativePlatform()) {
      this.mbiError.set('Camera OCR is available in the installed mobile Shell.');
      return;
    }
    this.mbiBusy.set(true);
    this.mbiError.set('');
    this.mbiPhotoStatus.set('Opening camera…');
    try {
      const photo = await Camera.getPhoto({
        source: CameraSource.Camera,
        resultType: CameraResultType.Base64,
        quality: 85,
        allowEditing: false,
      });
      if (!photo.base64String) throw new Error('The camera did not return an image.');
      this.mbiPhotoStatus.set('Reading the Medicare card with on-device OCR…');
      const result =
        Capacitor.getPlatform() === 'ios'
          ? await MobileVisionTextRecognition.detectText({ base64Image: photo.base64String })
          : await CapacitorPluginMlKitTextRecognition.detectText({
              base64Image: photo.base64String,
              rotation: 0,
            });
      this.mapOcrToSelectedMbi(result.text);
    } catch (error) {
      console.error('[Mobile Health] MBI camera OCR failed', error);
      const message = error instanceof Error ? error.message : String(error);
      this.mbiError.set(
        this.isOcrUnavailable(message)
          ? 'On-device OCR is unavailable in this iOS build. Rebuild the app after syncing the iOS project.'
          : 'The MBI card could not be read. Try a brighter, closer photo.',
      );
      this.mbiPhotoStatus.set('');
    } finally {
      this.mbiBusy.set(false);
    }
  }

  private mapOcrToSelectedMbi(text: string): void {
    const mbi = this.extractMbi(text);
    const dates = this.extractOcrDates(text);
    const index = this.selectedMbiIndex();
    const selected = this.draftMbiRecords[index];
    if (!selected || !mbi) {
      this.mbiError.set(
        'OCR could not identify an MBI number. Retake the photo with the card flat and in focus.',
      );
      this.mbiPhotoStatus.set('');
      return;
    }
    this.draftMbiRecords = this.draftMbiRecords.map((record, recordIndex) =>
      recordIndex === index
        ? {
            ...record,
            medicareNumber: mbi,
            partAStartDate: dates.partA || dates.all[0] || record.partAStartDate,
            partBStartDate: dates.partB || dates.all[1] || record.partBStartDate,
          }
        : { ...record },
    );
    this.mbiPhotoStatus.set(
      `OCR found an MBI for ${selected.name}. Review it, re-enter it, then submit.`,
    );
  }

  private extractMbi(text: string): string | undefined {
    const normalizedLines = text
      .split(/\r?\n/)
      .map((line) => line.toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter(Boolean);
    const strictMbiPattern =
      /[1-9][A-HJ-NP-Z][A-HJ-NP-Z0-9]\d[A-HJ-NP-Z][A-HJ-NP-Z0-9]\d[A-HJ-NP-Z][A-HJ-NP-Z0-9]\d\d/;
    const broadMbiPattern = /[1-9][A-Z0-9]{10}/;

    for (const line of normalizedLines) {
      const candidate = line.match(strictMbiPattern)?.[0] ?? line.match(broadMbiPattern)?.[0];
      if (candidate) return candidate;
    }

    const compactText = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
    return compactText.match(strictMbiPattern)?.[0] ?? compactText.match(broadMbiPattern)?.[0];
  }

  private extractOcrDates(text: string): { all: string[]; partA?: string; partB?: string } {
    const matches = [
      ...text.matchAll(/\b(0?[1-9]|1[0-2])([/.-])(0?[1-9]|[12]\d|3[01])\2((?:19|20)\d{2})\b/g),
      ...text.matchAll(/\b((?:19|20)\d{2})([/.-])(0?[1-9]|1[0-2])\2(0?[1-9]|[12]\d|3[01])\b/g),
    ]
      .map((match) => {
        const isYearFirst = match[1].length === 4;
        const year = isYearFirst ? match[1] : match[4];
        const month = isYearFirst ? match[3] : match[1];
        const day = isYearFirst ? match[4] : match[3];
        return {
          index: match.index ?? 0,
          value: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
        };
      })
      .sort((left, right) => left.index - right.index);
    const uniqueDates = [...new Map(matches.map((match) => [match.index, match.value])).values()];
    let partA: string | undefined;
    let partB: string | undefined;

    for (const match of matches) {
      const precedingText = text.slice(Math.max(0, match.index - 50), match.index).toUpperCase();
      const partALabel = precedingText.lastIndexOf('PART A');
      const partBLabel = precedingText.lastIndexOf('PART B');
      if (partALabel > partBLabel && !partA) partA = match.value;
      if (partBLabel > partALabel && !partB) partB = match.value;
    }

    return { all: uniqueDates, partA, partB };
  }

  private isOcrUnavailable(message: string): boolean {
    const normalizedMessage = message.toLowerCase();
    return (
      normalizedMessage.includes('not implemented') ||
      normalizedMessage.includes('unavailable') ||
      (normalizedMessage.includes('plugin') && normalizedMessage.includes('not found'))
    );
  }

  private load(): void {
    void this.loadCachedThenRefresh();
  }

  private async loadCachedThenRefresh(): Promise<void> {
    const [cachedHealth, cachedMbi, cachedEnrollment] = await Promise.all([
      this.cache.read<HealthSummary>('health'),
      this.cache.read<MbiRecord[]>('health-mbi'),
      this.cache.read<EnrollmentDraft | null>('health-enrollment'),
    ]);
    if (this.destroyRef.destroyed) return;
    if (cachedHealth) this.apply(cachedHealth);
    if (cachedMbi) this.draftMbiRecords = cachedMbi.map((record) => ({ ...record }));
    if (cachedEnrollment) this.enrollment = { ...cachedEnrollment };

    const token = window.__mobileAuth?.token;
    this.loading.set(true);
    this.error.set('');

    if (!token || !this.auth.online() || this.auth.offlineMode()) {
      if (!cachedHealth)
        this.error.set('Offline. Health information has not been cached on this device yet.');
      this.loading.set(false);
      return;
    }

    this.loadMbi(token);
    this.loadEnrollmentState(token);
    this.http
      .get<HealthSummary>(
        `${API_BASE}/mobile-poc/wss-apps/health-ws/api/health`,
        this.options(token),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.apply(data);
          void this.cache.write('health', data);
          this.loading.set(false);
        },
        error: (error) => {
          this.logApiError('GET', error);
          this.error.set(this.loadError(error));
          this.loading.set(false);
        },
      });
  }

  private loadMbi(token: string): void {
    this.http
      .get<MbiRecord[]>(
        `${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/mbi`,
        this.options(token),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.draftMbiRecords = data.map((record) => ({ ...record }));
          void this.cache.write('health-mbi', this.draftMbiRecords);
          this.selectedMbiIndex.set(
            Math.min(this.selectedMbiIndex(), Math.max(this.draftMbiRecords.length - 1, 0)),
          );
        },
        error: (error) => {
          this.logApiError('GET /mbi', error);
          this.mbiError.set(this.loadError(error));
        },
      });
  }

  private loadEnrollmentState(token: string): void {
    this.http
      .get<EnrollmentDraft | null>(
        `${API_BASE}/mobile-poc/wss-apps/health-ws/api/health/enrollment`,
        this.options(token),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (draft) => {
          this.enrollment = draft ? { ...draft } : null;
          void this.cache.write('health-enrollment', this.enrollment);
        },
        error: () => {
          /* Retain the last loaded enrollment during an outage. */
        },
      });
  }

  private apply(data: HealthSummary): void {
    this.member.set(data);
    void this.cache.write('health', data);
  }
  private options(token: string): { headers: { Authorization: string } } {
    return { headers: { Authorization: `Bearer ${token}` } };
  }

  private logApiError(method: string, error: unknown): void {
    if (error instanceof HttpErrorResponse)
      console.error(`[Mobile Health] ${method} ${error.url ?? ''} failed`, {
        status: error.status,
        statusText: error.statusText,
        message: error.message,
        body: error.error,
      });
    else console.error(`[Mobile Health] ${method} request failed`, error);
  }

  private loadError(error: unknown): string {
    if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403))
      return `Health API rejected the mobile session (HTTP ${error.status}).`;
    if (error instanceof HttpErrorResponse && error.status === 0)
      return 'Unable to refresh right now. Previously loaded information is still available.';
    return error instanceof HttpErrorResponse && error.status > 0
      ? `Health API returned HTTP ${error.status}.`
      : 'Health data is temporarily unavailable.';
  }

  private updateError(error: unknown): string {
    if (error instanceof HttpErrorResponse && (error.status === 401 || error.status === 403))
      return `Health API rejected the mobile session (HTTP ${error.status}).`;
    if (error instanceof HttpErrorResponse && error.status === 0)
      return 'We could not confirm this update. Your entries are still here; reconnect and check before submitting again.';
    return error instanceof HttpErrorResponse && error.status > 0
      ? `Health API returned HTTP ${error.status}.`
      : 'Health information could not be updated.';
  }
}
