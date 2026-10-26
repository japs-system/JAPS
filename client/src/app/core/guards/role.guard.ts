import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { AuthUser } from '../../shared/models/auth.models';
import { map } from 'rxjs/operators';

export const roleGuard = (...allowedRoles: AuthUser['role'][]): CanActivateFn => {
  return () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    const check = (user: AuthUser | null) => {
      if (!user || !allowedRoles.includes(user.role)) {
        router.navigate(['/login']);
        return false;
      }
      return true;
    };

    if (auth.isLoggedIn()) return check(auth.getUser());

    return auth.fetchMe().pipe(map(check));
  };
};
