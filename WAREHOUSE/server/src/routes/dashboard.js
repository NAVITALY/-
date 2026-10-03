import { Router } from 'express';
import { db } from '../db.js';
import { auth } from '../auth.js';

const r = Router();
r.use(auth);

r.get('/dashboard', (req, res) => {
  const cells = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(status = 'free') AS free, SUM(status = 'occupied') AS occupied,
      SUM(status = 'blocked') AS blocked, SUM(status = 'maintenance') AS maintenance
    FROM cells`).get();
  const stock = db.prepare(`
    SELECT COUNT(DISTINCT product_id) AS skuCount, COALESCE(SUM(quantity), 0) AS totalQty,
           COALESCE(SUM(reserved), 0) AS reservedQty
    FROM stock WHERE quantity > 0`).get();
  const products = db.prepare('SELECT COUNT(*) AS n FROM products').get();
  const today = new Date().toISOString().slice(0, 10);
  const receiptsToday = db.prepare(`SELECT COUNT(*) AS n FROM receipts WHERE date >= ?`).get(today + ' 00:00:00').n;
  const ordersToday = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE date >= ?`).get(today + ' 00:00:00').n;
  const pending = {
    receipts: db.prepare(`SELECT COUNT(*) AS n FROM receipts WHERE status IN ('new','confirmed')`).get().n,
    orders: db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE status IN ('new','picking')`).get().n,
    inventories: db.prepare(`SELECT COUNT(*) AS n FROM inventories WHERE status = 'open'`).get().n,
  };
  const lowStock = db.prepare(`
    SELECT p.product_id AS productId, p.name, p.sku, p.unit, p.min_stock AS minStock,
           COALESCE(SUM(s.quantity), 0) AS qty
    FROM products p LEFT JOIN stock s ON s.product_id = p.product_id
    GROUP BY p.product_id HAVING minStock > 0 AND qty < minStock ORDER BY qty ASC LIMIT 8`).all();
  const byZone = db.prepare(`
    SELECT z.name AS zone, COUNT(c.cell_id) AS total, SUM(c.status = 'occupied') AS occupied
    FROM zones z JOIN cells c ON c.zone_id = z.zone_id GROUP BY z.zone_id ORDER BY z.name`).all()
    .map(x => ({ ...x, pct: x.total ? Math.round(x.occupied / x.total * 100) : 0 }));
  const byCategory = db.prepare(`
    SELECT COALESCE(pc.name, c.name, 'Без категории') AS name, COALESCE(SUM(s.quantity), 0) AS qty
    FROM stock s
    JOIN products p ON p.product_id = s.product_id
    LEFT JOIN categories c ON c.category_id = p.category_id
    LEFT JOIN categories pc ON pc.category_id = c.parent_id
    GROUP BY COALESCE(pc.name, c.name, 'Без категории') HAVING qty > 0 ORDER BY qty DESC LIMIT 8`).all();
  const recentLogs = db.prepare(`
    SELECT l.action, l.entity, l.details, l.timestamp, COALESCE(u.full_name, '—') AS userName
    FROM operation_logs l LEFT JOIN users u ON u.user_id = l.user_id
    ORDER BY l.log_id DESC LIMIT 10`).all();
  const ordersByStatus = db.prepare(`
    SELECT status, COUNT(*) AS n FROM orders GROUP BY status`).all();
  const receiptsByStatus = db.prepare(`
    SELECT status, COUNT(*) AS n FROM receipts GROUP BY status`).all();
  const pendingReceipts = db.prepare(`
    SELECT rc.receipt_id AS id, rc.number, rc.supplier, rc.status, rc.date,
           COALESCE((SELECT SUM(i.quantity - i.placed) FROM receipt_items i WHERE i.receipt_id = rc.receipt_id), 0) AS toPlace
    FROM receipts rc WHERE rc.status IN ('new','confirmed') ORDER BY rc.receipt_id DESC LIMIT 5`).all();
  const pendingOrders = db.prepare(`
    SELECT o.order_id AS id, o.number, o.customer_name AS customerName, o.status, o.date,
           COALESCE((SELECT SUM(i.quantity) FROM order_items i WHERE i.order_id = o.order_id), 0) AS totalQty,
           COALESCE((SELECT SUM(i.picked) FROM order_items i WHERE i.order_id = o.order_id), 0) AS pickedQty
    FROM orders o WHERE o.status IN ('new','picking') ORDER BY o.order_id DESC LIMIT 5`).all();
  const rcByDay = db.prepare(`SELECT COUNT(*) AS n FROM receipts WHERE substr(date, 1, 10) = ?`);
  const orByDay = db.prepare(`SELECT COUNT(*) AS n FROM orders WHERE substr(date, 1, 10) = ?`);
  const weekly = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    weekly.push({ day: d.slice(5).split('-').reverse().join('.'), receipts: rcByDay.get(d).n, orders: orByDay.get(d).n });
  }
  res.json({
    cells, stock, products: products.n, receiptsToday, ordersToday, pending, lowStock,
    byZone, byCategory, recentLogs, ordersByStatus, receiptsByStatus,
    pendingReceipts, pendingOrders, weekly,
  });
});

export default r;
