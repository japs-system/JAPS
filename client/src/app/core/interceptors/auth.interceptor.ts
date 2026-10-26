import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';

// JWT lives in an httpOnly cookie — browser sends it automatically.
// Interceptor only ensures withCredentials is set for API requests.
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.startsWith(environment.apiUrl)) {
    return next(req.clone({ withCredentials: true }));
  }
  return next(req);
};
