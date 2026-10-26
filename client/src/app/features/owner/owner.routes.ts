import { Routes } from '@angular/router';
import { OwnerLayout } from './layout/owner-layout/owner-layout';
import { authGuard } from '../../core/guards/auth.guard';
import { roleGuard } from '../../core/guards/role.guard';
import { OWNER_LEVEL_ROLES } from '../../shared/constants/user-options';

export const OWNER_ROUTES: Routes = [
  {
    path: '',
    component: OwnerLayout,
    canActivate: [authGuard, roleGuard(...OWNER_LEVEL_ROLES)],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard),
      },
      {
        path: 'remittances',
        loadComponent: () => import('./pages/remittances/remittances').then((m) => m.Remittances),
      },
      {
        path: 'reports',
        loadComponent: () =>
          import('./pages/reports/reports').then((m) => m.OwnerReports),
      },
      {
        path: 'remittances/:id',
        loadComponent: () =>
          import('./pages/remittance-detail/remittance-detail').then((m) => m.RemittanceDetailPage),
      },
      {
        path: 'buses',
        loadComponent: () => import('./pages/buses/buses').then((m) => m.Buses),
      },
      {
        path: 'routes',
        loadComponent: () => import('./pages/routes/routes').then((m) => m.Routes),
      },
      {
        path: 'fare-settings',
        loadComponent: () =>
          import('./pages/fare-settings/fare-settings').then((m) => m.FareSettings),
      },
      {
        path: 'schedules',
        loadComponent: () => import('./pages/schedules/schedules').then((m) => m.Schedules),
      },
      {
        path: 'users',
        loadComponent: () => import('./pages/users/users').then((m) => m.Users),
      },
    ],
  },
];
