import { Component, inject, signal, OnInit } from '@angular/core';
import { NumericInput } from '../../../../shared/directives/numeric-input.directive';
import { HttpClient } from '@angular/common/http';
import {
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { AlertService } from '../../../../core/services/alert.service';
import { environment } from '../../../../../environments/environment';

interface FareSettingsData {
  id: number;
  minimum_fare: number;
  base_distance_km: number;
  rate_per_km: number;
  regular_discount_percent: number;
  student_discount_percent: number;
  senior_citizen_discount_percent: number;
  pwd_discount_percent: number;
  effective_date: string;
}

/** Fare configuration: up to 4 whole digits and 2 decimals (0 – 9999.99). */
const MONEY_VALIDATORS: ValidatorFn[] = [
  Validators.required,
  Validators.min(0),
  Validators.max(9999.99),
  Validators.pattern(/^\d{1,4}(\.\d{1,2})?$/),
];

/** Category discounts: up to 3 whole digits and 2 decimals, never above 100%. */
const PERCENT_VALIDATORS: ValidatorFn[] = [
  Validators.required,
  Validators.min(0),
  Validators.max(100),
  Validators.pattern(/^\d{1,3}(\.\d{1,2})?$/),
];

@Component({
  selector: 'app-fare-settings',
  imports: [NumericInput, ReactiveFormsModule],
  templateUrl: './fare-settings.html',
})
export class FareSettings implements OnInit {
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);
  private alertService = inject(AlertService);

  private readonly API = `${environment.apiUrl}/api/fare-settings`;

  loading = signal(false);
  saving = signal(false);
  settings = signal<FareSettingsData | null>(null);
  previewDistance = signal(10);

  readonly CATEGORIES = [
    { key: 'regular', label: 'Regular', hint: 'No discount' },
    { key: 'student', label: 'Student', hint: 'Typically 20%' },
    { key: 'senior_citizen', label: 'Senior Citizen', hint: '20% required by law' },
    { key: 'pwd', label: 'PWD', hint: '20% required by law' },
  ];

  form: FormGroup = this.fb.group({
    minimum_fare: [50.0, MONEY_VALIDATORS],
    base_distance_km: [5.0, MONEY_VALIDATORS],
    rate_per_km: [2.0, MONEY_VALIDATORS],
    regular_discount_percent: [0, PERCENT_VALIDATORS],
    student_discount_percent: [20, PERCENT_VALIDATORS],
    senior_citizen_discount_percent: [20, PERCENT_VALIDATORS],
    pwd_discount_percent: [20, PERCENT_VALIDATORS],
    effective_date: [new Date().toISOString().slice(0, 10), Validators.required],
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.http.get<FareSettingsData>(this.API, { withCredentials: true }).subscribe({
      next: (data) => {
        this.settings.set(data);
        // The API returns decimals as strings (e.g. "2.7100"); convert them to numbers so
        // they satisfy the 2-decimal validators.
        this.form.patchValue({
          minimum_fare: Number(data.minimum_fare),
          base_distance_km: Number(data.base_distance_km),
          rate_per_km: Number(data.rate_per_km),
          regular_discount_percent: Number(data.regular_discount_percent),
          student_discount_percent: Number(data.student_discount_percent),
          senior_citizen_discount_percent: Number(data.senior_citizen_discount_percent),
          pwd_discount_percent: Number(data.pwd_discount_percent),
          effective_date: data.effective_date,
        });
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.http
      .put<FareSettingsData>(this.API, this.form.value, { withCredentials: true })
      .subscribe({
        next: (data) => {
          this.settings.set(data);
          this.alertService.success('Saved', 'Fare settings updated successfully.');
          this.saving.set(false);
        },
        error: (err) => {
          this.alertService.error('Error', err.error?.message ?? 'Could not save fare settings.');
          this.saving.set(false);
        },
      });
  }

  fieldError(field: string): boolean {
    const c = this.form.get(field);
    return !!(c?.invalid && c?.touched);
  }

  /** Message shown under a field that failed validation. */
  fieldMessage(field: string): string {
    const c = this.form.get(field);
    if (c?.errors?.['required']) return 'Required';
    return field.endsWith('_discount_percent')
      ? '0 to 100, up to 2 decimals'
      : 'Up to 9999.99, up to 2 decimals';
  }

  previewFare(distance: number): Record<string, number> {
    const v = this.form.value;
    const minFare = parseFloat(v.minimum_fare) || 0;
    const baseDistanceKm = parseFloat(v.base_distance_km) || 0;
    const ratePerKm = parseFloat(v.rate_per_km) || 0;
    // Within the base distance the minimum fare applies; beyond it, distance × rate per km.
    const baseFare = distance <= baseDistanceKm ? minFare : distance * ratePerKm;

    return {
      regular: baseFare * (1 - (parseFloat(v.regular_discount_percent) || 0) / 100),
      student: baseFare * (1 - (parseFloat(v.student_discount_percent) || 0) / 100),
      senior_citizen: baseFare * (1 - (parseFloat(v.senior_citizen_discount_percent) || 0) / 100),
      pwd: baseFare * (1 - (parseFloat(v.pwd_discount_percent) || 0) / 100),
    };
  }
}