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
      .expectOne(`${environment.apiUrl}/api/buses/trips?startDate=2026-11-07&endDate=2026-11-07`)
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
      departure_time: '2026-11-07T04:00:00.000Z',
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
    });
    request.flush({});

    httpMock
      .expectOne(
        `${environment.apiUrl}/api/buses/trips?startDate=${component.startDate()}&endDate=${component.endDate()}`,
      )
      .flush([]);
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
