const { Op } = require("sequelize");
const {
  BusInfo,
  User,
  Trip,
  Route,
  BusCrewHistory,
  PassengerCount,
  Ticket,
  sequelize,
} = require("../models");
const {
  fullName,
  sendTripScheduledEmail,
  sendTripsScheduledSummaryEmail,
  sendTripsScheduledManagementEmail,
  sendTripScheduleUpdatedEmail,
  sendCrewAssignmentEmail,
} = require("../config/mailer");
const { OWNER_LEVEL_ROLES } = require("../middleware/auth");
const { createNotification } = require("../services/notificationService");
const {
  addCalendarDays,
  assignTripNumbersByManilaDay,
  isValidDateKey,
  manilaDateKey,
  manilaDayBounds,
  manilaToday,
  parseManilaDateTime,
  scheduleDepartureError,
} = require("../utils/manilaTime");

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

// GET /api/buses
const getBuses = async (req, res) => {
  const buses = await BusInfo.findAll({
    order: [["bus_number", "ASC"]],
  });
  return res.json(buses);
};

// POST /api/buses
const createBus = async (req, res) => {
  const { bus_number, plate_number, capacity, status } = req.body;
  const bus = await BusInfo.create({
    bus_number,
    plate_number,
    capacity,
    status,
  });
  return res.status(201).json(bus);
};

// PUT /api/buses/:id
const updateBus = async (req, res) => {
  const bus = await BusInfo.findByPk(req.params.id);
  if (!bus) return res.status(404).json({ message: "Bus not found." });
  const { bus_number, plate_number, capacity, status } = req.body;
  await bus.update({
    bus_number,
    plate_number,
    capacity,
    status,
  });
  return res.json(bus);
};

// DELETE /api/buses/:id
const deleteBus = async (req, res) => {
  const bus = await BusInfo.findByPk(req.params.id);
  if (!bus) return res.status(404).json({ message: "Bus not found." });
  await bus.destroy();
  return res.status(204).send();
};

// PUT /api/buses/:id/assign-crew
const assignCrew = async (req, res) => {
  const bus = await BusInfo.findByPk(req.params.id);
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
  const { date, startDate, endDate } = req.query;
  let fromKey;
  let toKey;
  if (startDate || endDate) {
    if (!isValidDateKey(startDate) || !isValidDateKey(endDate) || startDate > endDate) {
      return res.status(400).json({ message: "Provide a valid startDate and endDate in YYYY-MM-DD format." });
    }
    fromKey = startDate;
    toKey = endDate;
  } else {
    fromKey = date || addCalendarDays(manilaToday(), 1);
    if (!isValidDateKey(fromKey)) {
      return res.status(400).json({ message: "Provide a valid date in YYYY-MM-DD format." });
    }
    toKey = fromKey;
  }
  const start = manilaDayBounds(fromKey).start;
  const endExclusive = manilaDayBounds(toKey).endExclusive;

  const trips = await Trip.findAll({
    where: { departure_time: { [Op.gte]: start, [Op.lt]: endExclusive } },
    include: [
      { model: BusInfo, attributes: ["id", "bus_number", "plate_number", "status"] },
      { model: Route, attributes: ["id", "origin", "destination"] },
      {
        model: User,
        as: "driver",
        attributes: ["id", "first_name", "last_name", "is_active"],
      },
      {
        model: User,
        as: "conductor",
        attributes: ["id", "first_name", "last_name", "is_active"],
      },
    ],
    order: [["departure_time", "ASC"]],
  });
  return res.json(trips);
};

