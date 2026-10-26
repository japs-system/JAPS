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

const notify = (promise) => promise.catch((err) => console.error("Email notification failed:", err));

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

const busInclude = [
  {
    model: User,
    as: "driver",
    attributes: ["id", "first_name", "last_name", "employee_id"],
    foreignKey: "driver_id",
  },
  {
    model: User,
    as: "conductor",
    attributes: ["id", "first_name", "last_name", "employee_id"],
    foreignKey: "conductor_id",
  },
];

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
  return res.json(buses);
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
  if (!bus) return res.status(404).json({ message: "Bus not found." });
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
  if (!bus) return res.status(404).json({ message: "Bus not found." });
  await bus.destroy();
  return res.status(204).send();
};

// PUT /api/buses/:id/assign-crew
const assignCrew = async (req, res) => {
  const bus = await BusModel.findByPk(req.params.id);
  if (!bus) return res.status(404).json({ message: "Bus not found." });

  const { driver_id, conductor_id } = req.body;
  const now = new Date();
  const previousDriverId = bus.driver_id;
  const previousConductorId = bus.conductor_id;

  // Close any open history record for this bus
  await BusCrewHistory.update(
    { unassigned_at: now },
    { where: { bus_id: bus.id, unassigned_at: null } },
  );

  // Only create a new history row if there's actually someone being assigned
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
  // Drivers and conductors each get a bell notification, linking to their own portal.
  const crewLink = (role) => (role === "driver" ? "/driver/dashboard" : "/conductor/trips");
  const notifyCrewChange = async (previousId, newId, role) => {
    if (previousId === newId) return;
    if (previousId) {
      const prevUser = await User.findByPk(previousId);
      if (prevUser) {
        notify(
          sendCrewAssignmentEmail({
            to: prevUser.email,
            name: fullName(prevUser),
            role,
            busLabel,
            assigned: false,
          }),
        );
        await createNotification({
          userId: prevUser.id,
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

// GET /api/buses/trips?date=YYYY-MM-DD  OR  ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
const getTrips = async (req, res) => {
  let start, end;

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
    where: { departure_time: { [Op.between]: [start, end] } },
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
};

// Look up bus/route labels and notify the assigned driver/conductor of a scheduled trip.
const notifyTripScheduled = async ({ bus_id, route_id, driver_id, conductor_id, trip_number, departure_time }) => {
  const [bus, route, driver, conductor] = await Promise.all([
    BusModel.findByPk(bus_id),
    Route.findByPk(route_id),
    User.findByPk(driver_id),
    User.findByPk(conductor_id),
  ]);
  const busLabel = bus?.bus_number ?? String(bus_id);
  const routeLabel = route ? `${route.origin} → ${route.destination}` : "";

  // In-app notification for the conductor and the driver.
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

  for (const user of [driver, conductor]) {
    if (!user) continue;
    notify(
      sendTripScheduledEmail({
        to: user.email,
        name: fullName(user),
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
    trips: [{ tripNumber: trip_number, routeLabel, departureTime: departure_time }],
  });
};

// Copy owner-level staff (owner/secretary/admin staff) on every newly scheduled crew trip.
const notifyManagementOfSchedule = async ({ busLabel, date, driver, conductor, trips }) => {
  const managers = await User.findAll({
    where: { role: OWNER_LEVEL_ROLES, is_active: true },
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

// POST /api/buses/trips
const createTrip = async (req, res) => {
  const {
    bus_id,
    route_id,
    driver_id,
    conductor_id,
    trip_number,
    departure_time,
  } = req.body;
  const trip = await Trip.create({
    bus_id,
    route_id,
    driver_id,
    conductor_id,
    trip_number,
    departure_time,
    status: "scheduled",
  });

  notify(notifyTripScheduled({ bus_id, route_id, driver_id, conductor_id, trip_number, departure_time }));

  return res.status(201).json(trip);
};

// POST /api/buses/trips/bulk — create multiple trips, trip numbers auto-assigned
const createTripsBulk = async (req, res) => {
  const { bus_id, driver_id, conductor_id, date, trips } = req.body;
  // trips = [{ route_id, departure_time }]
  if (
    !bus_id ||
    !driver_id ||
    !conductor_id ||
    !date ||
    !Array.isArray(trips) ||
    trips.length === 0
  ) {
    return res.status(400).json({
      message:
        "bus_id, driver_id, conductor_id, date, and trips[] are required.",
    });
  }

  // Find the highest existing trip_number for this bus on this date
  const dayStart = new Date(date + "T00:00:00");
  const dayEnd = new Date(date + "T23:59:59");
  const existing = await Trip.findAll({
    where: {
      bus_id,
      departure_time: { [Op.between]: [dayStart, dayEnd] },
    },
    order: [["trip_number", "DESC"]],
    limit: 1,
  });
  let nextTripNumber = existing.length > 0 ? existing[0].trip_number + 1 : 1;

  const created = [];
  for (const t of trips) {
    const trip = await Trip.create({
      bus_id,
      route_id: t.route_id,
      driver_id,
      conductor_id,
      trip_number: nextTripNumber++,
      departure_time: t.departure_time,
      status: "scheduled",
    });
    created.push(trip);
  }

  notify(
    (async () => {
      const [bus, driver, conductor, routes] = await Promise.all([
        BusModel.findByPk(bus_id),
        User.findByPk(driver_id),
        User.findByPk(conductor_id),
        Route.findAll({ where: { id: created.map((t) => t.route_id) } }),
      ]);
      const busLabel = bus?.bus_number ?? String(bus_id);
      const routeById = new Map(routes.map((r) => [r.id, `${r.origin} → ${r.destination}`]));
      const tripSummaries = created.map((t) => ({
        tripNumber: t.trip_number,
        routeLabel: routeById.get(t.route_id) ?? "",
        departureTime: t.departure_time,
      }));

      // One in-app notification for the whole batch (not one per trip).
      const count = created.length;
      for (const [person, link] of [
        [conductor, "/conductor/trips"],
        [driver, "/driver/dashboard"],
      ]) {
        if (!person) continue;
        await createNotification({
          userId: person.id,
          type: "schedule_assigned",
          title: count === 1 ? "New schedule assigned" : `${count} new trips scheduled`,
          message: `Bus ${busLabel} on ${formatDate(date)}: ${count} trip${count === 1 ? "" : "s"}, first departure at ${formatTime(created[0].departure_time)}.`,
          link,
        });
      }

      for (const user of [driver, conductor]) {
        if (!user) continue;
        notify(
          sendTripsScheduledSummaryEmail({
            to: user.email,
            name: fullName(user),
            busLabel,
            date,
            trips: tripSummaries,
          }),
        );
      }

      await notifyManagementOfSchedule({ busLabel, date, driver, conductor, trips: tripSummaries });
    })(),
  );

  return res.status(201).json(created);
};

// DELETE /api/buses/trips/:id
const deleteTrip = async (req, res) => {
  const trip = await Trip.findByPk(req.params.id);
  if (!trip) return res.status(404).json({ message: "Trip not found." });

  // Keep the details before the row is gone.
  const { conductor_id, driver_id, trip_number, departure_time } = trip;
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
  const routes = await Route.findAll({ order: [["origin", "ASC"]] });
  return res.json(routes);
};

// GET /api/buses/:id/crew-history
const getCrewHistory = async (req, res) => {
  const history = await BusCrewHistory.findAll({
    where: { bus_id: req.params.id },
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