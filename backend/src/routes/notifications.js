/**
 * Notification Routes — Phase 6
 *
 * In-dashboard notification system for agent events,
 * approvals, and operational alerts.
 */
import express from 'express';
import {
  getNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
  dismissNotification,
} from '../cache/database.js';

const router = express.Router();

/** GET / — Get notifications */
router.get('/', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const unreadOnly = req.query.unread === 'true';
    const notifications = getNotifications(limit, unreadOnly);
    const unreadCount = getUnreadNotificationCount();
    res.json({ notifications, unreadCount, fetchedAt: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /count — Get unread count only (lightweight polling) */
router.get('/count', (req, res) => {
  try {
    const count = getUnreadNotificationCount();
    res.json({ unreadCount: count });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /:id/read — Mark notification as read */
router.post('/:id/read', (req, res) => {
  try {
    markNotificationRead(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /read-all — Mark all as read */
router.post('/read-all', (req, res) => {
  try {
    markAllNotificationsRead();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /:id/dismiss — Dismiss notification */
router.post('/:id/dismiss', (req, res) => {
  try {
    dismissNotification(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
