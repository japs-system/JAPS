import { Component, ElementRef, inject, signal, computed, viewChild, OnInit } from '@angular/core';
import { NumericInput } from '../../../../shared/directives/numeric-input.directive';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { AlertService } from '../../../../core/services/alert.service';
import { PrinterSetupService } from '../../../../core/services/printer-setup.service';
import { environment } from '../../../../../environments/environment';
import { TicketPassengerLine } from '../../../../shared/models/ticket.models';

export interface Trip {
  id: number;
  trip_number: number;
  status: 'scheduled' | 'ongoing' | 'completed' | 'cancelled';
  departure_time: string;
  grand_total: number;
  ticket_number_start: string | null;
  ticket_number_end: string | null;
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
}

export interface FareSettings {
  minimum_fare: number;
  base_distance_km: number;
  rate_per_km: number;
  regular_discount_percent: number;
  student_discount_percent: number;
  senior_citizen_discount_percent: number;
  pwd_discount_percent: number;
  discounted_discount_percent: number;
}

export interface PassengerCount {
  id: number;
  category: string;
  count: number;
}

export interface RouteStopPoint {
  name: string;
  km_from_origin: number;
}

export const PASSENGER_CATEGORIES = [
  'regular',
  'student',
  'senior_citizen',
  'pwd',
  'discounted',
] as const;
export type PassengerCategory = (typeof PASSENGER_CATEGORIES)[number];

/** Default passenger mix for a new ticket: one regular passenger. */
const DEFAULT_QUANTITIES: Record<PassengerCategory, number> = {
  regular: 1,
  student: 0,
  senior_citizen: 0,
  pwd: 0,
  discounted: 0,
};

