import { Component, HostListener, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { AlertModal } from './shared/components/alert-modal/alert-modal';

const isNumberInput = (el: EventTarget | null): el is HTMLInputElement =>
  el instanceof HTMLInputElement && el.type === 'number';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AlertModal],
  templateUrl: './app.html',
})
export class App {
  protected readonly title = signal('client');

  /** Numeric fields start at 0 — select their contents on focus so typing replaces
   *  the 0 instead of appending to it (e.g. "05"). */
  @HostListener('document:focusin', ['$event.target'])
  selectNumberOnFocus(target: EventTarget | null): void {
    if (isNumberInput(target)) target.select();
  }

  /** Stop the mouse wheel from silently changing a focused number field while the
   *  user scrolls the page. */
  @HostListener('document:wheel', ['$event.target'])
  blurNumberOnWheel(target: EventTarget | null): void {
    if (isNumberInput(target) && document.activeElement === target) target.blur();
  }
}
