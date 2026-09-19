import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { catchError, throwError, timeout, TimeoutError } from 'rxjs';
import { MobileAuthService } from './mobile-auth.service';

/** Bound mobile API waits without replaying a submission whose outcome is unknown. */
export const mobileNetworkInterceptor: HttpInterceptorFn = (request, next) => {
  if (
    !Capacitor.isNativePlatform() ||
    !request.headers.has('Authorization') ||
    !request.url.startsWith('https://brianthedeveloper.com/')
  ) {
    return next(request);
  }
  const auth = inject(MobileAuthService);
  return next(request).pipe(
    timeout(15_000),
    catchError((error: unknown) => {
      if (
        error instanceof TimeoutError ||
        (error instanceof HttpErrorResponse &&
          (error.status === 0 ||
            error.status === 408 ||
            error.status === 429 ||
            error.status >= 500))
      ) {
        auth.markUnavailable();
      }
      return throwError(() => error);
    }),
  );
};
