import { Directive, ElementRef, Input, inject } from '@angular/core';

/** Keeps number inputs to plain non-negative numbers: digits and a decimal point only.
 *  Browsers otherwise let "e", "+" and "-" (and, in some, any character) be typed into
 *  `type="number"` fields. Applies automatically to every number input of a component
 *  that imports it.
 *
 *  Optional digit limits, e.g. `<input type="number" [maxWhole]="4" [maxDecimals]="2" />`
 *  allow at most 4 digits before the decimal point and 2 after it (up to 9999.99).
 *  A keystroke or paste that would exceed a limit is rejected and the previous value
 *  is kept. Inputs without these attributes behave exactly as before. */
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
  /** Maximum digits before the decimal point (no limit when omitted). */
  @Input() maxWhole?: number;
  /** Maximum digits after the decimal point (no limit when omitted). */
  @Input() maxDecimals?: number;

  private readonly el = inject<ElementRef<HTMLInputElement>>(ElementRef).nativeElement;
  private lastValid = '';

  rememberValue(): void {
    this.lastValid = this.el.value;
  }

  onKeydown(e: KeyboardEvent): void {
    // Shortcuts (copy/paste/select all) and control keys (Backspace, arrows, Tab…) pass.
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (!/[0-9.]/.test(e.key)) e.preventDefault();
    if (e.key === '.' && this.maxDecimals === 0) e.preventDefault();
  }

  onPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text').trim() ?? '';
    if (!/^\d*\.?\d*$/.test(text)) e.preventDefault();
  }

  /** Reverts to the last accepted value when typing or pasting exceeds a digit limit. */
  onInput(): void {
    const value = this.el.value;
    if (value === '') return;
    if (this.exceedsLimits(value)) {
      this.el.value = this.lastValid;
      // Let the form control pick up the restored value.
      this.el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    this.lastValid = value;
  }

  private exceedsLimits(value: string): boolean {
    const [whole, decimals = ''] = value.split('.');
    const wholeDigits = whole.replace(/^0+(?=\d)/, '').length;
    if (this.maxWhole != null && wholeDigits > this.maxWhole) return true;
    if (this.maxDecimals != null && decimals.length > this.maxDecimals) return true;
    return false;
  }
}