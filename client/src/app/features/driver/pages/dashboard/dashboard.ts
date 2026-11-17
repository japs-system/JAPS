import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { AlertService } from '../../../../core/services/alert.service';
import { environment } from '../../../../../environments/environment';
import { TablePagination } from '../../../../shared/components/table-pagination/table-pagination';

export interface Trip {
  id: number;
  trip_number: number;
  status: 'scheduled' | 'ongoing' | 'completed' | 'cancelled';
  departure_time: string;
  arrival_time: string | null;
  BusModel?: {
    id: number;
    bus_number: string;
    plate_number: string;
    capacity: number;
  };
  Route?: {
    id: number;
    origin: string;
    destination: string;
    distance_km: number;
  };
  conductor?: {
    id: number;
    first_name: string;
    last_name: string;
    contact_number: string | null;
  };
}

type ViewMode = 'card' | 'table';
type ScheduleTab = 'today' | 'all' | 'archive';

function manilaDateStr(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

@Component({
  selector: 'app-driver-dashboard',
  imports: [DatePipe, TablePagination],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DriverDashboard implements OnInit {
  private http = inject(HttpClient);
  private alertService = inject(AlertService);

  private readonly API = `${environment.apiUrl}/api/driver`;

  trips = signal<Trip[]>([]);
  loading = signal(false);
  viewMode = signal<ViewMode>('card');
  activeTab = signal<ScheduleTab>('today');
  search = signal('');
  statusFilter = signal('');
  pageSize = signal(9);
  currentPage = signal(1);
  readonly PAGE_SIZES = [6, 9, 18, 36];
  private readonly todayStr = manilaDateStr(new Date());
  // Current month as YYYY-MM (Manila) — the "All" tab shows every trip in this month.
  private readonly monthStr = this.todayStr.slice(0, 7);

  /** Today's trips: the active one first, then by departure time. */
  todayTrips = computed(() =>
    this.trips()
      .filter(
        (trip) =>
          !!trip.departure_time && manilaDateStr(new Date(trip.departure_time)) === this.todayStr,
      )
      .sort(
        (a, b) =>
          Number(b.status === 'ongoing') - Number(a.status === 'ongoing') ||
          new Date(a.departure_time).getTime() - new Date(b.departure_time).getTime(),
      ),
  );

  isArchivedTrip(trip: Trip): boolean {
    return (
      (trip.status === 'completed' || trip.status === 'cancelled') &&
      !!trip.departure_time &&
      manilaDateStr(new Date(trip.departure_time)) < this.todayStr
    );
  }

  archivedTrips = computed(() =>
    this.trips()
      .filter((trip) => this.isArchivedTrip(trip))
      .sort(
        (a, b) =>
          new Date(b.departure_time).getTime() - new Date(a.departure_time).getTime() ||
          b.id - a.id,
      ),
  );

  /** Every trip of the current month, whatever its status. Active trip first, then newest. */
  allTrips = computed(() =>
    this.trips()
      .filter(
        (trip) =>
          !!trip.departure_time &&
          manilaDateStr(new Date(trip.departure_time)).slice(0, 7) === this.monthStr,
      )
      .sort(
        (a, b) =>
          Number(b.status === 'ongoing') - Number(a.status === 'ongoing') ||
          new Date(b.departure_time).getTime() - new Date(a.departure_time).getTime() ||
          b.id - a.id,
      ),
  );

  /** Tab-scoped list before search/filter. */
  private tabTrips = computed(() =>
    this.activeTab() === 'today'
      ? this.todayTrips()
      : this.activeTab() === 'archive'
        ? this.archivedTrips()
        : this.allTrips(),
  );

  filteredTrips = computed(() => {
    const query = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    return this.tabTrips().filter((trip) => {
      const matchesSearch =
        !query ||
        String(trip.trip_number).includes(query) ||
        (trip.Route?.origin ?? '').toLowerCase().includes(query) ||
        (trip.Route?.destination ?? '').toLowerCase().includes(query) ||
        (trip.BusModel?.bus_number ?? '').toLowerCase().includes(query) ||
        (trip.BusModel?.plate_number ?? '').toLowerCase().includes(query) ||
        (trip.conductor
          ? `${trip.conductor.first_name} ${trip.conductor.last_name}`.toLowerCase().includes(query)
          : false);
      return matchesSearch && (!status || trip.status === status);
    });
  });

  // Counts for badge indicators
  ongoingCount = computed(() => this.trips().filter((t) => t.status === 'ongoing').length);
  scheduledTodayCount = computed(
    () => this.todayTrips().filter((t) => t.status === 'scheduled').length,
  );

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

  setTab(tab: ScheduleTab): void {
    this.activeTab.set(tab);
    this.currentPage.set(1);
  }

  setPage(page: number): void {
    this.currentPage.set(page);
  }

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1);
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    this.currentPage.set(1);
  }

  onStatusFilter(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
    this.currentPage.set(1);
  }

  ngOnInit(): void {
    this.loadTrips();
  }

  loadTrips(): void {
    this.loading.set(true);
    this.http.get<Trip[]>(`${this.API}/trips`, { withCredentials: true }).subscribe({
      next: (data) => {
        this.trips.set(data);
        this.currentPage.set(1);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.alertService.error('Error', 'Failed to load assigned trips.');
      },
    });
  }
}