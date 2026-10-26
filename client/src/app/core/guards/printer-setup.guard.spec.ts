import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { printerSetupGuard } from './printer-setup.guard';
import { PrinterSetupService } from '../services/printer-setup.service';

describe('printerSetupGuard', () => {
  it('allows activation when printer is configured', () => {
    const isConfigured = () => true;
    TestBed.configureTestingModule({
      providers: [
        { provide: PrinterSetupService, useValue: { isConfigured } },
        { provide: Router, useValue: { navigate: () => {} } },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      printerSetupGuard({} as any, {} as any),
    );
    expect(result).toBe(true);
  });

  it('redirects to printer-setup and blocks activation when not configured', () => {
    const isConfigured = () => false;
    const navigate = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: PrinterSetupService, useValue: { isConfigured } },
        { provide: Router, useValue: { navigate } },
      ],
    });

    const result = TestBed.runInInjectionContext(() =>
      printerSetupGuard({} as any, {} as any),
    );
    expect(result).toBe(false);
    expect(navigate).toHaveBeenCalledWith(['/conductor/printer-setup']);
  });
});
