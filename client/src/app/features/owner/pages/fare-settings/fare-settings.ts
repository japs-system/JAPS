import { Component, inject, signal, OnInit } from '@angular/core';
import { NumericInput } from '../../../../shared/directives/numeric-input.directive';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
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
    { key: 'regular', label: 'Regular'},
    { key: 'student', label: 'Student' },
    { key: 'senior_citizen', label: 'Senior Citizen' },
    { key: 'pwd', label: 'PWD' },
  ];

  form: FormGroup = this.fb.group({
    minimum_fare: [50.0, [Validators.required, Validators.min(0)]],
    base_distance_km: [5.0, [Validators.required, Validators.min(0)]],
    rate_per_km: [2.0, [Validators.required, Validators.min(0)]],
    regular_discount_percent: [0, [Validators.required, Validators.min(0), Validators.max(100)]],
    student_discount_percent: [20, [Validators.required, Validators.min(0), Validators.max(100)]],
    senior_citizen_discount_percent: [
      20,
      [Validators.required, Validators.min(0), Validators.max(100)],
    ],
    pwd_discount_percent: [20, [Validators.required, Validators.min(0), Validators.max(100)]],
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
        this.form.patchValue(data);
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

  /** Error text shown under a field once it has been touched. */
  fieldMessage(field: string): string {
    const errors = this.form.get(field)?.errors;
    if (!errors) return '';
    if (errors['required']) return 'This field is required.';
    if (errors['min']) return `Must be at least ${errors['min'].min}.`;
    if (errors['max']) return `Must be at most ${errors['max'].max}.`;
    return 'Invalid value.';
  }

  previewFare(distance: number): Record<string, number> {
    const v = this.form.value;
    const minFare = parseFloat(v.minimum_fare) || 0;
    const baseDistanceKm = parseFloat(v.base_distance_km) || 0;
    const ratePerKm = parseFloat(v.rate_per_km) || 0;
    // If distance <= base_distance_km, use min_fare. Otherwise add per-km rate.
    const baseFare =
      distance <= baseDistanceKm ? minFare : minFare + (distance - baseDistanceKm) * ratePerKm;

    const fare = (pct: unknown) =>
      Math.round(baseFare * (1 - (parseFloat(String(pct)) || 0) / 100));
    return {
      regular: fare(v.regular_discount_percent),
      student: fare(v.student_discount_percent),
      senior_citizen: fare(v.senior_citizen_discount_percent),
      pwd: fare(v.pwd_discount_percent),
    };
  }
}