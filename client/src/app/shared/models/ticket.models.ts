/** One category line on a group ticket (mirrors the server's Ticket.passengers). */
export interface TicketPassengerLine {
  category: string;
  quantity: number;
  unit_fare: number;
  subtotal: number;
}

/** The ticket fields needed to describe who travelled on it. */
export interface TicketPassengerFields {
  category: string | null;
  passengers?: TicketPassengerLine[] | null;
  passenger_count?: number | null;
  fare: number | string;
}

export const PASSENGER_CATEGORY_LABELS: Record<string, string> = {
  regular: 'Regular',
  student: 'Student',
  senior_citizen: 'Senior Citizen',
  pwd: 'PWD',
  discounted: 'Discounted',
};

export const passengerCategoryLabel = (category: string): string =>
  PASSENGER_CATEGORY_LABELS[category] ?? category;

/** Passenger lines for a ticket. Tickets issued before group ticketing have no
 *  `passengers` and describe exactly one passenger of `category`. */
export function ticketPassengers(t: TicketPassengerFields): TicketPassengerLine[] {
  if (t.passengers?.length) return t.passengers;
  const fare = Number(t.fare);
  return [{ category: t.category ?? 'regular', quantity: 1, unit_fare: fare, subtotal: fare }];
}

export const ticketPassengerCount = (t: TicketPassengerFields): number =>
  t.passenger_count ?? ticketPassengers(t).reduce((sum, l) => sum + l.quantity, 0);

/** e.g. "1 Regular · 2 Student" */
export const ticketPassengerSummary = (t: TicketPassengerFields): string =>
  ticketPassengers(t)
    .map((l) => `${l.quantity} ${passengerCategoryLabel(l.category)}`)
    .join(' · ');
