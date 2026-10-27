import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../../../core/services/auth.service';
import { ConfirmModal } from '../../../../shared/components/confirm-modal/confirm-modal';
import { NotificationBell } from '../../../../shared/components/notification-bell/notification-bell';

interface NavItem {
  label: string;
  icon: string;
  route: string;
}

@Component({
  selector: 'app-owner-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ConfirmModal, NotificationBell],
  templateUrl: './owner-layout.html',
})
export class OwnerLayout {
  private auth = inject(AuthService);
  private router = inject(Router);

  user = this.auth.getUser();
  sidebarOpen = signal(true);
  mobileMenuOpen = signal(false);
  userMenuOpen = signal(false);
  showLogoutConfirm = signal(false);

  navItems: NavItem[] = [
    { label: 'Dashboard', icon: 'pi-chart-bar', route: 'dashboard' },
    { label: 'Remittances', icon: 'pi-book', route: 'remittances' },
    { label: 'Reports', icon: 'pi-file-excel', route: 'reports' },
    { label: 'Buses', icon: 'pi-car', route: 'buses' },
    { label: 'Routes', icon: 'pi-map', route: 'routes' },
    { label: 'Fare Settings', icon: 'pi-money-bill', route: 'fare-settings' },
    { label: 'Schedules', icon: 'pi-calendar', route: 'schedules' },
    { label: 'Users', icon: 'pi-users', route: 'users' },
  ];

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  openMobileMenu(): void {
    this.mobileMenuOpen.set(true);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  toggleUserMenu(): void {
    this.userMenuOpen.update((v) => !v);
  }

  closeUserMenu(): void {
    this.userMenuOpen.set(false);
  }

  roleLabel(): string {
    if (this.user?.role === 'admin_staff') return 'Admin Staff';
    return 'Owner';
  }

  logoutMessage(): string {
    return `You'll need to sign in again to access the ${this.roleLabel()} Portal. Continue?`;
  }

  confirmLogout(): void {
    this.userMenuOpen.set(false);
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