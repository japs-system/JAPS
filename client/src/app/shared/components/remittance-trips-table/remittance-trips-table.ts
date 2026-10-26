import { Component, input, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { TicketPassengerLine, ticketPassengerSummary } from '../../models/ticket.models';

export interface RemittanceTicket {
  id: number;
  ticket_number: string;
  category: string | null;
  passengers: TicketPassengerLine[] | null;
  passenger_count: number | null;
  boarding_point: string | null;
  dropping_point: string | null;
  distance_km: number;
  fare: number;
  issued_at: string;
}

export interface RemittanceTrip {
  id: number;
  trip_number: number;
  departure_time: string;
  grand_total: number;
  ticket_number_start: string | null;
  ticket_number_end: string | null;
  Route: { origin: string; destination: string } | null;
  // Undefined while the tickets are still being loaded.
  Tickets?: RemittanceTicket[];
}

/** The trips of a remittance; clicking a trip lists every ticket issued on it. */
@Component({
  selector: 'app-remittance-trips-table',
  imports: [CurrencyPipe, DatePipe],
  templateUrl: './remittance-trips-table.html',
})
export class RemittanceTripsTable {
  trips = input.required<RemittanceTrip[]>();

  expandedTripId = signal<number | null>(null);

  toggleTripTickets(tripId: number): void {
    this.expandedTripId.update((id) => (id === tripId ? null : tripId));
  }

  /** e.g. "1 Regular · 2 Student" (group tickets and older single-passenger ones). */
  passengerSummary(t: RemittanceTicket): string {
    return ticketPassengerSummary(t);
  }
}
