import { Router } from 'express';
import { db } from '../db.js';
import { auth, perm } from '../auth.js';

const r = Router();
r.use(auth);

r.get('/logs', perm('logs.view'), (req, res) => {
  const { userId = '', action = '', entity = '', from = '', to = '', page = 1 } = req.query;
  const limit = 50;
  const conds = [], params = [];
  if (userId) { conds.push('l.user_id = ?'); params.push(+userId); }
  if (action) { conds.push('l.action LIKE ?'); params.push(`%${action}%`); }
  if (entity) { conds.push('l.entity = ?'); params.push(entity); }
  if (from) { conds.push('l.timestamp >= ?'); params.push(from + ' 00:00:00'); }
  if (to) { conds.push('l.timestamp <= ?'); params.push(to + ' 23:59:59'); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) AS n FROM operation_logs l ${where}`).get(...params).n;
  const offset = (Math.max(1, +page) - 1) * limit;
  const rows = db.prepare(`
    SELECT l.log_id AS id, l.action, l.entity, l.entity_id AS entityId, l.details, l.timestamp,
           COALESCE(u.full_name, '—') AS userName, l.user_id AS userId
    FROM operation_logs l LEFT JOIN users u ON u.user_id = l.user_id
    ${where} ORDER BY l.log_id DESC LIMIT ${limit} OFFSET ${offset}`).all(...params);
  res.json({ total, page: +page, pages: Math.ceil(total / limit), items: rows });
});

export default r;
