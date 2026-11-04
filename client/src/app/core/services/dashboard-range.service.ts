import { Injectable, computed, signal } from '@angular/core';

export type DashboardRangePreset = 'today' | '7d' | 'month' | '30d' | 'custom';

export interface DateRange {
  from: string;
  to: string;
}

interface AppliedRange {
  preset: DashboardRangePreset;
  /** Only used by the custom preset. */
  from: string;
  to: string;
}

/**
 * Owner date range, picked on the Dashboard and shared with the Remittances page.
 *
 * Kept in memory only (never localStorage/sessionStorage), so it survives
 * switching between tabs but is cleared on a page reload or when the user
 * logs in/out (AuthService calls reset()).
 */
@Injectable({ providedIn: 'root' })
export class DashboardRangeService {
  /** Preset button highlighted on the Dashboard. */
  readonly preset = signal<DashboardRangePreset>('month');
  readonly customFrom = signal<string>('');
  readonly customTo = signal<string>('');

  /** The range actually in effect. null = the owner has not picked one yet. */
  private readonly applied = signal<AppliedRange | null>(null);

  /** True once the owner has explicitly picked a range on the Dashboard. */
  readonly hasChosenRange = computed(() => this.applied() !== null);

  /**
   * Re-highlight the applied preset when a dashboard opens (so an unapplied "Custom"
   * click doesn't linger), or the portal's default button when nothing was chosen.
   */
  syncPreset(defaultPreset: DashboardRangePreset): void {
    this.preset.set(this.applied()?.preset ?? defaultPreset);
  }

  /** The chosen range as concrete dates, or null when the user has not picked one. */
  appliedRange(): DateRange | null {
    const a = this.applied();
    return a ? this.resolve(a) : null;
  }

  /** Pick a preset. 'custom' only shows the date inputs; it applies on applyCustom(). */
  selectPreset(preset: DashboardRangePreset): void {
    this.preset.set(preset);
    if (preset !== 'custom') this.applied.set({ preset, from: '', to: '' });
  }

  /** Apply the custom dates. Returns false if either date is missing. */
  applyCustom(): boolean {
    const from = this.customFrom();
    const to = this.customTo();
    if (!from || !to) return false;
    this.applied.set({ preset: 'custom', from, to });
    return true;
  }

  /**
   * Range sent to /owner/dashboard. null = let the server default to the current
   * month (also used until the owner picks something).
   */
  dashboardQuery(): DateRange | null {
    const a = this.applied();
    if (!a || a.preset === 'month') return null;
    return this.resolve(a);
  }

  /**
   * Concrete date range for the Remittances page: the chosen range, or today
   * when the owner has not picked one.
   */
  remittanceRange(): DateRange {
    const a = this.applied();
    if (!a) return this.resolve({ preset: 'today', from: '', to: '' });
    return this.resolve(a);
  }

  /** Short description of what the Remittances page is showing. */
  remittanceRangeLabel(): string {
    const a = this.applied();
    if (!a) return 'Today';
    switch (a.preset) {
      case 'today':
        return 'Today';
      case '7d':
        return 'Last 7 Days';
      case '30d':
        return 'Last 30 Days';
      case 'month':
        return 'This Month';
      default:
        return 'Custom Range';
    }
  }

  /** Back to "nothing chosen" (called on login/logout). */
  reset(): void {
    this.preset.set('month');
    this.customFrom.set('');
    this.customTo.set('');
    this.applied.set(null);
  }

  private resolve(a: AppliedRange): DateRange {
    // Local calendar dates (toISOString() is UTC and shifts the day before 8 AM in PH time).
    const now = new Date();
    switch (a.preset) {
      case 'today':
        return { from: this.key(now), to: this.key(now) };
      case '7d':
        return { from: this.key(this.daysAgo(now, 6)), to: this.key(now) };
      case '30d':
        return { from: this.key(this.daysAgo(now, 29)), to: this.key(now) };
      case 'custom':
        // Tolerate dates entered the wrong way round.
        return a.from <= a.to ? { from: a.from, to: a.to } : { from: a.to, to: a.from };
      case 'month':
      default:
        return {
          from: this.key(new Date(now.getFullYear(), now.getMonth(), 1)),
          to: this.key(now),
        };
    }
  }

  private daysAgo(d: Date, n: number): Date {
    const r = new Date(d);
    r.setDate(r.getDate() - n);
    return r;
  }

  private key(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
}