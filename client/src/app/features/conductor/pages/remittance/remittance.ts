import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { AlertService } from '../../../../core/services/alert.service';
import { environment } from '../../../../../environments/environment';

interface Trip {
  id: number;
  trip_number: number;
  status: string;
  departure_time: string;
  grand_total: number;
  ticket_number_start: string | null;
  ticket_number_end: string | null;
  remittance_id: number | null;
  bus_id: number;
  driver_id: number;
  conductor_id: number;
  BusModel?: { id: number; bus_number: string; plate_number: string };
  Route?: { origin: string; destination: string };
  driver?: { id: number; first_name: string; last_name: string };
  conductor?: { id: number; first_name: string; last_name: string };
}

@Component({
  selector: 'app-remittance',
  imports: [ReactiveFormsModule, CurrencyPipe, DatePipe],
  templateUrl: './remittance.html',
  styleUrl: './remittance.css',
})
export class RemittancePage implements OnInit {
  private http = inject(HttpClient);
  private alertService = inject(AlertService);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  private readonly API = `${environment.apiUrl}/api/conductor`;
  private readonly BUSES_API = `${environment.apiUrl}/api/buses`;

  selectedDate = signal<string>(new Date().toISOString().split('T')[0]);
  selectedBus = signal<any | null>(null);
  allTrips = signal<Trip[]>([]);
  selectedTripIds = signal<Set<number>>(new Set());
  buses = signal<any[]>([]);
  loading = signal(false);
  isSubmitting = signal(false);
  formValues = signal<any>({});

  remittanceForm: FormGroup;

  constructor() {
    this.remittanceForm = this.fb.group({
      exp_officer: [0, [Validators.min(0)]],
      exp_toll_fees: [0, [Validators.min(0)]],
      exp_parking: [0, [Validators.min(0)]],
      exp_ppa: [0, [Validators.min(0)]],
      exp_washing: [0, [Validators.min(0)]],
      exp_diesel: [0, [Validators.min(0)]],
      exp_caller_grand_terminal: [0, [Validators.min(0)]],
      exp_caller_calamba_terminal: [0, [Validators.min(0)]],
      exp_pwd: [0, [Validators.min(0)]],
      exp_miscellaneous: [0, [Validators.min(0)]],
      driver_commission: [0, [Validators.required, Validators.min(0)]],
      conductor_commission: [0, [Validators.required, Validators.min(0)]],
      bonus_allowance: [0, [Validators.min(0)]],
      other_deductions: [0, [Validators.min(0)]],
      cash_deposit: [0, [Validators.required, Validators.min(0)]],
      driver_officer_share: [0, [Validators.min(0)]],
      conductor_officer_share: [0, [Validators.min(0)]],
    });
  }

  ngOnInit(): void {
    this.http.get<any[]>(`${this.BUSES_API}`, { withCredentials: true }).subscribe({
      next: (data) => this.buses.set(data),
      error: () => this.alertService.error('Error', 'Failed to load buses.'),
    });
    this.remittanceForm.valueChanges.subscribe((v) => this.formValues.set(v));
    this.formValues.set(this.remittanceForm.value);
  }

  loadTrips(): void {
    const bus = this.selectedBus();
    if (!bus) { this.allTrips.set([]); return; }
    this.loading.set(true);
    this.selectedTripIds.set(new Set());
    this.http.get<Trip[]>(`${this.API}/trips`, {
      params: { date: this.selectedDate(), busId: bus.id.toString() },
      withCredentials: true,
    }).subscribe({
      next: (data) => {
        this.allTrips.set(data.filter((t) => t.status === 'completed' && !t.remittance_id));
        this.loading.set(false);
      },
      error: () => { this.loading.set(false); this.alertService.error('Error', 'Failed to load trips.'); },
    });
  }

  onBusChange(e: Event): void {
    const id = (e.target as HTMLSelectElement).value;
    this.selectedBus.set(id ? this.buses().find((b) => b.id === parseInt(id)) ?? null : null);
    this.loadTrips();
  }

