import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { AllowedCharsDirective } from '../../../../shared/directives/allowed-chars.directive';
import { HttpClient } from '@angular/common/http';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { AlertService } from '../../../../core/services/alert.service';
import { environment } from '../../../../../environments/environment';
import { USER_ROLES, NAME_SUFFIXES, UserRole } from '../../../../shared/constants/user-options';
import { User } from '../../../../shared/models/user.models';
import { TablePagination } from '../../../../shared/components/table-pagination/table-pagination';

type NonOwnerRole = Exclude<UserRole, 'owner'>;
type SortField = 'employee_id' | 'last_name' | 'username' | 'role' | 'is_active';

@Component({
  selector: 'app-users',
  imports: [AllowedCharsDirective, ReactiveFormsModule, TablePagination],
  templateUrl: './users.html',
})
export class Users implements OnInit {
  private http = inject(HttpClient);
  private fb = inject(FormBuilder);
  private alertService = inject(AlertService);

  private readonly API = `${environment.apiUrl}/api/users`;

  // ── Raw data ──────────────────────────────────────────────────────────
  private allUsers = signal<User[]>([]);
  loading = signal(false);

  // ── Table state ───────────────────────────────────────────────────────
  search = signal('');
  roleFilter = signal<NonOwnerRole | ''>('');
  statusFilter = signal<'' | 'active' | 'inactive'>('');
  sortField = signal<SortField>('last_name');
  sortDir = signal<'asc' | 'desc'>('asc');
  pageSize = signal(10);
  currentPage = signal(1);

  readonly PAGE_SIZES = [10, 25, 50];

  // ── Derived ───────────────────────────────────────────────────────────
  filtered = computed(() => {
    const q = this.search().toLowerCase().trim();
    const role = this.roleFilter();
    const status = this.statusFilter();

    return this.allUsers().filter((u) => {
      const matchSearch =
        !q ||
        [u.employee_id, u.first_name, u.last_name, u.username].some((v) =>
          v.toLowerCase().includes(q),
        );
      const matchRole = !role || u.role === role;
      const matchStatus = !status || (status === 'active' ? u.is_active : !u.is_active);
      return matchSearch && matchRole && matchStatus;
    });
  });

