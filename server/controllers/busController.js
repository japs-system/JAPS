
const { Op } = require("sequelize");
const { BusModel, User, Trip, Route, BusCrewHistory } = require("../models");
const {
  fullName,
  sendTripScheduledEmail,
  sendTripsScheduledSummaryEmail,
  sendTripsScheduledManagementEmail,
  sendCrewAssignmentEmail,
} = require("../config/mailer");
const { OWNER_LEVEL_ROLES } = require("../middleware/auth");
const { createNotification } = require("../services/notificationService");

const notify = (promise) =>
  promise.catch((err) => console.error("Email notification failed:", err));

// Friendly date/time text for in-app notifications (Philippine time).
const formatDate = (value) =>
  new Date(value).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "Asia/Manila",
  });

const formatTime = (value) =>
  new Date(value).toLocaleTimeString("en-PH", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Manila",
  });

// GET /api/buses
const getBuses = async (req, res) => {
  const buses = await BusModel.findAll({
    order: [["bus_number", "ASC"]],
    include: [
      {
        model: User,
        as: "assignedDriver",
        attributes: ["id", "first_name", "last_name", "employee_id"],
      },
      {
        model: User,
        as: "assignedConductor",
        attributes: ["id", "first_name", "last_name", "employee_id"],
      },
      {
        model: Route,
        as: "defaultRoute",
        attributes: ["id", "origin", "destination"],
      },
    ],
  });

  // Return both crew association objects and their IDs for the frontend.
  return res.json(
    buses.map((bus) => {
      const data = bus.toJSON();

      return {
        ...data,
        driver_id: data.driver_id ?? data.assignedDriver?.id ?? null,
        conductor_id:
          data.conductor_id ?? data.assignedConductor?.id ?? null,
        route_id: data.route_id ?? data.defaultRoute?.id ?? null,
      };
    }),
  );
};

// POST /api/buses
const createBus = async (req, res) => {
  const { bus_number, plate_number, capacity, status } = req.body;

  const bus = await BusModel.create({
    bus_number,
    plate_number,
    capacity,
    status,
  });

  return res.status(201).json(bus);
};

// PUT /api/buses/:id
const updateBus = async (req, res) => {
  const bus = await BusModel.findByPk(req.params.id);

  if (!bus) {
    return res.status(404).json({ message: "Bus not found." });
  }

  const { bus_number, plate_number, capacity, status, route_id } = req.body;

  await bus.update({
    bus_number,
    plate_number,
    capacity,
    status,
    route_id: route_id ?? null,
  });

  return res.json(bus);
};

// DELETE /api/buses/:id
const deleteBus = async (req, res) => {
  const bus = await BusModel.findByPk(req.params.id);

  if (!bus) {
    return res.status(404).json({ message: "Bus not found." });
  }

  await bus.destroy();
  return res.status(204).send();
};

// PUT /api/buses/:id/assign-crew
const assignCrew = async (req, res) => {
  const bus = await BusModel.findByPk(req.params.id);

  if (!bus) {
    return res.status(404).json({ message: "Bus not found." });
  }

  const { driver_id, conductor_id } = req.body;
  const now = new Date();

  const previousDriverId = bus.driver_id;
  const previousConductorId = bus.conductor_id;

  await BusCrewHistory.update(
    { unassigned_at: now },
    { where: { bus_id: bus.id, unassigned_at: null } },
  );

  if (driver_id || conductor_id) {
    await BusCrewHistory.create({
      bus_id: bus.id,
      driver_id: driver_id || null,
      conductor_id: conductor_id || null,
      assigned_at: now,
    });
  }

  await bus.update({
    driver_id: driver_id || null,
    conductor_id: conductor_id || null,
  });

  const busLabel = bus.bus_number;

  const crewLink = (role) =>
    role === "driver" ? "/driver/dashboard" : "/conductor/trips";

  const notifyCrewChange = async (previousId, newId, role) => {
    if (previousId === newId) return;

    if (previousId) {
      const previousUser = await User.findByPk(previousId);

      if (previousUser) {
        notify(
          sendCrewAssignmentEmail({
            to: previousUser.email,
            name: fullName(previousUser),
            role,
            busLabel,
            assigned: false,
          }),
        );

        await createNotification({
          userId: previousUser.id,
          type: "crew_unassigned",
          title: "Bus assignment removed",
          message: `You are no longer assigned to Bus ${busLabel}.`,
          link: crewLink(role),
        });
      }
    }

    if (newId) {
      const newUser = await User.findByPk(newId);

      if (newUser) {
        notify(
          sendCrewAssignmentEmail({
            to: newUser.email,
            name: fullName(newUser),
            role,
            busLabel,
            assigned: true,
          }),
        );

        await createNotification({
          userId: newUser.id,
          type: "crew_assigned",
          title: "Assigned to a bus",
          message: `You have been assigned as ${role} of Bus ${busLabel}.`,
          link: crewLink(role),
        });
      }
    }
  };

  await notifyCrewChange(previousDriverId, driver_id || null, "driver");
  await notifyCrewChange(previousConductorId, conductor_id || null, "conductor");

  return res.json(bus);
};

