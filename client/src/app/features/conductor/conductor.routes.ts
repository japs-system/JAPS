import { Routes } from '@angular/router';
import { ConductorLayout } from './layout/conductor-layout/conductor-layout';
import { authGuard } from '../../core/guards/auth.guard';
import { roleGuard } from '../../core/guards/role.guard';
import { printerSetupGuard } from '../../core/guards/printer-setup.guard';

export const CONDUCTOR_ROUTES: Routes = [
  {
    path: '',
    component: ConductorLayout,
    canActivate: [authGuard, roleGuard('conductor')],
    children: [
      { path: '', redirectTo: 'trips', pathMatch: 'full' },
      {
        path: 'trips',
        loadComponent: () =>
          import('./pages/dashboard/dashboard').then((m) => m.ConductorDashboard),
      },
      {
        path: 'ticketing',
        canActivate: [printerSetupGuard],
        loadComponent: () => import('./pages/ticketing/ticketing').then((m) => m.TicketingPage),
      },
      {
        path: 'printer-setup',
        loadComponent: () =>
          import('./pages/printer-setup/printer-setup').then((m) => m.PrinterSetupPage),
      },
      {
        path: 'tickets',
        loadComponent: () => import('./pages/tickets').then((m) => m.TicketsPage),
      },
      {
        path: 'remittances',
        loadComponent: () =>
          import('./pages/remittances/remittances').then((m) => m.ConductorRemittancesPage),
      },
    ],
  },
];
