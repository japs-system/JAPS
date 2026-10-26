import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { AlertService } from '../../../../core/services/alert.service';
import { PrinterSetupService } from '../../../../core/services/printer-setup.service';
import { ConfirmModal } from '../../../../shared/components/confirm-modal/confirm-modal';
import { NotificationBell } from '../../../../shared/components/notification-bell/notification-bell';

interface NavItem {
  label: string;
  shortLabel?: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'app-conductor-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConfirmModal, NotificationBell],
  templateUrl: './conductor-layout.html',
  styleUrl: './conductor-layout.css',
})
export class ConductorLayout {
  private auth = inject(AuthService);
  public router = inject(Router);
  private alertService = inject(AlertService);
  private printerSetup = inject(PrinterSetupService);

  user = this.auth.getUser();
  sidebarOpen = signal(true);
  userMenuOpen = signal(false);
  printerMenuOpen = signal(false);
  connectingPrinter = signal(false);
  showLogoutConfirm = signal(false);

  navItems: NavItem[] = [
    { label: 'My Trips', shortLabel: 'Trips', icon: 'pi-list', route: 'trips' },
    { label: 'Ticketing Terminal', shortLabel: 'Ticketing', icon: 'pi-ticket', route: 'ticketing' },
    { label: 'All Tickets', shortLabel: 'Tickets', icon: 'pi-receipt', route: 'tickets' },
    { label: 'Remittances', shortLabel: 'Remit', icon: 'pi-file-check', route: 'remittances' },
  ];

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  /** First letters of the first and last name, for the header avatar. */
  initials(): string {
    const first = this.user?.first_name?.[0] ?? '';
    const last = this.user?.last_name?.[0] ?? '';
    return (first + last).toUpperCase();
  }

  toggleUserMenu(): void {
    this.userMenuOpen.update((v) => !v);
  }

  closeUserMenu(): void {
    this.userMenuOpen.set(false);
  }

  isPrinterConnected(): boolean {
    return this.printerSetup.isConnected();
  }

  printerDeviceName(): string {
    return this.printerSetup.deviceName();
  }

  printerBatteryLevel(): number | null {
    return this.printerSetup.batteryLevel();
  }

  printerBatteryColorClass(): string {
    const level = this.printerBatteryLevel();
    if (level === null) return '';
    if (level <= 20) return 'text-red-600';
    if (level <= 50) return 'text-amber-600';
    return 'text-green-600';
  }

  togglePrinterMenu(): void {
    this.printerMenuOpen.update((v) => !v);
  }

  closePrinterMenu(): void {
    this.printerMenuOpen.set(false);
  }

  onPrinterButtonClick(): void {
    if (this.isPrinterConnected()) {
      this.togglePrinterMenu();
    } else {
      this.connectPrinter();
    }
  }

  async connectPrinter(): Promise<void> {
    this.connectingPrinter.set(true);
    try {
      await this.printerSetup.connect();
      this.printerSetup.markConfigured();
      this.alertService.success('Printer Connected', `Connected to ${this.printerDeviceName()}.`);
    } catch (err) {
      this.alertService.error(
        'Connection Failed',
        err instanceof Error ? err.message : 'Failed to connect to printer.',
      );
    } finally {
      this.connectingPrinter.set(false);
    }
  }

  disconnectPrinter(): void {
    this.printerSetup.disconnect();
    this.closePrinterMenu();
    this.alertService.info('Printer Disconnected', 'The Bluetooth printer has been disconnected.');
  }

  confirmLogout(): void {
    this.closeUserMenu();
    this.showLogoutConfirm.set(true);
  }

  cancelLogout(): void {
    this.showLogoutConfirm.set(false);
  }

  logout(): void {
    this.showLogoutConfirm.set(false);
    this.auth.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login']),
    });
  }
}