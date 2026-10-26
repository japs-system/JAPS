const { Op } = require("sequelize");
const {
  Trip,
  BusModel,
  Route,
  RouteStop,
  FareSettings,
  User,
  PassengerCount,
  Ticket,
  Remittance,
  RemittanceExpense,
  sequelize,
} = require("../models");
const EXPENSE_TYPES = require("../models/expenseTypes");
const {
  fullName,
  sendRemittanceSubmittedEmail,
  sendRemittanceReceiptEmail,
} = require("../config/mailer");

const { findRemittanceDetail } = require("../services/remittance/findRemittanceDetail");
const {
  createNotification,
  notifyOwners,
  notifyRoles,
} = require("../services/notificationService");

// Fire-and-forget wrapper: a failed email/notification must never break the real action.
const notify = (promise) => promise.catch((err) => console.error("Notification failed:", err));

const peso = (n) =>
  `₱${Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Emails the conductor a confirmation + summary of the remittance they just (re)submitted.
const notifyConductorOfSubmission = (remittance, isResubmission) =>
  notify(
    (async () => {
      const [bus, conductor] = await Promise.all([
        BusModel.findByPk(remittance.bus_id),
        User.findByPk(remittance.conductor_id),
      ]);
      if (!conductor?.email) return;
      await sendRemittanceReceiptEmail({
        to: conductor.email,
        name: fullName(conductor),
        busLabel: bus?.bus_number ?? String(remittance.bus_id),
        remittance,
        isResubmission,
      });
    })(),
  );

// ── In-app notifications ────────────────────────────────────────────────────

const TRIP_EVENTS = {
  ongoing: { type: "trip_started", title: "Trip started", verb: "started" },
  completed: { type: "trip_completed", title: "Trip completed", verb: "completed" },
  cancelled: { type: "trip_cancelled", title: "Trip cancelled", verb: "cancelled" },
};

// Tells the owner(s) when a trip starts, completes or is cancelled.
const notifyOwnersOfTrip = (trip, status, conductorId) =>
  notify(
    (async () => {
      const event = TRIP_EVENTS[status];
      if (!event) return;

      const [full, conductor] = await Promise.all([
        Trip.findByPk(trip.id, {
          include: [
            { model: BusModel, attributes: ["bus_number"] },
            { model: Route, attributes: ["origin", "destination"] },
          ],
        }),
        User.findByPk(conductorId),
      ]);

      const route = full?.Route ? `${full.Route.origin} → ${full.Route.destination}` : "";
      const bus = full?.BusModel?.bus_number ?? trip.bus_id;

      let extra = "";
      if (status === "ongoing" && trip.actual_departure_time && trip.departure_time) {
        const late = Math.round(
          (new Date(trip.actual_departure_time) - new Date(trip.departure_time)) / 60000,
        );
        if (late >= 15) extra = ` It left ${late} min late.`;
      }
      if (status === "completed") extra = ` Revenue ${peso(trip.grand_total)}.`;

      await notifyOwners({
        type: event.type,
        title: `${event.title}: Trip #${trip.trip_number}`,
        message: `${conductor ? fullName(conductor) : "A conductor"} ${event.verb} trip #${trip.trip_number}${route ? ` (${route})` : ""} on Bus ${bus}.${extra}`,
        link: "/owner/schedules",
      });
    })(),
  );

// Tells the owner(s) and audit teller(s) that a remittance needs review.
const notifyReviewersOfSubmission = (remittance, isResubmission) =>
  notify(
    (async () => {
      const [bus, conductor] = await Promise.all([
        BusModel.findByPk(remittance.bus_id),
        User.findByPk(remittance.conductor_id),
      ]);
      const payload = {
        type: isResubmission ? "remittance_resubmitted" : "remittance_submitted",
        title: isResubmission ? "Remittance resubmitted" : "Remittance submitted",
        message: `${conductor ? fullName(conductor) : "A conductor"} ${isResubmission ? "resubmitted" : "submitted"} the remittance for Bus ${bus?.bus_number ?? remittance.bus_id} (${remittance.date}). Net collection ${peso(remittance.net_collection)}.`,
      };
      await notifyOwners({ ...payload, link: `/owner/remittances/${remittance.id}` });
      await notifyRoles(["audit_teller"], {
        ...payload,
        link: `/audit-teller/remittances/${remittance.id}`,
      });
    })(),
  );