// GET /api/buses/trips
const getTrips = async (req, res) => {
  let start;
  let end;

  if (req.query.startDate && req.query.endDate) {
    start = new Date(req.query.startDate);
    start.setHours(0, 0, 0, 0);

    end = new Date(req.query.endDate);
    end.setHours(23, 59, 59, 999);
  } else {
    const date = req.query.date
      ? new Date(req.query.date)
      : (() => {
          const d = new Date();
          d.setDate(d.getDate() + 1);
          return d;
        })();

    start = new Date(date);
    start.setHours(0, 0, 0, 0);

    end = new Date(date);
    end.setHours(23, 59, 59, 999);
  }

  const trips = await Trip.findAll({
    where: {
      departure_time: {
        [Op.between]: [start, end],
      },
    },
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
};

// Send notifications for a newly scheduled trip.
const notifyTripScheduled = async ({
  bus_id,
  route_id,
  driver_id,
  conductor_id,
  trip_number,
  departure_time,
}) => {
  const [bus, route, driver, conductor] = await Promise.all([
    BusModel.findByPk(bus_id),
    Route.findByPk(route_id),
    User.findByPk(driver_id),
    User.findByPk(conductor_id),
  ]);

  const busLabel = bus?.bus_number ?? String(bus_id);
  const routeLabel = route
    ? `${route.origin} → ${route.destination}`
    : "";

  for (const [person, link] of [
    [conductor, "/conductor/trips"],
    [driver, "/driver/dashboard"],
  ]) {
    if (!person) continue;

    await createNotification({
      userId: person.id,
      type: "schedule_assigned",
      title: "New schedule assigned",
      message: `Trip #${trip_number}${routeLabel ? " · " + routeLabel : ""} · Bus ${busLabel} on ${formatDate(departure_time)} at ${formatTime(departure_time)}.`,
      link,
    });
  }

  for (const person of [driver, conductor]) {
    if (!person) continue;

    notify(
      sendTripScheduledEmail({
        to: person.email,
        name: fullName(person),
        tripNumber: trip_number,
        busLabel,
        routeLabel,
        departureTime: departure_time,
      }),
    );
  }

  await notifyManagementOfSchedule({
    busLabel,
    date: departure_time,
    driver,
    conductor,
    trips: [
      {
        tripNumber: trip_number,
        routeLabel,
        departureTime: departure_time,
      },
    ],
  });
};

// Notify owner-level staff about newly scheduled trips.
const notifyManagementOfSchedule = async ({
  busLabel,
  date,
  driver,
  conductor,
  trips,
}) => {
  const managers = await User.findAll({
    where: {
      role: OWNER_LEVEL_ROLES,
      is_active: true,
    },
  });

  for (const manager of managers) {
    notify(
      sendTripsScheduledManagementEmail({
        to: manager.email,
        name: fullName(manager),
        busLabel,
        date,
        driverName: driver ? fullName(driver) : "Unassigned",
        conductorName: conductor ? fullName(conductor) : "Unassigned",
        trips,
      }),
    );
  }
};

// Check whether this bus already has a trip in any of the requested departure minutes.
// A time slot is treated as the same YYYY-MM-DD HH:mm minute.
const findBusDepartureConflicts = async (bus_id, departureDates) => {
  if (!departureDates.length) return [];

  const minuteWindows = departureDates.map((departure) => ({
    departure_time: {
      [Op.gte]: departure,
      [Op.lt]: new Date(departure.getTime() + 60 * 1000),
    },
  }));

  return Trip.findAll({
    where: {
      bus_id,
      [Op.or]: minuteWindows,
    },
    attributes: ["id", "departure_time", "trip_number"],
  });
};

const formatDepartureSlot = (value) =>
  new Date(value).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila",
  });

