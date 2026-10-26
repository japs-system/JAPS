import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { environment } from '../../../../../environments/environment';
import { TablePagination } from '../../../../shared/components/table-pagination/table-pagination';

interface Remittance {
  id: number;
  date: string;
  no_of_trips: number;
  gross_income: number;
  total_expenses: number;
  net_gross: number;
  total_less: number;
  net_collection: number;
  cash_deposit: number;
  cash_received: number | null;
  status: 'submitted' | 'approved' | 'rejected';
  resubmitted_at?: string | null;
  submitted_at: string;
  approved_at: string | null;
  conductor: { id: number; first_name: string; last_name: string; employee_id: string };
  driver: { id: number; first_name: string; last_name: string; employee_id: string };
  BusModel: { id: number; bus_number: string; plate_number: string };
  approver: { id: number; first_name: string; last_name: string } | null;
}

type SortField = 'date' | 'submitted_at' | 'total_revenue' | 'status';

@Component({
  selector: 'app-remittances',
  imports: [RouterLink, CurrencyPipe, DatePipe, TablePagination],
  templateUrl: './remittances.html',
})
export class Remittances implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private readonly API = `${environment.apiUrl}/api/owner`;

  private allRemittances = signal<Remittance[]>([]);
  loading = signal(false);

  search = signal('');
  statusFilter = signal<string>('all');
  dateFrom = signal<string>('');
  dateTo = signal<string>('');
  sortField = signal<SortField>('submitted_at');
  sortDir = signal<'asc' | 'desc'>('desc');
  pageSize = signal(10);
  currentPage = signal(1);

  readonly PAGE_SIZES = [10, 25, 50, 100];

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const status = this.statusFilter();
    const from = this.dateFrom();
    const to = this.dateTo();

    return this.allRemittances().filter((r) => {
      const matchSearch =
        !q ||
        r.conductor.first_name.toLowerCase().includes(q) ||
        r.conductor.last_name.toLowerCase().includes(q) ||
        r.conductor.employee_id.toLowerCase().includes(q) ||
        r.driver.first_name.toLowerCase().includes(q) ||
        r.driver.last_name.toLowerCase().includes(q) ||
        r.BusModel.bus_number.toLowerCase().includes(q) ||
        r.BusModel.plate_number.toLowerCase().includes(q);

      const matchStatus = status === 'all' || r.status === status;
      const remitDate = new Date(r.date);
      const matchFrom = !from || remitDate >= new Date(from);
      const matchTo = !to || remitDate <= new Date(to + 'T23:59:59');

      return matchSearch && matchStatus && matchFrom && matchTo;
    });
  });

  sorted = computed(() => {
    const field = this.sortField();
    const dir = this.sortDir();
    return [...this.filtered()].sort((a, b) => {
      let av: any = field === 'total_revenue' ? this.totalRevenue(a) : a[field];
      let bv: any = field === 'total_revenue' ? this.totalRevenue(b) : b[field];
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
    const total = this.totalPages();
    const cur = this.currentPage();
    const pages: (number | '...')[] = [];
    for (let i = 1; i <= total; i++) {
      if (i === 1 || i === total || Math.abs(i - cur) <= 1) pages.push(i);
      else if (pages[pages.length - 1] !== '...') pages.push('...');
    }
    return pages;
  });

  ngOnInit(): void {
    this.route.queryParams.subscribe((params) => {
      if (params['status']) this.statusFilter.set(params['status']);
    });
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

  getStatusBadge(status: string): string {
    const badges: Record<string, string> = {
      submitted: 'bg-amber-100 text-amber-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
    };
    return badges[status] ?? 'bg-gray-100 text-gray-800';
  }

  /** Total Revenue = Net Collection + Cash Deposit (same as the audit teller pages). */
  totalRevenue(r: Remittance): number {
    return Number(r.net_collection) + Number(r.cash_deposit);
  }

  /** Cash received minus total revenue, rounded to centavos. Null if no cash was recorded. */
  cashDifference(r: Remittance): number | null {
    if (r.cash_received === null || r.cash_received === undefined) return null;
    return Math.round((Number(r.cash_received) - this.totalRevenue(r)) * 100) / 100;
  }

  /** Absolute value, so the template doesn't have to negate it. */
  absValue(n: number): number {
    return Math.abs(n);
  }
}