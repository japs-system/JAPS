const {
  Trip,
  BusModel,
  Route,
  User,
  Remittance,
  RemittanceExpense,
  Ticket,
} = require("../../models");

// Loads one remittance with everything a detail view shows: bus, crew, approver,
// expenses, and its trips with every ticket issued on them (sorted by ticket number).
// `where` scopes the lookup to the caller, e.g. { id, conductor_id }. Resolves to null
// when nothing matches.
const findRemittanceDetail = async (where) => {
  const remittance = await Remittance.findOne({
    where,
    include: [
      { model: BusModel, attributes: ["id", "bus_number", "plate_number"] },
      {
        model: User,
        as: "driver",
        attributes: ["id", "first_name", "last_name", "employee_id"],
      },
      {
        model: User,
        as: "conductor",
        attributes: ["id", "first_name", "last_name", "employee_id"],
      },
      {
        model: User,
        as: "approver",
        attributes: ["id", "first_name", "last_name"],
      },
      {
        model: RemittanceExpense,
        attributes: ["id", "expense_type", "amount"],
      },
      {
        model: Trip,
        attributes: [
          "id",
          "trip_number",
          "departure_time",
          "grand_total",
          "ticket_number_start",
          "ticket_number_end",
        ],
        include: [
          { model: Route, attributes: ["origin", "destination"] },
          {
            model: Ticket,
            attributes: [
              "id",
              "ticket_number",
              "category",
              "passengers",
              "passenger_count",
              "boarding_point",
              "boarding_km",
              "dropping_point",
              "dropping_km",
              "distance_km",
              "fare",
              "issued_at",
            ],
          },
        ],
      },
    ],
  });
  if (!remittance) return null;

  for (const trip of remittance.Trips) {
    trip.Tickets.sort((a, b) => Number(a.ticket_number) - Number(b.ticket_number));
  }
  return remittance;
};

module.exports = { findRemittanceDetail };