// POST /api/buses/trips
const createTrip = async (req, res) => {
  const { bus_id, route_id, trip_number, departure_time } = req.body;

  if (!bus_id || !route_id || !departure_time || Number.isNaN(new Date(departure_time).getTime())) {
    return res.status(400).json({
      message: "Please provide a valid bus, route, and departure date/time.",
    });
  }

  const bus = await BusModel.findByPk(bus_id);
  if (!bus) {
    return res.status(404).json({ message: "Selected bus was not found." });
  }

  // Crew is always taken from the bus assignment, not from the request payload.
  const driver_id = bus.driver_id;
  const conductor_id = bus.conductor_id;

  if (!driver_id || !conductor_id) {
    return res.status(400).json({
      message: "Please assign both a driver and a conductor to the selected bus before scheduling.",
    });
  }

  const departureDate = new Date(departure_time);
  const conflicts = await findBusDepartureConflicts(bus_id, [departureDate]);
  if (conflicts.length) {
    return res.status(409).json({
      message: `Bus ${bus.bus_number} already has a trip scheduled for ${formatDepartureSlot(departureDate)}. Please choose another departure time.`,
    });
  }

  const trip = await Trip.create({
    bus_id,
    route_id,
    driver_id,
    conductor_id,
    trip_number,
    departure_time: departureDate,
    status: "scheduled",
  });

  notify(
    notifyTripScheduled({
      bus_id,
      route_id,
      driver_id,
      conductor_id,
      trip_number,
      departure_time: departureDate,
    }),
  );

  return res.status(201).json(trip);
};

// POST /api/buses/trips/bulk
const createTripsBulk = async (req, res) => {
  try {
    const { bus_id, trips } = req.body;

    if (!bus_id || !Array.isArray(trips) || trips.length === 0) {
      return res.status(400).json({
        message: "Please provide a bus and at least one trip.",
      });
    }

    // Always use the crew already assigned to the selected bus.
    const bus = await BusModel.findByPk(bus_id);

    if (!bus) {
      return res.status(404).json({
        message: "Selected bus was not found.",
      });
    }

    const driver_id = bus.driver_id;
    const conductor_id = bus.conductor_id;

    if (!driver_id || !conductor_id) {
      return res.status(400).json({
        message:
          "Please assign both a driver and a conductor to the selected bus before scheduling.",
      });
    }

    // Validate all rows before creating any trip.
    const parsedTrips = [];
    const requestedSlots = new Set();

    for (let i = 0; i < trips.length; i++) {
      const trip = trips[i];

      if (!trip?.route_id || !trip?.departure_time) {
        return res.status(400).json({
          message: `Trip ${i + 1} is missing a route or departure time.`,
        });
      }

      const departureDate = new Date(trip.departure_time);
      if (Number.isNaN(departureDate.getTime())) {
        return res.status(400).json({
          message: `Trip ${i + 1} has an invalid departure date or time.`,
        });
      }

      // Duplicate times within the same bulk submission are not allowed for this bus.
      const slotKey = Math.floor(departureDate.getTime() / 60000);
      if (requestedSlots.has(slotKey)) {
        return res.status(409).json({
          message: `This bus has more than one trip set for ${formatDepartureSlot(departureDate)}. Each trip must have a different departure time.`,
        });
      }
      requestedSlots.add(slotKey);
      parsedTrips.push({
        route_id: Number(trip.route_id),
        departure_time: departureDate,
        date_key: String(trip.departure_time).slice(0, 10),
      });
    }

    // Check saved schedules for this same bus. Driver/conductor conflicts across
    // different buses are intentionally allowed.
    const conflicts = await findBusDepartureConflicts(
      bus_id,
      parsedTrips.map((trip) => trip.departure_time),
    );

    if (conflicts.length) {
      const conflictTime = conflicts[0].departure_time;
      return res.status(409).json({
        message: `Bus ${bus.bus_number} already has a trip scheduled for ${formatDepartureSlot(conflictTime)}. Please choose another departure time.`,
      });
    }

    const routeIds = [
      ...new Set(parsedTrips.map((trip) => trip.route_id)),
    ];

    const validRoutes = await Route.findAll({
      where: {
        id: routeIds,
      },
    });

    const validRouteIds = new Set(
      validRoutes.map((route) => Number(route.id)),
    );

    const missingRoute = routeIds.find(
      (id) => !validRouteIds.has(id),
    );

    if (missingRoute) {
      return res.status(400).json({
        message: `Route ${missingRoute} was not found. Please refresh the route list.`,
      });
    }

    // Assign trip numbers sequentially for the selected bus across all dates.
    // This avoids duplicate trip_number values when one submission contains
    // trips on multiple dates and the database enforces a uniqueness rule.
    const highestTrip = await Trip.findOne({
      where: { bus_id },
      attributes: ["trip_number"],
      order: [["trip_number", "DESC"]],
    });
    let nextTripNumber = highestTrip
      ? Number(highestTrip.trip_number) + 1
      : 1;

    const created = [];

    for (const tripData of parsedTrips) {
      const trip = await Trip.create({
        bus_id,
        route_id: tripData.route_id,
        driver_id,
        conductor_id,
        trip_number: nextTripNumber++,
        departure_time: tripData.departure_time,
        status: "scheduled",
      });

      created.push(trip);
    }

    const uniqueDepartureDates = [
      ...new Set(
        created.map((trip) => formatDate(trip.departure_time)),
      ),
    ];
    const notificationDateLabel =
      uniqueDepartureDates.length === 1
        ? uniqueDepartureDates[0]
        : `${uniqueDepartureDates.length} different dates`;

    // Send notifications after the trips have been saved.
    notify(
      (async () => {
        const [driver, conductor] = await Promise.all([
          User.findByPk(driver_id),
          User.findByPk(conductor_id),
        ]);

        const busLabel = bus.bus_number ?? String(bus_id);

        const routeById = new Map(
          validRoutes.map((route) => [
            Number(route.id),
            `${route.origin} → ${route.destination}`,
          ]),
        );

        const tripSummaries = created.map((trip) => ({
          tripNumber: trip.trip_number,
          routeLabel: routeById.get(Number(trip.route_id)) ?? "",
          departureTime: trip.departure_time,
        }));

        const count = created.length;

        for (const [person, link] of [
          [conductor, "/conductor/trips"],
          [driver, "/driver/dashboard"],
        ]) {
          if (!person) continue;

          await createNotification({
            userId: person.id,
            type: "schedule_assigned",
            title:
              count === 1
                ? "New schedule assigned"
                : `${count} new trips scheduled`,
            message: `Bus ${busLabel}: ${count} trip${count === 1 ? "" : "s"} scheduled across ${notificationDateLabel}. First departure: ${formatDate(created[0].departure_time)} at ${formatTime(created[0].departure_time)}.`,
            link,
          });
        }

        for (const person of [driver, conductor]) {
          if (!person) continue;

          notify(
            sendTripsScheduledSummaryEmail({
              to: person.email,
              name: fullName(person),
              busLabel,
              date: created[0].departure_time,
              trips: tripSummaries,
            }),
          );
        }

        await notifyManagementOfSchedule({
          busLabel,
          date: created[0].departure_time,
          driver,
          conductor,
          trips: tripSummaries,
        });
      })(),
    );

    return res.status(201).json(created);
  } catch (error) {
    console.error("createTripsBulk error:", error);

    const validationDetails = Array.isArray(error.errors)
      ? error.errors.map((item) => item.message).join("; ")
      : null;

    return res.status(500).json({
      message:
        validationDetails ||
        error.parent?.detail ||
        error.message ||
        "Could not create the schedule. Please check the bus, crew, route, and departure time.",
    });
  }
};

