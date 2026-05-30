/**
 * routes/bookings.js
 * ------------------
 * CRUD REST API for restaurant table bookings.
 *
 * GET    /api/bookings              – list all bookings (with filters)
 * POST   /api/bookings              – create a new booking
 * GET    /api/bookings/:id          – get a single booking
 * PUT    /api/bookings/:id          – full update a booking
 * PATCH  /api/bookings/:id          – partial update (e.g. change status)
 * DELETE /api/bookings/:id          – cancel a booking
 *
 * GET    /api/bookings/tables       – list all restaurant tables
 * GET    /api/bookings/availability – check table availability for a date/time
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const router = express.Router();

// Helper – get db from app.locals (set in app.js)
function getDb(req) {
  return req.app.locals.db;
}

// ── Validation helpers ────────────────────────────────────────────────────────
function validateBookingBody(body, requireAll = true) {
  const errors = [];
  const {
    table_id, customer_name, customer_email,
    party_size, booking_date, booking_time,
  } = body;

  if (requireAll) {
    if (!table_id)       errors.push('table_id is required');
    if (!customer_name)  errors.push('customer_name is required');
    if (!customer_email) errors.push('customer_email is required');
    if (!party_size)     errors.push('party_size is required');
    if (!booking_date)   errors.push('booking_date is required (YYYY-MM-DD)');
    if (!booking_time)   errors.push('booking_time is required (HH:MM)');
  }

  if (customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer_email)) {
    errors.push('customer_email is not valid');
  }
  if (party_size && (isNaN(party_size) || party_size < 1 || party_size > 50)) {
    errors.push('party_size must be between 1 and 50');
  }
  if (booking_date && !/^\d{4}-\d{2}-\d{2}$/.test(booking_date)) {
    errors.push('booking_date must be YYYY-MM-DD');
  }
  if (booking_time && !/^\d{2}:\d{2}$/.test(booking_time)) {
    errors.push('booking_time must be HH:MM');
  }

  return errors;
}

// ── GET /api/bookings/tables ──────────────────────────────────────────────────
router.get('/tables', (req, res) => {
  const db = getDb(req);
  const tables = db.prepare('SELECT * FROM restaurant_tables ORDER BY table_number').all();
  res.json({ data: tables, count: tables.length });
});

// ── GET /api/bookings/availability ───────────────────────────────────────────
router.get('/availability', (req, res) => {
  const db = getDb(req);
  const { date, time, party_size } = req.query;

  if (!date || !time) {
    return res.status(400).json({ error: 'Query params "date" and "time" are required' });
  }

  // Find tables that have no confirmed booking overlapping the requested slot
  // (simplified: checks same date + time only; extend with duration for production)
  const occupied = db.prepare(`
    SELECT DISTINCT table_id FROM bookings
    WHERE booking_date = ? AND booking_time = ? AND status = 'confirmed'
  `).all(date, time).map(r => r.table_id);

  let query = 'SELECT * FROM restaurant_tables';
  const params = [];

  if (party_size) {
    query += ' WHERE capacity >= ?';
    params.push(parseInt(party_size, 10));
  }

  let tables = db.prepare(query).all(...params);
  tables = tables.map(t => ({
    ...t,
    available: !occupied.includes(t.id),
  }));

  res.json({ date, time, data: tables, count: tables.length });
});

// ── GET /api/bookings ─────────────────────────────────────────────────────────
router.get('/', (req, res) => {
  const db = getDb(req);
  const { status, date, email, limit = 50, offset = 0 } = req.query;

  let query = `
    SELECT b.*, t.table_number, t.capacity, t.location
    FROM bookings b
    JOIN restaurant_tables t ON t.id = b.table_id
    WHERE 1=1
  `;
  const params = [];

  if (status) { query += ' AND b.status = ?';       params.push(status); }
  if (date)   { query += ' AND b.booking_date = ?'; params.push(date); }
  if (email)  { query += ' AND b.customer_email = ?'; params.push(email); }

  query += ' ORDER BY b.booking_date DESC, b.booking_time DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit, 10), parseInt(offset, 10));

  const rows = db.prepare(query).all(...params);
  const total = db.prepare(
    `SELECT COUNT(*) as c FROM bookings WHERE 1=1${status ? ' AND status=?' : ''}${date ? ' AND booking_date=?' : ''}`
  ).get(...params.slice(0, params.length - 2));

  res.json({ data: rows, count: rows.length, total: total.c });
});

// ── GET /api/bookings/:id ─────────────────────────────────────────────────────
router.get('/:id', (req, res) => {
  const db = getDb(req);
  const booking = db.prepare(`
    SELECT b.*, t.table_number, t.capacity, t.location
    FROM bookings b
    JOIN restaurant_tables t ON t.id = b.table_id
    WHERE b.id = ?
  `).get(req.params.id);

  if (!booking) return res.status(404).json({ error: 'Booking not found' });
  res.json({ data: booking });
});

// ── POST /api/bookings ────────────────────────────────────────────────────────
router.post('/', (req, res) => {
  const db = getDb(req);
  const errors = validateBookingBody(req.body, true);
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  const {
    table_id, customer_name, customer_email, customer_phone,
    party_size, booking_date, booking_time,
    duration_min = 90, notes,
  } = req.body;

  // Check table exists
  const table = db.prepare('SELECT * FROM restaurant_tables WHERE id = ?').get(table_id);
  if (!table) return res.status(404).json({ error: `Table ${table_id} not found` });

  // Check capacity
  if (party_size > table.capacity) {
    return res.status(409).json({
      error: `Party size ${party_size} exceeds table capacity ${table.capacity}`,
    });
  }

  // Check for conflicting booking
  const conflict = db.prepare(`
    SELECT id FROM bookings
    WHERE table_id = ? AND booking_date = ? AND booking_time = ? AND status = 'confirmed'
  `).get(table_id, booking_date, booking_time);

  if (conflict) {
    return res.status(409).json({
      error: 'Table is already booked for this date and time',
      conflicting_booking_id: conflict.id,
    });
  }

  const id = uuidv4();
  db.prepare(`
    INSERT INTO bookings
      (id, table_id, customer_name, customer_email, customer_phone,
       party_size, booking_date, booking_time, duration_min, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, table_id, customer_name, customer_email, customer_phone ?? null,
         party_size, booking_date, booking_time, duration_min, notes ?? null);

  const created = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
  res.status(201).json({ data: created, message: 'Booking created successfully' });
});

// ── PUT /api/bookings/:id ─────────────────────────────────────────────────────
router.put('/:id', (req, res) => {
  const db = getDb(req);
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Booking not found' });

  const errors = validateBookingBody(req.body, true);
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  const {
    table_id, customer_name, customer_email, customer_phone,
    party_size, booking_date, booking_time,
    duration_min = 90, status = 'confirmed', notes,
  } = req.body;

  db.prepare(`
    UPDATE bookings SET
      table_id=?, customer_name=?, customer_email=?, customer_phone=?,
      party_size=?, booking_date=?, booking_time=?, duration_min=?,
      status=?, notes=?, updated_at=datetime('now')
    WHERE id=?
  `).run(table_id, customer_name, customer_email, customer_phone ?? null,
         party_size, booking_date, booking_time, duration_min,
         status, notes ?? null, req.params.id);

  res.json({ data: db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id) });
});

// ── PATCH /api/bookings/:id ───────────────────────────────────────────────────
router.patch('/:id', (req, res) => {
  const db = getDb(req);
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Booking not found' });

  const errors = validateBookingBody(req.body, false);
  if (errors.length) return res.status(400).json({ error: 'Validation failed', details: errors });

  const allowed = [
    'table_id','customer_name','customer_email','customer_phone',
    'party_size','booking_date','booking_time','duration_min','status','notes',
  ];
  const updates = [];
  const values = [];

  for (const key of allowed) {
    if (key in req.body) {
      updates.push(`${key} = ?`);
      values.push(req.body[key]);
    }
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No valid fields provided for update' });
  }

  updates.push(`updated_at = datetime('now')`);
  values.push(req.params.id);

  db.prepare(`UPDATE bookings SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  res.json({ data: db.prepare('SELECT * FROM bookings WHERE id=?').get(req.params.id) });
});

// ── DELETE /api/bookings/:id ──────────────────────────────────────────────────
router.delete('/:id', (req, res) => {
  const db = getDb(req);
  const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Booking not found' });

  db.prepare(`
    UPDATE bookings SET status='cancelled', updated_at=datetime('now') WHERE id=?
  `).run(req.params.id);

  res.json({ message: 'Booking cancelled successfully', id: req.params.id });
});

module.exports = router;
