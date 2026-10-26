const { Op } = require("sequelize");
const { Route, RouteStop } = require("../models");

// GET /api/routes
const getRoutes = async (req, res) => {
  const routes = await Route.findAll({ order: [["origin", "ASC"]] });
  return res.json(routes);
};

// POST /api/routes
const createRoute = async (req, res) => {
  const { origin, destination, distance_km } = req.body;
  if (!origin || !destination)
    return res
      .status(400)
      .json({ message: "Origin and destination are required." });
  if (!(Number(distance_km) > 0))
    return res
      .status(400)
      .json({ message: "Distance (km) is required and must be greater than 0." });
  const route = await Route.create({ origin, destination, distance_km });
  return res.status(201).json(route);
};

// PUT /api/routes/:id
const updateRoute = async (req, res) => {
  const route = await Route.findByPk(req.params.id);
  if (!route) return res.status(404).json({ message: "Route not found." });
  const { origin, destination, distance_km } = req.body;
  if (!(Number(distance_km) > 0))
    return res
      .status(400)
      .json({ message: "Distance (km) is required and must be greater than 0." });
  // Every stopover must stay strictly between the origin and the destination.
  const farStop = await RouteStop.findOne({
    where: { route_id: route.id, km_from_origin: { [Op.gte]: Number(distance_km) } },
    order: [["km_from_origin", "DESC"]],
  });
  if (farStop)
    return res.status(400).json({
      message: `Stop "${farStop.name}" is at ${Number(farStop.km_from_origin)} km — the route distance must be greater than that. Move or remove the stop first.`,
    });
  await route.update({ origin, destination, distance_km });
  return res.json(route);
};

// DELETE /api/routes/:id
const deleteRoute = async (req, res) => {
  const route = await Route.findByPk(req.params.id);
  if (!route) return res.status(404).json({ message: "Route not found." });
  await route.destroy();
  return res.status(204).send();
};

// GET /api/routes/:routeId/stops
// Merged, ordered list: origin (0km) -> intermediate stops -> destination (distance_km).
const getRouteStops = async (req, res) => {
  const route = await Route.findByPk(req.params.routeId);
  if (!route) return res.status(404).json({ message: "Route not found." });

  const stops = await RouteStop.findAll({
    where: { route_id: route.id },
    order: [["km_from_origin", "ASC"]],
  });

  const merged = [
    { name: route.origin, km_from_origin: 0 },
    ...stops.map((s) => ({
      id: s.id,
      name: s.name,
      km_from_origin: Number(s.km_from_origin),
    })),
    { name: route.destination, km_from_origin: Number(route.distance_km ?? 0) },
  ];

  return res.json(merged);
};

// POST /api/routes/:routeId/stops
const createRouteStop = async (req, res) => {
  const route = await Route.findByPk(req.params.routeId);
  if (!route) return res.status(404).json({ message: "Route not found." });

  const { name, km_from_origin } = req.body;
  const km = Number(km_from_origin);
  const distanceKm = Number(route.distance_km);

  if (!name || !name.trim())
    return res.status(400).json({ message: "Stop name is required." });
  if (!route.distance_km || !(km > 0 && km < distanceKm))
    return res.status(400).json({
      message: `Distance from origin must be between 0 and ${distanceKm || 0} km.`,
    });

  const duplicate = await RouteStop.findOne({
    where: { route_id: route.id, km_from_origin: km },
  });
  if (duplicate)
    return res
      .status(400)
      .json({ message: "A stop already exists at this distance from origin." });

  const stop = await RouteStop.create({
    route_id: route.id,
    name: name.trim(),
    km_from_origin: km,
  });
  return res.status(201).json(stop);
};

// PUT /api/routes/:routeId/stops/:stopId
const updateRouteStop = async (req, res) => {
  const route = await Route.findByPk(req.params.routeId);
  if (!route) return res.status(404).json({ message: "Route not found." });

  const stop = await RouteStop.findOne({
    where: { id: req.params.stopId, route_id: route.id },
  });
  if (!stop) return res.status(404).json({ message: "Stop not found." });

  const { name, km_from_origin } = req.body;
  const km = Number(km_from_origin);
  const distanceKm = Number(route.distance_km);

  if (!name || !name.trim())
    return res.status(400).json({ message: "Stop name is required." });
  if (!(km > 0 && km < distanceKm))
    return res.status(400).json({
      message: `Distance from origin must be between 0 and ${distanceKm} km.`,
    });

  const duplicate = await RouteStop.findOne({
    where: {
      route_id: route.id,
      km_from_origin: km,
      id: { [Op.ne]: stop.id },
    },
  });
  if (duplicate)
    return res
      .status(400)
      .json({ message: "A stop already exists at this distance from origin." });

  await stop.update({ name: name.trim(), km_from_origin: km });
  return res.json(stop);
};

// DELETE /api/routes/:routeId/stops/:stopId
const deleteRouteStop = async (req, res) => {
  const stop = await RouteStop.findOne({
    where: { id: req.params.stopId, route_id: req.params.routeId },
  });
  if (!stop) return res.status(404).json({ message: "Stop not found." });
  await stop.destroy();
  return res.status(204).send();
};

module.exports = {
  getRoutes,
  createRoute,
  updateRoute,
  deleteRoute,
  getRouteStops,
  createRouteStop,
  updateRouteStop,
  deleteRouteStop,
};
