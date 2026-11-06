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
  allBuses = signal<Bus[]>([]);
  loading = signal(false);
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
      const matchSearch = !q || b.bus_number.toLowerCase().includes(q) || (b.plate_number ?? '').toLowerCase().includes(q);
      const matchStatus = !s || b.status === s;
      return matchSearch && matchStatus;
    });
  });

  sorted = computed(() => {
    const f = this.sortField(), d = this.sortDir();
    // Keep inactive buses at the bottom of the whole list (across all pages),
    // unless the user is explicitly sorting by the Status column.
    const inactiveLast = f !== 'status';

    return [...this.filtered()].sort((a, b) => {
      if (inactiveLast) {
        const aInactive = a.status === 'inactive' ? 1 : 0;
        const bInactive = b.status === 'inactive' ? 1 : 0;
        if (aInactive !== bInactive) return aInactive - bInactive;
      }

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
  });

  ngOnInit(): void {
    this.loadBuses();
  }

  loadBuses(): void {
    this.loading.set(true);
    this.http.get<Bus[]>(this.API, { withCredentials: true }).subscribe({
      next: (data) => { this.allBuses.set(data); this.loading.set(false); },
      error: () => this.loading.set(false),
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

  openAdd(): void { this.editingBus.set(null); this.form.reset({ status: 'active' }); this.showModal.set(true); }
  openEdit(bus: Bus): void { this.editingBus.set(bus); this.form.patchValue(bus); this.showModal.set(true); }
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

  fieldError(form: FormGroup, field: string): boolean {
    const c = form.get(field);
    return !!(c?.invalid && c?.touched);
  }
}