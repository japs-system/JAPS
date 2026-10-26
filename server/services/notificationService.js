const { Op } = require("sequelize");
const { User, Notification, Remittance, BusModel } = require("../models");
const { OWNER_LEVEL_ROLES } = require("../middleware/auth");

// Never throws: a failed notification must not break the real action.
const createNotification = async ({ userId, type, title, message, link = null }) => {
  if (!userId) return;
  try {
    await Notification.create({ user_id: userId, type, title, message, link });
  } catch (err) {
    console.error("Notification create failed:", err);
  }
};

// One notification per active user holding any of the roles.
const notifyRoles = async (roles, { type, title, message, link = null }) => {
  try {
    const users = await User.findAll({
      where: { role: roles, is_active: true },
      attributes: ["id"],
    });
    if (users.length === 0) return;
    await Notification.bulkCreate(
      users.map((u) => ({ user_id: u.id, type, title, message, link })),
    );
  } catch (err) {
    console.error("Role notification failed:", err);
  }
};

const notifyOwners = (payload) => notifyRoles(OWNER_LEVEL_ROLES, payload);

// ── Pending-review reminders ────────────────────────────────────────────────
const REMIND_AFTER_HOURS = 24; // a remittance waiting this long triggers a reminder
const REMIND_EVERY_HOURS = 24; // ...and is repeated at most this often per audit teller

const HOUR_MS = 60 * 60 * 1000;

const waitingLabel = (hours) =>
  hours >= 48 ? `${Math.floor(hours / 24)} days` : `${hours} hours`;

// Reminds every active audit teller about remittances still waiting for review.
// Call it on a timer (see server/index.js). Safe to run often: it skips a
// remittance a teller was already reminded about within REMIND_EVERY_HOURS.
const remindPendingRemittances = async () => {
  try {
    const pending = await Remittance.findAll({
      where: { status: "submitted" },
      include: [{ model: BusModel, attributes: ["bus_number"] }],
    });

    const now = Date.now();
    const overdue = pending
      .map((r) => {
        const since = new Date(r.resubmitted_at ?? r.submitted_at).getTime();
        return { r, hours: Math.floor((now - since) / HOUR_MS) };
      })
      .filter((x) => x.hours >= REMIND_AFTER_HOURS);
    if (overdue.length === 0) return;

    const tellers = await User.findAll({
      where: { role: "audit_teller", is_active: true },
      attributes: ["id"],
    });
    if (tellers.length === 0) return;

    const since = new Date(now - REMIND_EVERY_HOURS * HOUR_MS);
    for (const { r, hours } of overdue) {
      const link = `/audit-teller/remittances/${r.id}`;
      for (const teller of tellers) {
        const alreadyReminded = await Notification.findOne({
          where: {
            user_id: teller.id,
            type: "remittance_pending_reminder",
            link,
            created_at: { [Op.gte]: since },
          },
        });
        if (alreadyReminded) continue;

        await Notification.create({
          user_id: teller.id,
          type: "remittance_pending_reminder",
          title: "Remittance waiting for review",
          message: `The remittance for Bus ${r.BusModel?.bus_number ?? r.bus_id} (${r.date}) has been waiting for review for ${waitingLabel(hours)}.`,
          link,
        });
      }
    }
  } catch (err) {
    console.error("Pending remittance reminder failed:", err);
  }
};

module.exports = { createNotification, notifyRoles, notifyOwners, remindPendingRemittances };