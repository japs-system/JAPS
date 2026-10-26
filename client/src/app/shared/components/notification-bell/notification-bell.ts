import { Component, ElementRef, HostListener, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppNotification, NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-notification-bell',
  templateUrl: './notification-bell.html',
})
export class NotificationBell implements OnInit, OnDestroy {
  private router = inject(Router);
  private host = inject(ElementRef);
  svc = inject(NotificationService);
  open = signal(false);

  ngOnInit(): void {
    this.svc.start();
  }
  ngOnDestroy(): void {
    this.svc.stop();
  }

  @HostListener('document:click', ['$event'])
  onDocClick(e: Event): void {
    if (!this.host.nativeElement.contains(e.target)) this.open.set(false);
  }

  toggle(): void {
    this.open.update((v) => !v);
  }

  openItem(n: AppNotification): void {
    this.svc.markRead(n);
    this.open.set(false);
    if (n.link) this.router.navigateByUrl(n.link);
  }

  iconFor(type: string): { icon: string; bg: string; fg: string } {
    switch (type) {
      case 'remittance_approved':
        return { icon: 'pi-check-circle', bg: 'bg-green-100', fg: 'text-green-600' };
      case 'remittance_rejected':
        return { icon: 'pi-times-circle', bg: 'bg-red-100', fg: 'text-red-600' };
      case 'remittance_submitted':
      case 'remittance_resubmitted':
        return { icon: 'pi-file', bg: 'bg-blue-100', fg: 'text-[#1E5AAA]' };
      case 'remittance_pending_reminder':
        return { icon: 'pi-clock', bg: 'bg-amber-100', fg: 'text-amber-600' };
      case 'schedule_cancelled':
        return { icon: 'pi-calendar-times', bg: 'bg-red-100', fg: 'text-red-600' };
      case 'trip_started':
        return { icon: 'pi-play', bg: 'bg-blue-100', fg: 'text-[#1E5AAA]' };
      case 'trip_completed':
        return { icon: 'pi-check-circle', bg: 'bg-green-100', fg: 'text-green-600' };
      case 'trip_cancelled':
        return { icon: 'pi-ban', bg: 'bg-red-100', fg: 'text-red-600' };
      case 'cash_discrepancy':
        return { icon: 'pi-exclamation-triangle', bg: 'bg-amber-100', fg: 'text-amber-600' };
      default: // schedule_assigned, schedule_updated
        return { icon: 'pi-calendar', bg: 'bg-amber-100', fg: 'text-amber-600' };
    }
  }

  timeAgo(iso: string): string {
    const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins} min ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs} hr ago`;
    const days = Math.floor(hrs / 24);
    return days === 1 ? 'Yesterday' : `${days} days ago`;
  }
}