/**
 * Report Comments Routes
 *
 * Comments on intelligence reports — async team discussion
 * scoped by tenant and report ID.
 */
import express from 'express';
import {
  getReportComments,
  createReportComment,
  addReportCommentReaction,
  getReportCommentCounts,
  insertNotification,
  getUsersByTenant,
} from '../cache/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();

/** GET /counts/batch — Get comment counts for multiple reports (must be before /:reportId) */
router.get('/counts/batch', authenticate, (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const reportIds = (req.query.ids || '').split(',').filter(Boolean);
    const counts = getReportCommentCounts(tenantId, reportIds);
    res.json({ counts });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:reportId — Get comments for a report */
router.get('/:reportId', authenticate, (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { reportId } = req.params;
    const comments = getReportComments(tenantId, reportId);
    const parsed = comments.map(c => ({
      ...c,
      reactions: JSON.parse(c.reactions_json || '{}'),
    }));
    res.json({ comments: parsed });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /:reportId — Post a new comment */
router.post('/:reportId', authenticate, (req, res) => {
  try {
    const tenantId = req.user.tenantId;
    const { reportId } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const comment = createReportComment(
      tenantId, reportId,
      req.user.id, req.user.name, req.user.role,
      message.trim()
    );

    // Create notification for other team members
    insertNotification(
      'intel-comments',
      'info',
      `${req.user.name} commented on Intel Report`,
      `"${message.trim().slice(0, 120)}${message.length > 120 ? '...' : ''}"`,
      null
    );

    // Check for @mentions and create targeted notifications
    const mentionRegex = /@(\w+(?:\s\w+)?)/g;
    let match;
    while ((match = mentionRegex.exec(message)) !== null) {
      const mentionedName = match[1];
      const users = getUsersByTenant(tenantId);
      const mentioned = users.find(u =>
        u.name.toLowerCase().includes(mentionedName.toLowerCase())
      );
      if (mentioned && mentioned.id !== req.user.id) {
        insertNotification(
          'intel-mention',
          'info',
          `${req.user.name} mentioned you in Intel Report`,
          `"${message.trim().slice(0, 120)}${message.length > 120 ? '...' : ''}"`,
          null
        );
      }
    }

    res.json({
      comment: {
        ...comment,
        reactions: JSON.parse(comment.reactions_json || '{}'),
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** POST /:reportId/:commentId/react — Toggle emoji reaction */
router.post('/:reportId/:commentId/react', authenticate, (req, res) => {
  try {
    const { commentId } = req.params;
    const { emoji } = req.body;

    const allowed = ['👍', '🔥', '⚠️'];
    if (!allowed.includes(emoji)) {
      return res.status(400).json({ error: 'Invalid reaction emoji' });
    }

    const updated = addReportCommentReaction(parseInt(commentId), req.user.id, emoji);
    if (!updated) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    res.json({
      comment: {
        ...updated,
        reactions: JSON.parse(updated.reactions_json || '{}'),
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/** GET /:reportId/users — Get tenant users for @mention autocomplete */
router.get('/:reportId/users', authenticate, (req, res) => {
  try {
    const users = getUsersByTenant(req.user.tenantId);
    const list = users
      .filter(u => u.status === 'active' && u.id !== req.user.id)
      .map(u => ({ id: u.id, name: u.name, role: u.role }));
    res.json({ users: list });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
