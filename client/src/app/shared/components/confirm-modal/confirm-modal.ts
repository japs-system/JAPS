import { Component, input, output } from '@angular/core';

export type ConfirmVariant = 'default' | 'danger';

@Component({
  selector: 'app-confirm-modal',
  imports: [],
  templateUrl: './confirm-modal.html',
})
export class ConfirmModal {
  open = input.required<boolean>();
  title = input<string>('Confirm');
  message = input<string>('');
  confirmText = input<string>('Confirm');
  cancelText = input<string>('Cancel');
  icon = input<string>('pi-question-circle');
  variant = input<ConfirmVariant>('default');

  confirm = output<void>();
  cancel = output<void>();
}
