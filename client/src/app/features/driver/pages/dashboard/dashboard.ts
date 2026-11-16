import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { AlertService } from '../../../../core/services/alert.service';
import { environment } from '../../../../../environments/environment';

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
type ScheduleTab = 'schedule' | 'archive';

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
  imports: [DatePipe],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
})
export class DriverDashboard implements OnInit {
  private http = inject(HttpClient);
  private alertService = inject(AlertService);

  private readonly API = `${environment.apiUrl}/api/driver`;
  private readonly PAGE = 12;

  trips = signal<Trip[]>([]);
  loading = signal(false);
  viewMode = signal<ViewMode>('card');
  activeTab = signal<ScheduleTab>('schedule');
  search = signal('');
  statusFilter = signal('');
  private readonly todayStr = manilaDateStr(new Date());

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

  /** Active and current-date trips stay in the main schedule; older finished trips are archived. */
  sortedTrips = computed(() =>
    this.trips()
      .filter((trip) => !this.isArchivedTrip(trip))
      .sort(
        (a, b) =>
          Number(b.status === 'ongoing') - Number(a.status === 'ongoing') ||
          new Date(b.departure_time).getTime() - new Date(a.departure_time).getTime() ||
          b.id - a.id,
      ),
  );

  filteredTrips = computed(() => {
    const query = this.search().trim().toLowerCase();
    const status = this.statusFilter();
    const trips = this.activeTab() === 'archive' ? this.archivedTrips() : this.sortedTrips();
    return trips.filter((trip) => {
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

  /** Only the newest trips are drawn; "Show more" reveals older ones. */
  visibleCount = signal(this.PAGE);
  visibleTrips = computed(() => this.filteredTrips().slice(0, this.visibleCount()));
  hasMore = computed(() => this.filteredTrips().length > this.visibleCount());

  setTab(tab: ScheduleTab): void {
    this.activeTab.set(tab);
    this.visibleCount.set(this.PAGE);
  }

  onSearch(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    this.visibleCount.set(this.PAGE);
  }

  onStatusFilter(event: Event): void {
    this.statusFilter.set((event.target as HTMLSelectElement).value);
    this.visibleCount.set(this.PAGE);
  }

  showMore(): void {
    this.visibleCount.update((n) => n + this.PAGE);
  }

  ngOnInit(): void {
    this.loadTrips();
  }

  loadTrips(): void {
    this.loading.set(true);
    this.http.get<Trip[]>(`${this.API}/trips`, { withCredentials: true }).subscribe({
      next: (data) => {
        this.trips.set(data);
        this.visibleCount.set(this.PAGE);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.alertService.error('Error', 'Failed to load assigned trips.');
      },
    });
  }
}