import { Router } from 'express';
import { db } from '../db.js';
import { auth, perm, logAction } from '../auth.js';
import { nextNumber, takeStock, refreshCellStatus } from '../util.js';

const r = Router();
r.use(auth);

const orderListSql = `
  SELECT o.order_id AS id, o.number, o.customer_name AS customerName, o.date, o.status, o.comment,
         u.full_name AS userName,
         COALESCE((SELECT SUM(i.quantity) FROM order_items i WHERE i.order_id = o.order_id), 0) AS totalQty,
         COALESCE((SELECT SUM(i.picked) FROM order_items i WHERE i.order_id = o.order_id), 0) AS pickedQty
  FROM orders o LEFT JOIN users u ON u.user_id = o.user_id`;

function orderItems(orderId) {
  return db.prepare(`
    SELECT i.item_id AS itemId, i.quantity, i.picked, p.product_id AS productId, p.name, p.sku, p.barcode, p.unit
    FROM order_items i JOIN products p ON p.product_id = i.product_id
    WHERE i.order_id = ? ORDER BY i.item_id`).all(orderId);
}

r.get('/orders', perm('orders.view'), (req, res) => {
  const { status = '' } = req.query;
  const where = status ? 'WHERE o.status = ?' : '';
  const params = status ? [status] : [];
  res.json(db.prepare(`${orderListSql} ${where} ORDER BY o.order_id DESC LIMIT 300`).all(...params));
});

r.get('/orders/:id', perm('orders.view'), (req, res) => {
  const o = db.prepare(`${orderListSql} WHERE o.order_id = ?`).get(+req.params.id);
  if (!o) return res.status(404).json({ error: 'Заказ не найден' });
  res.json({ ...o, items: orderItems(o.id) });
});

