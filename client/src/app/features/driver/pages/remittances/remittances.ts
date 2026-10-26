import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { environment } from '../../../../../environments/environment';
import { TablePagination } from '../../../../shared/components/table-pagination/table-pagination';
import {
  RemittanceTripsTable,
  RemittanceTicket,
} from '../../../../shared/components/remittance-trips-table/remittance-trips-table';

interface Remittance {
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
  total_less: number;
  net_collection: number;
  driver_officer_share: number;
  conductor_officer_share: number;
  teller_remarks: string | null;
  status: 'submitted' | 'approved' | 'rejected' | 'finalized';
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
    // Loaded when the details panel is opened.
    Tickets?: RemittanceTicket[];
  }[];
}

type SortField = 'date' | 'submitted_at' | 'total_revenue' | 'status';

// Read-only disclosure of the driver's own remittances — drivers cannot submit, edit,
// approve, or reject; this mirrors the conductor list view minus every write action.
@Component({
  selector: 'app-driver-remittances',
  imports: [CurrencyPipe, DatePipe, TablePagination, RemittanceTripsTable],
  templateUrl: './remittances.html',
})
export class DriverRemittancesPage implements OnInit {
  private http = inject(HttpClient);

  private readonly API = `${environment.apiUrl}/api/driver`;

  private allRemittances = signal<Remittance[]>([]);
  loading = signal(false);
  selected = signal<Remittance | null>(null);

  search = signal('');
  statusFilter = signal('all');
  dateFrom = signal('');
  dateTo = signal('');
  sortField = signal<SortField>('submitted_at');
  sortDir = signal<'asc' | 'desc'>('desc');
  pageSize = signal(10);
  currentPage = signal(1);
  readonly PAGE_SIZES = [10, 25, 50];

  ngOnInit(): void {
    this.loadRemittances();
  }

  loadRemittances(): void {
    this.loading.set(true);
    this.http.get<Remittance[]>(`${this.API}/remittances`, { withCredentials: true }).subscribe({
      next: (data) => {
        this.allRemittances.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  /** Total Revenue = Net Collection + Cash Deposit */
  revenue(r: Remittance): number {
    return Number(r.net_collection) + Number(r.cash_deposit);
  }

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const status = this.statusFilter();
    const from = this.dateFrom();
    const to = this.dateTo();
    return this.allRemittances().filter((r) => {
      const matchSearch =
        !q ||
        r.BusModel.bus_number.toLowerCase().includes(q) ||
        r.BusModel.plate_number.toLowerCase().includes(q) ||
        r.conductor.first_name.toLowerCase().includes(q) ||
        r.conductor.last_name.toLowerCase().includes(q);
      const matchStatus = status === 'all' || r.status === status;
      const d = new Date(r.date);
      const matchFrom = !from || d >= new Date(from);
      const matchTo = !to || d <= new Date(to + 'T23:59:59');
      return matchSearch && matchStatus && matchFrom && matchTo;
    });
  });

  sorted = computed(() => {
    const field = this.sortField();
    const dir = this.sortDir();
    return [...this.filtered()].sort((a, b) => {
      let av: any = field === 'total_revenue' ? this.revenue(a) : a[field];
      let bv: any = field === 'total_revenue' ? this.revenue(b) : b[field];
      if (typeof av === 'string') av = av.toLowerCase();
      if (typeof bv === 'string') bv = bv.toLowerCase();
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  });

  totalItems = computed(() => this.sorted().length);
  totalPages = computed(() => Math.max(1, Math.ceil(this.totalItems() / this.pageSize())));
  pageStart = computed(() => (this.currentPage() - 1) * this.pageSize() + 1);
  pageEnd = computed(() => Math.min(this.currentPage() * this.pageSize(), this.totalItems()));
  paged = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.sorted().slice(start, start + this.pageSize());
  });
  pageNumbers = computed(() => {
    const total = this.totalPages(),
      cur = this.currentPage();
    const pages: (number | '...')[] = [];
    for (let i = 1; i <= total; i++) {
      if (i === 1 || i === total || Math.abs(i - cur) <= 1) pages.push(i);
      else if (pages[pages.length - 1] !== '...') pages.push('...');
    }
    return pages;
  });

  onSearch(e: Event): void {
    this.search.set((e.target as HTMLInputElement).value);
    this.currentPage.set(1);
  }
  onStatusFilter(e: Event): void {
    this.statusFilter.set((e.target as HTMLSelectElement).value);
    this.currentPage.set(1);
  }
  onDateFromChange(e: Event): void {
    this.dateFrom.set((e.target as HTMLInputElement).value);
    this.currentPage.set(1);
  }
  onDateToChange(e: Event): void {
    this.dateTo.set((e.target as HTMLInputElement).value);
    this.currentPage.set(1);
  }
  clearDateFilters(): void {
    this.dateFrom.set('');
    this.dateTo.set('');
    this.currentPage.set(1);
  }
  setSort(field: SortField): void {
    if (this.sortField() === field) this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      this.sortField.set(field);
      this.sortDir.set('asc');
    }
    this.currentPage.set(1);
  }
  sortIcon(field: SortField): string {
    if (this.sortField() !== field) return 'pi-sort';
    return this.sortDir() === 'asc' ? 'pi-sort-up' : 'pi-sort-down';
  }
  setPage(page: number): void {
    this.currentPage.set(page);
  }
  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1);
  }
  /** Opens the details panel, then loads the tickets issued on each of its trips. */
  openDetails(r: Remittance): void {
    this.selected.set(r);
    this.http
      .get<Remittance>(`${this.API}/remittances/${r.id}`, { withCredentials: true })
      .subscribe({
        next: (detail) => {
          const current = this.selected();
          if (current?.id === r.id) this.selected.set({ ...current, Trips: detail.Trips });
        },
      });
  }

  getStatusBadge(status: string): string {
    return (
      (
        {
          submitted: 'bg-amber-100 text-amber-800',
          approved: 'bg-green-100 text-green-800',
          rejected: 'bg-red-100 text-red-800',
          finalized: 'bg-blue-100 text-blue-800',
        } as any
      )[status] ?? 'bg-gray-100 text-gray-800'
    );
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