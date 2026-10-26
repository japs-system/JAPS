export type AlertType = 'success' | 'error' | 'warning' | 'info';

export interface AlertConfig {
  type: AlertType;
  title: string;
  message: string;
  confirmText?: string;
}