function availableQty(productId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(s.quantity - s.reserved), 0) AS a
    FROM stock s JOIN cells c ON c.cell_id = s.cell_id
    WHERE s.product_id = ? AND c.status != 'blocked'`).get(productId);
  return row?.a || 0;
}

r.get('/orders/check/:productId', perm('orders.view'), (req, res) => {
  res.json({ available: availableQty(+req.params.productId) });
});

r.post('/orders', perm('orders.create'), (req, res) => {
  const { customerName, comment, items } = req.body || {};
  if (!customerName?.trim()) return res.status(400).json({ error: 'Укажите покупателя' });
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Добавьте позиции' });
  for (const it of items) {
    if (!it.productId || !(+it.quantity > 0)) return res.status(400).json({ error: 'Позиции: товар и количество > 0' });
  }
  const shortages = [];
  for (const it of items) {
    const avail = availableQty(+it.productId);
    if (avail < +it.quantity) {
      const p = db.prepare('SELECT name FROM products WHERE product_id = ?').get(+it.productId);
      shortages.push(`«${p?.name}»: нужно ${it.quantity}, свободно ${avail}`);
    }
  }
  if (shortages.length) return res.status(409).json({ error: 'Недостаточно свободных остатков: ' + shortages.join('; ') });

  const number = nextNumber('orders', 'number', 'ЗАК');
  const info = db.prepare('INSERT INTO orders (number, customer_name, comment, user_id) VALUES (?, ?, ?, ?)')
    .run(number, customerName.trim(), comment || null, req.user.id);
  const orderId = Number(info.lastInsertRowid);
  const ins = db.prepare('INSERT INTO order_items (order_id, product_id, quantity) VALUES (?, ?, ?)');
  const upd = db.prepare('UPDATE stock SET reserved = reserved + ? WHERE stock_id = ?');
  for (const it of items) {
    ins.run(orderId, +it.productId, +it.quantity);
    let need = +it.quantity;
    const rows = db.prepare(`
      SELECT s.* FROM stock s JOIN cells c ON c.cell_id = s.cell_id
      WHERE s.product_id = ? AND s.quantity - s.reserved > 0 AND c.status != 'blocked'
      ORDER BY s.cell_id`).all(+it.productId);
    for (const row of rows) {
      if (need <= 0) break;
      const take = Math.min(need, row.quantity - row.reserved);
      upd.run(take, row.stock_id);
      need -= take;
    }
  }
  logAction(req.user, 'создание', 'order', orderId, { number, customerName, positions: items.length });
  res.json({ id: orderId, number });
});

r.post('/orders/:id/start', perm('orders.pick'), (req, res) => {
  const id = +req.params.id;
  const o = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Заказ не найден' });
  if (o.status !== 'new') return res.status(400).json({ error: 'Заказ уже в работе или закрыт' });
  db.prepare(`UPDATE orders SET status = 'picking' WHERE order_id = ?`).run(id);
  logAction(req.user, 'сборка начата', 'order', id, { number: o.number });
  res.json({ ok: true, route: buildRoute(id) });
});

function buildRoute(orderId) {
  const items = orderItems(orderId);
  const lines = [];
  for (const it of items) {
    let need = it.quantity - it.picked;
    if (need <= 0) continue;
    const rows = db.prepare(`
      SELECT s.stock_id AS stockId, s.quantity AS qty, s.reserved AS res, c.cell_id AS cellId, c.code AS cellCode,
             c.rack, c.section, c.level, z.coord_x AS cx, z.coord_y AS cy, z.name AS zoneName
      FROM stock s JOIN cells c ON c.cell_id = s.cell_id JOIN zones z ON z.zone_id = c.zone_id
      WHERE s.product_id = ? AND s.reserved > 0 AND s.quantity > 0
      ORDER BY z.coord_y, z.coord_x, c.rack, c.section, c.level`).all(it.productId);
    for (const row of rows) {
      if (need <= 0) break;
      const q = Math.min(need, row.res, row.qty);
      if (q <= 0) continue;
      lines.push({ productId: it.productId, name: it.name, sku: it.sku, cellId: row.cellId, cellCode: row.cellCode,
        zoneName: row.zoneName, rack: row.rack, section: row.section, level: row.level, qty: q, stockId: row.stockId });
      need -= q;
    }
    if (need > 0) {
      lines.push({ productId: it.productId, name: it.name, sku: it.sku, cellId: null, cellCode: '—',
        zoneName: null, qty: need, missing: true });
    }
  }
  return lines;
}

r.get('/orders/:id/route', perm('orders.pick'), (req, res) => {
  const o = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(+req.params.id);
  if (!o) return res.status(404).json({ error: 'Заказ не найден' });
  res.json(buildRoute(o.order_id));
});

r.post('/orders/:id/pick', perm('orders.pick'), (req, res) => {
  const id = +req.params.id;
  const o = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Заказ не найден' });
  if (o.status !== 'picking') return res.status(400).json({ error: 'Сборка не начата' });
  const { productId, cellId, quantity } = req.body || {};
  const qty = +quantity;
  if (!(qty > 0)) return res.status(400).json({ error: 'Укажите количество' });
  const item = db.prepare('SELECT * FROM order_items WHERE order_id = ? AND product_id = ?').get(id, +productId);
  if (!item) return res.status(404).json({ error: 'Позиция не найдена в заказе' });
  if (item.picked + qty > item.quantity) {
    return res.status(400).json({ error: `Можно собрать не более ${item.quantity - item.picked} шт.` });
  }
  const row = db.prepare('SELECT * FROM stock WHERE product_id = ? AND cell_id = ?').get(+productId, +cellId);
  if (!row || row.quantity < qty) return res.status(400).json({ error: 'В выбранной ячейке нет столько товара' });
  const newRes = Math.max(0, row.reserved - qty);
  const newQty = row.quantity - qty;
  if (newQty <= 0) {
    db.prepare('DELETE FROM stock WHERE stock_id = ?').run(row.stock_id);
  } else {
    db.prepare('UPDATE stock SET quantity = ?, reserved = ? WHERE stock_id = ?').run(newQty, newRes, row.stock_id);
  }
  refreshCellStatus(+cellId);
  db.prepare('UPDATE order_items SET picked = picked + ? WHERE item_id = ?').run(qty, item.item_id);
  const p = db.prepare('SELECT name FROM products WHERE product_id = ?').get(+productId);
  const c = db.prepare('SELECT code FROM cells WHERE cell_id = ?').get(+cellId);
  logAction(req.user, 'сборка', 'order', id, { product: p?.name, cell: c?.code, qty });
  const rest = db.prepare(`
    SELECT COUNT(*) AS n FROM order_items WHERE order_id = ? AND picked < quantity`).get(id).n;
  res.json({ ok: true, allPicked: rest === 0 });
});

r.post('/orders/:id/complete', perm('orders.complete'), (req, res) => {
  const id = +req.params.id;
  const o = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Заказ не найден' });
  if (o.status !== 'picking') return res.status(400).json({ error: 'Заказ не в стадии сборки' });
  const rest = db.prepare('SELECT * FROM order_items WHERE order_id = ? AND picked < quantity').all(id);
  if (rest.length && !req.query.force) {
    return res.status(400).json({ error: 'Заказ собран не полностью. Отгрузите собранное с force или отмените заказ.' });
  }
  for (const it of rest) {
    let need = it.quantity - it.picked;
    const rows = db.prepare('SELECT * FROM stock WHERE product_id = ? AND reserved > 0 ORDER BY stock_id').all(it.productId);
    const upd = db.prepare('UPDATE stock SET reserved = MAX(0, reserved - ?) WHERE stock_id = ?');
    for (const row of rows) {
      if (need <= 0) break;
      const rel = Math.min(need, row.reserved);
      upd.run(rel, row.stock_id);
      need -= rel;
    }
  }
  db.prepare(`UPDATE orders SET status = 'completed' WHERE order_id = ?`).run(id);
  logAction(req.user, 'отгрузка', 'order', id, { number: o.number, partial: rest.length > 0 });
  res.json({ ok: true });
});

r.post('/orders/:id/cancel', perm('orders.cancel'), (req, res) => {
  const id = +req.params.id;
  const o = db.prepare('SELECT * FROM orders WHERE order_id = ?').get(id);
  if (!o) return res.status(404).json({ error: 'Заказ не найден' });
  if (['completed', 'cancelled'].includes(o.status)) {
    return res.status(400).json({ error: 'Закрытый заказ нельзя отменить' });
  }
  const items = orderItems(id);
  const upd = db.prepare('UPDATE stock SET reserved = MAX(0, reserved - ?) WHERE stock_id = ?');
  for (const it of items) {
    let need = it.quantity - it.picked;
    if (need <= 0) continue;
    const rows = db.prepare('SELECT * FROM stock WHERE product_id = ? AND reserved > 0 ORDER BY stock_id').all(it.productId);
    for (const row of rows) {
      if (need <= 0) break;
      const rel = Math.min(need, row.reserved);
      upd.run(rel, row.stock_id);
      need -= rel;
    }
  }
  db.prepare(`UPDATE orders SET status = 'cancelled' WHERE order_id = ?`).run(id);
  logAction(req.user, 'отмена', 'order', id, { number: o.number });
  res.json({ ok: true });
});

export default r;