// DELETE /api/buses/trips/:id
const deleteTrip = async (req, res) => {
  const trip = await Trip.findByPk(req.params.id);

  if (!trip) {
    return res.status(404).json({
      message: "Trip not found.",
    });
  }

  const {
    conductor_id,
    driver_id,
    trip_number,
    departure_time,
  } = trip;

  await trip.destroy();

  for (const [userId, link] of [
    [conductor_id, "/conductor/trips"],
    [driver_id, "/driver/dashboard"],
  ]) {
    if (!userId) continue;

    await createNotification({
      userId,
      type: "schedule_cancelled",
      title: "Schedule cancelled",
      message: `Trip #${trip_number} on ${formatDate(departure_time)} at ${formatTime(departure_time)} was cancelled.`,
      link,
    });
  }

  return res.status(204).send();
};

// GET /api/buses/routes
const getRoutes = async (req, res) => {
  const routes = await Route.findAll({
    order: [["origin", "ASC"]],
  });

  return res.json(routes);
};

// GET /api/buses/:id/crew-history
const getCrewHistory = async (req, res) => {
  const history = await BusCrewHistory.findAll({
    where: {
      bus_id: req.params.id,
    },
    include: [
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
    order: [["assigned_at", "DESC"]],
  });

  return res.json(history);
};

module.exports = {
  getBuses,
  createBus,
  updateBus,
  deleteBus,
  assignCrew,
  getCrewHistory,
  getTrips,
  createTrip,
  createTripsBulk,
  deleteTrip,
  getRoutes,
};
