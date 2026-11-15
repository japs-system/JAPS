import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { environment } from '../../../../../environments/environment';
import { DriverDashboard } from './dashboard';

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
});
