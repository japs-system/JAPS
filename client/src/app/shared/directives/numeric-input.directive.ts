import { Directive } from '@angular/core';

/** Keeps number inputs to plain non-negative numbers: digits and a decimal point only.
 *  Browsers otherwise let "e", "+" and "-" (and, in some, any character) be typed into
 *  `type="number"` fields. Applies automatically to every number input of a component
 *  that imports it. */
@Directive({
  selector: 'input[type=number]',
  host: {
    '(keydown)': 'onKeydown($event)',
    '(paste)': 'onPaste($event)',
  },
})
export class NumericInput {
  onKeydown(e: KeyboardEvent): void {
    // Shortcuts (copy/paste/select all) and control keys (Backspace, arrows, Tab…) pass.
    if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
    if (!/[0-9.]/.test(e.key)) e.preventDefault();
  }

  onPaste(e: ClipboardEvent): void {
    const text = e.clipboardData?.getData('text').trim() ?? '';
    if (!/^\d*\.?\d*$/.test(text)) e.preventDefault();
  }
}
