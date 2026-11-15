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
    httpMock.expectOne(`${environment.apiUrl}/api/owner/remittances`).flush([]);
  });

  afterEach(() => httpMock.verify());

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
