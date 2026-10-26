import { Injectable, signal } from '@angular/core';
import { AlertType, AlertConfig } from '../../shared/models/alert.models';

export type { AlertType, AlertConfig };

@Injectable({ providedIn: 'root' })
export class AlertService {
  private _config = signal<AlertConfig | null>(null);
  readonly config = this._config.asReadonly();

  show(config: AlertConfig): void {
    this._config.set(config);
  }

  success(title: string, message: string, confirmText?: string): void {
    this.show({ type: 'success', title, message, confirmText });
  }

  error(title: string, message: string, confirmText?: string): void {
    this.show({ type: 'error', title, message, confirmText });
  }

  warning(title: string, message: string, confirmText?: string): void {
    this.show({ type: 'warning', title, message, confirmText });
  }

  info(title: string, message: string, confirmText?: string): void {
    this.show({ type: 'info', title, message, confirmText });
  }

  close(): void {
    this._config.set(null);
  }
}
