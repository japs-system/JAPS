import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { TicketingPage } from './ticketing';
import { PrinterSetupService } from '../../../../core/services/printer-setup.service';
import { environment } from '../../../../../environments/environment';

describe('TicketingPage', () => {
  let component: TicketingPage;
  let fixture: ComponentFixture<TicketingPage>;
  let httpMock: HttpTestingController;
  let printReceipt: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    printReceipt = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      queueMicrotask(() => callback(0));
      return 1;
    });

    await TestBed.configureTestingModule({
      imports: [TicketingPage, HttpClientTestingModule],
      providers: [
        provideRouter([]),
        {
          provide: PrinterSetupService,
          useValue: {
            printReceipt,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TicketingPage);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    // Satisfy ngOnInit's fare-settings + trips requests.
    httpMock.expectOne(`${environment.apiUrl}/api/fare-settings`).flush({
      minimum_fare: 10,
      base_distance_km: 4,
      rate_per_km: 2,
      regular_discount_percent: 0,
      student_discount_percent: 20,
      senior_citizen_discount_percent: 20,
      pwd_discount_percent: 20,
    });
    httpMock.expectOne(`${environment.apiUrl}/api/conductor/trips`).flush([]);
    await fixture.whenStable();
  });

  afterEach(() => {
    httpMock.verify();
    vi.unstubAllGlobals();
  });

  it('prints the receipt after a successful ticket submission', async () => {
    component.selectedTripId.set(1);
    component.trips.set([
      {
        id: 1,
        trip_number: 1,
        status: 'ongoing',
        departure_time: new Date().toISOString(),
        grand_total: 0,
        ticket_number_start: null,
        ticket_number_end: null,
        ticket_passenger_count: '0',
        BusModel: { id: 1, bus_number: 'BUS-01', plate_number: 'ABC-123', capacity: 40 },
        Route: { id: 1, origin: 'Manila', destination: 'Baguio', distance_km: 250 },
      },
    ]);
    component.ticketForm.patchValue({
      boarding_km: 0,
      dropping_km: 5,
      quantities: { regular: 1, student: 1, senior_citizen: 1, pwd: 0 },
    });

    // 5 km is past the 4 km base distance: 5 × 2 = ₱10 regular, ₱8 with a 20% discount.
    expect(component.totalPassengers()).toBe(3);
    expect(component.totalFare()).toBe(26);
    expect(component.ticketNumberPreview()).toBe('1-3');

    component.trips.update((trips) =>
      trips.map((trip) => ({ ...trip, ticket_passenger_count: '3' })),
    );
    component.ticketForm.patchValue({
      quantities: { regular: 1, student: 0, senior_citizen: 0, pwd: 0 },
    });
    expect(component.ticketNumberPreview()).toBe('4');

    component.trips.update((trips) =>
      trips.map((trip) => ({ ...trip, ticket_passenger_count: '4' })),
    );
    component.ticketForm.patchValue({
      quantities: { regular: 0, student: 1, senior_citizen: 1, pwd: 0 },
    });
    expect(component.ticketNumberPreview()).toBe('5-6');

    component.trips.update((trips) =>
      trips.map((trip) => ({ ...trip, ticket_passenger_count: '0' })),
    );
    component.ticketForm.patchValue({
      quantities: { regular: 1, student: 1, senior_citizen: 1, pwd: 0 },
    });

    component.printTicketSubmit();

    const req = httpMock.expectOne(`${environment.apiUrl}/api/conductor/trips/1/tickets`);
    expect(req.request.body).toEqual({
      boarding_km: 0,
      dropping_km: 5,
      passengers: [
        { category: 'regular', quantity: 1 },
        { category: 'student', quantity: 1 },
        { category: 'senior_citizen', quantity: 1 },
      ],
    });
    req.flush({
      ticket: {
        ticket_number: '1-3',
        boarding_point: 'Manila',
        dropping_point: 'Baguio',
        distance_km: 5,
        fare: 26,
        passenger_count: 3,
        passengers: [
          { category: 'regular', quantity: 1, unit_fare: 10, subtotal: 10 },
          { category: 'student', quantity: 1, unit_fare: 8, subtotal: 8 },
          { category: 'senior_citizen', quantity: 1, unit_fare: 8, subtotal: 8 },
        ],
      },
    });

    // Let the modal render so the receipt content element exists before the
    // component's own double-rAF wait resolves and reads it.
    fixture.detectChanges();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    expect(printReceipt).toHaveBeenCalledTimes(1);
    expect(printReceipt).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketNumber: '1-3',
        busNumber: 'BUS-01',
        plateNumber: 'ABC-123',
        from: 'Manila',
        to: 'Baguio',
        passengerCount: 3,
        total: '₱26.00',
        lines: [
          { label: 'Regular', quantity: 1, amount: '₱10.00' },
          { label: 'Student', quantity: 1, amount: '₱8.00' },
          { label: 'Senior Citizen', quantity: 1, amount: '₱8.00' },
        ],
      }),
    );

    // printTicketSubmit()'s success handler also refreshes trips & passenger counts.
    httpMock.expectOne(`${environment.apiUrl}/api/conductor/trips`).flush([]);
    httpMock.expectOne(`${environment.apiUrl}/api/conductor/trips/1/passenger-counts`).flush([]);
  });
});