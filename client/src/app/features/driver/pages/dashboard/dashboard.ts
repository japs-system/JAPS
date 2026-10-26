import { Component, inject, signal, OnInit } from '@angular/core';
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
    employee_id: string;
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

  trips = signal<Trip[]>([]);
  loading = signal(false);

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
}