// GET /api/conductor/trips
// Returns completed unremitted trips for a bus on a date (for remittance submission).
// With includeOpen=1 it also returns that day's scheduled/ongoing trips, so a conductor
// who didn't use ticketing can remit them with manually encoded counts. Each trip then
// carries `ticket_count` so the client knows which ones need manual entry.
const getAssignedTrips = async (req, res) => {
  try {
    const conductorId = req.user.id;
    const { date, busId, includeOpen } = req.query;
    const withOpen = includeOpen === "1" || includeOpen === "true";

    // If date + busId provided, return unremitted trips for that bus/date
    if (date && busId) {
      const trips = await Trip.findAll({
        attributes: {
          include: [
            [
              sequelize.literal(
                '(SELECT COUNT(*) FROM tickets AS tk WHERE tk.trip_id = "Trip"."id")',
              ),
              "ticket_count",
            ],
          ],
        },
        where: {
          bus_id: busId,
          conductor_id: conductorId,
          status: withOpen ? ["scheduled", "ongoing", "completed"] : "completed",
          remittance_id: null,
          departure_time: {
            [Op.gte]: new Date(date + "T00:00:00"),
            [Op.lt]: new Date(
              new Date(date).getTime() + 24 * 60 * 60 * 1000,
            ).toISOString(),
          },
        },
        include: [
          { model: BusModel, attributes: ["id", "bus_number", "plate_number"] },
          { model: Route, attributes: ["id", "origin", "destination"] },
          {
            model: User,
            as: "driver",
            attributes: ["id", "first_name", "last_name"],
          },
          {
            model: User,
            as: "conductor",
            attributes: ["id", "first_name", "last_name"],
          },
        ],
        order: [["departure_time", "ASC"]],
      });
      return res.json(trips);
    }

    // Default: return all trips assigned to conductor
    const trips = await Trip.findAll({
      where: { conductor_id: conductorId },
      include: [
        {
          model: BusModel,
          attributes: ["id", "bus_number", "plate_number", "capacity"],
        },
        {
          model: Route,
          attributes: [
            "id",
            "origin",
            "destination",
            "distance_km",
          ],
        },
        {
          model: User,
          as: "driver",
          attributes: ["id", "first_name", "last_name", "employee_id"],
        },
      ],
      order: [["departure_time", "ASC"]],
    });
    return res.json(trips);
  } catch (error) {
    console.error("Error fetching assigned trips:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// PUT /api/conductor/trips/:id/status
// Update trip status (scheduled -> ongoing -> completed/cancelled)
const updateTripStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const conductorId = req.user.id;

    if (!["scheduled", "ongoing", "completed", "cancelled"].includes(status)) {
      return res.status(400).json({ message: "Invalid status." });
    }

    const trip = await Trip.findOne({
      where: { id, conductor_id: conductorId },
    });
    if (!trip) {
      return res
        .status(404)
        .json({ message: "Trip not found or not assigned to you." });
    }

    const updateData = { status };
    if (status === "ongoing") {
      updateData.actual_departure_time = new Date();
      // Enforce that the trip's scheduled date matches today
      if (trip.departure_time) {
        const tripDate = new Date(trip.departure_time);
        const today = new Date();
        const isSameDay =
          tripDate.getFullYear() === today.getFullYear() &&
          tripDate.getMonth() === today.getMonth() &&
          tripDate.getDate() === today.getDate();
        if (!isSameDay) {
          return res.status(400).json({
            message: `This trip is scheduled for ${tripDate.toDateString()} and cannot be started today.`,
          });
        }
      } else {
        // No departure_time yet — set it now (today's trip)
        updateData.departure_time = new Date();
      }

      // Enforce sequential order: no earlier scheduled trip on the same bus today
      const today = new Date();
      const dayStart = new Date(today);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(today);
      dayEnd.setHours(23, 59, 59, 999);

      const blockers = await Trip.findAll({
        where: {
          bus_id: trip.bus_id,
          conductor_id: conductorId,
          trip_number: { [Op.lt]: trip.trip_number },
          status: "scheduled",
          departure_time: { [Op.between]: [dayStart, dayEnd] },
        },
      });

      if (blockers.length > 0) {
        const blockingNums = blockers
          .map((b) => `#${b.trip_number}`)
          .join(", ");
        return res.status(400).json({
          message: `You must complete trip${blockers.length > 1 ? "s" : ""} ${blockingNums} before starting this one.`,
        });
      }
    } else if (status === "completed") {
      updateData.arrival_time = new Date();
    }

    await trip.update(updateData);
    notifyOwnersOfTrip(trip, status, conductorId);
    return res.json(trip);
  } catch (error) {
    console.error("Error updating trip status:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// GET /api/conductor/trips/:id/passenger-counts
const getTripPassengerCounts = async (req, res) => {
  try {
    const { id } = req.params;
    const conductorId = req.user.id;

    const trip = await Trip.findOne({
      where: { id, conductor_id: conductorId },
    });
    if (!trip) {
      return res.status(404).json({ message: "Trip not found." });
    }

    const counts = await PassengerCount.findAll({ where: { trip_id: id } });
    return res.json(counts);
  } catch (error) {
    console.error("Error fetching passenger counts:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// POST /api/conductor/trips/:id/passenger-counts
// Save/update passenger counts for a trip
const savePassengerCounts = async (req, res) => {
  try {
    const { id } = req.params;
    const { counts } = req.body; // Array of { category, count }
    const conductorId = req.user.id;

    const trip = await Trip.findOne({
      where: { id, conductor_id: conductorId },
    });
    if (!trip) {
      return res.status(404).json({ message: "Trip not found." });
    }

    // Delete existing passenger counts for this trip to overwrite
    await PassengerCount.destroy({ where: { trip_id: id } });

    const createdCounts = [];
    for (const item of counts) {
      const pc = await PassengerCount.create({
        trip_id: id,
        category: item.category,
        count: item.count,
      });
      createdCounts.push(pc);
    }

    return res.json(createdCounts);
  } catch (error) {
    console.error("Error saving passenger counts:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// Mirrors the discount-percent lookup in the client's autoCalculateFare() —
// kept in sync manually since there's no shared package between client/server.
const getDiscountPercent = (category, settings) => {
  switch (category) {
    case "regular":
      return Number(settings.regular_discount_percent);
    case "student":
      return Number(settings.student_discount_percent);
    case "senior_citizen":
      return Number(settings.senior_citizen_discount_percent);
    case "pwd":
      return Number(settings.pwd_discount_percent);
    case "discounted":
      return Number(settings.discounted_discount_percent);
    default:
      return 0;
  }
};

const PASSENGER_CATEGORIES = ["regular", "student", "senior_citizen", "pwd", "discounted"];

// Normalises a ticket request body into [{ category, quantity }] with quantity > 0.
// Accepts the group form `passengers: [{ category, quantity }]` and the legacy
// single-passenger form `category`. Returns null when the input is invalid.
const parsePassengerGroup = ({ passengers, category }) => {
  const raw = Array.isArray(passengers) ? passengers : category ? [{ category, quantity: 1 }] : [];
  const totals = new Map();
  for (const p of raw) {
    const quantity = Number(p?.quantity);
    if (!PASSENGER_CATEGORIES.includes(p?.category)) return null;
    if (!Number.isInteger(quantity) || quantity < 0) return null;
    if (quantity > 0) totals.set(p.category, (totals.get(p.category) ?? 0) + quantity);
  }
  if (totals.size === 0) return null;
  return [...totals].map(([cat, quantity]) => ({ category: cat, quantity }));
};

const findStopByKm = (stops, km) =>
  stops.find((s) => Math.abs(Number(s.km_from_origin) - Number(km)) < 0.01);

// GET /api/conductor/routes/:routeId/stops
// Read-only mirror of the owner's stops endpoint, reachable by a conductor
// session, so the ticketing page can populate its boarding/dropping dropdowns.
const getRouteStopsForConductor = async (req, res) => {
  const route = await Route.findByPk(req.params.routeId);
  if (!route) return res.status(404).json({ message: "Route not found." });

  const stops = await RouteStop.findAll({
    where: { route_id: route.id },
    order: [["km_from_origin", "ASC"]],
  });

  const merged = [
    { name: route.origin, km_from_origin: 0 },
    ...stops.map((s) => ({ name: s.name, km_from_origin: Number(s.km_from_origin) })),
    { name: route.destination, km_from_origin: Number(route.distance_km ?? 0) },
  ];

  return res.json(merged);
};

// POST /api/conductor/trips/:id/tickets
// Encode and print one ticket for a group of passengers travelling together
// (e.g. 1 student + 1 regular + 1 senior) — body: { boarding_km, dropping_km,
// passengers: [{ category, quantity }] }. Distance and fares are derived and
// verified server-side from the trip's route stops — the client only picks
// which two stops (by km_from_origin) the group boarded/alighted at.
const printTicket = async (req, res) => {
  const group = parsePassengerGroup(req.body);
  if (!group) {
    return res.status(400).json({
      message: "Add at least one passenger (whole numbers only, valid categories).",
    });
  }

  const transaction = await sequelize.transaction();
  try {
    const { id } = req.params;
    const { boarding_km, dropping_km } = req.body;
    const conductorId = req.user.id;

    const trip = await Trip.findOne({
      where: { id, conductor_id: conductorId },
      transaction,
    });
    if (!trip) {
      await transaction.rollback();
      return res.status(404).json({ message: "Trip not found." });
    }

    const route = await Route.findByPk(trip.route_id, { transaction });
    if (!route) {
      await transaction.rollback();
      return res.status(400).json({ message: "Trip has no route assigned." });
    }
    if (!(Number(route.distance_km) > 0)) {
      await transaction.rollback();
      return res.status(400).json({
        message: "This route has no distance configured. Ask the owner to set it before issuing tickets.",
      });
    }

    const routeStops = await RouteStop.findAll({
      where: { route_id: route.id },
      transaction,
    });
    const stops = [
      { name: route.origin, km_from_origin: 0 },
      ...routeStops.map((s) => ({
        name: s.name,
        km_from_origin: Number(s.km_from_origin),
      })),
      { name: route.destination, km_from_origin: Number(route.distance_km ?? 0) },
    ];

    const boardingStop = findStopByKm(stops, boarding_km);
    const droppingStop = findStopByKm(stops, dropping_km);
    if (!boardingStop || !droppingStop) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ message: "Invalid boarding/dropping point for this route." });
    }

    const distance_km = Math.abs(
      droppingStop.km_from_origin - boardingStop.km_from_origin,
    );
    if (distance_km <= 0) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ message: "Boarding and dropping point must be different." });
    }

    const fareSettings = await FareSettings.findOne({
      order: [["id", "DESC"]],
      transaction,
    });
    if (!fareSettings) {
      await transaction.rollback();
      return res.status(400).json({ message: "Fare settings not configured." });
    }

    const minFare = Number(fareSettings.minimum_fare);
    const baseDistanceKm = Number(fareSettings.base_distance_km);
    const ratePerKm = Number(fareSettings.rate_per_km);
    const baseFare =
      distance_km <= baseDistanceKm
        ? minFare
        : minFare + (distance_km - baseDistanceKm) * ratePerKm;

    const passengers = group.map(({ category, quantity }) => {
      const discountPercent = getDiscountPercent(category, fareSettings);
      const unitFare = parseFloat((baseFare * (1 - discountPercent / 100)).toFixed(2));
      return {
        category,
        quantity,
        unit_fare: unitFare,
        subtotal: parseFloat((unitFare * quantity).toFixed(2)),
      };
    });
    const fare = parseFloat(passengers.reduce((sum, p) => sum + p.subtotal, 0).toFixed(2));
    const passengerCount = passengers.reduce((sum, p) => sum + p.quantity, 0);

    // 1. Auto-generate ticket number (last for this trip + 1, starting at 1).
    // ticket_number is a STRING column, so order numerically rather than lexically.
    const lastTicket = await Ticket.findOne({
      where: { trip_id: id },
      order: [[sequelize.cast(sequelize.col("ticket_number"), "INTEGER"), "DESC"]],
      transaction,
    });
    const ticketNumber = lastTicket ? Number(lastTicket.ticket_number) + 1 : 1;

    // 2. Create one ticket record for the whole group
    const ticket = await Ticket.create(
      {
        trip_id: id,
        ticket_number: ticketNumber,
        category: passengers.length === 1 ? passengers[0].category : null,
        passengers,
        passenger_count: passengerCount,
        boarding_point: boardingStop.name,
        boarding_km: boardingStop.km_from_origin,
        dropping_point: droppingStop.name,
        dropping_km: droppingStop.km_from_origin,
        distance_km,
        fare,
        issued_at: new Date(),
      },
      { transaction },
    );

    // 3. Update Trip Grand Total
    const newGrandTotal = Number(trip.grand_total) + Number(fare);

    // 4. Update Ticket Number Range
    const ticketStart = trip.ticket_number_start ?? ticketNumber;
    const ticketEnd = ticketNumber;

    await trip.update(
      {
        grand_total: newGrandTotal,
        ticket_number_start: ticketStart,
        ticket_number_end: ticketEnd,
      },
      { transaction },
    );

    // 5. Increment the trip's passenger count for each category on the ticket
    const passengerCounts = [];
    for (const { category, quantity } of passengers) {
      const [pc] = await PassengerCount.findOrCreate({
        where: { trip_id: id, category },
        defaults: { count: 0 },
        transaction,
      });
      await pc.increment("count", { by: quantity, transaction });
      await pc.reload({ transaction });
      passengerCounts.push(pc);
    }

    await transaction.commit();

    return res.json({
      message: "Ticket printed successfully.",
      ticket,
      trip: {
        id: trip.id,
        grand_total: newGrandTotal,
        ticket_number_start: ticketStart,
        ticket_number_end: ticketEnd,
      },
      passengerCounts,
    });
  } catch (error) {
    await transaction.rollback();
    console.error("Error printing ticket:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// GET /api/conductor/tickets
// Get all tickets for conductor's trips
const getTickets = async (req, res) => {
  try {
    const conductorId = req.user.id;
    const { tripId } = req.query;

    const where = {};
    if (tripId) {
      // Verify trip belongs to conductor
      const trip = await Trip.findOne({
        where: { id: tripId, conductor_id: conductorId },
      });
      if (!trip) {
        return res.status(404).json({ message: "Trip not found." });
      }
      where.trip_id = tripId;
    }

    const tickets = await Ticket.findAll({
      where,
      include: [
        {
          model: Trip,
          where: { conductor_id: conductorId },
          include: [
            {
              model: BusModel,
              attributes: ["id", "bus_number", "plate_number"],
            },
            {
              model: Route,
              attributes: ["id", "origin", "destination"],
            },
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
          ],
        },
      ],
      order: [["issued_at", "DESC"]],
    });

    return res.json(tickets);
  } catch (error) {
    console.error("Error fetching tickets:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// Applies manually encoded results to trips that were run without the ticketing
// terminal: sets the collection as the trip total, replaces its passenger counts and
// marks it completed. Returns an error message for the client, or null on success.
const applyManualTripEntries = async (trips, manualTrips, transaction) => {
  for (const entry of manualTrips) {
    const trip = trips.find((t) => t.id === Number(entry?.trip_id));
    if (!trip) return "A manually encoded trip is not part of this remittance.";

    const ticketCount = await Ticket.count({ where: { trip_id: trip.id }, transaction });
    if (ticketCount > 0) {
      return `Trip #${trip.trip_number} already has issued tickets — its totals come from those tickets.`;
    }

    const collection = Number(entry.collection);
    if (!Number.isFinite(collection) || collection < 0) {
      return `Enter a valid cash collection for trip #${trip.trip_number}.`;
    }
    const counts = Array.isArray(entry.passenger_counts) ? entry.passenger_counts : [];
    for (const c of counts) {
      if (!PASSENGER_CATEGORIES.includes(c?.category)) {
        return `Invalid passenger category on trip #${trip.trip_number}.`;
      }
      if (!Number.isInteger(Number(c.count)) || Number(c.count) < 0) {
        return `Passenger counts on trip #${trip.trip_number} must be whole numbers.`;
      }
    }

    const departed = entry.actual_departure_time ? new Date(entry.actual_departure_time) : null;
    const arrived = entry.arrival_time ? new Date(entry.arrival_time) : null;
    if ((departed && isNaN(departed)) || (arrived && isNaN(arrived))) {
      return `Invalid departure/arrival time on trip #${trip.trip_number}.`;
    }
    if (departed && arrived && arrived < departed) {
      return `Trip #${trip.trip_number} can't arrive before it departed.`;
    }

    await PassengerCount.destroy({ where: { trip_id: trip.id }, transaction });
    for (const c of counts) {
      if (Number(c.count) > 0) {
        await PassengerCount.create(
          { trip_id: trip.id, category: c.category, count: Number(c.count) },
          { transaction },
        );
      }
    }

    await trip.update(
      {
        grand_total: collection,
        status: "completed",
        actual_departure_time:
          departed ?? trip.actual_departure_time ?? trip.departure_time,
        arrival_time: arrived ?? trip.arrival_time ?? new Date(),
      },
      { transaction },
    );
  }
  return null;
};

// POST /api/conductor/remittances
// Submit expenses and operational reports. Trips run without the ticketing terminal can
// be included with `manual_trips: [{ trip_id, passenger_counts: [{ category, count }],
// collection, actual_departure_time?, arrival_time? }]`; logged TripExpense entries the
// remittance covers are passed as `expense_ids` and get linked to it.
const submitRemittance = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const conductorId = req.user.id;
    const {
      bus_id,
      driver_id,
      date,
      trip_ids, // array of trip IDs completed
      expenses = [], // array of { expense_type, amount }
      manual_trips = [],
      driver_commission = 0,
      conductor_commission = 0,
      bonus_allowance = 0,
      other_deductions = 0,
      cash_deposit = 0,
      driver_officer_share = 0,
      conductor_officer_share = 0,
    } = req.body;

    if (!bus_id || !driver_id || !date || !trip_ids || trip_ids.length === 0) {
      await transaction.rollback();
      return res
        .status(400)
        .json({ message: "Missing required remittance fields." });
    }

    const isValidAmount = (n) => Number.isFinite(n) && n >= 0;
    const amountsOk = [
      driver_commission,
      conductor_commission,
      bonus_allowance,
      other_deductions,
      cash_deposit,
      driver_officer_share,
      conductor_officer_share,
    ].every((v) => isValidAmount(Number(v ?? 0)));
    const expensesOk = expenses.every(
      (e) => EXPENSE_TYPES.includes(e?.expense_type) && isValidAmount(Number(e.amount)),
    );
    if (!amountsOk || !expensesOk) {
      await transaction.rollback();
      return res.status(400).json({ message: "Enter valid amounts (0 or more)." });
    }

    // 1. Fetch completed trips to calculate actual gross income
    const trips = await Trip.findAll({
      where: {
        id: { [Op.in]: trip_ids },
        conductor_id: conductorId,
      },
      transaction,
    });

    if (trips.length === 0) {
      await transaction.rollback();
      return res
        .status(404)
        .json({ message: "No valid trips found for remittance." });
    }

    const manualError = await applyManualTripEntries(
      trips,
      Array.isArray(manual_trips) ? manual_trips : [],
      transaction,
    );
    if (manualError) {
      await transaction.rollback();
      return res.status(400).json({ message: manualError });
    }
    const unfinished = trips.find((t) => t.status !== "completed");
    if (unfinished) {
      await transaction.rollback();
      return res.status(400).json({
        message: `Trip #${unfinished.trip_number} isn't completed — finish it or encode its passengers and collection manually.`,
      });
    }

    // A prior rejected remittance for the same bus/date/conductor means this is a resubmission.
    const priorRejected = await Remittance.findOne({
      where: { bus_id, conductor_id: conductorId, date, status: "rejected" },
      transaction,
    });

    const grossIncome = trips.reduce(
      (sum, t) => sum + Number(t.grand_total),
      0,
    );
    const totalExpenses = expenses.reduce(
      (sum, e) => sum + Number(e.amount),
      0,
    );
    const netGross = grossIncome - totalExpenses;

    const totalLess =
      Number(driver_commission) +
      Number(conductor_commission) +
      Number(bonus_allowance) +
      Number(other_deductions) +
      Number(cash_deposit);

    const netCollection = netGross - totalLess;

    // Create Remittance record
    const remittance = await Remittance.create(
      {
        bus_id,
        driver_id,
        conductor_id: conductorId,
        date,
        no_of_trips: trips.length,
        gross_income: grossIncome,
        total_expenses: totalExpenses,
        net_gross: netGross,
        driver_commission,
        conductor_commission,
        bonus_allowance,
        other_deductions,
        cash_deposit,
        total_less: totalLess,
        net_collection: netCollection,
        driver_officer_share,
        conductor_officer_share,
        status: "submitted",
        submitted_at: new Date(),
      },
      { transaction },
    );

    // Link trips to this remittance
    await Trip.update(
      { remittance_id: remittance.id },
      { where: { id: { [Op.in]: trip_ids } }, transaction },
    );

    // Create expenses
    for (const exp of expenses) {
      await RemittanceExpense.create(
        {
          remittance_id: remittance.id,
          expense_type: exp.expense_type,
          amount: exp.amount,
        },
        { transaction },
      );
    }

    await transaction.commit();

    notifyConductorOfSubmission(remittance, false);
    notifyReviewersOfSubmission(remittance, !!priorRejected);
    notify(
      (async () => {
        const [bus, conductor, reviewers] = await Promise.all([
          BusModel.findByPk(bus_id),
          User.findByPk(conductorId),
          User.findAll({ where: { role: ["owner", "admin_staff", "audit_teller"], is_active: true } }),
        ]);
        for (const reviewer of reviewers) {
          await sendRemittanceSubmittedEmail({
            to: reviewer.email,
            conductorName: conductor ? fullName(conductor) : "A conductor",
            busLabel: bus?.bus_number ?? String(bus_id),
            date,
            netCollection,
            isResubmission: !!priorRejected,
          });
        }
      })(),
    );

    // Confirmation for the conductor in their own bell.
    await createNotification({
      userId: remittance.conductor_id,
      type: "remittance_submitted",
      title: "Remittance submitted",
      message: `Your remittance for ${remittance.date} was sent to the audit teller for review.`,
      link: "/conductor/remittances",
    });

    return res.status(201).json(remittance);
  } catch (error) {
    await transaction.rollback();
    console.error("Error submitting remittance:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// PUT /api/conductor/remittances/:id
// Correct and resubmit a rejected remittance. The same record goes back to the audit
// teller (status "submitted", resubmitted_at set) — no second remittance is created and
// its trips stay linked to it. Gross income is left as is: it comes from those trips.
// Body: { expenses: [{ expense_type, amount }], driver_commission, conductor_commission,
// bonus_allowance, other_deductions, cash_deposit, driver_officer_share,
// conductor_officer_share }.
const resubmitRemittance = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const conductorId = req.user.id;
    const remittance = await Remittance.findOne({
      where: { id: req.params.id, conductor_id: conductorId },
      transaction,
    });
    if (!remittance) {
      await transaction.rollback();
      return res.status(404).json({ message: "Remittance not found." });
    }
    if (remittance.status !== "rejected") {
      await transaction.rollback();
      return res
        .status(400)
        .json({ message: "Only a rejected remittance can be edited and resubmitted." });
    }

    const expenses = Array.isArray(req.body.expenses) ? req.body.expenses : [];
    const amountFields = [
      "driver_commission",
      "conductor_commission",
      "bonus_allowance",
      "other_deductions",
      "cash_deposit",
      "driver_officer_share",
      "conductor_officer_share",
    ];
    const amounts = {};
    for (const field of amountFields) {
      amounts[field] = Number(req.body[field] ?? 0);
    }
    const isValidAmount = (n) => Number.isFinite(n) && n >= 0;
    const validExpenses = expenses.every(
      (e) => EXPENSE_TYPES.includes(e?.expense_type) && isValidAmount(Number(e.amount)),
    );
    if (!validExpenses || !Object.values(amounts).every(isValidAmount)) {
      await transaction.rollback();
      return res.status(400).json({ message: "Enter valid amounts (0 or more)." });
    }

    const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount), 0);
    const netGross = Number(remittance.gross_income) - totalExpenses;
    const totalLess =
      amounts.driver_commission +
      amounts.conductor_commission +
      amounts.bonus_allowance +
      amounts.other_deductions +
      amounts.cash_deposit;
    const netCollection = netGross - totalLess;

    await remittance.update(
      {
        ...amounts,
        total_expenses: totalExpenses,
        net_gross: netGross,
        total_less: totalLess,
        net_collection: netCollection,
        status: "submitted",
        resubmitted_at: new Date(),
        approved_by: null,
        approved_at: null,
      },
      { transaction },
    );

    await RemittanceExpense.destroy({ where: { remittance_id: remittance.id }, transaction });
    for (const exp of expenses) {
      if (Number(exp.amount) > 0) {
        await RemittanceExpense.create(
          {
            remittance_id: remittance.id,
            expense_type: exp.expense_type,
            amount: exp.amount,
          },
          { transaction },
        );
      }
    }

    await transaction.commit();

    notifyConductorOfSubmission(remittance, true);
    notifyReviewersOfSubmission(remittance, true);
    notify(
      (async () => {
        const [bus, conductor, reviewers] = await Promise.all([
          BusModel.findByPk(remittance.bus_id),
          User.findByPk(conductorId),
          User.findAll({ where: { role: ["owner", "admin_staff", "audit_teller"], is_active: true } }),
        ]);
        for (const reviewer of reviewers) {
          await sendRemittanceSubmittedEmail({
            to: reviewer.email,
            conductorName: conductor ? fullName(conductor) : "A conductor",
            busLabel: bus?.bus_number ?? String(remittance.bus_id),
            date: remittance.date,
            netCollection,
            isResubmission: true,
          });
        }
      })(),
    );

    // Confirmation for the conductor in their own bell (after the commit, so a rollback
    // can't leave a notification behind).
    await createNotification({
      userId: remittance.conductor_id,
      type: "remittance_resubmitted",
      title: "Remittance resubmitted",
      message: `Your updated remittance for ${remittance.date} was sent back for review.`,
      link: "/conductor/remittances",
    });

    return res.json(remittance);
  } catch (error) {
    await transaction.rollback();
    console.error("Error resubmitting remittance:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// GET /api/conductor/remittances
const getRemittances = async (req, res) => {
  try {
    const conductorId = req.user.id;
    const remittances = await Remittance.findAll({
      where: { conductor_id: conductorId },
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
          include: [{ model: Route, attributes: ["origin", "destination"] }],
        },
      ],
      order: [["submitted_at", "DESC"]],
    });
    return res.json(remittances);
  } catch (error) {
    console.error("Error fetching remittances:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// GET /api/conductor/remittances/:id — one of the conductor's remittances, with tickets.
const getRemittanceById = async (req, res) => {
  try {
    const remittance = await findRemittanceDetail({
      id: req.params.id,
      conductor_id: req.user.id,
    });
    if (!remittance) return res.status(404).json({ message: "Remittance not found." });
    return res.json(remittance);
  } catch (error) {
    console.error("Error fetching remittance:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = {
  getAssignedTrips,
  updateTripStatus,
  getTripPassengerCounts,
  savePassengerCounts,
  getRouteStopsForConductor,
  printTicket,
  getTickets,
  submitRemittance,
  resubmitRemittance,
  getRemittances,
  getRemittanceById,
};