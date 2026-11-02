import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { MobileAuthService } from './mobile-auth.service';
import { MobileHealthComponent } from './mobile-health.component';
import { MobileOfflineCacheService } from './mobile-offline-cache.service';
import { MobilePensionComponent } from './mobile-pension.component';

const HEALTH = 'https://brianthedeveloper.com/mobile-poc/wss-apps/health-ws/api/health';
const PENSION = 'https://brianthedeveloper.com/pension/api/pension';
const SUMMARY = {
  memberName: 'Synthetic Member',
  plan: 'Demo',
  status: 'Active',
  medical: 'PPO',
  deductible: 0,
  fsaBalance: 0,
  nextAppointment: '',
};
const MBI = [
  {
    name: 'Synthetic Member',
    relationship: 'Policyholder',
    medicareNumber: '1EG4TE5MK73',
    reentryMedicareNumber: '1EG4TE5MK73',
    partAStartDate: '',
    partBStartDate: '',
  },
];
function draft() {
  return {
    id: 'synthetic-api-contract',
    startDate: '2026-11-02',
    dateSubmitted: '',
    status: 'INCOMPLETE',
    currentStep: 5,
    eligibilityReviewed: true,
    eligibilityDecision: 'CONTINUE',
    legalAccepted: true,
    demographicVerified: true,
    memberName: 'Synthetic Member',
    mailingAddress: 'Synthetic address',
    effectiveDate: '2026-11-01',
    medicalCoverage: 'Enroll',
    dentalCoverage: 'None',
    visionCoverage: 'None',
    acknowledgmentAccepted: true,
    signature: 'Synthetic Member',
    dependents: [
      {
        id: 'synthetic-child',
        name: 'Synthetic Child',
        relationship: 'Child',
        selected: true,
        prefix: '',
        firstName: 'Synthetic',
        middleName: '',
        lastName: 'Child',
        suffix: '',
        dateOfBirth: '2010-01-01',
        gender: 'Female',
        ssn: '000-00-0000',
      },
    ],
  };
}

// Invoke the handlers used by the real templates, without duplicating their HTTP implementation.
interface HealthActions {
  beginEnrollment(): void;
  chooseEligibility(decision: 'CONTINUE'): void;
  closeEnrollment(): void;
  cancelEnrollment(): void;
  continueEnrollment(): void;
  submitEnrollment(): void;
  nextEnrollmentStep(): void;
  submitMbi(): void;
  cancelMbi(): void;
  resetDemo(): void;
}

