import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Capacitor } from '@capacitor/core';
import { MobileAuthService } from './mobile-auth.service';
import { mobileNetworkInterceptor } from './mobile-network.interceptor';

describe('Mobile network recovery', () => {
  let http: HttpClient;
  let requests: HttpTestingController;
  let unavailable: jasmine.Spy;
  const url = 'https://brianthedeveloper.com/pension/api/pension';

  beforeEach(() => {
    unavailable = jasmine.createSpy('markUnavailable');
    spyOn(Capacitor, 'isNativePlatform').and.returnValue(true);
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([mobileNetworkInterceptor])),
        provideHttpClientTesting(),
        { provide: MobileAuthService, useValue: { markUnavailable: unavailable } },
      ],
    });
    http = TestBed.inject(HttpClient);
    requests = TestBed.inject(HttpTestingController);
  });

  afterEach(() => requests.verify());

  it('marks an outage without replaying a failed submission', () => {
    http
      .put(url, { status: 'demo' }, { headers: { Authorization: 'Bearer test' } })
      .subscribe({ error: () => {} });
    requests.expectOne(url).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(unavailable).toHaveBeenCalledTimes(1);
    requests.expectNone(url);
  });

  it('does not mistake a permission rejection for a connectivity failure', () => {
    http.get(url, { headers: { Authorization: 'Bearer test' } }).subscribe({ error: () => {} });
    requests.expectOne(url).flush({}, { status: 403, statusText: 'Forbidden' });
    expect(unavailable).not.toHaveBeenCalled();
  });
});
