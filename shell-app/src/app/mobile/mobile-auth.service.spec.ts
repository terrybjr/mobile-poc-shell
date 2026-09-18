import { refreshResponseRequiresSignIn } from './mobile-auth.service';

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
  it('requires sign-in only for invalid refresh responses', () => {
    expect(refreshResponseRequiresSignIn(400)).toBeTrue();
    expect(refreshResponseRequiresSignIn(401)).toBeTrue();
    expect(refreshResponseRequiresSignIn(403)).toBeTrue();
    expect(refreshResponseRequiresSignIn(408)).toBeFalse();
    expect(refreshResponseRequiresSignIn(429)).toBeFalse();
    expect(refreshResponseRequiresSignIn(503)).toBeFalse();
  });
});
