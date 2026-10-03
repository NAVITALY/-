import { Router } from 'express';
import { db } from '../db.js';
import { auth, perm } from '../auth.js';
import { cellFill } from '../util.js';

const r = Router();
r.use(auth, perm('reports.view'));

r.get('/reports/stock-by-product', (req, res) => {
  const rows = db.prepare(`
    SELECT p.product_id AS productId, p.sku, p.name, p.unit, c.name AS categoryName,
           p.turnover_class AS turnoverClass,
           COALESCE(SUM(s.quantity), 0) AS qty,
           COALESCE(SUM(s.reserved), 0) AS reserved,
           COALESCE(SUM(s.quantity) * p.weight_kg, 0) AS totalWeight
    FROM products p
    LEFT JOIN stock s ON s.product_id = p.product_id
    LEFT JOIN categories c ON c.category_id = p.category_id
    GROUP BY p.product_id HAVING qty > 0 OR p.min_stock > 0
    ORDER BY p.name`).all();
  res.json(rows.map(x => ({ ...x, totalWeight: +x.totalWeight.toFixed(1) })));
});

r.get('/reports/stock-by-cell', (req, res) => {
  const rows = db.prepare(`
    SELECT c.code AS cellCode, z.name AS zoneName, c.status,
           COUNT(s.stock_id) AS positions,
           COALESCE(SUM(s.quantity), 0) AS qty
    FROM cells c
    JOIN zones z ON z.zone_id = c.zone_id
    LEFT JOIN stock s ON s.cell_id = c.cell_id AND s.quantity > 0
    GROUP BY c.cell_id ORDER BY z.name, c.code`).all();
  res.json(rows);
});

r.get('/reports/cell-utilization', (req, res) => {
  const cells = db.prepare(`
    SELECT c.cell_id AS id, c.code, c.max_weight_kg AS maxWeight, c.max_volume_m3 AS maxVolume,
           z.name AS zoneName
    FROM cells c JOIN zones z ON z.zone_id = c.zone_id`).all();
  const byZone = new Map();
  for (const c of cells) {
    const f = cellFill(c.id);
    if (!byZone.has(c.zoneName)) {
      byZone.set(c.zoneName, { zone: c.zoneName, cells: 0, occupied: 0, usedVolume: 0, totalVolume: 0, usedWeight: 0, totalWeight: 0 });
    }
    const z = byZone.get(c.zoneName);
    z.cells++;
    if (f.qty > 0) z.occupied++;
    z.usedVolume += f.volume; z.totalVolume += c.maxVolume;
    z.usedWeight += f.weight; z.totalWeight += c.maxWeight;
  }
  const out = [...byZone.values()].map(z => ({
    ...z,
    usedVolume: +z.usedVolume.toFixed(1), totalVolume: +z.totalVolume.toFixed(1),
    usedWeight: +z.usedWeight.toFixed(0), totalWeight: +z.totalWeight.toFixed(0),
    volumePct: z.totalVolume ? Math.round(z.usedVolume / z.totalVolume * 100) : 0,
    weightPct: z.totalWeight ? Math.round(z.usedWeight / z.totalWeight * 100) : 0,
    occupiedPct: z.cells ? Math.round(z.occupied / z.cells * 100) : 0,
  }));
  res.json(out);
});

r.get('/reports/movements', (req, res) => {
  const { from = '', to = '', entity = '' } = req.query;
  const conds = [], params = [];
  const movementActions = ['приёмка', 'подтверждение приёмки', 'размещение', 'частичное размещение',
    'сборка', 'отгрузка', 'перемещение', 'закрытие инвентаризации', 'резерв'];
  conds.push(`(${movementActions.map(() => 'l.action LIKE ?').join(' OR ')})`);
  for (const a of movementActions) params.push(`%${a}%`);
  if (entity) { conds.push('l.entity = ?'); params.push(entity); }
  if (from) { conds.push('l.timestamp >= ?'); params.push(from + ' 00:00:00'); }
  if (to) { conds.push('l.timestamp <= ?'); params.push(to + ' 23:59:59'); }
  const rows = db.prepare(`
    SELECT l.log_id AS id, l.action, l.entity, l.details, l.timestamp,
           COALESCE(u.full_name, '—') AS userName
    FROM operation_logs l LEFT JOIN users u ON u.user_id = l.user_id
    WHERE ${conds.join(' AND ')} ORDER BY l.log_id DESC LIMIT 1000`).all(...params);
  res.json(rows);
});

r.get('/reports/low-stock', (req, res) => {
  const rows = db.prepare(`
    SELECT p.product_id AS productId, p.sku, p.name, p.unit, p.min_stock AS minStock,
           COALESCE(SUM(s.quantity), 0) AS qty
    FROM products p LEFT JOIN stock s ON s.product_id = p.product_id
    GROUP BY p.product_id HAVING qty < min_stock AND min_stock > 0 ORDER BY qty ASC`).all();
  res.json(rows);
});

export default r;
