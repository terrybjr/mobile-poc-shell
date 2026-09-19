import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MobileAuthService } from './mobile-auth.service';
import { MobileDocumentsComponent } from './mobile-documents.component';
import { MobileLoginComponent } from './mobile-login.component';

describe('Mobile presentation', () => {
  it('shows all sample documents without nonfunctional preview buttons', () => {
    const fixture = TestBed.createComponent(MobileDocumentsComponent);
    fixture.detectChanges();
    const page: HTMLElement = fixture.nativeElement;
    expect(page.querySelectorAll('.document-list li').length).toBe(8);
    expect(page.querySelectorAll('time[datetime]').length).toBe(8);
    expect(page.querySelector('button')).toBeNull();
    expect(page.textContent).toContain('Document previews are not available in this demo.');
  });

  it('keeps sign-in progress inside the button rather than inserting a shifting notice', () => {
    const busy = signal(false);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MobileAuthService,
          useValue: {
            busy,
            hasSavedSession: signal(false),
            lockedForBackground: signal(false),
            online: signal(true),
            error: signal(''),
            biometricLabel: () => 'Face ID',
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(MobileLoginComponent);
    fixture.detectChanges();
    const page: HTMLElement = fixture.nativeElement;
    const button = page.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.textContent).toContain('Sign in');
    busy.set(true);
    fixture.detectChanges();
    expect(button.disabled).toBeTrue();
    expect(button.textContent).toContain('Signing in…');
    expect(page.querySelector('.status')).toBeNull();
    expect(page.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
  });
});
