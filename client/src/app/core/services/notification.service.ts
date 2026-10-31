import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { EMPTY, Subject, Subscription, fromEvent, merge, timer } from 'rxjs';
import { catchError, filter, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

export interface AppNotification {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

/** How often to check for new notifications while the tab is visible. */
const POLL_INTERVAL_MS = 10_000;

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private http = inject(HttpClient);
  private readonly API = `${environment.apiUrl}/api/notifications`;

  items = signal<AppNotification[]>([]);
  unreadCount = signal(0);

  private sub?: Subscription;
  private refresh$ = new Subject<void>();

  /**
   * Starts checking for notifications. A check runs:
   *  - immediately, then every 10 seconds (skipped while the tab is hidden)
   *  - when the user comes back to the tab / window
   *  - whenever refresh() is called (e.g. when the bell is opened)
   * Safe to call twice.
   */
  start(): void {
    if (this.sub) return;
    this.sub = merge(
      timer(0, POLL_INTERVAL_MS),
      this.refresh$,
      fromEvent(document, 'visibilitychange'),
      fromEvent(window, 'focus'),
    )
      .pipe(
        filter(() => !document.hidden),
        switchMap(() =>
          this.http
            .get<{ items: AppNotification[]; unreadCount: number }>(this.API, {
              withCredentials: true,
            })
            .pipe(catchError(() => EMPTY)),
        ),
      )
      .subscribe((res) => {
        this.items.set(res.items);
        this.unreadCount.set(res.unreadCount);
      });
  }

  stop(): void {
    this.sub?.unsubscribe();
    this.sub = undefined;
    this.items.set([]);
    this.unreadCount.set(0);
  }

  /** Check for new notifications right now. */
  refresh(): void {
    this.refresh$.next();
  }

  /** Keeps unread items plus enough read ones to fill the minimum list size. */
  private static readonly MIN_SHOWN = 5;
  private trim(list: AppNotification[]): AppNotification[] {
    const unread = list.filter((x) => !x.read_at);
    const read = list.filter((x) => x.read_at).slice(0, Math.max(0, NotificationService.MIN_SHOWN - unread.length));
    return [...unread, ...read].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );
  }

  markRead(n: AppNotification): void {
    if (n.read_at) return; // already read: nothing to do, it just stays in the list
    const now = new Date().toISOString();
    // Mark it read right away but keep it in the list; it is marked read on the server too.
    this.items.update((list) => this.trim(list.map((x) => (x.id === n.id ? { ...x, read_at: now } : x))));
    this.unreadCount.update((c) => Math.max(0, c - 1));
    this.http
      .put(`${this.API}/${n.id}/read`, {}, { withCredentials: true })
      .pipe(catchError(() => EMPTY))
      .subscribe();
  }

  markAllRead(): void {
    const now = new Date().toISOString();
    this.items.update((list) => this.trim(list.map((x) => (x.read_at ? x : { ...x, read_at: now }))));
    this.unreadCount.set(0);
    this.http
      .put(`${this.API}/read-all`, {}, { withCredentials: true })
      .pipe(catchError(() => EMPTY))
      .subscribe();
  }
}