import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../../../environments/environment';
import { DriverDashboard, Trip } from './dashboard';

describe('DriverDashboard', () => {
  let fixture: ComponentFixture<DriverDashboard>;
  let component: DriverDashboard;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DriverDashboard, HttpClientTestingModule],
    }).compileComponents();

    fixture = TestBed.createComponent(DriverDashboard);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/api/driver/trips`).flush([]);
  });

  afterEach(() => httpMock.verify());

  it('supports card and table schedule views', () => {
    expect(component.viewMode()).toBe('card');

    component.trips.set([
      {
        id: 1,
        trip_number: 1,
        status: 'scheduled',
        departure_time: '2026-11-15T01:00:00.000Z',
        arrival_time: null,
      },
    ]);
    component.viewMode.set('table');
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Departure');
    expect(fixture.nativeElement.textContent).toContain('Conductor');
  });

  it('archives past completed and cancelled trips and filters current trips', () => {
    const trips: Trip[] = [
      {
        id: 1,
        trip_number: 1,
        status: 'completed',
        departure_time: '2020-01-01T20:00:00.000Z',
        arrival_time: null,
        BusModel: { id: 1, bus_number: 'BUS-1', plate_number: 'ABC-1', capacity: 40 },
        Route: { id: 1, origin: 'North', destination: 'South', distance_km: 50 },
      },
      {
        id: 2,
        trip_number: 2,
        status: 'scheduled',
        departure_time: '2020-01-02T20:00:00.000Z',
        arrival_time: null,
        BusModel: { id: 2, bus_number: 'BUS-2', plate_number: 'ABC-2', capacity: 40 },
        Route: { id: 2, origin: 'East', destination: 'West', distance_km: 60 },
      },
      {
        id: 3,
        trip_number: 3,
        status: 'ongoing',
        departure_time: '2020-01-03T20:00:00.000Z',
        arrival_time: null,
      },
    ];
    component.trips.set(trips);

    expect(component.archivedTrips().map((trip) => trip.id)).toEqual([1]);
    expect(component.filteredTrips().map((trip) => trip.id)).toEqual([3, 2]);

    component.setTab('archive');
    expect(component.filteredTrips().map((trip) => trip.id)).toEqual([1]);
    component.onSearch({ target: { value: 'North' } } as unknown as Event);
    expect(component.filteredTrips().map((trip) => trip.id)).toEqual([1]);
    component.onStatusFilter({ target: { value: 'cancelled' } } as unknown as Event);
    expect(component.filteredTrips()).toEqual([]);
  });
});
