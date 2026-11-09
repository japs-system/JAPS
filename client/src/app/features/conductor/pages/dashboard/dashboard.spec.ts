import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { AlertService } from '../../../../core/services/alert.service';
import { environment } from '../../../../../environments/environment';
import { ConductorDashboard, Trip } from './dashboard';

describe('ConductorDashboard', () => {
  let fixture: ComponentFixture<ConductorDashboard>;
  let component: ConductorDashboard;
  let httpMock: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConductorDashboard, HttpClientTestingModule],
      providers: [
        {
          provide: AlertService,
          useValue: { error: vi.fn(), success: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ConductorDashboard);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    httpMock.expectOne(`${environment.apiUrl}/api/conductor/trips`).flush([]);
  });

  afterEach(() => httpMock.verify());

  it('allows starting past scheduled trips in the all-trips list', () => {
    const trip: Trip = {
      id: 1,
      bus_id: 10,
      trip_number: 1,
      status: 'scheduled',
      departure_time: '2020-01-01T20:00:00.000Z',
      arrival_time: null,
      grand_total: 0,
      ticket_number_start: null,
      ticket_number_end: null,
    };

    component.trips.set([trip]);

    expect(component.canStartTrip().get(trip.id)).toBe(true);
  });

  it('requires earlier trips on the same bus and Manila service date to be completed first', () => {
    const earlier: Trip = {
      id: 1,
      bus_id: 10,
      trip_number: 1,
      status: 'scheduled',
      departure_time: '2020-01-01T20:00:00.000Z',
      arrival_time: null,
      grand_total: 0,
      ticket_number_start: null,
      ticket_number_end: null,
    };
    const later: Trip = {
      ...earlier,
      id: 2,
      trip_number: 2,
      departure_time: '2020-01-01T21:00:00.000Z',
    };

    component.trips.set([earlier, later]);
    expect(component.canStartTrip().get(later.id)).toBe(false);

    component.trips.set([{ ...earlier, status: 'completed' }, later]);
    expect(component.canStartTrip().get(later.id)).toBe(true);
  });
});
