import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { PrinterSetupService } from '../../../../core/services/printer-setup.service';

@Component({
  selector: 'app-printer-setup',
  imports: [],
  templateUrl: './printer-setup.html',
})
export class PrinterSetupPage {
  private printerSetup = inject(PrinterSetupService);
  private router = inject(Router);

  connecting = signal(false);
  connectError = signal('');
  printing = signal(false);
  showConfirmation = signal(false);
  showTroubleshooting = signal(false);

  isConnected(): boolean {
    return this.printerSetup.isConnected();
  }

  deviceName(): string {
    return this.printerSetup.deviceName();
  }

  batteryLevel(): number | null {
    return this.printerSetup.batteryLevel();
  }

  batteryColorClass(): string {
    const level = this.batteryLevel();
    if (level === null) return '';
    if (level <= 20) return 'text-red-600';
    if (level <= 50) return 'text-amber-600';
    return 'text-green-600';
  }

  isConfigured(): boolean {
    return this.printerSetup.isConfigured();
  }

  async connectPrinter(): Promise<void> {
    this.connectError.set('');
    this.connecting.set(true);
    try {
      await this.printerSetup.connect();
    } catch (err) {
      this.connectError.set(err instanceof Error ? err.message : 'Failed to connect to printer.');
    } finally {
      this.connecting.set(false);
    }
  }

  async sendTestPrint(): Promise<void> {
    this.showTroubleshooting.set(false);
    this.printing.set(true);

    try {
      await this.printerSetup.printSampleTicketImage();
      this.showConfirmation.set(true);
    } catch (err) {
      this.connectError.set(err instanceof Error ? err.message : 'Failed to send test print.');
    } finally {
      this.printing.set(false);
    }
  }

  confirmSuccess(): void {
    this.printerSetup.markConfigured();
    this.showConfirmation.set(false);
    this.router.navigate(['/conductor/ticketing']);
  }

  confirmFailure(): void {
    this.showConfirmation.set(false);
    this.showTroubleshooting.set(true);
  }

  reconfigure(): void {
    this.printerSetup.reset();
    this.showConfirmation.set(false);
    this.showTroubleshooting.set(false);
  }
}
