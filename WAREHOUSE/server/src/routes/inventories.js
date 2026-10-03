import { Router } from 'express';
import { db } from '../db.js';
import { auth, perm, logAction } from '../auth.js';
import { nextNumber, refreshCellStatus } from '../util.js';

const r = Router();
r.use(auth);

r.get('/inventories', perm('inventory.view'), (req, res) => {
  const rows = db.prepare(`
    SELECT i.inventory_id AS id, i.number, i.date, i.status, z.name AS zoneName, i.zone_id AS zoneId,
           u.full_name AS userName,
           (SELECT COUNT(*) FROM inventory_items t WHERE t.inventory_id = i.inventory_id) AS itemsCount,
           (SELECT COUNT(*) FROM inventory_items t WHERE t.inventory_id = i.inventory_id AND t.fact_qty IS NOT NULL) AS countedCount,
           (SELECT COUNT(*) FROM inventory_items t WHERE t.inventory_id = i.inventory_id
             AND t.fact_qty IS NOT NULL AND t.fact_qty != t.expected_qty) AS diffCount
    FROM inventories i
    LEFT JOIN zones z ON z.zone_id = i.zone_id
    LEFT JOIN users u ON u.user_id = i.user_id
    ORDER BY i.inventory_id DESC LIMIT 200`).all();
  res.json(rows);
});

r.get('/inventories/:id', perm('inventory.view'), (req, res) => {
  const inv = db.prepare(`
    SELECT i.inventory_id AS id, i.number, i.date, i.status, i.zone_id AS zoneId, z.name AS zoneName,
           u.full_name AS userName
    FROM inventories i
    LEFT JOIN zones z ON z.zone_id = i.zone_id
    LEFT JOIN users u ON u.user_id = i.user_id WHERE i.inventory_id = ?`).get(+req.params.id);
  if (!inv) return res.status(404).json({ error: 'Инвентаризация не найдена' });
  const items = db.prepare(`
    SELECT t.item_id AS itemId, t.expected_qty AS expectedQty, t.fact_qty AS factQty,
           t.product_id AS productId, p.name, p.sku, p.unit,
           t.cell_id AS cellId, c.code AS cellCode
    FROM inventory_items t
    JOIN products p ON p.product_id = t.product_id
    JOIN cells c ON c.cell_id = t.cell_id
    WHERE t.inventory_id = ? ORDER BY c.code, p.name`).all(inv.id);
  res.json({ ...inv, items });
});

r.post('/inventories', perm('inventory.create'), (req, res) => {
  const { zoneId } = req.body || {};
  const conds = ['s.quantity > 0'], params = [];
  if (zoneId) { conds.push('c.zone_id = ?'); params.push(+zoneId); }
  const rows = db.prepare(`
    SELECT s.product_id, s.cell_id, s.quantity FROM stock s
    JOIN cells c ON c.cell_id = s.cell_id WHERE ${conds.join(' AND ')}`).all(...params);
  if (!rows.length) return res.status(400).json({ error: 'Нет остатков для пересчёта' });
  const number = nextNumber('inventories', 'number', 'ИНВ');
  const info = db.prepare('INSERT INTO inventories (number, zone_id, user_id) VALUES (?, ?, ?)')
    .run(number, zoneId || null, req.user.id);
  const id = Number(info.lastInsertRowid);
  const ins = db.prepare('INSERT INTO inventory_items (inventory_id, product_id, cell_id, expected_qty) VALUES (?, ?, ?, ?)');
  for (const row of rows) ins.run(id, row.product_id, row.cell_id, row.quantity);
  logAction(req.user, 'создание', 'inventory', id, { number, positions: rows.length });
  res.json({ id, number, positions: rows.length });
});

