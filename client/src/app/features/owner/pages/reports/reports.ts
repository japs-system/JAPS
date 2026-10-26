import { Component, inject, signal, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CurrencyPipe } from '@angular/common';
import { environment } from '../../../../../environments/environment';

interface ReportSummary {
  from: string;
  to: string;
  remittances: number;
  gross_income: number;
  total_expenses: number;
  net_gross: number;
  driver_commission: number;
  conductor_commission: number;
  net_collection: number;
  cash_deposit: number;
  total_revenue: number;
  cash_received: number;
  pending: number;
  rejected: number;
}

type Preset = 'today' | 'week' | 'month' | 'lastMonth';

@Component({
  selector: 'app-owner-reports',
  imports: [CurrencyPipe],
  templateUrl: './reports.html',
})
export class OwnerReports implements OnInit {
  private http = inject(HttpClient);
  private readonly API = `${environment.apiUrl}/api/owner/reports`;

  from = signal('');
  to = signal('');
  activePreset = signal<Preset | null>('month');
  summary = signal<ReportSummary | null>(null);
  loading = signal(false);
  downloading = signal(false);
  error = signal<string | null>(null);

  ngOnInit(): void {
    this.applyPreset('month');
  }

  /** Local YYYY-MM-DD (toISOString would shift the day in UTC+8). */
  private key(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  applyPreset(p: Preset): void {
    const now = new Date();
    let start = new Date(now);
    let end = new Date(now);
    if (p === 'week') {
      const dow = (now.getDay() + 6) % 7; // Monday start
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
    } else if (p === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (p === 'lastMonth') {
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
    }
    this.from.set(this.key(start));
    this.to.set(this.key(end));
    this.activePreset.set(p);
    this.loadSummary();
  }

  onFrom(e: Event): void {
    this.from.set((e.target as HTMLInputElement).value);
    this.activePreset.set(null);
    this.loadSummary();
  }

  onTo(e: Event): void {
    this.to.set((e.target as HTMLInputElement).value);
    this.activePreset.set(null);
    this.loadSummary();
  }

  rangeValid(): boolean {
    return !!this.from() && !!this.to() && this.from() <= this.to();
  }

  loadSummary(): void {
    this.error.set(null);
    if (!this.rangeValid()) {
      this.summary.set(null);
      if (this.from() && this.to()) this.error.set('"From" date must be on or before "To" date.');
      return;
    }
    this.loading.set(true);
    this.http
      .get<ReportSummary>(`${this.API}/summary`, {
        params: { from: this.from(), to: this.to() },
      })
      .subscribe({
        next: (s) => {
          this.summary.set(s);
          this.loading.set(false);
        },
        error: () => {
          this.error.set('Could not load the report preview. Please try again.');
          this.loading.set(false);
        },
      });
  }

  download(): void {
    if (!this.rangeValid() || this.downloading()) return;
    this.downloading.set(true);
    this.error.set(null);
    this.http
      .get(`${this.API}/remittances`, {
        params: { from: this.from(), to: this.to() },
        responseType: 'blob',
      })
      .subscribe({
        next: (blob) => {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download =
            this.from() === this.to()
              ? `JAPS-Daily-Report_${this.from()}.xlsx`
              : `JAPS-Remittance-Report_${this.from()}_to_${this.to()}.xlsx`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          this.downloading.set(false);
        },
        error: () => {
          this.error.set('Could not download the report. Please try again.');
          this.downloading.set(false);
        },
      });
  }
}