describe('Mobile canonical business API contracts', () => {
  let requests: HttpTestingController;
  let fixture: ComponentFixture<MobileHealthComponent | MobilePensionComponent>;
  let previousAuth: Window['__mobileAuth'];

  beforeEach(() => {
    previousAuth = window.__mobileAuth;
    window.__mobileAuth = {
      authenticated: true,
      token: 'synthetic-contract-token',
      tokenType: 'Bearer',
      expiresIn: 300,
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MobileAuthService,
          useValue: { online: signal(true), offlineMode: signal(false) },
        },
        {
          provide: MobileOfflineCacheService,
          useValue: { read: async () => null, write: async () => {} },
        },
      ],
    });
    requests = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture.destroy();
    requests.verify();
    if (previousAuth) window.__mobileAuth = previousAuth;
    else delete window.__mobileAuth;
  });

  function render() {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  function request(method: string, url: string) {
    const pending = requests.expectOne(url);
    expect(pending.request.method).toBe(method);
    expect(pending.request.headers.get('Authorization')).toBe('Bearer synthetic-contract-token');
    if (method === 'POST' || method === 'PUT')
      expect(pending.request.detectContentTypeHeader()).toBe('application/json');
    return pending;
  }

  function health() {
    fixture = TestBed.createComponent(MobileHealthComponent);
    render();
    request('GET', HEALTH).flush(SUMMARY);
    request('GET', `${HEALTH}/mbi`).flush(structuredClone(MBI));
    request('GET', `${HEALTH}/enrollment`).flush(null);
    render();
    return fixture.componentInstance as unknown as HealthActions;
  }

  it('uses canonical start, whole-draft save and cancellation contracts', fakeAsync(() => {
    const ui = health();
    ui.beginEnrollment();
    request('GET', `${HEALTH}/enrollment`).flush(null);
    const start = request('POST', `${HEALTH}/enrollment/start`);
    expect(start.request.body).toEqual({});
    start.flush(draft());
    ui.chooseEligibility('CONTINUE');
    const eligibility = request('PUT', `${HEALTH}/enrollment`);
    expect(eligibility.request.body).toEqual(draft());
    eligibility.flush(structuredClone(eligibility.request.body));
    ui.closeEnrollment();
    const save = request('PUT', `${HEALTH}/enrollment`);
    expect(save.request.body).toEqual(draft());
    save.flush(structuredClone(save.request.body));
    ui.cancelEnrollment();
    request('DELETE', `${HEALTH}/enrollment`).flush({ ...draft(), status: 'CANCELLED' });
    render();
  }));

  it('submits a saved draft with an empty command body and resets the same Health resource', fakeAsync(() => {
    const ui = health();
    ui.beginEnrollment();
    request('GET', `${HEALTH}/enrollment`).flush(draft());
    ui.continueEnrollment();
    ui.submitEnrollment();
    const submit = request('POST', `${HEALTH}/enrollment/submit`);
    expect(submit.request.body).toEqual({});
    submit.flush({ ...draft(), status: 'SUBMITTED', dateSubmitted: '2026-11-02' });
    ui.resetDemo();
    request('DELETE', HEALTH).flush(SUMMARY);
    request('GET', `${HEALTH}/mbi`).flush(structuredClone(MBI));
    render();
  }));

  it('saves and reloads the same MBI list contract without uploading an image', fakeAsync(() => {
    const ui = health();
    ui.submitMbi();
    const save = request('PUT', `${HEALTH}/mbi`);
    expect(save.request.body).toEqual(MBI);
    save.flush(structuredClone(MBI));
    ui.cancelMbi();
    request('GET', `${HEALTH}/mbi`).flush(structuredClone(MBI));
    render();
  }));

  it('uses the canonical Pension summary GET, whole-record PUT and reset DELETE', fakeAsync(() => {
    const summary = {
      memberName: 'Synthetic Member',
      memberId: 'DEMO-ONLY',
      plan: 'Demo',
      status: 'Active',
      communication: 'Email',
      lastUpdated: 'Demo date',
      serviceYears: 12,
      estimatedMonthlyBenefit: 2000,
      retirementEligibility: 'Demo eligibility',
    };
    fixture = TestBed.createComponent(MobilePensionComponent);
    render();
    request('GET', PENSION).flush(summary);
    render();
    const ui = fixture.componentInstance as unknown as { save(): void; reset(): void };
    ui.save();
    const save = request('PUT', PENSION);
    expect(save.request.body).toEqual(summary);
    save.flush({ ...summary });
    ui.reset();
    request('DELETE', PENSION).flush({ ...summary });
    render();
  }));

  const invalidDrafts = [
    { reason: 'missing disclosure consent', change: { legalAccepted: false } },
    { reason: 'unconfirmed demographics', change: { demographicVerified: false } },
    { reason: 'no selected plan', change: { medicalCoverage: 'None' } },
    { reason: 'missing acceptance', change: { acknowledgmentAccepted: false } },
    { reason: 'blank signature', change: { signature: ' ' } },
  ];
  for (const test of invalidDrafts) {
    it(`does not submit a resumed draft with ${test.reason}`, fakeAsync(() => {
      const ui = health();
      ui.beginEnrollment();
      request('GET', `${HEALTH}/enrollment`).flush({ ...draft(), ...test.change });
      ui.continueEnrollment();
      ui.submitEnrollment();
      render();
      requests.expectNone(`${HEALTH}/enrollment/submit`);
      expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    }));
  }

  for (const test of [
    { step: 2, reason: 'blank demographics', change: { memberName: '' } },
    { step: 3, reason: 'missing effective date', change: { effectiveDate: '' } },
    { step: 3, reason: 'no selected plan', change: { medicalCoverage: 'None' } },
  ]) {
    it(`does not advance or save step ${test.step} with ${test.reason}`, fakeAsync(() => {
      const ui = health();
      ui.beginEnrollment();
      request('GET', `${HEALTH}/enrollment`).flush({
        ...draft(),
        ...test.change,
        currentStep: test.step,
      });
      ui.continueEnrollment();
      ui.nextEnrollmentStep();
      render();
      requests.expectNone(`${HEALTH}/enrollment`);
      expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    }));
  }

  it('does not introduce new required member/address/date fields at submission', fakeAsync(() => {
    const ui = health();
    ui.beginEnrollment();
    const sparse = { ...draft(), memberName: '', mailingAddress: '', effectiveDate: '' };
    request('GET', `${HEALTH}/enrollment`).flush(sparse);
    ui.continueEnrollment();
    ui.submitEnrollment();
    const submit = request('POST', `${HEALTH}/enrollment/submit`);
    expect(submit.request.body).toEqual({});
    submit.flush({ ...sparse, status: 'SUBMITTED' });
    render();
  }));
});
