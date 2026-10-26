import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { environment } from '../../../../../environments/environment';

export type DashboardRangePreset = 'today' | '7d' | 'month' | '30d' | 'custom';

export type InsightTone = 'positive' | 'negative' | 'neutral' | 'warning';

export interface DashboardInsight {
  tone: InsightTone;
  title: string;
  message: string;
}

const INSIGHT_STYLES: Record<InsightTone, { bg: string; icon: string; text: string }> = {
  positive: { bg: 'bg-green-50', icon: 'pi-arrow-up-right', text: 'text-green-600' },
  negative: { bg: 'bg-red-50', icon: 'pi-arrow-down-right', text: 'text-red-600' },
  warning: { bg: 'bg-amber-50', icon: 'pi-exclamation-triangle', text: 'text-amber-600' },
  neutral: { bg: 'bg-gray-50', icon: 'pi-info-circle', text: 'text-[#1E5AAA]' },
};

interface DashboardData {
  insights?: DashboardInsight[];
  range: { from: string; to: string };
  kpi: {
    net_gross_in_range: number;
    total_revenue_in_range: number;
    driver_commission_in_range: number;
    conductor_commission_in_range: number;
    passenger_count_in_range: number;
    passenger_growth_pct: string | null;
    bus_utilisation_rate: number;
    total_buses: number;
    buses_in_use_today: number;
    remittance_approved: number;
    remittance_total: number;
    remittance_pending: number;
    remittance_rejected: number;
    remittance_revenue_in_range: number;
    remittance_cash_variance_in_range: number;
  };
  daily_passengers: { date: string; total: string }[];
  route_profit: {
    route_id: number;
    revenue: string;
    trip_count: string;
    origin: string;
    destination: string;
  }[];
  peak_hours: { hour: number; ticket_count: string }[];
  weekday_weekend: { month: number; dow: number; total: string }[];
  remittance_daily: { date: string; total_revenue: string }[];
  remittance_trend: {
    year: number;
    month: number;
    net_collection: string;
    total_revenue: string;
    gross_income: string;
  }[];
}

interface ForecastData {
  kpi_forecast: {
    predicted_passengers_tomorrow: number;
    passenger_growth_pct_tomorrow: string | null;
    predicted_revenue_tomorrow: number;
    revenue_growth_pct_tomorrow: string | null;
    predicted_bus_utilisation_tomorrow: number;
  };
  demand_series: { date: string; value: number; type: 'actual' | 'forecast' }[];
  revenue_forecast_7d: { date: string; predicted: number }[];
  revenue_series?: { date: string; value: number; type: 'actual' | 'forecast' }[];
  peak_hours_forecast: { hour: number; avg_tickets: string }[];
  seasonal_factors: { dow: string; factor: number }[];
}

@Component({
  selector: 'app-dashboard',
  imports: [CurrencyPipe, DecimalPipe],
  templateUrl: './dashboard.html',
})
export class Dashboard implements OnInit {
  private http = inject(HttpClient);
  private readonly API = `${environment.apiUrl}/api/owner`;

  loading = signal(true);
  dash = signal<DashboardData | null>(null);
  insights = computed(() => this.dash()?.insights ?? []);
  fore = signal<ForecastData | null>(null);

  // ── Date range filter ─────────────────────────────────────────────────
  rangePreset = signal<DashboardRangePreset>('month');
  customFrom = signal<string>('');
  customTo = signal<string>('');

  readonly RANGE_PRESETS: { value: DashboardRangePreset; label: string }[] = [
    { value: 'today', label: 'Today' },
    { value: '7d', label: 'Last 7 Days' },
    { value: 'month', label: 'This Month' },
    { value: '30d', label: 'Last 30 Days' },
    { value: 'custom', label: 'Custom Range' },
  ];

  ngOnInit(): void {
    this.fore.set(null);
    this.http
      .get<ForecastData>(`${this.API}/forecast`, { withCredentials: true })
      .subscribe({ next: (fore) => this.fore.set(fore) });
    this.loadDashboard();
  }

