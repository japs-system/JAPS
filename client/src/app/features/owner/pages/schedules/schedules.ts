
import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { AlertService } from '../../../../core/services/alert.service';
import { environment } from '../../../../../environments/environment';

export interface ScheduleTrip {
  id: number;
  bus_id: number;
  route_id: number;
  driver_id: number;
  conductor_id: number;
  trip_number: number;
  departure_time: string; // scheduled
  actual_departure_time: string | null;
  arrival_time: string | null;
  status: string;
  BusModel?: { id: number; bus_number: string; plate_number: string };
  Route?: { id: number; origin: string; destination: string };
  driver?: { id: number; first_name: string; last_name: string };
  conductor?: { id: number; first_name: string; last_name: string };
}

export interface ScheduleBus {
  id: number;
  bus_number: string;
  plate_number: string;
  driver_id: number | null;
  conductor_id: number | null;
  route_id: number | null;
  assignedDriver?: { id: number; first_name: string; last_name: string } | null;
  assignedConductor?: { id: number; first_name: string; last_name: string } | null;
  defaultRoute?: { id: number; origin: string; destination: string } | null;
}

export interface ScheduleRoute {
  id: number;
  origin: string;
  destination: string;
}

// A single trip row in the multi-trip builder
export interface TripRow {
  route_id: number | null;
  departure_time: string; // datetime-local string
}

@Component({
  selector: 'app-schedules',
  imports: [FormsModule, DatePipe],
  templateUrl: './schedules.html',
})
export class Schedules implements OnInit {
  private http = inject(HttpClient);
  private alertService = inject(AlertService);

  private readonly BUSES_API = `${environment.apiUrl}/api/buses`;

  // Departures later than this after the scheduled time get a "late" badge.
  private readonly LATE_THRESHOLD_MINUTES = 10;

  private allTrips = signal<ScheduleTrip[]>([]);
  loading = signal(false);
  saving = signal(false);
  buses = signal<ScheduleBus[]>([]);
  routes = signal<ScheduleRoute[]>([]);

  startDate = signal<string>(this.firstOfMonth());
  endDate = signal<string>(this.today());

  filterBus = signal('');
  filterDriver = signal('');
  filterConductor = signal('');
  filterRoute = signal('');

  filtered = computed(() => {
    const bus = this.filterBus();
    const driver = this.filterDriver();
    const conductor = this.filterConductor();
    const route = this.filterRoute();
    return this.allTrips()
      .filter((t) => {
        if (bus && t.bus_id !== Number(bus)) return false;
        if (driver && t.driver_id !== Number(driver)) return false;
        if (conductor && t.conductor_id !== Number(conductor)) return false;
        if (route && t.route_id !== Number(route)) return false;
        return true;
      })
      .sort((a, b) => b.id - a.id); // newest added first
  });

  tripDrivers = computed(() => {
    const seen = new Set<number>();
    return this.allTrips()
      .filter((t) => t.driver && !seen.has(t.driver_id) && !!seen.add(t.driver_id))
      .map((t) => ({ id: t.driver_id, name: `${t.driver!.first_name} ${t.driver!.last_name}` }));
  });

  tripConductors = computed(() => {
    const seen = new Set<number>();
    return this.allTrips()
      .filter((t) => t.conductor && !seen.has(t.conductor_id) && !!seen.add(t.conductor_id))
      .map((t) => ({
        id: t.conductor_id,
        name: `${t.conductor!.first_name} ${t.conductor!.last_name}`,
      }));
  });

  // ── Modal state ──
  showModal = signal(false);
  selectedBus = signal<ScheduleBus | null>(null);
  scheduleDate = signal<string>(this.today());

  // The list of trip rows being built
  tripRows = signal<TripRow[]>([]);

  // Delete confirm
  deletingTrip = signal<ScheduleTrip | null>(null);
  showDeleteModal = signal(false);

