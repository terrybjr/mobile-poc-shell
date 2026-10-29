import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MobileAuthService } from './mobile-auth.service';
import { MobileHealthComponent } from './mobile-health.component';
import { MobileHomeComponent } from './mobile-home.component';
import { MobileOfflineCacheService } from './mobile-offline-cache.service';
import { MobilePensionComponent } from './mobile-pension.component';

const HEALTH_API = 'https://brianthedeveloper.com/mobile-poc/wss-apps/health-ws/api/health';
const PENSION_API = 'https://brianthedeveloper.com/pension/api/pension';
const PENSION = {
  memberName: 'Demo Member',
  memberId: 'DEMO-ONLY',
  plan: 'Demo plan',
  status: 'Active',
  communication: 'Email',
  lastUpdated: 'Demo date',
  serviceYears: 12,
  estimatedMonthlyBenefit: 2000,
  retirementEligibility: 'Demo eligibility',
};

function enrollmentDraft() {
  return {
    id: 'synthetic-draft',
    startDate: '2026-10-01',
    dateSubmitted: '',
    status: 'INCOMPLETE',
    currentStep: 3,
    eligibilityReviewed: true,
    eligibilityDecision: 'CONTINUE',
    legalAccepted: true,
    demographicVerified: true,
    memberName: 'Demo Member',
    mailingAddress: 'Synthetic address',
    effectiveDate: '',
    medicalCoverage: 'None',
    dentalCoverage: 'None',
    visionCoverage: 'None',
    acknowledgmentAccepted: false,
    signature: '',
    dependents: [],
  };
}