@Component({
  selector: 'app-ticketing',
  imports: [NumericInput, ReactiveFormsModule, CurrencyPipe, DatePipe, DecimalPipe],
  templateUrl: './ticketing.html',
  styleUrl: './ticketing.css',
})
export class TicketingPage implements OnInit {
  private http = inject(HttpClient);
  private alertService = inject(AlertService);
  private printerSetup = inject(PrinterSetupService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  private readonly API = `${environment.apiUrl}/api/conductor`;

  trips = signal<Trip[]>([]);
  selectedTripId = signal<number | null>(null);
  selectedTrip = computed(() => this.trips().find((t) => t.id === this.selectedTripId()) || null);
  fareSettings = signal<FareSettings | null>(null);
  routeStops = signal<RouteStopPoint[]>([]);

  passengerCounts = signal<PassengerCount[]>([]);
  ticketForm: FormGroup;
  isPrinting = signal(false);
  /** True while a receipt is being sent to the thermal printer. */
  isSendingToPrinter = signal(false);

  readonly CATEGORIES = PASSENGER_CATEGORIES;
  // Mirror of the form's value as a signal so fares below can be computed reactively.
  private formValue = signal<any>({});

  /** Full fare for the selected stops, before any category discount. */
  baseFare = computed(() => {
    const settings = this.fareSettings();
    const { boarding_km, dropping_km } = this.formValue();
    if (!settings || boarding_km == null || dropping_km == null) return 0;
    const distance = Math.abs(Number(dropping_km) - Number(boarding_km));
    if (distance <= 0) return 0;
    const minFare = Number(settings.minimum_fare);
    const baseDistanceKm = Number(settings.base_distance_km);
    const ratePerKm = Number(settings.rate_per_km);
    return distance <= baseDistanceKm ? minFare : minFare + (distance - baseDistanceKm) * ratePerKm;
  });

  /** Per-category lines for the passengers currently encoded (quantity > 0 only).
   *  Same formula as the server's printTicket, which recomputes and is authoritative. */
  fareLines = computed<TicketPassengerLine[]>(() => {
    const quantities = this.formValue().quantities ?? {};
    const base = this.baseFare();
    return PASSENGER_CATEGORIES.map((category) => {
      const quantity = Math.max(0, Math.floor(Number(quantities[category]) || 0));
      const unitFare = this.unitFare(category, base);
      return { category, quantity, unit_fare: unitFare, subtotal: +(unitFare * quantity).toFixed(2) };
    }).filter((l) => l.quantity > 0);
  });

  totalPassengers = computed(() => this.fareLines().reduce((sum, l) => sum + l.quantity, 0));
  totalFare = computed(() => +this.fareLines().reduce((sum, l) => sum + l.subtotal, 0).toFixed(2));

  // Thermal print modal
  showPrintModal = signal(false);
  lastPrintedTicket = signal<any | null>(null);
  private receiptContentRef = viewChild<ElementRef<HTMLElement>>('receiptContent');

  constructor() {
    this.ticketForm = this.fb.group({
      boarding_km: [null, Validators.required],
      dropping_km: [null, Validators.required],
      quantities: this.fb.group(
        Object.fromEntries(
          PASSENGER_CATEGORIES.map((c) => [c, [DEFAULT_QUANTITIES[c], [Validators.min(0)]]]),
        ),
      ),
    });
    this.formValue.set(this.ticketForm.getRawValue());
    this.ticketForm.valueChanges.subscribe(() =>
      this.formValue.set(this.ticketForm.getRawValue()),
    );
  }

  ngOnInit(): void {
    this.loadFareSettings();
    this.loadTrips(() => {
      // Check query params for active trip
      this.route.queryParams.subscribe((params) => {
        const tripId = Number(params['tripId']);
        if (tripId) {
          this.selectTrip(tripId);
        }
      });
    });

    // Boarding and dropping can't be the same stop.
    this.ticketForm.get('boarding_km')?.valueChanges.subscribe((val) => {
      const droppingKm = this.ticketForm.get('dropping_km')?.value;
      if (droppingKm !== null && Number(droppingKm) === Number(val)) {
        this.ticketForm.patchValue({ dropping_km: null });
      }
    });
  }

  loadFareSettings(): void {
    this.http
      .get<FareSettings>(`${environment.apiUrl}/api/fare-settings`, { withCredentials: true })
      .subscribe({
        next: (data) => {
          console.log('Fare settings loaded successfully:', data);
          this.fareSettings.set(data);
        },
        error: (err) => {
          console.error('Failed to load fare settings:', err);
          this.alertService.error('Error', 'Failed to load fare settings.');
        },
      });
  }

  loadTrips(callback?: () => void): void {
    this.http.get<Trip[]>(`${this.API}/trips`, { withCredentials: true }).subscribe({
      next: (data) => {
        // Filter ongoing or completed trips
        this.trips.set(data.filter((t) => t.status === 'ongoing' || t.status === 'completed'));
        if (callback) callback();
      },
      error: () => this.alertService.error('Error', 'Failed to load assigned trips.'),
    });
  }

  selectTrip(tripId: number): void {
    this.selectedTripId.set(tripId);
    this.loadPassengerCounts(tripId);
    this.ticketForm.patchValue({ boarding_km: null, dropping_km: null });
    const routeId = this.selectedTrip()?.Route?.id;
    if (routeId) this.loadRouteStops(routeId);
  }

  loadRouteStops(routeId: number): void {
    this.http
      .get<RouteStopPoint[]>(`${this.API}/routes/${routeId}/stops`, { withCredentials: true })
      .subscribe({
        next: (data) => this.routeStops.set(data),
        error: () => this.alertService.error('Error', 'Failed to load route stops.'),
      });
  }

  getDroppingOptions(): RouteStopPoint[] {
    const boardingKm = this.ticketForm.get('boarding_km')?.value;
    return this.routeStops().filter(
      (s) => boardingKm === null || boardingKm === undefined || Number(s.km_from_origin) !== Number(boardingKm),
    );
  }

  computeDistance(): number {
    const boardingKm = this.ticketForm.get('boarding_km')?.value;
    const droppingKm = this.ticketForm.get('dropping_km')?.value;
    if (boardingKm === null || boardingKm === undefined || droppingKm === null || droppingKm === undefined) {
      return 0;
    }
    return Math.abs(Number(droppingKm) - Number(boardingKm));
  }

  loadPassengerCounts(tripId: number): void {
    this.http
      .get<PassengerCount[]>(`${this.API}/trips/${tripId}/passenger-counts`, {
        withCredentials: true,
      })
      .subscribe({
        next: (data) => this.passengerCounts.set(data),
      });
  }

  private unitFare(category: string, base: number): number {
    return parseFloat((base * (1 - this.getDiscountPercent(category) / 100)).toFixed(2));
  }

  quantity(category: string): number {
    return Number(this.formValue().quantities?.[category]) || 0;
  }

  changeQuantity(category: string, delta: number): void {
    const control = this.ticketForm.get(['quantities', category]);
    if (!control) return;
    control.setValue(Math.max(0, Math.floor(Number(control.value) || 0) + delta));
  }

  categoryUnitFare(category: string): number {
    return this.unitFare(category, this.baseFare());
  }

  printTicketSubmit(): void {
    if (this.ticketForm.invalid) {
      this.ticketForm.markAllAsTouched();
      return;
    }
    if (this.totalPassengers() === 0) {
      this.alertService.error('No passengers', 'Add at least one passenger to the ticket.');
      return;
    }

    const tripId = this.selectedTripId();
    if (!tripId) return;

    this.isPrinting.set(true);
    const formValue = this.ticketForm.getRawValue();
    const payload = {
      boarding_km: formValue.boarding_km,
      dropping_km: formValue.dropping_km,
      passengers: this.fareLines().map(({ category, quantity }) => ({ category, quantity })),
    };

    this.http
      .post<any>(`${this.API}/trips/${tripId}/tickets`, payload, { withCredentials: true })
      .subscribe({
        next: async (res) => {
          this.isPrinting.set(false);
          // Receipt shows the server's figures (it recomputes fares authoritatively).
          const passengers: TicketPassengerLine[] = res.ticket?.passengers ?? this.fareLines();
          const printed = {
            ticketNumber: res.ticket?.ticket_number,
            passengers,
            passengerCount:
              res.ticket?.passenger_count ?? passengers.reduce((sum, l) => sum + l.quantity, 0),
            boardingPoint: res.ticket?.boarding_point,
            droppingPoint: res.ticket?.dropping_point,
            distance: res.ticket?.distance_km,
            fare: res.ticket?.fare,
            date: new Date(),
            route: this.selectedTrip()?.Route,
            bus: this.selectedTrip()?.BusModel,
          };
          this.lastPrintedTicket.set(printed);
          this.showPrintModal.set(true);
          // Ready for the next group: the stops are kept, the passenger mix resets.
          this.ticketForm.get('quantities')?.reset(DEFAULT_QUANTITIES);

          // Wait for the modal (and its receipt content ref) to actually render.
          await this.waitForRender();
          this.sendReceiptToPrinter();

          this.alertService.success('Success', 'Ticket generated and sent to printing terminal.');

          // Refresh local trip info & counts
          this.loadTrips();
          this.loadPassengerCounts(tripId);
        },
        error: (err) => {
          this.isPrinting.set(false);
          this.alertService.error('Error', err.error?.message ?? 'Failed to print ticket.');
        },
      });
  }

  /** Resolves after the browser has painted at least one frame, so a just-set signal
   *  (e.g. showPrintModal) is guaranteed to be reflected in the DOM before it's read. */
  private waitForRender(): Promise<void> {
    return new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  }

  closePrintModal(): void {
    this.showPrintModal.set(false);
  }

  /** Prints another copy of the receipt shown in the modal on the thermal printer. */
  reprintReceipt(): void {
    this.sendReceiptToPrinter();
  }

  /** Sends the receipt currently rendered in the modal to the thermal printer. */
  private sendReceiptToPrinter(): void {
    const receiptEl = this.receiptContentRef()?.nativeElement;
    if (!receiptEl) return;

    this.isSendingToPrinter.set(true);
    this.printerSetup
      .printTicketImage(receiptEl)
      .catch((err) => {
        this.alertService.error(
          'Printer Error',
          err instanceof Error
            ? err.message
            : 'Ticket saved, but printing failed. Check the printer connection.',
        );
      })
      .finally(() => this.isSendingToPrinter.set(false));
  }

  getDiscountPercent(category: string, settings: FareSettings | null = this.fareSettings()): number {
    if (!settings) return 0;
    switch (category) {
      case 'regular':
        return Number(settings.regular_discount_percent);
      case 'student':
        return Number(settings.student_discount_percent);
      case 'senior_citizen':
        return Number(settings.senior_citizen_discount_percent);
      case 'pwd':
        return Number(settings.pwd_discount_percent);
      case 'discounted':
        return Number(settings.discounted_discount_percent);
      default:
        return 0;
    }
  }

  getCategoryLabel(cat: string): string {
    const labels: Record<string, string> = {
      regular: 'Regular',
      student: 'Student',
      senior_citizen: 'Senior Citizen',
      pwd: 'PWD',
      discounted: 'Discounted',
    };
    return labels[cat] ?? cat;
  }
}