  sorted = computed(() => {
    const field = this.sortField();
    const dir = this.sortDir();
    return [...this.filtered()].sort((a, b) => {
      const av = String(a[field] ?? '').toLowerCase();
      const bv = String(b[field] ?? '').toLowerCase();
      return dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
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
    const total = this.totalPages();
    const cur = this.currentPage();
    const pages: (number | '...')[] = [];
    for (let i = 1; i <= total; i++) {
      if (i === 1 || i === total || Math.abs(i - cur) <= 1) pages.push(i);
      else if (pages[pages.length - 1] !== '...') pages.push('...');
    }
    return pages;
  });

  // ── Modal state ───────────────────────────────────────────────────────
  showModal = signal(false);
  showDeleteModal = signal(false);
  editingUser = signal<User | null>(null);
  deletingUser = signal<User | null>(null);

  readonly SUFFIXES = NAME_SUFFIXES;
  readonly ROLES = USER_ROLES;
  // Generated passwords are the employee's last name (client request), so this has to
  // allow short surnames like "Go" or "Uy".
  readonly PASSWORD_MIN_LENGTH = 2;

  form: FormGroup = this.fb.group({
    employee_id: ['', Validators.required],
    username: ['', Validators.required],
    password: ['', Validators.minLength(this.PASSWORD_MIN_LENGTH)],
    role: ['conductor', Validators.required],
    first_name: ['', Validators.required],
    middle_name: [''],
    last_name: ['', Validators.required],
    suffix: [''],
    email: ['', [Validators.required, Validators.email]],
    // Optional, but when given it must be an 11-digit mobile number.
    contact_number: ['', Validators.pattern(/^\d{11}$/)],
    is_active: [true],
  });

  ngOnInit(): void {
    this.loadUsers();
    this.form.get('first_name')!.valueChanges.subscribe(() => this.suggestCredentials());
    this.form.get('last_name')!.valueChanges.subscribe(() => this.suggestCredentials());
  }

  // ── Generated credentials (new users only) ────────────────────────────
  /** Next employee number following the highest existing one, keeping its prefix and
   *  zero-padding (e.g. EMP-0007 -> EMP-0008). */
  nextEmployeeId(): string {
    let best: { prefix: string; num: number; width: number } | null = null;
    for (const u of this.allUsers()) {
      const m = /^(.*?)(\d+)$/.exec(u.employee_id ?? '');
      if (!m) continue;
      const num = Number(m[2]);
      if (!best || num > best.num) best = { prefix: m[1], num, width: m[2].length };
    }
    if (!best) return 'EMP-0001';
    return `${best.prefix}${String(best.num + 1).padStart(best.width, '0')}`;
  }

  /** Fills username (first initial + last name) and password (last name) from the name
   *  fields, but only while the owner hasn't typed into those fields themselves. */
  private suggestCredentials(): void {
    if (this.editingUser()) return;
    const letters = (v: unknown) =>
      String(v ?? '')
        .toLowerCase()
        .replace(/[^a-z]/g, '');
    const first = letters(this.form.get('first_name')!.value);
    const last = letters(this.form.get('last_name')!.value);

    const username = this.form.get('username')!;
    if (!username.dirty) {
      username.setValue(last ? this.uniqueUsername(`${first.charAt(0)}${last}`) : '');
    }
    const password = this.form.get('password')!;
    if (!password.dirty) password.setValue(last);
  }

  private uniqueUsername(base: string): string {
    const taken = new Set(this.allUsers().map((u) => u.username.toLowerCase()));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}${n}`)) n++;
    return `${base}${n}`;
  }

  loadUsers(): void {
    this.loading.set(true);
    this.http.get<User[]>(this.API, { withCredentials: true }).subscribe({
      next: (data) => {
        this.allUsers.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  // ── Toolbar actions ───────────────────────────────────────────────────
  onSearch(e: Event): void {
    this.search.set((e.target as HTMLInputElement).value);
    this.currentPage.set(1);
  }

  onRoleFilter(e: Event): void {
    this.roleFilter.set((e.target as HTMLSelectElement).value as NonOwnerRole | '');
    this.currentPage.set(1);
  }

  onStatusFilter(e: Event): void {
    this.statusFilter.set((e.target as HTMLSelectElement).value as '' | 'active' | 'inactive');
    this.currentPage.set(1);
  }

  setSort(field: SortField): void {
    if (this.sortField() === field) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortField.set(field);
      this.sortDir.set('asc');
    }
    this.currentPage.set(1);
  }

  sortIcon(field: SortField): string {
    if (this.sortField() !== field) return 'pi-sort';
    return this.sortDir() === 'asc' ? 'pi-sort-up' : 'pi-sort-down';
  }

  // Pagination output handlers (called from TablePagination outputs)
  setPage(page: number): void {
    this.currentPage.set(page);
  }

  onPageSizeChange(size: number): void {
    this.pageSize.set(size);
    this.currentPage.set(1);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────
  openAdd(): void {
    this.editingUser.set(null);
    this.form.reset({ role: 'conductor', is_active: true, employee_id: this.nextEmployeeId() });
    this.form
      .get('password')!
      .setValidators([Validators.required, Validators.minLength(this.PASSWORD_MIN_LENGTH)]);
    this.form.get('password')!.updateValueAndValidity();
    this.showModal.set(true);
  }

  openEdit(user: User): void {
    this.editingUser.set(user);
    this.form.patchValue({ ...user, password: '' });
    this.form.get('password')!.setValidators(Validators.minLength(this.PASSWORD_MIN_LENGTH));
    this.form.get('password')!.updateValueAndValidity();
    this.showModal.set(true);
  }

  closeModal(): void {
    this.showModal.set(false);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const payload = { ...this.form.value };
    if (!payload.password) delete payload.password;
    const editing = this.editingUser();
    const req = editing
      ? this.http.put<User>(`${this.API}/${editing.id}`, payload, { withCredentials: true })
      : this.http.post<User>(this.API, payload, { withCredentials: true });
    req.subscribe({
      next: () => {
        this.alertService.success('Saved', editing ? 'User updated.' : 'User created.');
        this.closeModal();
        this.loadUsers();
      },
      error: (err) =>
        this.alertService.error('Error', err.error?.message ?? 'Something went wrong.'),
    });
  }

  confirmDelete(user: User): void {
    this.deletingUser.set(user);
    this.showDeleteModal.set(true);
  }
  cancelDelete(): void {
    this.showDeleteModal.set(false);
  }

  deleteUser(): void {
    const user = this.deletingUser();
    if (!user) return;
    this.http.delete(`${this.API}/${user.id}`, { withCredentials: true }).subscribe({
      next: () => {
        this.alertService.success('Deleted', 'User removed.');
        this.showDeleteModal.set(false);
        this.loadUsers();
      },
      error: (err) =>
        this.alertService.error('Error', err.error?.message ?? 'Could not delete user.'),
    });
  }

  fieldError(field: string): boolean {
    const c = this.form.get(field);
    return !!(c?.invalid && c?.touched);
  }

  roleLabel(role: string): string {
    return this.ROLES.find((r) => r.value === role)?.label ?? role;
  }
}
