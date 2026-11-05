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

  /** Active trips first, then the latest schedules. */
  sortedTrips = computed(() =>
    [...this.trips()].sort(
      (a, b) =>
        Number(b.status === 'ongoing') - Number(a.status === 'ongoing') ||
        new Date(b.departure_time).getTime() - new Date(a.departure_time).getTime() ||
        b.id - a.id,
    ),
  );

  /** Only the newest trips are drawn; "Show more" reveals older ones. */
  visibleCount = signal(this.PAGE);
  visibleTrips = computed(() => this.sortedTrips().slice(0, this.visibleCount()));
  hasMore = computed(() => this.sortedTrips().length > this.visibleCount());

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