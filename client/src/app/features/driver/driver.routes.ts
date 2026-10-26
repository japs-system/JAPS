import { Routes } from '@angular/router';
import { DriverLayout } from './layout/driver-layout/driver-layout';
import { authGuard } from '../../core/guards/auth.guard';
import { roleGuard } from '../../core/guards/role.guard';

export const DRIVER_ROUTES: Routes = [
  {
    path: '',
    component: DriverLayout,
    canActivate: [authGuard, roleGuard('driver')],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.DriverDashboard),
      },
      {
        path: 'remittances',
        loadComponent: () =>
          import('./pages/remittances/remittances').then((m) => m.DriverRemittancesPage),
      },
    ],
  },
];
