import express from 'express';
import { getNotes, addNote, updateNote, deleteNote } from '../cache/database.js';
import db from '../cache/database.js';
import { authenticate } from '../middleware/auth.js';

const router = express.Router();
router.use(authenticate);

// Panels for note association
const PANELS = [
  'hashprice',
  'eu_us_tech',
  'btc_reserve',
  'fiber_infrastructure',
  'japan_macro',
  'uranium',
  'brazil_compute',
  'pmi',
  'rare_earths',
  'iran_hashrate',
  'trade_routes',
  'datacenter_power',
  'correlation',
  'general'
];

// Get all notes
router.get('/', (req, res) => {
  const { panel, limit = 50 } = req.query;

  try {
    let notes;
    if (panel) {
      notes = getNotes(panel);
    } else {
      notes = getNotes();
    }

    res.json({
      notes: notes.slice(0, parseInt(limit)),
      total: notes.length,
      panels: PANELS
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get note by ID
router.get('/:id', (req, res) => {
  const { id } = req.params;

  try {
    const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(parseInt(id));
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }
    res.json({ note });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create note
router.post('/', (req, res) => {
  const { title, content, panel, tags } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  if (panel && !PANELS.includes(panel)) {
    return res.status(400).json({
      error: `Invalid panel. Valid panels: ${PANELS.join(', ')}`
    });
  }

  try {
    const tagsStr = Array.isArray(tags) ? tags.join(',') : tags;
    const result = addNote(title || null, content, panel || null, tagsStr || null);
    res.json({
      success: true,
      id: result.lastInsertRowid,
      message: 'Note created'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update note
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { title, content, panel, tags } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Content is required' });
  }

  if (panel && !PANELS.includes(panel)) {
    return res.status(400).json({
      error: `Invalid panel. Valid panels: ${PANELS.join(', ')}`
    });
  }

  try {
    const tagsStr = Array.isArray(tags) ? tags.join(',') : tags;
    updateNote(parseInt(id), title || null, content, panel || null, tagsStr || null);
    res.json({ success: true, message: 'Note updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete note
router.delete('/:id', (req, res) => {
  const { id } = req.params;

  try {
    deleteNote(parseInt(id));
    res.json({ success: true, message: 'Note deleted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Search notes
router.get('/search/:query', (req, res) => {
  const { query } = req.params;

  try {
    const notes = db.prepare(`
      SELECT * FROM notes
      WHERE content LIKE ? OR title LIKE ? OR tags LIKE ?
      ORDER BY created_at DESC
      LIMIT 50
    `).all(`%${query}%`, `%${query}%`, `%${query}%`);

    res.json({
      query,
      results: notes.length,
      notes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get notes by tag
router.get('/tag/:tag', (req, res) => {
  const { tag } = req.params;

  try {
    const notes = db.prepare(`
      SELECT * FROM notes
      WHERE tags LIKE ?
      ORDER BY created_at DESC
    `).all(`%${tag}%`);

    res.json({
      tag,
      count: notes.length,
      notes
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get all tags
router.get('/meta/tags', (req, res) => {
  try {
    const notes = db.prepare('SELECT tags FROM notes WHERE tags IS NOT NULL').all();
    const tagCount = {};

    notes.forEach(note => {
      if (note.tags) {
        note.tags.split(',').forEach(tag => {
          const trimmed = tag.trim();
          if (trimmed) {
            tagCount[trimmed] = (tagCount[trimmed] || 0) + 1;
          }
        });
      }
    });

    const tags = Object.entries(tagCount)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ tags });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
