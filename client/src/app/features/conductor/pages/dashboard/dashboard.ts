import { Component, inject, signal, computed, OnInit, effect } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router, RouterLink } from '@angular/router';
import { DatePipe, CurrencyPipe } from '@angular/common';
import { AlertService } from '../../../../core/services/alert.service';
import { environment } from '../../../../../environments/environment';
import { TablePagination } from '../../../../shared/components/table-pagination/table-pagination';

export interface Trip {
  id: number;
  bus_id: number;
  trip_number: number;
  status: 'scheduled' | 'ongoing' | 'completed' | 'cancelled';
  departure_time: string;
  arrival_time: string | null;
  grand_total: number;
  ticket_number_start: string | null;
  ticket_number_end: string | null;
  BusModel?: { id: number; bus_number: string; plate_number: string; capacity: number };
  Route?: {
    id: number;
    origin: string;
    destination: string;
    distance_km: number;
    minimum_fare: number;
    rate_per_km: number;
  };
  driver?: { id: number; first_name: string; last_name: string; employee_id: string };
}

type TripTab = 'today' | 'all';
type ViewMode = 'card' | 'table';

/** Formats a date as YYYY-MM-DD using local calendar fields, not UTC (unlike
 *  `toISOString()`, which would shift the date near midnight in any timezone
 *  ahead/behind UTC). */
function localDateStr(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

@Component({
  selector: 'app-conductor-dashboard',
  imports: [DatePipe, CurrencyPipe, RouterLink, TablePagination],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class ConductorDashboard implements OnInit {
  private http = inject(HttpClient);
  private alertService = inject(AlertService);
  private router = inject(Router);

  private readonly API = `${environment.apiUrl}/api/conductor`;

  trips = signal<Trip[]>([]);
  loading = signal(false);
  updatingId = signal<number | null>(null);
  activeTab = signal<TripTab>('today');
  viewMode = signal<ViewMode>('card');
  search = signal('');
  statusFilter = signal('');
  pageSize = signal(9);
  currentPage = signal(1);
  readonly PAGE_SIZES = [6, 9, 18, 36];

  // Today's date string for comparison (local calendar date)
  private todayStr = localDateStr(new Date());

  todayTrips = computed(() =>
    this.trips().filter((t) => {
      if (!t.departure_time) return false;
      return localDateStr(new Date(t.departure_time)) === this.todayStr;
    }),
  );

  allTrips = computed(() => this.trips());

  // Tab-scoped list before search/filter
  private tabTrips = computed(() =>
    this.activeTab() === 'today' ? this.todayTrips() : this.allTrips(),
  );

  // Search + status filter applied on top of the active tab
  filteredTrips = computed(() => {
    const q = this.search().toLowerCase().trim();
    const status = this.statusFilter();
    return this.tabTrips().filter((t) => {
      const matchSearch =
        !q ||
        String(t.trip_number).includes(q) ||
        (t.Route?.origin ?? '').toLowerCase().includes(q) ||
        (t.Route?.destination ?? '').toLowerCase().includes(q) ||
        (t.BusModel?.bus_number ?? '').toLowerCase().includes(q) ||
        (t.BusModel?.plate_number ?? '').toLowerCase().includes(q) ||
        (t.driver
          ? `${t.driver.first_name} ${t.driver.last_name}`.toLowerCase().includes(q)
          : false);
      const matchStatus = !status || t.status === status;
      return matchSearch && matchStatus;
    });
  });

  // Pagination
  totalItems = computed(() => this.filteredTrips().length);
  totalPages = computed(() => Math.max(1, Math.ceil(this.totalItems() / this.pageSize())));
  pageStart = computed(() => (this.currentPage() - 1) * this.pageSize() + 1);
  pageEnd = computed(() => Math.min(this.currentPage() * this.pageSize(), this.totalItems()));

  displayedTrips = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.filteredTrips().slice(start, start + this.pageSize());
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

  // Counts for badge indicators
  ongoingCount = computed(() => this.trips().filter((t) => t.status === 'ongoing').length);
  scheduledTodayCount = computed(
    () => this.todayTrips().filter((t) => t.status === 'scheduled').length,
  );

  /**
   * Returns true if this trip can be started right now.
   * Rule: no earlier-numbered trip on the same bus today is still 'scheduled'.
   */
  canStartTrip = computed(() => {
    const todayStr = this.todayStr;
    const trips = this.trips();
    // Build a set of (bus_id, trip_number) pairs that are still scheduled today
    const scheduledToday = trips.filter(
      (t) =>
        t.status === 'scheduled' &&
        !!t.departure_time &&
        localDateStr(new Date(t.departure_time)) === todayStr,
    );
    // For each trip return whether it's the next one to start
    const result = new Map<number, boolean>();
    for (const trip of trips) {
      if (trip.status !== 'scheduled') {
        result.set(trip.id, false);
        continue;
      }
      const busId = (trip as any).bus_id ?? trip.BusModel?.id;
      const blockers = scheduledToday.filter((t) => {
        const tBusId = (t as any).bus_id ?? t.BusModel?.id;
        return tBusId === busId && t.trip_number < trip.trip_number;
      });
      result.set(trip.id, blockers.length === 0);
    }
    return result;
  });

  constructor() {
    // Reset page on tab, search, or filter change
    effect(
      () => {
        this.activeTab();
        this.search();
        this.statusFilter();
        this.currentPage.set(1);
      },
      { allowSignalWrites: true },
    );
  }

  ngOnInit(): void {
    this.loadTrips();
  }

  loadTrips(): void {
    this.loading.set(true);
    this.http.get<Trip[]>(`${this.API}/trips`, { withCredentials: true }).subscribe({
      next: (data) => {
        this.trips.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.alertService.error('Error', 'Failed to load assigned trips.');
      },
    });
  }

  updateStatus(tripId: number, status: 'ongoing' | 'completed' | 'cancelled'): void {
    this.updatingId.set(tripId);
    this.http
      .put<Trip>(`${this.API}/trips/${tripId}/status`, { status }, { withCredentials: true })
      .subscribe({
        next: () => {
          this.updatingId.set(null);
          this.alertService.success('Success', `Trip status updated to ${status}.`);
          this.loadTrips();
        },
        error: (err) => {
          this.updatingId.set(null);
          this.alertService.error('Error', err.error?.message ?? 'Failed to update trip status.');
        },
      });
  }

  getStatusBadgeClass(status: string): string {
    const map: Record<string, string> = {
      scheduled: 'bg-blue-50 text-blue-600 border-blue-100',
      ongoing: 'bg-amber-50 text-amber-600 border-amber-100',
      completed: 'bg-green-50 text-green-600 border-green-100',
      cancelled: 'bg-red-50 text-red-600 border-red-100',
    };
    return map[status] ?? 'bg-gray-50 text-gray-500 border-gray-100';
  }

  setPage(page: number): void {
    this.currentPage.set(page);
  }

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1);
  }

  onSearch(e: Event): void {
    this.search.set((e.target as HTMLInputElement).value);
  }

  onStatusFilter(e: Event): void {
    this.statusFilter.set((e.target as HTMLSelectElement).value);
  }
}