// Look up bus/route labels and notify the assigned driver/conductor of a scheduled trip.
const notifyTripScheduled = async ({ bus_id, route_id, driver_id, conductor_id, trip_number, departure_time }) => {
  const [bus, route, driver, conductor] = await Promise.all([
    BusInfo.findByPk(bus_id),
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

const notifyTripScheduleUpdated = async (before, after) => {
  const affectedIds = [...new Set([before.driver_id, before.conductor_id, after.driver_id, after.conductor_id].filter(Boolean))];
  const [bus, route, driver, conductor, crewUsers, managers] = await Promise.all([
    BusInfo.findByPk(after.bus_id),
    Route.findByPk(after.route_id),
    User.findByPk(after.driver_id),
    User.findByPk(after.conductor_id),
    User.findAll({ where: { id: affectedIds } }),
    User.findAll({ where: { role: OWNER_LEVEL_ROLES, is_active: true } }),
  ]);
  const busLabel = bus?.bus_number ?? String(after.bus_id);
  const routeLabel = route ? `${route.origin} → ${route.destination}` : "";
  const affectedCrew = new Map([
    [before.driver_id, "/driver/dashboard"],
    [before.conductor_id, "/conductor/trips"],
    [after.driver_id, "/driver/dashboard"],
    [after.conductor_id, "/conductor/trips"],
  ]);

  for (const [userId, link] of affectedCrew) {
    if (!userId) continue;
    await createNotification({
      userId,
      type: "schedule_updated",
      title: "Schedule updated",
      message: `Trip #${after.trip_number} · Bus ${busLabel}${routeLabel ? ` · ${routeLabel}` : ""} is now scheduled for ${formatDate(after.departure_time)} at ${formatTime(after.departure_time)}.`,
      link,
    });
  }

  for (const user of crewUsers) {
    notify(sendTripScheduleUpdatedEmail({
      to: user.email,
      name: fullName(user),
      busLabel,
      tripNumber: after.trip_number,
      routeLabel,
      driverName: driver ? fullName(driver) : "Unassigned",
      conductorName: conductor ? fullName(conductor) : "Unassigned",
      departureTime: after.departure_time,
    }));
  }

  for (const manager of managers) {
    await createNotification({
      userId: manager.id,
      type: "schedule_updated",
      title: "Schedule updated",
      message: `Trip #${after.trip_number} on Bus ${busLabel} was updated for ${formatDate(after.departure_time)} at ${formatTime(after.departure_time)}.`,
      link: "/owner/schedules",
    });
    notify(sendTripScheduleUpdatedEmail({
      to: manager.email,
      name: fullName(manager),
      busLabel,
      tripNumber: after.trip_number,
      routeLabel,
      driverName: driver ? fullName(driver) : "Unassigned",
      conductorName: conductor ? fullName(conductor) : "Unassigned",
      departureTime: after.departure_time,
    }));
  }
};

const validateScheduleResources = async ({ bus_id, driver_id, conductor_id, route_id, existingTrip }) => {
  const [bus, driver, conductor, route] = await Promise.all([
    BusInfo.findByPk(bus_id),
    User.findOne({ where: { id: driver_id, role: "driver" } }),
    User.findOne({ where: { id: conductor_id, role: "conductor" } }),
    route_id ? Route.findByPk(route_id) : null,
  ]);
  const isExistingBus = existingTrip && String(bus_id) === String(existingTrip.bus_id);
  const isExistingDriver = existingTrip && String(driver_id) === String(existingTrip.driver_id);
  const isExistingConductor =
    existingTrip && String(conductor_id) === String(existingTrip.conductor_id);
  if (!bus || (bus.status !== "active" && !isExistingBus)) {
    return { status: 400, message: "Select an active bus." };
  }
  if (!driver || (!driver.is_active && !isExistingDriver)) {
    return { status: 400, message: "Select an active driver." };
  }
  if (!conductor || (!conductor.is_active && !isExistingConductor)) {
    return { status: 400, message: "Select an active conductor." };
  }
  if (route_id && !route) return { status: 400, message: "Select a valid route." };
  return { bus, driver, conductor, route };
};

// Returns a message when the bus, the driver or the conductor already has a trip
// (not cancelled) at the same date and time, otherwise null.
const findScheduleConflict = async ({ bus_id, driver_id, conductor_id, departure_time, excludeTripId }) => {
  const when = parseManilaDateTime(departure_time);
  if (!when) return "Provide a valid departure date and time.";
  const slotStart = new Date(when);
  slotStart.setSeconds(0, 0);
  const slotEnd = new Date(slotStart.getTime() + 60 * 1000);

  const who = [{ bus_id }];
  if (driver_id) who.push({ driver_id });
  if (conductor_id) who.push({ conductor_id });

  const clash = await Trip.findOne({
    where: {
      status: { [Op.ne]: "cancelled" },
      departure_time: { [Op.gte]: slotStart, [Op.lt]: slotEnd },
      ...(excludeTripId ? { id: { [Op.ne]: excludeTripId } } : {}),
      [Op.or]: who,
    },
  });
  if (!clash) return null;

  const what =
    String(clash.bus_id) === String(bus_id)
      ? "This bus"
      : driver_id && String(clash.driver_id) === String(driver_id)
        ? "This driver"
        : "This conductor";
  return `${what} already has a trip (#${clash.trip_number}) on ${formatDate(slotStart)} at ${formatTime(slotStart)}. Please choose a different departure time.`;
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

  if (!bus_id || !route_id || !driver_id || !conductor_id || !trip_number || !departure_time || Number.isNaN(new Date(departure_time).getTime())) {
    return res.status(400).json({ message: "Bus, route, active driver, active conductor, trip number, and valid departure time are required." });
  }
  const parsedDeparture = parseManilaDateTime(departure_time);
  if (!parsedDeparture) {
    return res.status(400).json({ message: "Provide a valid departure date and time." });
  }
  const departureError = scheduleDepartureError(parsedDeparture);
  if (departureError) return res.status(400).json({ message: departureError });

  const resources = await validateScheduleResources({
    bus_id,
    driver_id,
    conductor_id,
    route_id,
  });
  if (resources.status) return res.status(resources.status).json({ message: resources.message });

  const conflict = await findScheduleConflict({ bus_id, driver_id, conductor_id, departure_time: parsedDeparture });
  if (conflict) return res.status(409).json({ message: conflict });

  const trip = await Trip.create({
    bus_id,
    route_id,
    driver_id,
    conductor_id,
    trip_number,
    departure_time: parsedDeparture,
    status: "scheduled",
  });

  notify(notifyTripScheduled({ bus_id, route_id, driver_id, conductor_id, trip_number, departure_time: parsedDeparture }));

  return res.status(201).json(trip);
};

// POST /api/buses/trips/bulk — create multiple trips, trip numbers auto-assigned
const createTripsBulkInner = async (req, res) => {
  const { bus_id, driver_id, conductor_id, trips } = req.body;
  // trips = [{ route_id, departure_time }]
  if (
    !bus_id ||
    !driver_id ||
    !conductor_id ||
    !Array.isArray(trips) ||
    trips.length === 0
  ) {
    return res.status(400).json({
      message: "bus_id, driver_id, conductor_id and trips[] are required.",
    });
  }
  const resources = await validateScheduleResources({ bus_id, driver_id, conductor_id });
  if (resources.status) return res.status(resources.status).json({ message: resources.message });
  const parsedTrips = trips.map((trip) => ({
    ...trip,
    departureDate: parseManilaDateTime(trip?.departure_time),
  }));
  if (parsedTrips.some((trip) => !trip.route_id || !trip.departureDate)) {
    return res.status(400).json({ message: "Every trip must include a valid route and departure time." });
  }
  const invalidDeparture = parsedTrips.find((trip) => scheduleDepartureError(trip.departureDate));
  if (invalidDeparture) {
    return res.status(400).json({ message: scheduleDepartureError(invalidDeparture.departureDate) });
  }

  // Schedule conflicts: same bus, driver or conductor at the same date and time,
  // either inside this batch or already scheduled.
  const seenSlots = new Set();
  for (const t of parsedTrips) {
    const route = await Route.findByPk(t.route_id);
    if (!route) return res.status(400).json({ message: "Every trip must have a valid route." });
    const slot = t.departureDate;
    slot.setSeconds(0, 0);
    const key = slot.getTime();
    if (seenSlots.has(key)) {
      return res.status(409).json({
        message: `Two trips in this batch have the same departure (${formatDate(slot)} at ${formatTime(slot)}). Please choose different times.`,
      });
    }
    seenSlots.add(key);
    const conflict = await findScheduleConflict({
      bus_id,
      driver_id,
      conductor_id,
      departure_time: t.departureDate,
    });
    if (conflict) return res.status(409).json({ message: conflict });
  }

  const nextTripNumbers = new Map();
  for (const trip of parsedTrips) {
    const dayKey = manilaDateKey(trip.departureDate);
    if (nextTripNumbers.has(dayKey)) continue;
    const { start, endExclusive } = manilaDayBounds(dayKey);
    const highest = await Trip.max("trip_number", {
      where: { bus_id, departure_time: { [Op.gte]: start, [Op.lt]: endExclusive } },
    });
    nextTripNumbers.set(dayKey, Number(highest || 0) + 1);
  }
  const date = manilaDayBounds(manilaDateKey(parsedTrips[0].departureDate)).start;

  const numberedTrips = assignTripNumbersByManilaDay(parsedTrips, nextTripNumbers);
  const created = [];
  for (const t of numberedTrips) {
    const trip = await Trip.create({
      bus_id,
      route_id: t.route_id,
      driver_id,
      conductor_id,
      trip_number: t.trip_number,
      departure_time: t.departureDate,
      status: "scheduled",
    });
    created.push(trip);
  }

  notify(
    (async () => {
      const [bus, driver, conductor, routes] = await Promise.all([
        BusInfo.findByPk(bus_id),
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

// Shows the real reason when scheduling fails (also written to the server log).
const createTripsBulk = async (req, res) => {
  try {
    return await createTripsBulkInner(req, res);
  } catch (error) {
    console.error("Bulk schedule error:", error);
    if (res.headersSent) return;
    return res.status(500).json({ message: `Could not schedule trips: ${error.message}` });
  }
};

// PUT /api/buses/trips/:id — scheduled trips only
const updateTrip = async (req, res) => {
  const trip = await Trip.findByPk(req.params.id);
  if (!trip) return res.status(404).json({ message: "Trip not found." });
  if (trip.status !== "scheduled") {
    return res.status(409).json({ message: "Only scheduled trips can be edited." });
  }

  const { bus_id, route_id, driver_id, conductor_id, departure_time } = req.body;
  const nextDeparture = parseManilaDateTime(departure_time);
  if (!bus_id || !route_id || !driver_id || !conductor_id || !nextDeparture) {
    return res.status(400).json({ message: "Bus, route, active driver, active conductor, and a valid departure time are required." });
  }
  const departureError = scheduleDepartureError(nextDeparture);
  if (departureError) return res.status(400).json({ message: departureError });

  const resources = await validateScheduleResources({
    bus_id,
    driver_id,
    conductor_id,
    route_id,
    existingTrip: trip,
  });
  if (resources.status) return res.status(resources.status).json({ message: resources.message });

  const conflict = await findScheduleConflict({
    bus_id,
    driver_id,
    conductor_id,
    departure_time: nextDeparture,
    excludeTripId: trip.id,
  });
  if (conflict) return res.status(409).json({ message: conflict });

  const before = trip.get({ plain: true });
  const previousDeparture = parseManilaDateTime(trip.departure_time);
  const movedToDifferentScheduleDay =
    String(bus_id) !== String(trip.bus_id) ||
    manilaDateKey(nextDeparture) !== manilaDateKey(previousDeparture);
  let trip_number = trip.trip_number;
  if (movedToDifferentScheduleDay) {
    const { start, endExclusive } = manilaDayBounds(manilaDateKey(nextDeparture));
    const highestTripNumber = await Trip.max("trip_number", {
      where: { bus_id, departure_time: { [Op.gte]: start, [Op.lt]: endExclusive } },
    });
    trip_number = Number(highestTripNumber) + 1;
  }
  await trip.update({ bus_id, route_id, driver_id, conductor_id, departure_time: nextDeparture, trip_number });
  notify(notifyTripScheduleUpdated(before, trip.get({ plain: true })));
  return res.json(trip);
};

// DELETE /api/buses/trips/:id
const deleteTrip = async (req, res) => {
  const transaction = await sequelize.transaction();
  try {
    const trip = await Trip.findByPk(req.params.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!trip) {
      await transaction.rollback();
      return res.status(404).json({ message: "Trip not found." });
    }

    if (trip.status === "scheduled") {
      const { conductor_id, driver_id, trip_number, departure_time } = trip;
      await trip.update({ status: "cancelled" }, { transaction });
      await transaction.commit();

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
    }

    if (trip.status !== "completed" && trip.status !== "cancelled") {
      await transaction.rollback();
      return res.status(409).json({
        message: "Only scheduled, completed, or cancelled trips can be deleted.",
      });
    }
    if (trip.remittance_id !== null) {
      await transaction.rollback();
      return res.status(409).json({
        message: "This trip is linked to a remittance and cannot be deleted.",
      });
    }

    await Ticket.destroy({ where: { trip_id: trip.id }, transaction });
    await PassengerCount.destroy({ where: { trip_id: trip.id }, transaction });
    await trip.destroy({ transaction });
    await transaction.commit();
    return res.status(204).send();
  } catch (error) {
    if (!transaction.finished) await transaction.rollback();
    console.error("Error deleting trip:", error);
    return res.status(500).json({ message: "Could not delete trip." });
  }
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
  updateTrip,
  deleteTrip,
  getRoutes,
};