  /** Today's date (YYYY-MM-DD) in the browser's local time. */
  private today(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** First day of the current month (YYYY-MM-DD) in the browser's local time. */
  private firstOfMonth(): string {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-01`;
  }

  get dateLabel(): string {
    const fmt = (s: string) =>
      new Date(s + 'T00:00:00').toLocaleDateString('en-PH', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    if (this.startDate() === this.endDate()) return fmt(this.startDate());
    return `${fmt(this.startDate())} — ${fmt(this.endDate())}`;
  }

  ngOnInit(): void {
    this.loadBuses();
    this.loadRoutes();
    this.loadTrips();
  }

  loadTrips(): void {
    this.loading.set(true);
    this.filterBus.set('');
    this.filterDriver.set('');
    this.filterConductor.set('');
    this.filterRoute.set('');
    const url = `${this.BUSES_API}/trips?startDate=${this.startDate()}&endDate=${this.endDate()}`;
    this.http.get<ScheduleTrip[]>(url, { withCredentials: true }).subscribe({
      next: (data) => {
        this.allTrips.set(data);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  onStartDateChange(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.startDate.set(v);
    if (this.endDate() < v) this.endDate.set(v);
    this.loadTrips();
  }

  onEndDateChange(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.endDate.set(v);
    if (this.startDate() > v) this.startDate.set(v);
    this.loadTrips();
  }

  loadBuses(): void {
    this.http.get<ScheduleBus[]>(this.BUSES_API, { withCredentials: true }).subscribe({
      next: (data) => this.buses.set(data),
    });
  }

  loadRoutes(): void {
    this.http
      .get<ScheduleRoute[]>(`${this.BUSES_API}/routes`, { withCredentials: true })
      .subscribe({
        next: (data) => this.routes.set(data),
      });
  }

  // ── Modal ──
  openAdd(): void {
    this.selectedBus.set(null);
    this.scheduleDate.set(this.today());
    this.tripRows.set([this.newRow()]);
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  onModalBusChange(e: Event): void {
    const id = Number((e.target as HTMLSelectElement).value);
    const bus = this.buses().find((b) => b.id === id) ?? null;
    this.selectedBus.set(bus);
    // Pre-fill route on existing rows if bus has a default route
    if (bus?.route_id) {
      this.tripRows.update((rows) =>
        rows.map((r) => ({ ...r, route_id: r.route_id ?? bus.route_id! })),
      );
    }
  }

  private newRow(): TripRow {
    const bus = this.selectedBus();
    return {
      route_id: bus?.route_id ?? null,
      departure_time: `${this.scheduleDate()}T06:00`,
    };
  }

  addRow(): void {
    this.tripRows.update((rows) => {
      // Default departure = last row's time + 1 hour
      const last = rows[rows.length - 1];
      let nextTime = `${this.scheduleDate()}T06:00`;
      if (last?.departure_time) {
        const d = new Date(last.departure_time);
        d.setHours(d.getHours() + 1);
        const yyyy = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        nextTime = `${yyyy}-${month}-${day}T${hh}:${mm}`;
      }
      return [...rows, { route_id: last?.route_id ?? null, departure_time: nextTime }];
    });
  }

  removeRow(index: number): void {
    this.tripRows.update((rows) => rows.filter((_, i) => i !== index));
  }

  updateRowRoute(index: number, e: Event): void {
    const id = Number((e.target as HTMLSelectElement).value) || null;
    this.tripRows.update((rows) => rows.map((r, i) => (i === index ? { ...r, route_id: id } : r)));
  }

  updateRowTime(index: number, e: Event): void {
    const val = (e.target as HTMLInputElement).value;
    this.tripRows.update((rows) =>
      rows.map((r, i) => (i === index ? { ...r, departure_time: val } : r)),
    );
  }

  // The API may return crew IDs directly or inside the assigned crew objects.
  private getSelectedDriverId(): number | null {
    const bus = this.selectedBus();
    return bus?.driver_id ?? bus?.assignedDriver?.id ?? null;
  }

  private getSelectedConductorId(): number | null {
    const bus = this.selectedBus();
    return bus?.conductor_id ?? bus?.assignedConductor?.id ?? null;
  }

  canSave(): boolean {
    const bus = this.selectedBus();
    if (!bus) return false;
    if (!this.getSelectedDriverId() || !this.getSelectedConductorId()) return false;
    if (this.tripRows().length === 0) return false;
    return this.tripRows().every((r) => !!r.route_id && !!r.departure_time);
  }

  save(): void {
    const bus = this.selectedBus();
    const driverId = this.getSelectedDriverId();
    const conductorId = this.getSelectedConductorId();

    if (!bus) {
      this.alertService.error('Error', 'Please select a bus.');
      return;
    }
    if (!driverId || !conductorId) {
      this.alertService.error('Error', 'Please assign both a driver and a conductor to this bus first.');
      return;
    }
    if (this.tripRows().length === 0) {
      this.alertService.error('Error', 'Please add at least one trip.');
      return;
    }
    if (!this.tripRows().every((r) => !!r.route_id && !!r.departure_time && !Number.isNaN(new Date(r.departure_time).getTime()))) {
      this.alertService.error('Error', 'Please select a valid route, date, and departure time for every trip.');
      return;
    }

    // Prevent duplicate departure slots for the same bus within this batch.
    const departureSlots = this.tripRows().map((r) => r.departure_time.slice(0, 16));
    if (new Set(departureSlots).size !== departureSlots.length) {
      this.alertService.error('Duplicate schedule', 'This bus cannot have multiple trips at the same date and time. Please choose a different departure time.');
      return;
    }

    this.saving.set(true);
    const payload = {
      bus_id: bus.id,
      driver_id: driverId,
      conductor_id: conductorId,
      trips: this.tripRows().map((r) => ({
        route_id: r.route_id,
        departure_time: r.departure_time,
      })),
    };
    this.http.post(`${this.BUSES_API}/trips/bulk`, payload, { withCredentials: true }).subscribe({
      next: (res: any) => {
        const count = Array.isArray(res) ? res.length : 1;
        this.alertService.success('Scheduled', `${count} trip${count !== 1 ? 's' : ''} scheduled.`);
        this.saving.set(false);
        this.closeModal();
        this.loadTrips();
      },
      error: (err) => {
        this.saving.set(false);
        this.alertService.error('Error', err.error?.message ?? 'Could not schedule trips.');
      },
    });
  }

  // ── Delete ──
  confirmDelete(trip: ScheduleTrip): void {
    this.deletingTrip.set(trip);
    this.showDeleteModal.set(true);
  }
  cancelDelete(): void {
    this.showDeleteModal.set(false);
  }

  deleteTrip(): void {
    const trip = this.deletingTrip();
    if (!trip) return;
    this.http.delete(`${this.BUSES_API}/trips/${trip.id}`, { withCredentials: true }).subscribe({
      next: () => {
        this.alertService.success('Deleted', 'Trip removed.');
        this.showDeleteModal.set(false);
        this.loadTrips();
      },
      error: (err) =>
        this.alertService.error('Error', err.error?.message ?? 'Could not delete trip.'),
    });
  }

  routeLabel(routeId: number | null): string {
    if (!routeId) return '—';
    const r = this.routes().find((x) => x.id === routeId);
    return r ? `${r.origin} → ${r.destination}` : '—';
  }
}
