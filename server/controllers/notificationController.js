const { Op } = require("sequelize");
const { Notification } = require("../models");

// Minimum number of notifications shown in the bell (unread ones are always shown).
const MIN_SHOWN = 5;

// GET /api/notifications
const getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    // All unread notifications stay. If there are fewer than MIN_SHOWN, the list is
    // topped up with the most recent already-read ones so it never looks empty.
    const unread = await Notification.findAll({
      where: { user_id: userId, read_at: { [Op.is]: null } },
      order: [["created_at", "DESC"]],
      limit: 50,
    });
    const unreadCount = await Notification.count({
      where: { user_id: userId, read_at: { [Op.is]: null } },
    });
    const missing = Math.max(0, MIN_SHOWN - unread.length);
    const recentRead = missing
      ? await Notification.findAll({
          where: { user_id: userId, read_at: { [Op.not]: null } },
          order: [["created_at", "DESC"]],
          limit: missing,
        })
      : [];
    const items = [...unread, ...recentRead].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at),
    );
    return res.json({ items, unreadCount });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// PUT /api/notifications/read-all
const markAllRead = async (req, res) => {
  try {
    await Notification.update(
      { read_at: new Date() },
      { where: { user_id: req.user.id, read_at: { [Op.is]: null } } },
    );
    return res.json({ ok: true });
  } catch (error) {
    console.error("Error marking all read:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

// PUT /api/notifications/:id/read
const markRead = async (req, res) => {
  try {
    await Notification.update(
      { read_at: new Date() },
      { where: { id: req.params.id, user_id: req.user.id, read_at: { [Op.is]: null } } },
    );
    return res.json({ ok: true });
  } catch (error) {
    console.error("Error marking read:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
};

module.exports = { getMyNotifications, markAllRead, markRead };