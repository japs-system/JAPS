import { AfterViewInit, Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule],
  templateUrl: './login-page.html',
})
export class LoginPage implements AfterViewInit {
  loginForm: FormGroup;
  loading = signal(false);
  showPassword = signal(false);
  errorMessage = signal<string | null>(null);
  capsLockOn = signal(false);

  @ViewChild('usernameInput') private usernameInput?: ElementRef<HTMLInputElement>;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router,
  ) {
    this.loginForm = this.fb.group({
      username: ['', Validators.required],
      password: ['', Validators.required],
    });

    // Clear the sign-in error as soon as the user edits either field.
    this.loginForm.valueChanges.subscribe(() => {
      if (this.errorMessage()) this.errorMessage.set(null);
    });
  }

  ngAfterViewInit(): void {
    this.usernameInput?.nativeElement.focus();
  }

  togglePassword(): void {
    this.showPassword.update((v) => !v);
  }

  checkCapsLock(event: KeyboardEvent): void {
    this.capsLockOn.set(event.getModifierState?.('CapsLock') ?? false);
  }

  onSubmit(): void {
    if (this.loading()) return; // ignore a second Enter / click while signing in

    if (this.loginForm.invalid) {
      this.loginForm.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    const { username, password } = this.loginForm.value;

    this.authService.login(username, password).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.router.navigateByUrl(res.redirectUrl);
      },
      error: (err) => {
        this.loading.set(false);
        this.errorMessage.set(
          err.status === 0
            ? 'Cannot reach the server. Check your connection and try again.'
            : (err.error?.message ?? 'Invalid username or password. Please try again.'),
        );
      },
    });
  }
}