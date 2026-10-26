import { Routes } from '@angular/router';
import { LoginPage } from './auth/login-page/login-page';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  { path: 'login', component: LoginPage },

  {
    path: 'owner',
    loadChildren: () => import('./features/owner/owner.routes').then((m) => m.OWNER_ROUTES),
  },
  {
    path: 'conductor',
    loadChildren: () =>
      import('./features/conductor/conductor.routes').then((m) => m.CONDUCTOR_ROUTES),
  },
  {
    path: 'driver',
    loadChildren: () => import('./features/driver/driver.routes').then((m) => m.DRIVER_ROUTES),
  },
  {
    path: 'audit-teller',
    loadChildren: () =>
      import('./features/audit-teller/audit-teller.routes').then((m) => m.AUDIT_TELLER_ROUTES),
  },

  { path: '**', redirectTo: 'login' },
];