  private resolvedRange(): { from: string; to: string } | null {
    const toIso = (d: Date) => d.toISOString().split('T')[0];
    const now = new Date();
    switch (this.rangePreset()) {
      case 'today':
        return { from: toIso(now), to: toIso(now) };
      case '7d': {
        const from = new Date(now);
        from.setDate(from.getDate() - 6);
        return { from: toIso(from), to: toIso(now) };
      }
      case '30d': {
        const from = new Date(now);
        from.setDate(from.getDate() - 29);
        return { from: toIso(from), to: toIso(now) };
      }
      case 'custom':
        return this.customFrom() && this.customTo()
          ? { from: this.customFrom(), to: this.customTo() }
          : null;
      case 'month':
      default:
        return null; // let the server default to the current month
    }
  }

  loadDashboard(): void {
    this.loading.set(true);
    const range = this.resolvedRange();
    let params = new HttpParams();
    if (range) {
      params = params.set('from', range.from).set('to', range.to);
    }
    this.http
      .get<DashboardData>(`${this.API}/dashboard`, { withCredentials: true, params })
      .subscribe({
        next: (dash) => {
          this.dash.set(dash);
          this.loading.set(false);
        },
        error: () => this.loading.set(false),
      });
  }

  setRangePreset(preset: DashboardRangePreset): void {
    this.rangePreset.set(preset);
    if (preset !== 'custom') this.loadDashboard();
  }

  onCustomFromInput(e: Event): void {
    this.customFrom.set((e.target as HTMLInputElement).value);
  }

  onCustomToInput(e: Event): void {
    this.customTo.set((e.target as HTMLInputElement).value);
  }

  applyCustomRange(): void {
    if (this.customFrom() && this.customTo()) this.loadDashboard();
  }

  // ── SVG helpers ─────────────────────────────────────────────────────────
  private normalise(values: number[], height: number): number[] {
    const max = Math.max(...values, 1);
    return values.map((v) => height - (v / max) * height);
  }

  polyline(values: number[], width: number, height: number): string {
    if (!values.length) return '';
    const ys = this.normalise(values, height);
    const step = width / Math.max(values.length - 1, 1);
    return ys.map((y, i) => `${i * step},${y}`).join(' ');
  }

  areaPath(values: number[], width: number, height: number): string {
    if (!values.length) return '';
    const ys = this.normalise(values, height);
    const step = width / Math.max(values.length - 1, 1);
    const line = ys.map((y, i) => `${i * step},${y}`).join(' L');
    return `M0,${height} L${line} L${(values.length - 1) * step},${height} Z`;
  }

  // ── Dashboard computed ───────────────────────────────────────────────────
  remittanceApprovedPct = computed(() => {
    const d = this.dash();
    if (!d || !d.kpi.remittance_total) return 0;
    return Math.round((d.kpi.remittance_approved / d.kpi.remittance_total) * 100);
  });

  remittancePendingPct = computed(() => {
    const d = this.dash();
    if (!d || !d.kpi.remittance_total) return 0;
    return Math.round((d.kpi.remittance_pending / d.kpi.remittance_total) * 100);
  });

  remittanceRejectedPct = computed(() => {
    const d = this.dash();
    if (!d || !d.kpi.remittance_total) return 0;
    return Math.round((d.kpi.remittance_rejected / d.kpi.remittance_total) * 100);
  });

  /** Donut segments: approved, then rejected, then pending. Grey when there are none. */
  remittanceDonutGradient = computed(() => {
    if (!this.dash()?.kpi.remittance_total) return '#f3f4f6';
    const a = this.remittanceApprovedPct();
    const b = a + this.remittanceRejectedPct();
    return `conic-gradient(#22c55e 0% ${a}%, #ef4444 ${a}% ${b}%, #f59e0b ${b}% 100%)`;
  }); 

  dailyPassengerBars = computed(() => {
    const d = this.dash();
    if (!d) return [];
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const result: { label: string; value: number }[] = [];
    const from = new Date(`${d.range.from}T00:00:00`);
    const to = new Date(`${d.range.to}T00:00:00`);
    for (let dt = new Date(from); dt <= to; dt.setDate(dt.getDate() + 1)) {
      const key = dt.toISOString().split('T')[0];
      const found = d.daily_passengers.find((r) => r.date?.toString().startsWith(key));
      result.push({
        label: days[dt.getDay() === 0 ? 6 : dt.getDay() - 1],
        value: Number(found?.total ?? 0),
      });
    }
    return result;
  });

