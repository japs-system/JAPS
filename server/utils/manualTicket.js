const toManualTicketRow = (trip) => {
  const start = Number(trip.ticket_number_start);
  const end = Number(trip.ticket_number_end);
  const passengerCount = Math.max(0, end - start + 1);

  return {
    id: -trip.id,
    ticket_number: `${trip.ticket_number_start}-${trip.ticket_number_end}`,
    category: null,
    passengers: null,
    passenger_count: passengerCount,
    manual_passenger_count: passengerCount,
    is_manual: true,
    distance_km: Number(trip.Route?.distance_km ?? 0),
    fare: Number(trip.grand_total),
    issued_at: trip.updatedAt ?? trip.actual_departure_time ?? trip.departure_time,
    Trip: {
      id: trip.id,
      trip_number: trip.trip_number,
      departure_time: trip.departure_time,
      BusModel: trip.BusModel,
      Route: trip.Route,
      driver: trip.driver,
      conductor: trip.conductor,
    },
  };
};

module.exports = { toManualTicketRow };
