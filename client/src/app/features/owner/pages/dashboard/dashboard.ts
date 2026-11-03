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
    revenue_growth_pct?: string | null;
    driver_commission_in_range: number;
    conductor_commission_in_range: number;
    passenger_count_in_range: number;
    passenger_growth_pct: string | null;
    bus_utilisation_rate: number;
    total_buses: number;
    buses_in_use_today: number;
    avg_buses_in_use_per_day?: number;
    bus_active_days?: number;
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
    stops?: { name: string; revenue: number; passengers: number }[];
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
  /** Last day that has data; the 7-day forecast continues from here. */
  anchor_date?: string;
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
    // Local calendar dates (toISOString() is UTC and shifts the day before 8 AM in PH time).
    const toIso = (d: Date) => this.localKey(d);
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
      const key = this.localKey(dt);
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

  /** Route whose stop breakdown is open (null = all collapsed). */
  expandedRoute = signal<number | null>(null);
  toggleRoute(id: number): void {
    this.expandedRoute.set(this.expandedRoute() === id ? null : id);
  }

  /**
   * Routes with their stops. Every stop that has passengers or revenue is kept
   * (no cap), sorted by revenue so the biggest earners come first.
   */
  routeBars = computed(() => {
    const d = this.dash();
    if (!d) return [];
    return d.route_profit.map((r) => {
      const stops = (r.stops ?? [])
        .map((s) => ({
          name: s.name,
          revenue: Number(s.revenue),
          passengers: Number(s.passengers),
        }))
        .filter((s) => s.revenue > 0 || s.passengers > 0)
        .sort((a, b) => b.revenue - a.revenue);
      const maxStop = Math.max(...stops.map((s) => s.revenue), 1);
      return {
        id: r.route_id,
        label: `${r.origin} – ${r.destination}`,
        revenue: Number(r.revenue),
        trips: Number(r.trip_count),
        stops: stops.map((s) => ({ ...s, pct: (s.revenue / maxStop) * 100 })),
      };
    });
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

  /** Busiest hours (4 AM – 9 PM) within the selected range, from ticket issue times. */
  peakHoursTop = computed(() => {
    const d = this.dash();
    if (!d) return [];
    const days = Math.max(1, (d.daily_passengers ?? []).filter((r) => Number(r.total) > 0).length);
    return (d.peak_hours ?? [])
      .map((r) => ({
        hour: Number(r.hour),
        total: Number(r.ticket_count),
        avg: Number(r.ticket_count) / days,
      }))
      .filter((r) => r.total > 0 && r.hour >= 4 && r.hour <= 21)
      .sort((a, b) => b.total - a.total)
      .slice(0, 8);
  });

  /** Peak Hours list: busiest hours of the range, each rated against the busiest one. */
  peakHoursList = computed(() => {
    const rows = this.peakHoursTop();
    const max = Math.max(...rows.map((r) => r.avg), 0);
    return rows.map((r) => {
      const share = max > 0 ? r.avg / max : 0;
      return { hour: r.hour, avg: r.avg, pct: share * 100, level: this.peakLevelByShare(share) };
    });
  });

  /** Remittances KPI card: approved revenue / cash received are hidden until expanded. */
  remittanceOpen = signal(false);

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

  /**
   * Average passengers per day of the week, tagged with a demand factor
   * (that average ÷ the average of all weekdays).
   *
   * `weekday_weekend` covers the last 12 weeks, so each weekday occurs 12 times.
   * If it is empty we fall back to the daily totals of the selected range.
   * `dow` is normalised with % 7 so both 0–6 and 1–7 (Sunday = 7) work.
   */
  dayOfWeekBars = computed(() => {
    const d = this.dash();
    if (!d) return [];
    const WEEKS = 12;
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let avgs: number[] = Array(7).fill(0);

    if ((d.weekday_weekend ?? []).length) {
      const totals = Array(7).fill(0);
      for (const r of d.weekday_weekend) totals[Number(r.dow) % 7] += Number(r.total);
      avgs = totals.map((t) => t / WEEKS);
    } else {
      const totals = Array(7).fill(0);
      const seen = Array(7).fill(0);
      for (const r of d.daily_passengers ?? []) {
        const dow = new Date(`${String(r.date).slice(0, 10)}T00:00:00`).getDay();
        totals[dow] += Number(r.total);
        seen[dow]++;
      }
      avgs = totals.map((t, i) => (seen[i] ? t / seen[i] : 0));
    }

    const active = avgs.filter((a) => a > 0);
    const mean = active.length ? active.reduce((s, a) => s + a, 0) / active.length : 0;
    return [1, 2, 3, 4, 5, 6, 0].map((i) => ({
      label: names[i],
      value: Math.round(avgs[i]),
      factor: mean > 0 && avgs[i] > 0 ? avgs[i] / mean : null,
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

  private localKey(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /**
   * Always 7 actual days ending at the last day that has data (the anchor)
   * + the next 7 forecast days. Independent of the range filter.
   */
  chartSeries = computed(() => {
    const f = this.fore();
    if (!f) return [];
    const anchor = (f.anchor_date ?? this.localKey(new Date())).slice(0, 10);

    const pax = new Map<string, number>();
    for (const p of f.demand_series ?? []) pax.set(p.date.slice(0, 10), p.value);

    const rev = new Map<string, number>();
    for (const r of this.dash()?.remittance_daily ?? []) {
      rev.set(String(r.date).slice(0, 10), Number(r.total_revenue));
    }
    for (const p of f.revenue_series ?? []) rev.set(p.date.slice(0, 10), p.value);
    for (const p of f.revenue_forecast_7d ?? []) {
      const k = p.date.slice(0, 10);
      if (!rev.has(k)) rev.set(k, p.predicted);
    }

    const out: {
      date: string;
      type: 'actual' | 'forecast';
      passengers: number;
      revenue: number | null;
    }[] = [];

    // 7 actual days: anchor-6 … anchor
    const cursor = new Date(`${anchor}T00:00:00`);
    cursor.setDate(cursor.getDate() - 6);
    for (let i = 0; i < 7; i++) {
      const key = this.localKey(cursor);
      out.push({
        date: key,
        type: 'actual',
        passengers: pax.get(key) ?? 0,
        revenue: rev.get(key) ?? 0,
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    // Next 7 forecast days after the anchor
    (f.demand_series ?? [])
      .filter((p) => p.type === 'forecast' && p.date.slice(0, 10) > anchor)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 7)
      .forEach((p) => {
        const key = p.date.slice(0, 10);
        out.push({
          date: key,
          type: 'forecast',
          passengers: p.value,
          revenue: rev.get(key) ?? null,
        });
      });

    return out;
  });

  /** Label for the divider between actual and forecast: "Today" when data is current. */
  splitLabel = computed(() => {
    const anchor = this.fore()?.anchor_date?.slice(0, 10);
    return !anchor || anchor === this.localKey(new Date()) ? 'Today' : 'Last data';
  });

  /** True when the chart has any passengers or revenue to draw. */
  hasChartData = computed(() =>
    this.chartSeries().some((p) => p.type === 'actual' && (p.passengers > 0 || (p.revenue ?? 0) > 0)),
  );

  rangeTitle = computed(() => {
    const d = this.dash();
    if (!d) return '';
    const fmt = (s: string) =>
      new Date(`${s}T00:00:00`).toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    const base = d.range.from === d.range.to ? fmt(d.range.from) : `${fmt(d.range.from)} – ${fmt(d.range.to)}`;
    return this.chartSeries().some((p) => p.type === 'forecast') ? `${base} + 7-Day Forecast` : base;
  });

  splitIndex = computed(() => this.chartSeries().filter((p) => p.type === 'actual').length);

  allDemandValues = computed(() => this.chartSeries().map((p) => p.passengers));

  demandLabels = computed(() =>
    this.chartSeries().map((p) => {
      const d = new Date(`${p.date}T00:00:00`);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }),
  );

  /** Show roughly 14 x-axis labels at most, whatever the range length. */
  labelStride = computed(() => Math.max(1, Math.ceil(this.chartSeries().length / 14)));

  maxPassengers = computed(() => Math.max(...this.allDemandValues(), 1));
  maxRevenue = computed(() => Math.max(...this.chartSeries().map((p) => p.revenue ?? 0), 1));

  /** One entry per day: passengers + revenue, with SVG coordinates and % positions for hover markers. */
  demandPoints = computed(() => {
    const series = this.chartSeries();
    const n = series.length;
    const maxP = this.maxPassengers();
    const maxR = this.maxRevenue();
    const yOf = (v: number, max: number) => 116 - (v / max) * 108;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return series.map((p, i) => {
      const x = ((i + 0.5) / n) * this.CHART_W;
      const yP = yOf(p.passengers, maxP);
      const yR = p.revenue === null ? null : yOf(p.revenue, maxR);
      const d = new Date(`${p.date}T00:00:00`);
      return {
        date: p.date,
        label: `${dayNames[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`,
        type: p.type,
        passengers: p.passengers,
        revenue: p.revenue,
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

  /** Very High ≥ 75% of the busiest hour, High ≥ 50%, Moderate ≥ 25%, otherwise Low. */
  peakLevelByShare(share: number): { label: string; cls: string; bar: string } {
    if (share >= 0.75) return { label: 'Very High', cls: 'text-red-600 font-bold', bar: 'bg-red-500' };
    if (share >= 0.5) return { label: 'High', cls: 'text-orange-500 font-semibold', bar: 'bg-orange-400' };
    if (share >= 0.25) return { label: 'Moderate', cls: 'text-amber-500 font-medium', bar: 'bg-amber-400' };
    return { label: 'Low', cls: 'text-gray-400 font-medium', bar: 'bg-gray-300' };
  }

  // ── Growth vs previous period (KPI cards) ─────────────────────────────────
  private growthNum(val: string | null | undefined): number | null {
    if (val === null || val === undefined || val === '') return null;
    const n = Number(val);
    return Number.isFinite(n) ? n : null;
  }

  hasGrowth(val: string | null | undefined): boolean {
    return this.growthNum(val) !== null;
  }

  growthClass(val: string | null | undefined): string {
    const n = this.growthNum(val);
    if (n === null || n === 0) return 'text-gray-400';
    return n > 0 ? 'text-green-600' : 'text-red-500';
  }

  growthBgClass(val: string | null | undefined): string {
    const n = this.growthNum(val);
    if (n === null || n === 0) return 'bg-gray-100';
    return n > 0 ? 'bg-green-50' : 'bg-red-50';
  }

  growthIcon(val: string | null | undefined): string {
    const n = this.growthNum(val);
    if (n === null || n === 0) return 'pi-minus';
    return n > 0 ? 'pi-arrow-up-right' : 'pi-arrow-down-right';
  }

  growthLabel(val: string | null | undefined): string {
    const n = this.growthNum(val);
    return n === null ? '' : `${Math.abs(n).toFixed(1)}%`;
  }

  insightStyle(tone: InsightTone) {
    return INSIGHT_STYLES[tone] ?? INSIGHT_STYLES.neutral;
  }
}