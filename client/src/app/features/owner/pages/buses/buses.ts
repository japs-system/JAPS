import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { NumericInput } from '../../../../shared/directives/numeric-input.directive';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertService } from '../../../../core/services/alert.service';
import { environment } from '../../../../../environments/environment';
import { TablePagination } from '../../../../shared/components/table-pagination/table-pagination';

export interface Bus {
  id: number;
  bus_number: string;
  plate_number: string;
  capacity: number;
  status: 'active' | 'inactive' | 'under_maintenance';
  driver_id: number | null;
  conductor_id: number | null;
  route_id: number | null;
  assignedDriver?: { id: number; first_name: string; last_name: string; employee_id: string } | null;
  assignedConductor?: { id: number; first_name: string; last_name: string; employee_id: string } | null;
  defaultRoute?: { id: number; origin: string; destination: string } | null;
}

export interface CrewUser {
  id: number;
  employee_id: string;
  first_name: string;
  last_name: string;
  role: string;
}

type SortField = 'bus_number' | 'plate_number' | 'capacity' | 'status';

@Component({
  selector: 'app-buses',
  imports: [NumericInput, ReactiveFormsModule, TablePagination],
  templateUrl: './buses.html',
})
export class Buses implements OnInit {
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);
  private alertService = inject(AlertService);

  private readonly API = `${environment.apiUrl}/api/buses`;
  private readonly USERS_API = `${environment.apiUrl}/api/users`;
  private readonly ROUTES_API = `${environment.apiUrl}/api/buses/routes`;

  allBuses = signal<Bus[]>([]);
  loading = signal(false);
  routes = signal<{ id: number; origin: string; destination: string }[]>([]);
  search = signal('');
  statusFilter = signal('');
  sortField = signal<SortField>('bus_number');
  sortDir = signal<'asc' | 'desc'>('asc');
  pageSize = signal(10);
  currentPage = signal(1);
  readonly PAGE_SIZES = [10, 25, 50];
  readonly STATUSES = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'under_maintenance', label: 'Under Maintenance' },
  ];

  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const s = this.statusFilter();
    return this.allBuses().filter((b) => {
      const matchSearch = !q || b.bus_number.toLowerCase().includes(q) || b.plate_number.toLowerCase().includes(q);
      const matchStatus = !s || b.status === s;
      return matchSearch && matchStatus;
    });
  });

  sorted = computed(() => {
    const f = this.sortField(), d = this.sortDir();
    return [...this.filtered()].sort((a, b) => {
      const av = String(a[f] ?? '').toLowerCase();
      const bv = String(b[f] ?? '').toLowerCase();
      return d === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  });

  totalItems = computed(() => this.sorted().length);
  totalPages = computed(() => Math.max(1, Math.ceil(this.totalItems() / this.pageSize())));
  pageStart = computed(() => (this.currentPage() - 1) * this.pageSize() + 1);
  pageEnd = computed(() => Math.min(this.currentPage() * this.pageSize(), this.totalItems()));
  paged = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    return this.sorted().slice(start, start + this.pageSize());
  });
  pageNumbers = computed(() => {
    const total = this.totalPages(), cur = this.currentPage();
    const pages: (number | '...')[] = [];
    for (let i = 1; i <= total; i++) {
      if (i === 1 || i === total || Math.abs(i - cur) <= 1) pages.push(i);
      else if (pages[pages.length - 1] !== '...') pages.push('...');
    }
    return pages;
  });

  showModal = signal(false);
  showDeleteModal = signal(false);
  editingBus = signal<Bus | null>(null);
  deletingBus = signal<Bus | null>(null);

  form: FormGroup = this.fb.group({
    bus_number: ['', Validators.required],
    plate_number: ['', Validators.required],
    capacity: ['', [Validators.required, Validators.min(1)]],
    status: ['active', Validators.required],
    route_id: [null],
  });

  showCrewModal = signal(false);
  assigningBus = signal<Bus | null>(null);
  drivers = signal<CrewUser[]>([]);
  conductors = signal<CrewUser[]>([]);

  /** Drivers not assigned to any OTHER bus (the bus being edited keeps its own driver). */
  availableDrivers = computed(() => {
    const current = this.assigningBus();
    const takenByOthers = new Set(
      this.allBuses()
        .filter((b) => b.id !== current?.id && b.driver_id != null)
        .map((b) => b.driver_id as number),
    );
    return this.drivers().filter((d) => !takenByOthers.has(d.id));
  });

  /** Conductors not assigned to any OTHER bus (the bus being edited keeps its own conductor). */
  availableConductors = computed(() => {
    const current = this.assigningBus();
    const takenByOthers = new Set(
      this.allBuses()
        .filter((b) => b.id !== current?.id && b.conductor_id != null)
        .map((b) => b.conductor_id as number),
    );
    return this.conductors().filter((c) => !takenByOthers.has(c.id));
  });

  crewForm: FormGroup = this.fb.group({
    driver_id: [null],
    conductor_id: [null],
  });

  ngOnInit(): void {
    this.loadBuses();
    this.loadCrewUsers();
    this.loadRoutes();
  }

  loadBuses(): void {
    this.loading.set(true);
    this.http.get<Bus[]>(this.API, { withCredentials: true }).subscribe({
      next: (data) => { this.allBuses.set(data); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  loadCrewUsers(): void {
    this.http.get<CrewUser[]>(this.USERS_API, { withCredentials: true }).subscribe({
      next: (data) => {
        this.drivers.set(data.filter((u) => u.role === 'driver'));
        this.conductors.set(data.filter((u) => u.role === 'conductor'));
      },
    });
  }

  loadRoutes(): void {
    this.http.get<{ id: number; origin: string; destination: string }[]>(this.ROUTES_API, { withCredentials: true }).subscribe({
      next: (data) => this.routes.set(data),
    });
  }

  onSearch(e: Event): void { this.search.set((e.target as HTMLInputElement).value); this.currentPage.set(1); }
  onStatusFilter(e: Event): void { this.statusFilter.set((e.target as HTMLSelectElement).value); this.currentPage.set(1); }

  setSort(f: SortField): void {
    if (this.sortField() === f) this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { this.sortField.set(f); this.sortDir.set('asc'); }
    this.currentPage.set(1);
  }
  sortIcon(f: SortField): string {
    if (this.sortField() !== f) return 'pi-sort';
    return this.sortDir() === 'asc' ? 'pi-sort-up' : 'pi-sort-down';
  }
  setPage(p: number): void { this.currentPage.set(p); }
  onPageSizeChange(s: number): void { this.pageSize.set(s); this.currentPage.set(1); }

  openAdd(): void { this.editingBus.set(null); this.form.reset({ status: 'active', route_id: null }); this.showModal.set(true); }
  openEdit(bus: Bus): void { this.editingBus.set(bus); this.form.patchValue({ ...bus, route_id: bus.route_id ?? null }); this.showModal.set(true); }
  closeModal(): void { this.showModal.set(false); }

  save(): void {
    if (this.form.invalid) { this.form.markAllAsTouched(); return; }
    const editing = this.editingBus();
    const req = editing
      ? this.http.put<Bus>(`${this.API}/${editing.id}`, this.form.value, { withCredentials: true })
      : this.http.post<Bus>(this.API, this.form.value, { withCredentials: true });
    req.subscribe({
      next: () => { this.alertService.success('Saved', editing ? 'Bus updated.' : 'Bus created.'); this.closeModal(); this.loadBuses(); },
      error: (err) => this.alertService.error('Error', err.error?.message ?? 'Something went wrong.'),
    });
  }

  confirmDelete(bus: Bus): void { this.deletingBus.set(bus); this.showDeleteModal.set(true); }
  cancelDelete(): void { this.showDeleteModal.set(false); }

  deleteBus(): void {
    const bus = this.deletingBus();
    if (!bus) return;
    this.http.delete(`${this.API}/${bus.id}`, { withCredentials: true }).subscribe({
      next: () => { this.alertService.success('Deleted', 'Bus removed.'); this.showDeleteModal.set(false); this.loadBuses(); },
      error: (err) => this.alertService.error('Error', err.error?.message ?? 'Could not delete bus.'),
    });
  }

  openAssignCrew(bus: Bus): void {
    this.assigningBus.set(bus);
    this.crewForm.patchValue({ driver_id: bus.driver_id ?? null, conductor_id: bus.conductor_id ?? null });
    this.showCrewModal.set(true);
  }
  closeCrewModal(): void { this.showCrewModal.set(false); }

  saveCrew(): void {
    const bus = this.assigningBus();
    if (!bus) return;
    this.http.put(`${this.API}/${bus.id}/assign-crew`, this.crewForm.value, { withCredentials: true }).subscribe({
      next: () => { this.alertService.success('Saved', 'Crew assigned.'); this.closeCrewModal(); this.loadBuses(); },
      error: (err) => this.alertService.error('Error', err.error?.message ?? 'Could not assign crew.'),
    });
  }

  fieldError(form: FormGroup, field: string): boolean {
    const c = form.get(field);
    return !!(c?.invalid && c?.touched);
  }
}