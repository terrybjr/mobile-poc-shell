import { TestBed } from '@angular/core/testing';
import { MOBILE_SECURE_STORAGE } from './mobile-auth.service';
import { MobileOfflineCacheService } from './mobile-offline-cache.service';

describe('Member offline cache', () => {
  let cache: MobileOfflineCacheService;
  let records: Map<string, string>;
  const member = (sub: string) => {
    window.__mobileAuth = {
      authenticated: true,
      token: `header.${btoa(JSON.stringify({ sub }))}.signature`,
      tokenType: 'Bearer',
      expiresIn: 60,
    };
  };

  beforeEach(() => {
    records = new Map();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MOBILE_SECURE_STORAGE,
          useValue: {
            get: async (key: string) => records.get(key) ?? null,
            set: async (key: string, value: string) => {
              records.set(key, value);
            },
          },
        },
      ],
    });
    cache = TestBed.inject(MobileOfflineCacheService);
  });

  afterEach(() => {
    delete window.__mobileAuth;
  });

  it('restores saved information only for the member who loaded it', async () => {
    member('first');
    await cache.write('pension', { memberName: 'First member' });
    member('second');
    expect(await cache.read('pension')).toBeNull();
    member('first');
    expect(await cache.read('pension')).toEqual({ memberName: 'First member' });
  });

  it('does not return old shared caches or cached data while signed out', async () => {
    records.set('mytrs.mobile.cache.pension', JSON.stringify({ memberName: 'Someone else' }));
    member('first');
    expect(await cache.read('pension')).toBeNull();
    await cache.write('pension', { memberName: 'First member' });
    delete window.__mobileAuth;
    expect(await cache.read('pension')).toBeNull();
  });
});
