import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { ConfirmModal } from '../../../../shared/components/confirm-modal/confirm-modal';
import { NotificationBell } from '../../../../shared/components/notification-bell/notification-bell';

interface NavItem {
  label: string;
  shortLabel?: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'app-audit-teller-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConfirmModal, NotificationBell],
  templateUrl: './audit-teller-layout.html',
})
export class AuditTellerLayout {
  private auth = inject(AuthService);
  public router = inject(Router);

  user = this.auth.getUser();
  sidebarOpen = signal(true);
  userMenuOpen = signal(false);
  showLogoutConfirm = signal(false);

  navItems: NavItem[] = [
    { label: 'Dashboard', shortLabel: 'Dashboard', icon: 'pi-home', route: 'dashboard' },
    { label: 'Remittances', shortLabel: 'Remittances', icon: 'pi-file-check', route: 'remittances' },
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