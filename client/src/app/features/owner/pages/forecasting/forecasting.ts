import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { environment } from '../../../../../environments/environment';

interface DemandPoint {
  date: string;
  value: number;
  type: 'actual' | 'forecast';
}
interface RevenueForecast {
  date: string;
  predicted: number;
}
interface PeakHour {
  hour: number;
  avg_tickets: string;
}
interface SeasonalFactor {
  dow: string;
  factor: number;
}

interface ForecastData {
  kpi_forecast: {
    predicted_passengers_tomorrow: number;
    passenger_growth_pct_tomorrow: string | null;
    predicted_revenue_tomorrow: number;
    revenue_growth_pct_tomorrow: string | null;
    predicted_bus_utilisation_tomorrow: number;
  };
  demand_series: DemandPoint[];
  revenue_forecast_7d: RevenueForecast[];
  peak_hours_forecast: PeakHour[];
  seasonal_factors: SeasonalFactor[];
}

@Component({
  selector: 'app-forecasting',
  imports: [CurrencyPipe, DecimalPipe],
  templateUrl: './forecasting.html',
})
export class Forecasting implements OnInit {
  private http = inject(HttpClient);
  private readonly API = `${environment.apiUrl}/api/owner`;

  loading = signal(true);
  data = signal<ForecastData | null>(null);

  ngOnInit(): void {
    this.http.get<ForecastData>(`${this.API}/forecast`, { withCredentials: true }).subscribe({
      next: (d) => {
        this.data.set(d);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
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

  // ── Demand series split: actual vs forecast ──────────────────────────
  actualValues = computed(() =>
    (this.data()?.demand_series ?? []).filter((p) => p.type === 'actual').map((p) => p.value),
  );

  forecastValues = computed(() =>
    (this.data()?.demand_series ?? []).filter((p) => p.type === 'forecast').map((p) => p.value),
  );

  demandLabels = computed(() =>
    (this.data()?.demand_series ?? []).map((p) => {
      const d = new Date(p.date);
      return `${d.getMonth() + 1}/${d.getDate()}`;
    }),
  );

  // Combined series for single SVG (actual + forecast joined)
  allDemandValues = computed(() => (this.data()?.demand_series ?? []).map((p) => p.value));

  // Split index: where actual ends / forecast begins
  splitIndex = computed(
    () => (this.data()?.demand_series ?? []).filter((p) => p.type === 'actual').length,
  );

  // Polyline for actual segment only
  actualPolyline = computed(() => {
    const all = this.data()?.demand_series ?? [];
    const actuals = all.filter((p) => p.type === 'actual').map((p) => p.value);
    const allValues = all.map((p) => p.value);
    const max = Math.max(...allValues, 1);
    const totalPoints = all.length;
    const width = 500;
    const height = 120;
    const step = width / Math.max(totalPoints - 1, 1);
    return actuals
      .map((v, i) => {
        const y = height - (v / max) * height;
        return `${i * step},${y}`;
      })
      .join(' ');
  });

  // Polyline for forecast segment (continues from last actual point)
  forecastPolyline = computed(() => {
    const all = this.data()?.demand_series ?? [];
    const allValues = all.map((p) => p.value);
    const max = Math.max(...allValues, 1);
    const totalPoints = all.length;
    const width = 500;
    const height = 120;
    const step = width / Math.max(totalPoints - 1, 1);
    const si = this.splitIndex();
    // Start from last actual point for continuity
    return all
      .slice(si - 1)
      .map((p, i) => {
        const y = height - (p.value / max) * height;
        return `${(si - 1 + i) * step},${y}`;
      })
      .join(' ');
  });

  // ── Revenue forecast bars ────────────────────────────────────────────
  maxRevenueForecast = computed(() =>
    Math.max(...(this.data()?.revenue_forecast_7d ?? []).map((r) => r.predicted), 1),
  );

  revenueForecastLabels = computed(() =>
    (this.data()?.revenue_forecast_7d ?? []).map((r) => {
      const d = new Date(r.date);
      const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return days[d.getDay()];
    }),
  );

  // ── Seasonal factors bar heights ─────────────────────────────────────
  maxSeasonalFactor = computed(() =>
    Math.max(...(this.data()?.seasonal_factors ?? []).map((s) => s.factor), 1),
  );

  // ── Peak hour labels ─────────────────────────────────────────────────
  peakLabel(hour: number): string {
    const h = Number(hour);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${h12}:00 ${suffix}`;
  }

  peakLevel(rank: number): { label: string; cls: string } {
    const levels = [
      { label: 'Very High', cls: 'text-red-600 font-bold' },
      { label: 'High', cls: 'text-orange-500 font-semibold' },
      { label: 'Moderate', cls: 'text-amber-500 font-medium' },
    ];
    return levels[rank] ?? levels[2];
  }

  growthClass(val: string | null): string {
    if (!val) return 'text-gray-400';
    return +val >= 0 ? 'text-green-600' : 'text-red-500';
  }

  growthPrefix(val: string | null): string {
    if (!val) return '';
    return +val >= 0 ? '+' : '';
  }
}