  onDateChange(e: Event): void {
    this.selectedDate.set((e.target as HTMLInputElement).value);
    this.loadTrips();
  }

  toggleTrip(id: number): void {
    const set = new Set(this.selectedTripIds());
    set.has(id) ? set.delete(id) : set.add(id);
    this.selectedTripIds.set(set);
    this.autoCalculateCommissions();
  }

  toggleAll(): void {
    this.selectedTripIds.set(
      this.selectedTripIds().size === this.allTrips().length
        ? new Set()
        : new Set(this.allTrips().map((t) => t.id))
    );
    this.autoCalculateCommissions();
  }

  isSelected(id: number): boolean { return this.selectedTripIds().has(id); }

  selectedTrips = computed(() => this.allTrips().filter((t) => this.selectedTripIds().has(t.id)));

  autoCalculateCommissions(): void {
    const gross = this.grossIncome();
    this.remittanceForm.patchValue({
      driver_commission: parseFloat((gross * 0.1).toFixed(2)),
      conductor_commission: parseFloat((gross * 0.08).toFixed(2)),
    });
  }

  grossIncome = computed(() => this.selectedTrips().reduce((sum, t) => sum + Number(t.grand_total), 0));

  totalExpenses = computed(() => {
    const f = this.formValues();
    return [f.exp_officer, f.exp_toll_fees, f.exp_parking, f.exp_ppa, f.exp_washing,
      f.exp_diesel, f.exp_caller_grand_terminal, f.exp_caller_calamba_terminal,
      f.exp_pwd, f.exp_miscellaneous].reduce((sum, v) => sum + Number(v || 0), 0);
  });

  netGross = computed(() => this.grossIncome() - this.totalExpenses());

  totalLess = computed(() => {
    const f = this.formValues();
    return Number(f.driver_commission || 0) + Number(f.conductor_commission || 0) +
      Number(f.bonus_allowance || 0) + Number(f.other_deductions || 0) + Number(f.cash_deposit || 0);
  });

  netCollection = computed(() => this.netGross() - this.totalLess());

  private buildExpensesPayload() {
    const f = this.remittanceForm.value;
    const map: Record<string, number> = {
      officer: f.exp_officer, toll_fees: f.exp_toll_fees, parking: f.exp_parking,
      ppa: f.exp_ppa, washing: f.exp_washing, diesel: f.exp_diesel,
      caller_grand_terminal: f.exp_caller_grand_terminal,
      caller_calamba_terminal: f.exp_caller_calamba_terminal,
      pwd: f.exp_pwd, miscellaneous: f.exp_miscellaneous,
    };
    return Object.entries(map).filter(([, v]) => Number(v) > 0)
      .map(([expense_type, amount]) => ({ expense_type, amount: Number(amount) }));
  }

  submitRemittance(): void {
    if (this.remittanceForm.invalid) { this.remittanceForm.markAllAsTouched(); return; }
    const trips = this.selectedTrips();
    if (trips.length === 0) {
      this.alertService.error('Submit Failed', 'Select at least one trip to remit.');
      return;
    }
    const bus = this.selectedBus()!;
    this.isSubmitting.set(true);
    const { exp_officer, exp_toll_fees, exp_parking, exp_ppa, exp_washing, exp_diesel,
      exp_caller_grand_terminal, exp_caller_calamba_terminal, exp_pwd, exp_miscellaneous,
      ...rest } = this.remittanceForm.value;

    this.http.post<any>(`${this.API}/remittances`, {
      ...rest,
      bus_id: bus.id,
      driver_id: bus.assignedDriver?.id ?? null,
      date: this.selectedDate(),
      trip_ids: trips.map((t) => t.id),
      expenses: this.buildExpensesPayload(),
    }, { withCredentials: true }).subscribe({
      next: () => {
        this.isSubmitting.set(false);
        this.alertService.success('Success', 'Remittance submitted to audit teller for verification.');
        this.router.navigate(['/conductor/remittances']);
      },
      error: (err) => {
        this.isSubmitting.set(false);
        this.alertService.error('Error', err.error?.message ?? 'Failed to submit remittance.');
      },
    });
  }
}