  maxDailyPassengers = computed(() =>
    Math.max(...this.dailyPassengerBars().map((b) => b.value), 1),
  );

  routeBars = computed(() => {
    const d = this.dash();
    if (!d) return [];
    return d.route_profit.map((r) => ({
      label: `${r.origin} – ${r.destination}`,
      revenue: Number(r.revenue),
    }));
  });

  maxRouteRevenue = computed(() => Math.max(...this.routeBars().map((r) => r.revenue), 1));

  peakHourValues = computed(() => {
    const d = this.dash();
    if (!d) return [];
    const slots = Array(24).fill(0);
    for (const row of d.peak_hours) slots[Number(row.hour)] = Number(row.ticket_count);
    return slots.slice(6, 22);
  });
  // Evenly spaced along the chart's 6 AM – 9 PM axis.
  peakHourLabels = [6, 9, 12, 15, 18, 21];

  /** Daily total revenue of approved remittances across the selected range (weekend flagged). */
  remittanceDailyBars = computed(() => {
    const d = this.dash();
    if (!d) return [];
    const pad = (n: number) => String(n).padStart(2, '0');
    const keyOf = (dt: Date) =>
      `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
    const totals = new Map<string, number>(
      (d.remittance_daily ?? []).map((r) => [String(r.date).slice(0, 10), Number(r.total_revenue)]),
    );
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const bars: {
      key: string;
      dow: string;
      label: string;
      day: number;
      value: number;
      weekend: boolean;
      title: string;
    }[] = [];
    const to = new Date(`${d.range.to}T00:00:00`);
    for (let dt = new Date(`${d.range.from}T00:00:00`); dt <= to; dt.setDate(dt.getDate() + 1)) {
      const key = keyOf(dt);
      const dow = dt.getDay();
      const value = totals.get(key) ?? 0;
      bars.push({
        key,
        dow: names[dow],
        label: `${names[dow]} ${dt.getMonth() + 1}/${dt.getDate()}`,
        day: dt.getDate(),
        value,
        weekend: dow === 0 || dow === 6,
        title: `${names[dow]} ${dt.getMonth() + 1}/${dt.getDate()} · ₱${value.toLocaleString('en-PH', { maximumFractionDigits: 0 })}`,
      });
    }
    return bars;
  });
  /** Bar under the cursor in the remittance trend chart. */
  trendHoverIndex = signal<number | null>(null);
  trendHovered = computed(() => {
    const i = this.trendHoverIndex();
    const bars = this.remittanceDailyBars();
    if (i === null || !bars[i]) return null;
    return { ...bars[i], xPct: ((i + 0.5) / bars.length) * 100 };
  });
  maxRemittanceDaily = computed(() => Math.max(...this.remittanceDailyBars().map((b) => b.value), 1));

  /** Passengers per day of the week (Mon–Sun, last 12 weeks), tagged with the seasonal demand factor. */
  dayOfWeekBars = computed(() => {
    const d = this.dash();
    if (!d) return [];
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const totals = Array(7).fill(0);
    for (const r of d.weekday_weekend) totals[Number(r.dow)] += Number(r.total);
    const factors = new Map<string, number>(
      (this.fore()?.seasonal_factors ?? []).map((s) => [s.dow, s.factor] as [string, number]),
    );
    return [1, 2, 3, 4, 5, 6, 0].map((i) => ({
      label: names[i],
      value: totals[i],
      factor: factors.get(names[i]) ?? null,
    }));
  });

  maxDayOfWeek = computed(() => Math.max(...this.dayOfWeekBars().map((b) => b.value), 1));

  /** High demand = green, low = red, otherwise grey (same thresholds as before). */
  dayBarClass(factor: number | null): string {
    if (factor === null) return 'bg-[#1E5AAA]';
    if (factor > 1.05) return 'bg-green-400';
    if (factor < 0.95) return 'bg-red-300';
    return 'bg-gray-300';
  }
  dayTextClass(factor: number): string {
    if (factor > 1.05) return 'text-green-600 font-semibold';
    if (factor < 0.95) return 'text-red-400 font-semibold';
    return 'text-gray-500';
  }

  // ── Passenger demand + revenue chart ──────────────────────────────────────
  private readonly CHART_W = 500;
  private readonly CHART_H = 120;

  /** Index of the day under the cursor (null when not hovering). */
  hoverIndex = signal<number | null>(null);

  splitIndex = computed(
    () => (this.fore()?.demand_series ?? []).filter((p) => p.type === 'actual').length,
  );

  allDemandValues = computed(() => (this.fore()?.demand_series ?? []).map((p) => p.value));

  demandLabels = computed(() =>
    (this.fore()?.demand_series ?? []).map((p) => {
      const d = new Date(`${p.date}T00:00:00`);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }),
  );

  maxPassengers = computed(() => Math.max(...this.allDemandValues(), 1));
  maxRevenue = computed(() =>
    Math.max(...(this.fore()?.revenue_series ?? []).map((p) => p.value), 1),
  );

  /** One entry per day: passengers + revenue, with SVG coordinates and % positions for hover markers. */
  demandPoints = computed(() => {
    const f = this.fore();
    const series = f?.demand_series ?? [];
    const rev = f?.revenue_series ?? [];
    const n = series.length;
    const maxP = this.maxPassengers();
    const maxR = this.maxRevenue();
    const yOf = (v: number, max: number) => 116 - (v / max) * 108;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return series.map((p, i) => {
      const r = rev[i];
      const x = ((i + 0.5) / n) * this.CHART_W;
      const yP = yOf(p.value, maxP);
      const yR = r ? yOf(r.value, maxR) : null;
      const d = new Date(`${p.date}T00:00:00`);
      return {
        date: p.date,
        label: `${dayNames[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`,
        type: p.type,
        passengers: p.value,
        revenue: r ? r.value : null,
        x,
        yP,
        yR,
        xPct: (x / this.CHART_W) * 100,
        yPPct: (yP / this.CHART_H) * 100,
        yRPct: yR === null ? null : (yR / this.CHART_H) * 100,
      };
    });
  });

  /** X position (viewBox units) of today's point — the last "actual" day. */
  splitX = computed(() => {
    const n = this.demandPoints().length;
    return n ? ((this.splitIndex() - 0.5) / n) * this.CHART_W : 0;
  });

  private linePoints(key: 'yP' | 'yR', from: number, to: number): string {
    return this.demandPoints()
      .slice(from, to)
      .filter((p) => p[key] !== null)
      .map((p) => `${p.x},${p[key]}`)
      .join(' ');
  }

  // Forecast lines start at the last actual point so the two segments join up.
  actualPolyline = computed(() => this.linePoints('yP', 0, this.splitIndex()));
  forecastPolyline = computed(() =>
    this.linePoints('yP', Math.max(this.splitIndex() - 1, 0), this.demandPoints().length),
  );
  revenueActualPolyline = computed(() => this.linePoints('yR', 0, this.splitIndex()));
  revenueForecastPolyline = computed(() =>
    this.linePoints('yR', Math.max(this.splitIndex() - 1, 0), this.demandPoints().length),
  );

  hovered = computed(() => {
    const i = this.hoverIndex();
    return i === null ? null : (this.demandPoints()[i] ?? null);
  });

  /** Keeps the tooltip inside the chart near the left/right edges. */
  tooltipLeft(xPct: number): number {
    return Math.min(Math.max(xPct, 14), 86);
  }

  peakLabel(hour: number): string {
    const h = Number(hour);
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${h12}:00 ${h >= 12 ? 'PM' : 'AM'}`;
  }

  peakLevel(rank: number): { label: string; cls: string } {
    return (
      [
        { label: 'Very High', cls: 'text-red-600 font-bold' },
        { label: 'High', cls: 'text-orange-500 font-semibold' },
        { label: 'Moderate', cls: 'text-amber-500 font-medium' },
      ][rank] ?? { label: 'Moderate', cls: 'text-amber-500 font-medium' }
    );
  }

  growthClass(val: string | null): string {
    return !val ? 'text-gray-400' : +val >= 0 ? 'text-green-600' : 'text-red-500';
  }
  growthPrefix(val: string | null): string {
    return !val ? '' : +val >= 0 ? '+' : '';
  }

  insightStyle(tone: InsightTone) {
    return INSIGHT_STYLES[tone] ?? INSIGHT_STYLES.neutral;
  }
}