describe('Mobile demo save and navigation behavior', () => {
  let requests: HttpTestingController;
  let fixture: ComponentFixture<MobileHealthComponent | MobileHomeComponent>;
  let previousAuth: Window['__mobileAuth'];

  beforeEach(() => {
    previousAuth = window.__mobileAuth;
    window.__mobileAuth = {
      authenticated: true,
      token: 'synthetic-test-token',
      tokenType: 'Bearer',
      expiresIn: 300,
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: MobileAuthService,
          useValue: {
            online: signal(true),
            offlineMode: signal(false),
            connectionRestored: signal(0),
            onlineSignInRequired: signal(false),
            reconnecting: signal(false),
            memberName: signal('Demo Member'),
          },
        },
        {
          provide: MobileOfflineCacheService,
          useValue: {
            read: jasmine.createSpy('cache.read').and.resolveTo(null),
            write: jasmine.createSpy('cache.write').and.resolveTo(),
          },
        },
      ],
    });
    requests = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    fixture?.destroy();
    requests.verify();
    if (previousAuth) window.__mobileAuth = previousAuth;
    else delete window.__mobileAuth;
  });

  function render() {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  function button(label: string, selector = 'button'): HTMLButtonElement {
    const match = Array.from(
      fixture.nativeElement.querySelectorAll(selector) as NodeListOf<HTMLButtonElement>,
    ).find(
      (element) =>
        element.textContent?.trim() === label ||
        element.querySelector('strong')?.textContent?.trim() === label,
    );
    if (!match) throw new Error(`Button not found: ${label}`);
    return match;
  }

  function click(label: string, selector?: string) {
    const target = button(label, selector);
    expect(target.disabled).withContext(label).toBeFalse();
    target.click();
    render();
  }

  function input(selector: string, value: string) {
    const field = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    expect(field).withContext(selector).not.toBeNull();
    field.value = value;
    field.dispatchEvent(
      new Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }),
    );
    render();
  }

  function flushHealthReads() {
    requests.expectOne(HEALTH_API).flush({
      memberName: 'Demo Member',
      plan: 'Demo health',
      status: 'Active',
      medical: 'PPO',
      deductible: 0,
      fsaBalance: 0,
      nextAppointment: '',
    });
    requests.expectOne(`${HEALTH_API}/mbi`).flush([
      {
        name: 'Demo Member',
        relationship: 'Policyholder',
        medicareNumber: '',
        reentryMedicareNumber: '',
        partAStartDate: '',
        partBStartDate: '',
      },
    ]);
    requests.expectOne(`${HEALTH_API}/enrollment`).flush(null);
    render();
  }

  function openHealth() {
    fixture = TestBed.createComponent(MobileHealthComponent);
    render();
    flushHealthReads();
  }

  function openHome() {
    fixture = TestBed.createComponent(MobileHomeComponent);
    render();
    requests.expectOne(PENSION_API).flush({ ...PENSION });
    render();
  }

  function openMbi() {
    button('Update Medicare information', '.mobile-action-card').click();
    render();
    input('#mobile-mbi-number', '1EG4TE5MK73');
    input('#mobile-mbi-reentry', '1EG4TE5MK73');
  }

  it('preserves dependent details in the enrollment payload after a failed save and retry', fakeAsync(() => {
    openHealth();
    button('Initial enrollment', '.mobile-action-card').click();
    render();
    requests.expectOne(`${HEALTH_API}/enrollment`).flush(enrollmentDraft());
    render();
    click('Continue', '.mobile-modal button');
    click('Manage dependents');
    click('Add new dependent');
    expect(button('Save dependent').disabled).toBeTrue();

    input('#mobile-dependent-prefix', 'Dr.');
    input('#mobile-dependent-first-name', 'Synthetic');
    input('#mobile-dependent-middle-name', 'Test');
    input('#mobile-dependent-last-name', 'Dependent');
    input('#mobile-dependent-suffix', 'Jr.');
    input('#mobile-dependent-date-of-birth', '2010-01-01');
    (
      fixture.nativeElement.querySelector('#mobile-dependent-gender-female') as HTMLInputElement
    ).click();
    render();
    expect(button('Save dependent').disabled).toBeTrue();
    input('#mobile-dependent-ssn', '000-00-0000');
    click('Save dependent');

    const save = requests.expectOne(`${HEALTH_API}/enrollment`);
    expect(save.request.method).toBe('PUT');
    expect(save.request.headers.get('Authorization')).toBe('Bearer synthetic-test-token');
    expect(save.request.body.dependents).toEqual([
      {
        id: jasmine.stringMatching(/^new-/),
        name: 'Synthetic Test Dependent',
        relationship: 'Child',
        selected: true,
        prefix: 'Dr.',
        firstName: 'Synthetic',
        middleName: 'Test',
        lastName: 'Dependent',
        suffix: 'Jr.',
        dateOfBirth: '2010-01-01',
        gender: 'Female',
        ssn: '000-00-0000',
      },
    ]);
    const payload = structuredClone(save.request.body);
    save.flush({}, { status: 503, statusText: 'Synthetic unavailable' });
    render();
    expect((fixture.componentInstance as MobileHealthComponent).hasUnsavedChanges()).toBeTrue();
    click('Save & close');
    const retry = requests.expectOne(`${HEALTH_API}/enrollment`);
    expect(retry.request.body).toEqual(payload);
    retry.flush(payload);
    render();
    expect((fixture.componentInstance as MobileHealthComponent).hasUnsavedChanges()).toBeFalse();
  }));

  it('does not show draft MBI as Submitted after Back without a write', fakeAsync(() => {
    openHealth();
    expect(fixture.nativeElement.textContent).toContain('No coverage on file');
    openMbi();
    (
      fixture.nativeElement.querySelector(
        'button[aria-label="Back to Health overview"]',
      ) as HTMLButtonElement
    ).click();
    render();
    expect(fixture.nativeElement.textContent).toContain('No coverage on file');
    requests.expectNone((request) => request.method !== 'GET');

    click('Refresh');
    flushHealthReads();
    expect(fixture.nativeElement.textContent).toContain('No coverage on file');
  }));

  it('does not show Submitted after a rejected MBI write and Back', fakeAsync(() => {
    openHealth();
    openMbi();
    click('Submit update');
    const save = requests.expectOne(`${HEALTH_API}/mbi`);
    expect(save.request.method).toBe('PUT');
    expect(save.request.body[0].medicareNumber).toBe('1EG4TE5MK73');
    save.flush({}, { status: 503, statusText: 'Synthetic unavailable' });
    render();
    expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain('503');
    (
      fixture.nativeElement.querySelector(
        'button[aria-label="Back to Health overview"]',
      ) as HTMLButtonElement
    ).click();
    render();
    expect(fixture.nativeElement.textContent).toContain('No coverage on file');
    requests.expectNone(`${HEALTH_API}/mbi`);
  }));

  it('keeps Pension edits on Stay and discards them only after confirmation', fakeAsync(() => {
    openHome();
    click('Pension', '.mobile-toolbar button');
    requests.expectOne(PENSION_API).flush({ ...PENSION });
    render();
    const original = fixture.debugElement.query(
      By.directive(MobilePensionComponent),
    ).componentInstance;
    input('#pension-member-name', 'Unsaved synthetic edit');
    click('Documents', '.mobile-toolbar button');
    expect(fixture.nativeElement.querySelector('dialog').open).toBeTrue();
    expect(fixture.debugElement.query(By.directive(MobilePensionComponent)).componentInstance).toBe(
      original,
    );
    click('Stay here');
    expect(fixture.nativeElement.querySelector('dialog').open).toBeFalse();
    expect(
      (fixture.nativeElement.querySelector('#pension-member-name') as HTMLInputElement).value,
    ).toBe('Unsaved synthetic edit');
    click('Documents', '.mobile-toolbar button');
    click('Discard changes');
    expect(fixture.debugElement.query(By.directive(MobilePensionComponent))).toBeNull();
    click('Pension', '.mobile-toolbar button');
    requests.expectOne(PENSION_API).flush({ ...PENSION });
    render();
    expect(
      fixture.debugElement.query(By.directive(MobilePensionComponent)).componentInstance,
    ).not.toBe(original);
    expect(
      (fixture.nativeElement.querySelector('#pension-member-name') as HTMLInputElement).value,
    ).toBe('Demo Member');
    requests.expectNone((request) => request.method !== 'GET');
  }));

  it('retains a successfully saved Pension edit through a fresh tab read (control)', fakeAsync(() => {
    openHome();
    click('Pension', '.mobile-toolbar button');
    requests.expectOne(PENSION_API).flush({ ...PENSION });
    render();
    input('#pension-member-name', 'Saved synthetic edit');
    click('Save Pension data');
    const save = requests.expectOne(PENSION_API);
    expect(save.request.method).toBe('PUT');
    const saved = { ...save.request.body };
    save.flush(saved);
    render();
    click('Documents', '.mobile-toolbar button');
    click('Pension', '.mobile-toolbar button');
    requests.expectOne(PENSION_API).flush(saved);
    render();
    expect(
      (fixture.nativeElement.querySelector('#pension-member-name') as HTMLInputElement).value,
    ).toBe('Saved synthetic edit');
  }));

  it('keeps Health MBI edits on Stay and discards them only after confirmation', fakeAsync(() => {
    openHome();
    click('Health', '.mobile-toolbar button');
    flushHealthReads();
    const original = fixture.debugElement.query(
      By.directive(MobileHealthComponent),
    ).componentInstance;
    openMbi();
    click('Documents', '.mobile-toolbar button');
    click('Stay here');
    expect(
      (fixture.nativeElement.querySelector('#mobile-mbi-number') as HTMLInputElement).value,
    ).toBe('1EG4TE5MK73');
    expect(fixture.debugElement.query(By.directive(MobileHealthComponent)).componentInstance).toBe(
      original,
    );
    click('Documents', '.mobile-toolbar button');
    click('Discard changes');
    expect(fixture.debugElement.query(By.directive(MobileHealthComponent))).toBeNull();
    click('Health', '.mobile-toolbar button');
    flushHealthReads();
    expect(
      fixture.debugElement.query(By.directive(MobileHealthComponent)).componentInstance,
    ).not.toBe(original);
    button('Update Medicare information', '.mobile-action-card').click();
    render();
    expect(
      (fixture.nativeElement.querySelector('#mobile-mbi-number') as HTMLInputElement).value,
    ).toBe('');
    requests.expectNone((request) => request.method !== 'GET');
  }));

  it('shows Submitted only after MBI success and restores confirmed values on Cancel', fakeAsync(() => {
    openHealth();
    openMbi();
    click('Submit update');
    const save = requests.expectOne(`${HEALTH_API}/mbi`);
    const confirmed = structuredClone(save.request.body);
    expect(fixture.nativeElement.querySelector('.mobile-coverage-list')).toBeNull();
    save.flush(confirmed);
    render();
    expect(fixture.nativeElement.querySelector('.mobile-coverage-list').textContent).toContain(
      'Submitted',
    );
    button('Update Medicare information', '.mobile-action-card').click();
    render();
    input('#mobile-mbi-number', '9XX9XX9XX99');
    input('#mobile-mbi-reentry', '9XX9XX9XX99');
    click('Cancel');
    requests.expectOne(`${HEALTH_API}/mbi`).flush(confirmed);
    render();
    button('Update Medicare information', '.mobile-action-card').click();
    render();
    expect(
      (fixture.nativeElement.querySelector('#mobile-mbi-number') as HTMLInputElement).value,
    ).toBe('1EG4TE5MK73');
    expect(TestBed.inject(MobileOfflineCacheService).write).toHaveBeenCalledWith(
      'health-mbi',
      confirmed,
    );
    expect((fixture.componentInstance as MobileHealthComponent).hasUnsavedChanges()).toBeFalse();
  }));

  it('retries rejected MBI explicitly without confirming the rejected draft', fakeAsync(() => {
    openHealth();
    openMbi();
    click('Submit update');
    requests
      .expectOne(`${HEALTH_API}/mbi`)
      .flush({}, { status: 503, statusText: 'Synthetic unavailable' });
    render();
    expect((fixture.componentInstance as MobileHealthComponent).hasUnsavedChanges()).toBeTrue();
    requests.expectNone(`${HEALTH_API}/mbi`);
    click('Submit update');
    const retry = requests.expectOne(`${HEALTH_API}/mbi`);
    retry.flush(retry.request.body);
    render();
    expect((fixture.componentInstance as MobileHealthComponent).hasUnsavedChanges()).toBeFalse();
    expect(fixture.nativeElement.querySelector('.mobile-coverage-list').textContent).toContain(
      'Submitted',
    );
  }));

  it('blocks tab departure during Pension save and keeps the warning after failure', fakeAsync(() => {
    openHome();
    click('Pension', '.mobile-toolbar button');
    requests.expectOne(PENSION_API).flush({ ...PENSION });
    render();
    input('#pension-member-name', 'Unsaved synthetic edit');
    click('Save Pension data');
    expect(button('Documents', '.mobile-toolbar button').disabled).toBeTrue();
    button('Documents', '.mobile-toolbar button').click();
    render();
    expect(fixture.debugElement.query(By.directive(MobilePensionComponent))).not.toBeNull();
    requests.expectOne(PENSION_API).flush({}, { status: 503, statusText: 'Synthetic unavailable' });
    render();
    click('Documents', '.mobile-toolbar button');
    click('Stay here');
    expect(
      (fixture.nativeElement.querySelector('#pension-member-name') as HTMLInputElement).value,
    ).toBe('Unsaved synthetic edit');
    requests.expectNone(PENSION_API);
  }));

  it('handles Escape, same-tab clicks and repeated departure requests without losing edits', fakeAsync(() => {
    openHome();
    click('Pension', '.mobile-toolbar button');
    requests.expectOne(PENSION_API).flush({ ...PENSION });
    render();
    input('#pension-member-name', 'Keep this edit');
    click('Pension', '.mobile-toolbar button');
    expect(fixture.nativeElement.querySelector('dialog').open).toBeFalse();
    click('Documents', '.mobile-toolbar button');
    (fixture.componentInstance as MobileHomeComponent).selectTab('contact');
    render();
    click('Discard changes');
    expect(fixture.nativeElement.querySelector('app-mobile-documents')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-mobile-contact')).toBeNull();
    click('Pension', '.mobile-toolbar button');
    requests.expectOne(PENSION_API).flush({ ...PENSION });
    render();
    input('#pension-member-name', 'Another edit');
    const leaveButton = button('Documents', '.mobile-toolbar button');
    leaveButton.focus();
    click('Documents', '.mobile-toolbar button');
    expect(document.activeElement?.textContent).toContain('Stay here');
    fixture.nativeElement.querySelector('dialog').dispatchEvent(new Event('cancel'));
    render();
    expect(fixture.nativeElement.querySelector('dialog').open).toBeFalse();
    expect(document.activeElement).toBe(leaveButton);
    expect(
      (fixture.nativeElement.querySelector('#pension-member-name') as HTMLInputElement).value,
    ).toBe('Another edit');
    input('#pension-member-name', 'Demo Member');
    click('Documents', '.mobile-toolbar button');
    expect(fixture.nativeElement.querySelector('dialog').open).toBeFalse();
  }));

  it('guards unsaved enrollment fields and clears the guard after Save and close', fakeAsync(() => {
    openHome();
    click('Health', '.mobile-toolbar button');
    flushHealthReads();
    button('Initial enrollment', '.mobile-action-card').click();
    render();
    requests.expectOne(`${HEALTH_API}/enrollment`).flush(enrollmentDraft());
    render();
    click('Continue', '.mobile-modal button');
    // Step three uses a select; its change event updates the real template-driven form.
    const date = fixture.nativeElement.querySelector('#mobile-effective-date') as HTMLSelectElement;
    date.value = '2026-11-01';
    date.dispatchEvent(new Event('change'));
    render();
    click('Documents', '.mobile-toolbar button');
    click('Stay here');
    click('Save & close');
    expect(button('Documents', '.mobile-toolbar button').disabled).toBeTrue();
    const save = requests.expectOne(`${HEALTH_API}/enrollment`);
    save.flush(save.request.body);
    render();
    click('Documents', '.mobile-toolbar button');
    expect(fixture.nativeElement.querySelector('dialog').open).toBeFalse();
    expect(fixture.nativeElement.querySelector('app-mobile-documents')).not.toBeNull();
  }));
});
