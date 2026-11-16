import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AlertService } from '../../../../core/services/alert.service';
import { environment } from '../../../../../environments/environment';
import { Remittances } from './remittances';

describe('Remittances', () => {
  let fixture: ComponentFixture<Remittances>;
  let component: Remittances;
  let httpMock: HttpTestingController;
  let alertService: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    alertService = { error: vi.fn(), success: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [Remittances, HttpClientTestingModule],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
        { provide: AlertService, useValue: alertService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(Remittances);
    component = fixture.componentInstance;
    httpMock = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    httpMock.expectOne(`${environment.apiUrl}/api/owner/remittances`).flush([
      {
        id: 1,
        date: today,
        no_of_trips: 1,
        gross_income: 100,
        total_expenses: 10,
        net_gross: 90,
        total_less: 5,
        net_collection: 85,
        cash_deposit: 40,
        cash_received: 40,
        status: 'submitted',
        submitted_at: now.toISOString(),
        approved_at: null,
        conductor: { id: 2, first_name: 'Conductor', last_name: 'One', employee_id: 'C1' },
        driver: { id: 3, first_name: 'Driver', last_name: 'One', employee_id: 'D1' },
        BusModel: { id: 4, bus_number: 'BUS-1', plate_number: 'ABC-1' },
        approver: null,
      },
    ]);
  });

  afterEach(() => httpMock.verify());

  it('hides row checkboxes until selection mode and selects all filtered remittances', () => {
    expect(fixture.nativeElement.querySelectorAll('tbody input[type="checkbox"]').length).toBe(0);

    component.selectionMode.set(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('tbody input[type="checkbox"]').length).toBe(1);

    component.selectAllRemittances();
    expect(component.selectedRemittanceIds()).toEqual(new Set([1]));
  });

  it('deletes the selected remittances after confirmation', () => {
    component.selectedRemittanceIds.set(new Set([11, 12]));
    component.showBulkDeleteConfirmation.set(true);

    component.deleteSelectedRemittances();

    const deletes = httpMock.match((request) => request.method === 'DELETE');
    expect(deletes.map((request) => request.request.url).sort()).toEqual([
      `${environment.apiUrl}/api/owner/remittances/11`,
      `${environment.apiUrl}/api/owner/remittances/12`,
    ]);
    deletes.forEach((request) => request.flush(null));

    expect(component.showBulkDeleteConfirmation()).toBe(false);
    expect(component.selectedRemittanceIds().size).toBe(0);
    expect(alertService.success).toHaveBeenCalledWith('Deleted', '2 remittances deleted.');
  });

  it('keeps failed remittances selected and reports partial failures', () => {
    component.selectedRemittanceIds.set(new Set([21, 22]));

    component.deleteSelectedRemittances();

    const delete21 = httpMock.expectOne(`${environment.apiUrl}/api/owner/remittances/21`);
    const delete22 = httpMock.expectOne(`${environment.apiUrl}/api/owner/remittances/22`);
    delete21.flush(null);
    delete22.flush({ message: 'Remittance is locked.' }, { status: 409, statusText: 'Conflict' });

    expect(component.selectedRemittanceIds()).toEqual(new Set([22]));
    expect(alertService.error).toHaveBeenCalledWith(
      'Some remittances could not be deleted',
      '1 deleted; 1 failed. Remittance is locked.',
    );
  });
});
