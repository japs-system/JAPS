import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { Dashboard } from './dashboard';

describe('Dashboard', () => {
  let fixture: ComponentFixture<Dashboard>;
  let component: Dashboard;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Dashboard, HttpClientTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(Dashboard);
    component = fixture.componentInstance;
  });

  it('builds passenger and revenue insights from the chart series', () => {
    component.dash.set({
      insights: [{ tone: 'warning', title: 'Server insight', message: 'Not chart-derived.' }],
      range: { from: '2020-01-01', to: '2020-01-07' },
      kpi: {
        net_gross_in_range: 0,
        total_revenue_in_range: 0,
        driver_commission_in_range: 0,
        conductor_commission_in_range: 0,
        passenger_count_in_range: 0,
        passenger_growth_pct: null,
        bus_utilisation_rate: 0,
        total_buses: 0,
        buses_in_use_today: 0,
        remittance_approved: 0,
        remittance_total: 0,
        remittance_pending: 0,
        remittance_rejected: 0,
        remittance_revenue_in_range: 0,
        remittance_cash_variance_in_range: 0,
      },
      daily_passengers: [],
      route_profit: [
        {
          route_id: 1,
          origin: 'North',
          destination: 'South',
          revenue: '1000',
          trip_count: '4',
          stops: [],
        },
      ],
      peak_hours: [{ hour: 8, ticket_count: '90' }],
      weekday_weekend: [],
      remittance_daily: [
        { date: '2020-01-06', total_revenue: '100' },
        { date: '2020-01-07', total_revenue: '200' },
      ],
      remittance_trend: [],
    });
    component.fore.set({
      anchor_date: '2020-01-07',
      kpi_forecast: {
        predicted_passengers_tomorrow: 0,
        passenger_growth_pct_tomorrow: null,
        predicted_revenue_tomorrow: 0,
        revenue_growth_pct_tomorrow: null,
        predicted_bus_utilisation_tomorrow: 0,
      },
      demand_series: [
        { date: '2020-01-01', value: 10, type: 'actual' },
        { date: '2020-01-02', value: 11, type: 'actual' },
        { date: '2020-01-03', value: 12, type: 'actual' },
        { date: '2020-01-04', value: 13, type: 'actual' },
        { date: '2020-01-05', value: 14, type: 'actual' },
        { date: '2020-01-06', value: 15, type: 'actual' },
        { date: '2020-01-07', value: 20, type: 'actual' },
        { date: '2020-01-08', value: 25, type: 'forecast' },
      ],
      revenue_forecast_7d: [{ date: '2020-01-08', predicted: 300 }],
      revenue_series: [],
      peak_hours_forecast: [],
      seasonal_factors: [],
    });

    const insights = component.insights();

    expect(insights.map((insight) => insight.title)).toEqual([
      'Passenger trend',
      'Revenue trend',
      'Passenger forecast',
      'Revenue forecast',
      'Top route',
      'Peak hour',
    ]);
    expect(insights.some((insight) => insight.title === 'Server insight')).toBe(false);
    expect(insights[0].message).toContain('33.3% higher');
    expect(insights[1].message).toContain('100.0% higher');
    expect(component.peakHoursList().length).toBeLessThanOrEqual(4);
  });
});
