import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { NumericInput } from '../../../../shared/directives/numeric-input.directive';
import { AlertService } from '../../../../core/services/alert.service';
import { environment } from '../../../../../environments/environment';
import {
  TicketPassengerLine,
  passengerCategoryLabel,
  ticketPassengerSummary,
} from '../../../../shared/models/ticket.models';

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
  submitted_at: string;
  resubmitted_at?: string | null;
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
    Tickets: TicketRecord[];
  }[];
}

interface TicketRecord {
  id: number;
  ticket_number: string;
  category: string | null;
  passengers: TicketPassengerLine[] | null;
  passenger_count: number | null;
  boarding_point: string | null;
  boarding_km: number | null;
  dropping_point: string | null;
  dropping_km: number | null;
  distance_km: number;
  fare: number;
  issued_at: string;
}

@Component({
  selector: 'app-remittance-review',
  imports: [RouterLink, CurrencyPipe, DatePipe, NumericInput],
  templateUrl: './remittance-review.html',
})
export class RemittanceReviewPage implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private alertService = inject(AlertService);
  private readonly API = `${environment.apiUrl}/api/audit-teller`;

  remittance = signal<RemittanceDetail | null>(null);
  loading = signal(true);
  submitting = signal(false);
  rejectReason = signal('');

  expandedTripId = signal<number | null>(null);

  cashReceived = signal<number | null>(null);

  totalRevenue = computed(() => {
    const r = this.remittance();
    return r ? Number(r.net_collection) + Number(r.cash_deposit) : 0;
  });

  /** cash received minus total revenue, rounded to centavos; null until typed */
  difference = computed(() => {
    const c = this.cashReceived();
    return c === null ? null : Math.round((c - this.totalRevenue()) * 100) / 100;
  });

  cashStatus = computed<'empty' | 'match' | 'discrepancy'>(() => {
    const d = this.difference();
    if (d === null) return 'empty';
    return d === 0 ? 'match' : 'discrepancy';
  });
  /** Cash more than double the expected total is almost certainly a typo. */
  cashTooHigh = computed(() => {
    const c = this.cashReceived();
    const expected = this.totalRevenue();
    return c !== null && expected > 0 && c > expected * 2;
  });

  /** Negative or non-numeric entries (min="0" doesn't stop typed values). */
  cashInvalid = computed(() => {
    const c = this.cashReceived();
    return c !== null && (!Number.isFinite(c) || c < 0);
  });

  /** saved result for already-reviewed remittances */
  savedDifference = computed(() => {
    const r = this.remittance();
    if (!r || r.cash_received === null || r.cash_received === undefined) return 0;
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

  onCashReceivedChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  let v = input.value;

  // Keep at most 2 decimal places: "123.456" becomes "123.45"
  const dot = v.indexOf('.');
  if (dot !== -1 && v.length - dot - 1 > 2) {
    v = v.slice(0, dot + 3);
    input.value = v;
  }

  this.cashReceived.set(v === '' ? null : Number(v));
}

/** Blocks characters a number input accepts but a peso amount shouldn't have. */
blockInvalidKeys(e: KeyboardEvent): void {
  if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault();
}

  /** Safe dynamic accessor for RemittanceDetail fields in template loops */
  remittanceField(field: string): number {
    return (this.remittance() as any)?.[field] ?? 0;
  }

  approve(): void {
    const r = this.remittance();
    if (!r) return;
    this.submitting.set(true);
    this.http
      .put(
        `${this.API}/remittances/${r.id}/approve`,
        { cash_received: this.cashReceived() },
        { withCredentials: true },
      )
      .subscribe({
        next: () => {
          this.alertService.success('Approved', 'Remittance has been approved.');
          this.router.navigate(['/audit-teller/remittances']);
        },
        error: (err) => {
          this.submitting.set(false);
          this.alertService.error('Error', err.error?.message ?? 'Failed to approve remittance.');
        },
      });
  }

  reject(): void {
    const r = this.remittance();
    if (!r) return;
    this.submitting.set(true);
    this.http
      .put(
        `${this.API}/remittances/${r.id}/reject`,
        { reason: this.rejectReason(), cash_received: this.cashReceived() },
        { withCredentials: true },
      )
      .subscribe({
        next: () => {
          this.alertService.success('Rejected', 'Remittance has been rejected.');
          this.router.navigate(['/audit-teller/remittances']);
        },
        error: (err) => {
          this.submitting.set(false);
          this.alertService.error('Error', err.error?.message ?? 'Failed to reject remittance.');
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
      officer: 'Officer ',
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

  onRejectReasonChange(e: Event): void {
    this.rejectReason.set((e.target as HTMLTextAreaElement).value);
  }

  toggleTripTickets(tripId: number): void {
    this.expandedTripId.update((id) => (id === tripId ? null : tripId));
  }

  getCategoryLabel(cat: string): string {
    return passengerCategoryLabel(cat);
  }

  /** e.g. "1 Regular · 2 Student" (group tickets and older single-passenger ones). */
  passengerSummary(t: TicketRecord): string {
    return ticketPassengerSummary(t);
  }
}