r.put('/inventories/:id/items/:itemId', perm('inventory.create'), (req, res) => {
  const inv = db.prepare('SELECT * FROM inventories WHERE inventory_id = ?').get(+req.params.id);
  if (!inv) return res.status(404).json({ error: 'Инвентаризация не найдена' });
  if (inv.status !== 'open') return res.status(400).json({ error: 'Инвентаризация уже закрыта' });
  const item = db.prepare('SELECT * FROM inventory_items WHERE item_id = ? AND inventory_id = ?')
    .get(+req.params.itemId, inv.inventory_id);
  if (!item) return res.status(404).json({ error: 'Позиция не найдена' });
  const { factQty } = req.body || {};
  if (factQty === null || factQty === '') {
    db.prepare('UPDATE inventory_items SET fact_qty = NULL WHERE item_id = ?').run(item.item_id);
  } else {
    const q = +factQty;
    if (!Number.isInteger(q) || q < 0) return res.status(400).json({ error: 'Фактическое количество — целое число ≥ 0' });
    db.prepare('UPDATE inventory_items SET fact_qty = ? WHERE item_id = ?').run(q, item.item_id);
  }
  res.json({ ok: true });
});

r.post('/inventories/:id/close', perm('inventory.close'), (req, res) => {
  const inv = db.prepare('SELECT * FROM inventories WHERE inventory_id = ?').get(+req.params.id);
  if (!inv) return res.status(404).json({ error: 'Инвентаризация не найдена' });
  if (inv.status !== 'open') return res.status(400).json({ error: 'Уже закрыта' });
  const unchecked = db.prepare('SELECT COUNT(*) AS n FROM inventory_items WHERE inventory_id = ? AND fact_qty IS NULL').get(inv.inventory_id).n;
  if (unchecked && !req.query.force) {
    return res.status(400).json({ error: `Не пересчитано позиций: ${unchecked}. Закройте все позиции или используйте «закрыть с пропуском».` });
  }
  const diffs = [];
  const items = db.prepare(`
    SELECT t.*, p.name FROM inventory_items t JOIN products p ON p.product_id = t.product_id
    WHERE t.inventory_id = ? AND t.fact_qty IS NOT NULL AND t.fact_qty != t.expected_qty`).all(inv.inventory_id);
  for (const it of items) {
    const row = db.prepare('SELECT * FROM stock WHERE product_id = ? AND cell_id = ?').get(it.product_id, it.cell_id);
    const delta = it.fact_qty - it.expected_qty;
    if (row) {
      const q = Math.max(0, row.quantity + delta);
      if (q === 0) db.prepare('DELETE FROM stock WHERE stock_id = ?').run(row.stock_id);
      else db.prepare('UPDATE stock SET quantity = ?, reserved = MIN(reserved, ?) WHERE stock_id = ?').run(q, q, row.stock_id);
    } else if (it.fact_qty > 0) {
      db.prepare('INSERT INTO stock (product_id, cell_id, quantity) VALUES (?, ?, ?)').run(it.product_id, it.cell_id, it.fact_qty);
    }
    refreshCellStatus(it.cell_id);
    diffs.push({ product: it.name, cell: db.prepare('SELECT code FROM cells WHERE cell_id = ?').get(it.cell_id)?.code, delta });
  }
  db.prepare(`UPDATE inventories SET status = 'closed' WHERE inventory_id = ?`).run(inv.inventory_id);
  logAction(req.user, 'закрытие инвентаризации', 'inventory', inv.inventory_id, { number: inv.number, diffs: diffs.length });
  res.json({ ok: true, diffs });
});

r.delete('/inventories/:id', perm('inventory.create'), (req, res) => {
  const inv = db.prepare('SELECT * FROM inventories WHERE inventory_id = ?').get(+req.params.id);
  if (!inv) return res.status(404).json({ error: 'Инвентаризация не найдена' });
  if (inv.status !== 'open') return res.status(400).json({ error: 'Нельзя удалить закрытую инвентаризацию' });
  db.prepare('DELETE FROM inventories WHERE inventory_id = ?').run(inv.inventory_id);
  logAction(req.user, 'удаление', 'inventory', inv.inventory_id, { number: inv.number });
  res.json({ ok: true });
});

export default r;
