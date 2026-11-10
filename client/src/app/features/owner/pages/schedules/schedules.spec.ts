import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AlertService } from '../../../../core/services/alert.service';
import { environment } from '../../../../../environments/environment';
import { ScheduleTrip, Schedules } from './schedules';

describe('Schedules', () => {
  let fixture: ComponentFixture<Schedules>;
  let component: Schedules;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Schedules, HttpClientTestingModule],
      providers: [
        {
          provide: AlertService,
          useValue: { error: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Schedules);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    httpMock.expectOne(`${environment.apiUrl}/api/buses`).flush([]);
    httpMock.expectOne(`${environment.apiUrl}/api/users`).flush([
      { id: 2, role: 'driver', first_name: 'Active', last_name: 'Driver', is_active: true },
      { id: 3, role: 'driver', first_name: 'Inactive', last_name: 'Driver', is_active: false },
      { id: 4, role: 'conductor', first_name: 'Active', last_name: 'Conductor', is_active: true },
      { id: 5, role: 'conductor', first_name: 'Inactive', last_name: 'Conductor', is_active: false },
    ]);
    httpMock.expectOne(`${environment.apiUrl}/api/buses/routes`).flush([]);
    httpMock
      .expectOne(
        `${environment.apiUrl}/api/buses/trips?startDate=${component.startDate()}&endDate=${component.endDate()}`,
      )
      .flush([]);
    await fixture.whenStable();
  });

  afterEach(() => httpMock.verify());

  it('only offers active drivers and conductors for new schedules', () => {
    expect(component.drivers().map((user) => user.id)).toEqual([2]);
    expect(component.conductors().map((user) => user.id)).toEqual([4]);
  });

  it('updates a schedule row with a date and departure time', () => {
    component.tripRows.set([{ route_id: 40, departure_time: '2026-11-07T06:00' }]);

    component.updateRowTime(0, { target: { value: '2026-11-08T07:30' } } as unknown as Event);

    expect(component.tripRows()[0].departure_time).toBe('2026-11-08T07:30');
    expect(component.scheduleDate()).toBe('2026-11-08');
  });

  it('requires unlocking before scheduling before today', () => {
    expect(component.isDepartureAllowed('2000-01-01T23:59')).toBe(false);
    expect(component.isDepartureAllowed(`${component.minScheduleDateTime}`)).toBe(true);

    component.unlockPastSchedules();
    expect(component.isDepartureAllowed('2000-01-01T23:59')).toBe(true);

    component.lockPastSchedules();
    expect(component.isDepartureAllowed('2000-01-01T23:59')).toBe(false);
  });

  it('only includes active buses and crew in schedule filters', () => {
    component.buses.set([
      { id: 10, bus_number: 'ACTIVE', plate_number: 'A', status: 'active' },
      { id: 11, bus_number: 'INACTIVE', plate_number: 'I', status: 'inactive' },
    ]);
    component.filterDrivers.set([
      { id: 2, role: 'driver', first_name: 'Active', last_name: 'Driver', is_active: true },
      { id: 3, role: 'driver', first_name: 'Inactive', last_name: 'Driver', is_active: false },
    ]);
    component.filterConductors.set([
      { id: 4, role: 'conductor', first_name: 'Active', last_name: 'Conductor', is_active: true },
      { id: 5, role: 'conductor', first_name: 'Inactive', last_name: 'Conductor', is_active: false },
    ]);

    expect(component.activeBuses().map((bus) => bus.id)).toEqual([10]);
    expect(component.tripDrivers().map((driver) => driver.id)).toEqual([2]);
    expect(component.tripConductors().map((conductor) => conductor.id)).toEqual([4]);
  });

  it('keeps schedule filters applied when the date range reloads', () => {
    const trip: ScheduleTrip = {
      id: 1,
      bus_id: 10,
      driver_id: 20,
      conductor_id: 30,
      route_id: 40,
      trip_number: 1,
      departure_time: '2026-11-07T04:00:00.000Z',
      actual_departure_time: null,
      arrival_time: null,
      status: 'scheduled',
    };

    component.filterBus.set('10');
    component.filterDriver.set('20');
    component.filterConductor.set('30');
    component.filterRoute.set('40');

    component.onStartDateChange({ target: { value: '2026-11-07' } } as unknown as Event);
    httpMock
      .expectOne(
        `${environment.apiUrl}/api/buses/trips?startDate=2026-11-07&endDate=${component.endDate()}`,
      )
      .flush([trip]);

    expect(component.filterBus()).toBe('10');
    expect(component.filterDriver()).toBe('20');
    expect(component.filterConductor()).toBe('30');
    expect(component.filterRoute()).toBe('40');
    expect(component.filtered()).toEqual([trip]);
  });

  it('submits edits for an existing scheduled trip', () => {
    component.buses.set([{ id: 10, bus_number: 'BUS-10', plate_number: 'ABC-010', status: 'active' }]);
    component.openEdit({
      id: 99,
      bus_id: 10,
      driver_id: 2,
      conductor_id: 4,
      route_id: 40,
      trip_number: 3,
      departure_time: '2030-11-07T04:00:00.000Z',
      actual_departure_time: null,
      arrival_time: null,
      status: 'scheduled',
    });
    const expectedDeparture = component.tripRows()[0].departure_time;

    component.save();

    const request = httpMock.expectOne(`${environment.apiUrl}/api/buses/trips/99`);
    expect(request.request.method).toBe('PUT');
    expect(request.request.body).toEqual({
      bus_id: 10,
      driver_id: 2,
      conductor_id: 4,
      route_id: 40,
      departure_time: expectedDeparture,
      allow_past_schedule: false,
    });
    request.flush({});

    httpMock
      .expectOne(
        `${environment.apiUrl}/api/buses/trips?startDate=${component.startDate()}&endDate=${component.endDate()}`,
      )
      .flush([]);
  });

  it('submits a past schedule only after past dates are unlocked', () => {
    component.openAdd();
    component.selectedBus.set({ id: 10, bus_number: 'BUS-10', plate_number: 'ABC-010', status: 'active' });
    component.selectedDriverId.set(2);
    component.selectedConductorId.set(4);
    component.scheduleDate.set('2000-01-01');
    component.tripRows.set([{ route_id: 40, departure_time: '2000-01-01T06:00' }]);

    expect(component.canSave()).toBe(false);
    component.unlockPastSchedules();
    expect(component.canSave()).toBe(true);

    component.save();

    const request = httpMock.expectOne(`${environment.apiUrl}/api/buses/trips/bulk`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      bus_id: 10,
      driver_id: 2,
      conductor_id: 4,
      date: '2000-01-01',
      allow_past_schedule: true,
      trips: [{ route_id: 40, departure_time: '2000-01-01T06:00' }],
    });
    request.flush([]);

    httpMock
      .expectOne(
        `${environment.apiUrl}/api/buses/trips?startDate=${component.startDate()}&endDate=${component.endDate()}`,
      )
      .flush([]);
  });

  it('prefills the current assignments when editing a trip with inactive resources', () => {
    const inactiveBus = {
      id: 11,
      bus_number: 'BUS-11',
      plate_number: 'ABC-011',
      status: 'inactive' as const,
    };
    const trip: ScheduleTrip = {
      id: 101,
      bus_id: inactiveBus.id,
      driver_id: 12,
      conductor_id: 13,
      route_id: 40,
      trip_number: 5,
      departure_time: '2026-11-07T04:00:00.000Z',
      actual_departure_time: null,
      arrival_time: null,
      status: 'scheduled',
      BusModel: inactiveBus,
      driver: { id: 12, first_name: 'Old', last_name: 'Driver', is_active: false },
      conductor: { id: 13, first_name: 'Old', last_name: 'Conductor', is_active: false },
    };

    component.buses.set([inactiveBus]);
    component.openEdit(trip);

    expect(component.selectedBus()?.id).toBe(inactiveBus.id);
    expect(component.selectedDriverId()).toBe(12);
    expect(component.selectedConductorId()).toBe(13);
    expect(component.scheduleDrivers().map((user) => user.id)).toContain(12);
    expect(component.scheduleConductors().map((user) => user.id)).toContain(13);
  });

  it('shows all existing assignments and the Manila departure time in the edit form', () => {
    const bus = { id: 10, bus_number: 'BUS-10', plate_number: 'ABC-010', status: 'active' as const };
    const route = { id: 40, origin: 'Origin', destination: 'Destination' };
    const trip: ScheduleTrip = {
      id: 102,
      bus_id: bus.id,
      driver_id: 2,
      conductor_id: 4,
      route_id: route.id,
      trip_number: 6,
      departure_time: '2026-11-09T04:00:00.000Z',
      actual_departure_time: null,
      arrival_time: null,
      status: 'scheduled',
      BusModel: bus,
      Route: route,
      driver: { id: 2, first_name: 'Active', last_name: 'Driver', is_active: true },
      conductor: { id: 4, first_name: 'Active', last_name: 'Conductor', is_active: true },
    };

    component.buses.set([bus]);
    component.drivers.set([
      { ...trip.driver!, role: 'driver', is_active: true },
    ]);
    component.conductors.set([
      { ...trip.conductor!, role: 'conductor', is_active: true },
    ]);
    component.routes.set([]);
    component.openEdit(trip);
    fixture.detectChanges();

    expect(component.scheduleRoutes()).toContain(route);
    const modal = fixture.nativeElement.querySelector('.fixed.inset-0.z-50') as HTMLElement;
    const selects = modal.querySelectorAll('select');
    const departure = modal.querySelector('input[type="datetime-local"]') as HTMLInputElement;

    expect(Array.from(selects).map((select) => select.selectedOptions[0]?.textContent?.trim())).toEqual([
      'Bus BUS-10',
      'Active Driver',
      'Active Conductor',
      'Origin → Destination',
    ]);
    expect(departure.value).toBe('2026-11-09T12:00');
  });

  it('cancels a scheduled trip and reloads the schedule list', () => {
    const trip: ScheduleTrip = {
      id: 99,
      bus_id: 10,
      driver_id: 2,
      conductor_id: 4,
      route_id: 40,
      trip_number: 3,
      departure_time: '2026-11-07T04:00:00.000Z',
      actual_departure_time: null,
      arrival_time: null,
      status: 'scheduled',
    };

    component.confirmDelete(trip);
    expect(component.showDeleteModal()).toBe(true);

    component.deleteTrip();
    const request = httpMock.expectOne(`${environment.apiUrl}/api/buses/trips/99`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);

    httpMock
      .expectOne(
        `${environment.apiUrl}/api/buses/trips?startDate=${component.startDate()}&endDate=${component.endDate()}`,
      )
      .flush([]);
    expect(component.showDeleteModal()).toBe(false);
  });

  it('deletes a completed trip and reloads the schedule list', () => {
    const trip: ScheduleTrip = {
      id: 100,
      bus_id: 10,
      driver_id: 2,
      conductor_id: 4,
      route_id: 40,
      trip_number: 4,
      departure_time: '2026-11-07T04:00:00.000Z',
      actual_departure_time: '2026-11-07T04:05:00.000Z',
      arrival_time: '2026-11-07T05:00:00.000Z',
      status: 'completed',
    };

    component.confirmDelete(trip);
    component.deleteTrip();

    const request = httpMock.expectOne(`${environment.apiUrl}/api/buses/trips/100`);
    expect(request.request.method).toBe('DELETE');
    request.flush(null);

    httpMock
      .expectOne(
        `${environment.apiUrl}/api/buses/trips?startDate=${component.startDate()}&endDate=${component.endDate()}`,
      )
      .flush([]);
    expect(component.showDeleteModal()).toBe(false);
  });
});
