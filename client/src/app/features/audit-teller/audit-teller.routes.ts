import { Routes } from '@angular/router';
import { AuditTellerLayout } from './layout/audit-teller-layout/audit-teller-layout';
import { authGuard } from '../../core/guards/auth.guard';
import { roleGuard } from '../../core/guards/role.guard';

export const AUDIT_TELLER_ROUTES: Routes = [
  {
    path: '',
    component: AuditTellerLayout,
    canActivate: [authGuard, roleGuard('audit_teller')],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () => import('./pages/dashboard').then((m) => m.AuditTellerDashboard),
      },
      {
        path: 'remittances',
        loadComponent: () => import('./pages/remittances').then((m) => m.RemittancesPage),
      },
      {
        path: 'remittances/:id',
        loadComponent: () =>
          import('./pages/remittance-review').then((m) => m.RemittanceReviewPage),
      },
    ],
  },
];
