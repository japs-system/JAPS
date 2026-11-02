
import { Directive, ElementRef, Input, inject } from '@angular/core';

/**
 * Restricts number inputs to non-negative decimal numbers.
 * Optional limits:
 * maxWhole = maximum digits before decimal
 * maxDecimals = maximum digits after decimal
 */
@Directive({
  selector: 'input[type=number]',
  host: {
    '(keydown)': 'onKeydown($event)',
    '(paste)': 'onPaste($event)',
    '(focus)': 'rememberValue()',
    '(input)': 'onInput()',
  },
})
export class NumericInput {
  @Input() maxWhole?: number;
  @Input() maxDecimals?: number;

  private readonly el =
    inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;

  private lastValid = '';

  rememberValue(): void {
    this.lastValid = this.el.value;
  }

  onKeydown(e: KeyboardEvent): void {
    // Allow shortcuts and navigation keys.
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;

    // Only allow digits and decimal point.
    if (!/[0-9.]/.test(e.key)) {
      e.preventDefault();
      return;
    }

    if (e.key === '.' && (this.maxDecimals === 0 || this.el.value.includes('.'))) {
      e.preventDefault();
    }
  }

  onPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text').trim() ?? '';

    if (!/^\d+(\.\d+)?$/.test(text)) {
      e.preventDefault();
      return;
    }

    if (this.exceedsLimits(text)) {
      e.preventDefault();
    }
  }

  onInput(): void {
    const value = this.el.value;

    if (value === '') {
      this.lastValid = '';
      return;
    }

    if (this.exceedsLimits(value)) {
      this.el.value = this.lastValid;

      // Synchronize with Angular form control.
      this.el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }

    this.lastValid = value;
  }

  private exceedsLimits(value: string): boolean {
    if (!/^\d*\.?\d*$/.test(value)) return true;

    const [whole, decimals = ''] = value.split('.');

    const wholeDigits = whole.replace(/^0+(?=\d)/, '').length;

    if (this.maxWhole != null && wholeDigits > this.maxWhole) {
      return true;
    }

    if (this.maxDecimals != null && decimals.length > this.maxDecimals) {
      return true;
    }

    return false;
  }
}
