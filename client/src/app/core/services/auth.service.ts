import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, finalize } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser, LoginResponse } from '../../shared/models/auth.models';
import { DashboardRangeService } from './dashboard-range.service';

export type { AuthUser, LoginResponse };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly API = `${environment.apiUrl}/api/auth`;

  // In-memory only — never written to localStorage/sessionStorage
  private _user = signal<AuthUser | null>(null);

  private dashboardRange = inject(DashboardRangeService);

  constructor(private http: HttpClient) {}

  login(username: string, password: string): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${this.API}/login`, { username, password }, { withCredentials: true })
      .pipe(
        tap(() => {
          // Cookie is now set — user details will be loaded via fetchMe() after redirect
          this._user.set(null);
          // New session → start without a dashboard range.
          this.dashboardRange.reset();
        }),
      );
  }

  logout(): Observable<void> {
    return this.http
      .post<void>(`${this.API}/logout`, {}, { withCredentials: true })
      .pipe(
        tap(() => this._user.set(null)),
        // Clear the chosen dashboard range on logout, even if the request fails.
        finalize(() => this.dashboardRange.reset()),
      );
  }

  /** Fetch the current user from the server using the httpOnly cookie. */
  fetchMe(): Observable<AuthUser | null> {
    return this.http.get<AuthUser>(`${this.API}/me`, { withCredentials: true }).pipe(
      tap((user) => this._user.set(user)),
      catchError(() => {
        this._user.set(null);
        return of(null);
      }),
    );
  }

  getUser(): AuthUser | null {
    return this._user();
  }

  isLoggedIn(): boolean {
    return this._user() !== null;
  }
}