const { Op } = require("sequelize");
const { Notification } = require("../models");

// GET /api/notifications
const getMyNotifications = async (req, res) => {
  try {
    const userId = req.user.id;
    const [items, unreadCount] = await Promise.all([
      Notification.findAll({
        where: { user_id: userId },
        order: [["created_at", "DESC"]],
        limit: 30,
      }),
      Notification.count({ where: { user_id: userId, read_at: { [Op.is]: null } } }),
    ]);
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