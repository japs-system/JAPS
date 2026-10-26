import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { environment } from '../../../../../environments/environment';

export type AuditRangePreset = 'today' | '7d' | 'month' | '30d' | 'custom';

interface DashboardStats {
  pending: number;
  approved: number;
  rejected: number;
  total: number;
}

interface RemittanceSummary {
  id: number;
  date: string;
  net_collection: number;
  cash_deposit: number;
  cash_received: number | null;
  status: 'submitted' | 'approved' | 'rejected';
  resubmitted_at?: string | null;
  submitted_at: string;
  approved_at: string | null;
  conductor: { id: number; first_name: string; last_name: string; employee_id: string };
  BusModel: { id: number; bus_number: string; plate_number: string };
  approver: { id: number; first_name: string; last_name: string } | null;
}

/** One chart column: a single day, or a whole week when the range is very long. */
interface Bucket {
  key: string;
  from: string;
  to: string;
  dow: string; // Mon, Tue, … (empty for weekly buckets)
  short: string; // 10/18
  title: string; // Sat 10/18  or  10/12 – 10/18
  weekend: boolean;
  submitted: number; // remittances submitted in this bucket (by submitted_at)
  reviewed: number; // remittances approved or rejected in this bucket (by approved_at)
  approved: number;
  rejected: number;
  cashRemitted: number; // cash received on remittances approved in this bucket
}

interface AuditorActivity {
  name: string;
  count: number;
  cashRemitted: number;
}

@Component({
  selector: 'app-audit-teller-dashboard',
  imports: [RouterLink, CurrencyPipe, DatePipe],
  templateUrl: './dashboard.html',
})
export class AuditTellerDashboard implements OnInit {
  private http = inject(HttpClient);
  private readonly API = `${environment.apiUrl}/api/audit-teller`;

  // All-time counts (the Pending card is the teller's queue, so it ignores the range).
  stats = signal<DashboardStats>({ pending: 0, approved: 0, rejected: 0, total: 0 });
  loading = signal(false);

  private allRemittances = signal<RemittanceSummary[]>([]);
  remittancesLoading = signal(false);

  ngOnInit(): void {
    this.loadStats();
    this.loadRemittances();
  }

  // ── Date range filter (same presets as the owner dashboard) ─────────────
  rangePreset = signal<AuditRangePreset>('7d');
  customFrom = signal<string>('');
  customTo = signal<string>('');
  private appliedCustom = signal<{ from: string; to: string } | null>(null);

