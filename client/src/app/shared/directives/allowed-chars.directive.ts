import { Directive, ElementRef, inject, input } from '@angular/core';
import { NgControl } from '@angular/forms';

export type AllowedChars = 'name' | 'digits' | 'username' | 'code';

// Characters that are NOT allowed for each kind of field.
const DISALLOWED: Record<AllowedChars, RegExp> = {
  // Person names: letters (incl. ñ and accents), spaces, period, apostrophe, hyphen.
  name: /[^\p{L} .'\-]/gu,
  digits: /\D/g,
  username: /[^A-Za-z0-9_.]/g,
  // IDs such as EMP-0001.
  code: /[^A-Za-z0-9\-]/g,
};

/** Strips characters that don't belong in a text field as they are typed or pasted,
 *  e.g. `<input formControlName="first_name" appAllowedChars="name" />`. */
@Directive({
  selector: 'input[appAllowedChars]',
  host: { '(input)': 'onInput()' },
})
export class AllowedCharsDirective {
  appAllowedChars = input.required<AllowedChars>();

  private el = inject<ElementRef<HTMLInputElement>>(ElementRef);
  private ngControl = inject(NgControl, { optional: true });

  onInput(): void {
    const input = this.el.nativeElement;
    const clean = input.value.replace(DISALLOWED[this.appAllowedChars()], '');
    if (clean === input.value) return;
    input.value = clean;
    this.ngControl?.control?.setValue(clean);
  }
}
