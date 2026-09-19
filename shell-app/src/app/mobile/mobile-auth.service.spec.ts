import { fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import {
  MOBILE_SECURE_STORAGE,
  MobileAuthService,
  refreshResponseRequiresSignIn,
} from './mobile-auth.service';

declare global {
  interface Window {
    __healthAuth?: { authenticated: boolean; token: string };
    __mobileAuth?: {
      authenticated: boolean;
      token: string;
      tokenType: string;
      expiresIn: number;
      offline?: boolean;
    };
  }
}

describe('MobileAuthService offline refresh', () => {
  let auth: MobileAuthService;
  let fetchSpy: jasmine.Spy;

  const response = (status: number, body: object = {}) =>
    ({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) }) as Response;
  const tokens = { access_token: 'access', refresh_token: 'refresh', expires_in: 300 };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MOBILE_SECURE_STORAGE,
          useValue: {
            remove: () => Promise.resolve(true),
            get: () => Promise.resolve(null),
            set: () => Promise.resolve(),
          },
        },
      ],
    });
    auth = TestBed.inject(MobileAuthService);
    auth.online.set(true);
    fetchSpy = spyOn(window, 'fetch').and.callFake(() => Promise.resolve(response(200, tokens)));
  });

  afterEach(async () => {
    await auth.logout();
  });

  it('keeps an unremembered session through an outage and automatically reconnects', fakeAsync(() => {
    void auth.beginLogin('demo', 'password', false);
    flushMicrotasks();
    expect(auth.authenticated()).withContext(`login: ${auth.error()}`).toBeTrue();
    auth.markUnavailable();
    fetchSpy.and.resolveTo(response(503));
    auth.retryConnection();
    flushMicrotasks();
    expect(auth.authenticated()).toBeTrue();
    expect(auth.offlineMode()).toBeTrue();
    expect(window.__mobileAuth?.offline).toBeTrue();

    fetchSpy.and.resolveTo(response(200, { ...tokens, access_token: 'renewed' }));
    tick(10_000);
    flushMicrotasks();
    expect(auth.offlineMode()).toBeFalse();
    expect(window.__mobileAuth?.token).toBe('renewed');
    expect(auth.hasSavedSession()).toBeFalse();
    void auth.logout();
    flushMicrotasks();
  }));

  it('does not resurrect the session when a refresh finishes after sign-out', fakeAsync(() => {
    void auth.beginLogin('demo', 'password', false);
    flushMicrotasks();
    let finish!: (value: Response) => void;
    fetchSpy.and.returnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    auth.retryConnection();
    flushMicrotasks();
    void auth.logout();
    flushMicrotasks();
    finish(response(200, tokens));
    flushMicrotasks();
    expect(auth.authenticated()).toBeFalse();
    expect(window.__mobileAuth).toBeUndefined();
  }));

  it('requires a new sign-in when the refresh session is rejected', fakeAsync(() => {
    void auth.beginLogin('demo', 'password', false);
    flushMicrotasks();
    fetchSpy.and.resolveTo(response(401));
    auth.retryConnection();
    flushMicrotasks();
    expect(auth.authenticated()).toBeFalse();
    expect(auth.hasSavedSession()).toBeFalse();
    expect(window.__mobileAuth).toBeUndefined();
  }));

  it('does not send overlapping reconnect requests', fakeAsync(() => {
    void auth.beginLogin('demo', 'password', false);
    flushMicrotasks();
    let finish!: (value: Response) => void;
    fetchSpy.and.returnValue(
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    );
    auth.retryConnection();
    auth.retryConnection();
    expect(fetchSpy.calls.count()).toBe(2);
    finish(response(200, tokens));
    flushMicrotasks();
    void auth.logout();
    flushMicrotasks();
  }));

  it('keeps the session when a refresh times out', fakeAsync(() => {
    void auth.beginLogin('demo', 'password', false);
    flushMicrotasks();
    fetchSpy.and.callFake(
      (_url: string, options: RequestInit) =>
        new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    auth.retryConnection();
    tick(10_000);
    flushMicrotasks();
    expect(auth.authenticated()).toBeTrue();
    expect(auth.offlineMode()).toBeTrue();
    expect(auth.reconnecting()).toBeFalse();
    void auth.logout();
    flushMicrotasks();
  }));

  it('requires sign-in only for invalid refresh responses', () => {
    expect(refreshResponseRequiresSignIn(400)).toBeTrue();
    expect(refreshResponseRequiresSignIn(401)).toBeTrue();
    expect(refreshResponseRequiresSignIn(403)).toBeTrue();
    expect(refreshResponseRequiresSignIn(408)).toBeFalse();
    expect(refreshResponseRequiresSignIn(429)).toBeFalse();
    expect(refreshResponseRequiresSignIn(503)).toBeFalse();
  });
});
