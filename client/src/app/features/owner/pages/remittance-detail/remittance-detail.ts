import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { AlertService } from '../../../../core/services/alert.service';
import { environment } from '../../../../../environments/environment';
import { RemittanceTripsTable } from '../../../../shared/components/remittance-trips-table/remittance-trips-table';

interface RemittanceDetail {
  id: number;
  date: string;
  no_of_trips: number;
  gross_income: number;
  total_expenses: number;
  net_gross: number;
  driver_commission: number;
  conductor_commission: number;
  bonus_allowance: number;
  other_deductions: number;
  cash_deposit: number;
  cash_received: number | null;
  total_less: number;
  net_collection: number;
  driver_officer_share: number;
  conductor_officer_share: number;
  teller_remarks: string | null;
  status: 'submitted' | 'approved' | 'rejected';
  resubmitted_at?: string | null;
  submitted_at: string;
  approved_at: string | null;
  conductor: { id: number; first_name: string; last_name: string; employee_id: string };
  driver: { id: number; first_name: string; last_name: string; employee_id: string };
  BusModel: { id: number; bus_number: string; plate_number: string };
  approver: { id: number; first_name: string; last_name: string } | null;
  RemittanceExpenses: { id: number; expense_type: string; amount: number }[];
  Trips: {
    id: number;
    trip_number: number;
    departure_time: string;
    grand_total: number;
    ticket_number_start: string | null;
    ticket_number_end: string | null;
    Route: { origin: string; destination: string } | null;
  }[];
}

@Component({
  selector: 'app-remittance-detail',
  imports: [RouterLink, CurrencyPipe, DatePipe, RemittanceTripsTable],
  templateUrl: './remittance-detail.html',
})
export class RemittanceDetailPage implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private alertService = inject(AlertService);
  private readonly API = `${environment.apiUrl}/api/owner`;

  remittance = signal<RemittanceDetail | null>(null);
  loading = signal(true);

  /** Total Revenue = Net Collection + Cash Deposit (same as the audit teller pages). */
  totalRevenue = computed(() => {
    const r = this.remittance();
    return r ? Number(r.net_collection) + Number(r.cash_deposit) : 0;
  });

  /** Cash received minus total revenue, rounded to centavos. Null if no cash was recorded. */
  savedDifference = computed(() => {
    const r = this.remittance();
    if (!r || r.cash_received === null || r.cash_received === undefined) return null;
    return Math.round((Number(r.cash_received) - this.totalRevenue()) * 100) / 100;
  });

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    this.http
      .get<RemittanceDetail>(`${this.API}/remittances/${id}`, { withCredentials: true })
      .subscribe({
        next: (data) => {
          this.remittance.set(data);
          this.loading.set(false);
        },
        error: () => {
          this.alertService.error('Error', 'Failed to load remittance.');
          this.loading.set(false);
        },
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

  formatExpenseType(type: string): string {
    const labels: Record<string, string> = {
      officer: 'Officer',
      toll_fees: 'Toll Fees',
      parking: 'Parking',
      ppa: 'PPA (Port Authority)',
      washing: 'Bus Washing',
      diesel: 'Diesel',
      caller_grand_terminal: 'Caller (Grand Terminal)',
      caller_calamba_terminal: 'Caller (Calamba Terminal)',
      miscellaneous: 'Miscellaneous',
    };
    return labels[type] ?? type;
  }
}