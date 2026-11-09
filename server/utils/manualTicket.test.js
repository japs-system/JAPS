const test = require("node:test");
const assert = require("node:assert/strict");
const { toManualTicketRow } = require("./manualTicket");

test("formats a manual trip as a ticket range with trip collection and passenger total", () => {
  const bus = { id: 2, bus_number: "BUS-2", plate_number: "ABC-002" };
  const route = { id: 3, origin: "A", destination: "B", distance_km: "45.50" };
  const driver = { id: 4, first_name: "D", last_name: "Driver" };
  const conductor = { id: 5, first_name: "C", last_name: "Conductor" };

  assert.deepEqual(
    toManualTicketRow({
      id: 10,
      ticket_number_start: "1",
      ticket_number_end: "45",
      grand_total: "1234.50",
      updatedAt: "2026-11-09T12:00:00.000Z",
      trip_number: 6,
      departure_time: "2026-11-09T00:00:00.000Z",
      BusModel: bus,
      Route: route,
      driver,
      conductor,
    }),
    {
      id: -10,
      ticket_number: "1-45",
      category: null,
      passengers: null,
      passenger_count: 45,
      manual_passenger_count: 45,
      is_manual: true,
      distance_km: 45.5,
      fare: 1234.5,
      issued_at: "2026-11-09T12:00:00.000Z",
      Trip: {
        id: 10,
        trip_number: 6,
        departure_time: "2026-11-09T00:00:00.000Z",
        BusModel: bus,
        Route: route,
        driver,
        conductor,
      },
    },
  );
});
