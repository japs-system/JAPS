import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { PrinterSetupService } from '../services/printer-setup.service';

export const printerSetupGuard: CanActivateFn = () => {
  const printerSetup = inject(PrinterSetupService);
  const router = inject(Router);

  if (printerSetup.isConfigured()) return true;

  router.navigate(['/conductor/printer-setup']);
  return false;
};