  readonly RANGE_PRESETS: { value: AuditRangePreset; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: 'Last 7 Days' },
    { value: 'month', label: 'This Month' },
    { value: '30d', label: 'Last 30 Days' },
    { value: 'custom', label: 'Custom Range' },
  ];

  setRangePreset(preset: AuditRangePreset): void {
    this.rangePreset.set(preset);
  }

  onCustomFromInput(e: Event): void {
    this.customFrom.set((e.target as HTMLInputElement).value);
  }

  onCustomToInput(e: Event): void {
    this.customTo.set((e.target as HTMLInputElement).value);
  }

  applyCustomRange(): void {
    if (this.customFrom() && this.customTo()) {
      this.appliedCustom.set({ from: this.customFrom(), to: this.customTo() });
    }
  }

  // ── Date helpers (local calendar days, never toISOString — that shifts the day in UTC+8) ──
  private localDateStr(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private parseKey(key: string): Date {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  /** "YYYY-MM-DD" as-is; a full timestamp is converted to the local calendar day. */
  private dayKey(value: string | null | undefined): string {
    if (!value) return '';
    if (value.length === 10) return value;
    const d = new Date(value);
    return isNaN(d.getTime()) ? value.slice(0, 10) : this.localDateStr(d);
  }

  /** The resolved { from, to } for the selected preset. */
  range = computed(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const back = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n);
    let from = back(6);
    let to = today;
    switch (this.rangePreset()) {
      case 'today':
        from = today;
        break;
      case '30d':
        from = back(29);
        break;
      case 'month':
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case 'custom': {
        const c = this.appliedCustom();
        if (c) {
          from = this.parseKey(c.from);
          to = this.parseKey(c.to);
        }
        break;
      }
    }
    if (from > to) [from, to] = [to, from];
    return { from: this.localDateStr(from), to: this.localDateStr(to) };
  });

  private inRange(key: string): boolean {
    const { from, to } = this.range();
    return key !== '' && key >= from && key <= to;
  }

  // ── Chart buckets ───────────────────────────────────────────────────────
  // Submitted vs Reviewed follows the selected range and picks a column size that
  // keeps the bars wide: days (≤ 14 days), weeks (≤ 120 days), otherwise months.
  // The Cash Remitted trend is always the last 14 days.
  private bucketize(from: string, to: string): { list: Bucket[]; index: Map<string, Bucket> } {
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const short = (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`;

    // Every calendar day in the range (capped at three years).
    const keys: string[] = [];
    const end = this.parseKey(to);
    for (let d = this.parseKey(from); d <= end && keys.length < 1100; d.setDate(d.getDate() + 1)) {
      keys.push(this.localDateStr(d));
    }

    const blank = (key: string): Bucket => {
      const d = this.parseKey(key);
      return {
        key,
        from: key,
        to: key,
        dow: names[d.getDay()],
        short: short(d),
        title: `${names[d.getDay()]} ${short(d)}`,
        weekend: d.getDay() === 0 || d.getDay() === 6,
        submitted: 0,
        reviewed: 0,
        approved: 0,
        rejected: 0,
        cashRemitted: 0,
      };
    };

    const list: Bucket[] = [];
    const index = new Map<string, Bucket>();

    if (keys.length <= 14) {
      for (const key of keys) {
        const bucket = blank(key);
        list.push(bucket);
        index.set(key, bucket);
      }
      return { list, index };
    }

    const monthly = keys.length > 120;
    let cur: Bucket | null = null;
    for (const key of keys) {
      const d = this.parseKey(key);
      const startsNew = monthly ? d.getDate() === 1 : d.getDay() === 1;
      if (!cur || startsNew) {
        cur = blank(key);
        list.push(cur);
      }
      cur.to = key;
      index.set(key, cur);
    }
    for (const bucket of list) {
      const f = this.parseKey(bucket.from);
      const t = this.parseKey(bucket.to);
      bucket.dow = '';
      bucket.weekend = false;
      if (monthly) {
        bucket.short = months[f.getMonth()];
        bucket.title = `${months[f.getMonth()]} ${f.getFullYear()}`;
      } else {
        bucket.short = short(f);
        bucket.title = bucket.from === bucket.to ? short(f) : `${short(f)} – ${short(t)}`;
      }
    }
    return { list, index };
  }

  /** Adds the remittances to the buckets they fall in. */
  private fillBuckets(index: Map<string, Bucket>): void {
    for (const r of this.allRemittances()) {
      const submitted = index.get(this.dayKey(r.submitted_at));
      if (submitted) submitted.submitted++;

      if ((r.status === 'approved' || r.status === 'rejected') && r.approved_at) {
        const reviewed = index.get(this.dayKey(r.approved_at));
        if (!reviewed) continue;
        reviewed.reviewed++;
        if (r.status === 'approved') {
          reviewed.approved++;
          if (r.cash_received !== null && r.cash_received !== undefined) {
            reviewed.cashRemitted += Number(r.cash_received) || 0;
          }
        } else {
          reviewed.rejected++;
        }
      }
    }
  }

  /** Columns for Submitted vs Reviewed (selected range). */
  buckets = computed<Bucket[]>(() => {
    const { from, to } = this.range();
    const { list, index } = this.bucketize(from, to);
    this.fillBuckets(index);
    return list;
  });

  /** Columns for the Cash Remitted trend: always the last 14 days. */
  cashDays = computed<Bucket[]>(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 13);
    const { list, index } = this.bucketize(this.localDateStr(start), this.localDateStr(today));
    this.fillBuckets(index);
    return list;
  });

  /** Axis labels for Submitted vs Reviewed: with many columns only some labels show. */
  labelStep = computed(() => Math.ceil(this.buckets().length / 10));

  /** Bar height in %, with a small minimum so a single remittance is still visible. */
  barHeight(value: number): number {
    if (value <= 0) return 0;
    return Math.max((value / this.maxBar()) * 100, 4);
  }

  // ── Remittances reviewed (approved or rejected) inside the range ───────
  private reviewed = computed(() =>
    this.allRemittances().filter(
      (r) =>
        (r.status === 'approved' || r.status === 'rejected') &&
        !!r.approved_at &&
        this.inRange(this.dayKey(r.approved_at)),
    ),
  );

  approvedCount = computed(() => this.reviewed().filter((r) => r.status === 'approved').length);
  rejectedCount = computed(() => this.reviewed().filter((r) => r.status === 'rejected').length);

  // ── Cash discrepancy per remittance (approved remittances with cash recorded) ──
  private discrepancyOf(r: RemittanceSummary): number | null {
    if (r.status !== 'approved') return null;
    if (r.cash_received === null || r.cash_received === undefined) return null;
    const expected = Number(r.net_collection) + Number(r.cash_deposit);
    return Math.round((Number(r.cash_received) - expected) * 100) / 100;
  }

  /** 'short' | 'over' | 'match', or 'none' when there is no cash received to compare. */
  discKind(r: RemittanceSummary): 'short' | 'over' | 'match' | 'none' {
    const diff = this.discrepancyOf(r);
    if (diff === null) return 'none';
    return diff === 0 ? 'match' : diff < 0 ? 'short' : 'over';
  }

  discAbs(r: RemittanceSummary): number {
    return Math.abs(this.discrepancyOf(r) ?? 0);
  }

  // ── Submitted vs Reviewed (grouped columns) ─────────────────────────────
  submittedTotal = computed(() => this.buckets().reduce((s, b) => s + b.submitted, 0));
  reviewedTotal = computed(() => this.buckets().reduce((s, b) => s + b.reviewed, 0));
  maxBar = computed(() =>
    Math.max(...this.buckets().flatMap((b) => [b.submitted, b.reviewed]), 1),
  );
  subHoverIndex = signal<number | null>(null);
  subHovered = computed(() => {
    const i = this.subHoverIndex();
    const list = this.buckets();
    if (i === null || !list[i]) return null;
    return { bar: list[i], xPct: ((i + 0.5) / list.length) * 100 };
  });

  /** Remittances sent back for correction and resubmitted inside the range. */
  resubmittedCount = computed(
    () =>
      this.allRemittances().filter(
        (r) => !!r.resubmitted_at && this.inRange(this.dayKey(r.resubmitted_at)),
      ).length,
  );

  // ── Cash remitted line chart, last 14 days (points sit at the centre of each hover zone) ──
  private readonly CHART_W = 400;
  cashTotal = computed(() => this.cashDays().reduce((sum, d) => sum + d.cashRemitted, 0));
  cashPoints = computed(() => {
    const list = this.cashDays();
    const max = Math.max(...list.map((d) => d.cashRemitted), 1);
    return list.map((d, i) => {
      const xPct = ((i + 0.5) / list.length) * 100;
      return { xPct, x: (xPct / 100) * this.CHART_W, y: 94 - (d.cashRemitted / max) * 88 };
    });
  });
  cashLine = computed(() =>
    this.cashPoints()
      .map((p) => `${p.x},${p.y}`)
      .join(' '),
  );
  cashArea = computed(() => {
    const pts = this.cashPoints();
    if (!pts.length) return '';
    const line = pts.map((p) => `${p.x},${p.y}`).join(' L');
    return `M${pts[0].x},100 L${line} L${pts[pts.length - 1].x},100 Z`;
  });
  cashHoverIndex = signal<number | null>(null);
  cashHovered = computed(() => {
    const i = this.cashHoverIndex();
    const list = this.cashDays();
    if (i === null || !list[i]) return null;
    return { day: list[i], point: this.cashPoints()[i] };
  });

  /** Keeps a tooltip inside the card near the left/right edges. */
  tooltipLeft(xPct: number): number {
    return Math.min(86, Math.max(14, xPct));
  }

  // ── Auditor activity (remittances reviewed inside the range) ────────────
  auditorActivity = computed<AuditorActivity[]>(() => {
    const byAuditor = new Map<string, AuditorActivity>();
    for (const r of this.reviewed()) {
      if (!r.approver) continue;
      const name = `${r.approver.first_name} ${r.approver.last_name}`;
      const entry = byAuditor.get(name) ?? { name, count: 0, cashRemitted: 0 };
      entry.count++;
      if (r.status === 'approved' && r.cash_received !== null && r.cash_received !== undefined) {
        entry.cashRemitted += Number(r.cash_received) || 0;
      }
      byAuditor.set(name, entry);
    }
    return [...byAuditor.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  });

  maxAuditorCount = computed(() => Math.max(...this.auditorActivity().map((a) => a.count), 1));

  // ── Lists (not range based) ─────────────────────────────────────────────
  // Most recently submitted remittances, newest first
  recentRemittances = computed(() => this.allRemittances().slice(0, 8));

  // Remittances still waiting on review, oldest first (most urgent to audit)
  oldestPending = computed(() =>
    this.allRemittances()
      .filter((r) => r.status === 'submitted')
      .sort((a, b) => new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime())
      .slice(0, 5),
  );

  private waitDays(r: RemittanceSummary): number {
    const ms = Date.now() - new Date(r.submitted_at).getTime();
    return Math.max(0, Math.floor(ms / 86_400_000));
  }

  waitLabel(r: RemittanceSummary): string {
    const d = this.waitDays(r);
    return d === 0 ? 'Today' : d === 1 ? '1 day' : `${d} days`;
  }

  waitClass(r: RemittanceSummary): string {
    return this.waitDays(r) >= 3 ? 'text-red-700 bg-red-50' : 'text-amber-700 bg-amber-50';
  }

  // ── Data loading ────────────────────────────────────────────────────────
  loadStats(): void {
    this.loading.set(true);
    this.http.get<DashboardStats>(`${this.API}/stats`, { withCredentials: true }).subscribe({
      next: (data) => {
        this.stats.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  loadRemittances(): void {
    this.remittancesLoading.set(true);
    this.http
      .get<RemittanceSummary[]>(`${this.API}/remittances`, { withCredentials: true })
      .subscribe({
        next: (data) => {
          this.allRemittances.set(data);
          this.remittancesLoading.set(false);
        },
        error: () => this.remittancesLoading.set(false),
      });
  }

  getStatusBadge(status: string): string {
    const badges: Record<string, string> = {
      submitted: 'bg-amber-100 text-amber-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
    };
    return badges[status] ?? 'bg-gray-100 text-gray-800';
  }
}