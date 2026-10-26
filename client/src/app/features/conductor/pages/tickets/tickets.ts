import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { environment } from '../../../../../environments/environment';
import { TablePagination } from '../../../../shared/components/table-pagination/table-pagination';
import {
  TicketPassengerLine,
  passengerCategoryLabel,
  ticketPassengerCount,
  ticketPassengerSummary,
  ticketPassengers,
} from '../../../../shared/models/ticket.models';

interface Ticket {
  id: number;
  ticket_number: string;
  category: string | null;
  passengers: TicketPassengerLine[] | null;
  passenger_count: number | null;
  distance_km: number;
  fare: number;
  issued_at: string;
  Trip: {
    id: number;
    trip_number: number;
    departure_time: string;
    BusModel: {
      id: number;
      bus_number: string;
      plate_number: string;
    };
    Route: {
      id: number;
      origin: string;
      destination: string;
    };
    driver: {
      id: number;
      first_name: string;
      last_name: string;
      employee_id: string;
    };
    conductor: {
      id: number;
      first_name: string;
      last_name: string;
      employee_id: string;
    };
  };
}

type SortField = 'ticket_number' | 'issued_at' | 'fare' | 'category';

@Component({
  selector: 'app-tickets',
  imports: [CurrencyPipe, DatePipe, TablePagination],
  templateUrl: './tickets.html',
})
export class TicketsPage implements OnInit {
  private http = inject(HttpClient);
  private readonly API = `${environment.apiUrl}/api/conductor`;

  private allTickets = signal<Ticket[]>([]);
  loading = signal(false);

  search = signal('');
  categoryFilter = signal<string>('all');
  dateFrom = signal<string>('');
  dateTo = signal<string>('');
  sortField = signal<SortField>('issued_at');
  sortDir = signal<'asc' | 'desc'>('desc');
  pageSize = signal(10);
  currentPage = signal(1);

  readonly PAGE_SIZES = [10, 25, 50, 100];

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const cat = this.categoryFilter();
    const from = this.dateFrom();
    const to = this.dateTo();

    return this.allTickets().filter((t) => {
      const matchSearch =
        !q ||
        t.ticket_number.toLowerCase().includes(q) ||
        t.Trip.Route.origin.toLowerCase().includes(q) ||
        t.Trip.Route.destination.toLowerCase().includes(q) ||
        t.Trip.BusModel.bus_number.toLowerCase().includes(q) ||
        t.Trip.BusModel.plate_number.toLowerCase().includes(q) ||
        t.Trip.driver.first_name.toLowerCase().includes(q) ||
        t.Trip.driver.last_name.toLowerCase().includes(q) ||
        t.Trip.conductor.first_name.toLowerCase().includes(q) ||
        t.Trip.conductor.last_name.toLowerCase().includes(q);
      const matchCat = cat === 'all' || ticketPassengers(t).some((l) => l.category === cat);

      // Date filtering
      const ticketDate = new Date(t.issued_at);
      const matchFrom = !from || ticketDate >= new Date(from);
      const matchTo = !to || ticketDate <= new Date(to + 'T23:59:59');

      return matchSearch && matchCat && matchFrom && matchTo;
    });
  });

  sorted = computed(() => {
    const field = this.sortField();
    const dir = this.sortDir();
    return [...this.filtered()].sort((a, b) => {
      let av: any = field === 'category' ? this.passengerSummary(a) : a[field];
      let bv: any = field === 'category' ? this.passengerSummary(b) : b[field];
      if (field === 'fare' || field === 'ticket_number') {
        av = Number(av);
        bv = Number(bv);
      }
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
    this.loadTickets();
  }

  loadTickets(): void {
    this.loading.set(true);
    this.http.get<Ticket[]>(`${this.API}/tickets`, { withCredentials: true }).subscribe({
      next: (data) => {
        this.allTickets.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onSearch(e: Event): void {
    this.search.set((e.target as HTMLInputElement).value);
    this.currentPage.set(1);
  }

  onCategoryFilter(e: Event): void {
    this.categoryFilter.set((e.target as HTMLSelectElement).value);
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
    if (this.sortField() === field) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
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

  getCategoryLabel(cat: string): string {
    return passengerCategoryLabel(cat);
  }

  /** e.g. "1 Regular · 2 Student" (works for group and older single-passenger tickets). */
  passengerSummary(t: Ticket): string {
    return ticketPassengerSummary(t);
  }

  passengerCount(t: Ticket): number {
    return ticketPassengerCount(t);
  }

  /** All-regular tickets keep the blue badge; anything with a discount is green. */
  isAllRegular(t: Ticket): boolean {
    return ticketPassengers(t).every((l) => l.category === 'regular');
  }

  getTotalRevenue(): number {
    return this.filtered().reduce((sum, t) => sum + Number(t.fare), 0);
  }
}
