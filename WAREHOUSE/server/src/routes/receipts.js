import { Router } from 'express';
import { db } from '../db.js';
import { auth, perm, logAction } from '../auth.js';
import { nextNumber, stagingCell, addStock, takeStock, suggestCells, cellFill, productVolume, refreshCellStatus } from '../util.js';

const r = Router();
r.use(auth);

const receiptListSql = `
  SELECT rc.receipt_id AS id, rc.number, rc.supplier, rc.date, rc.status, rc.comment,
         u.full_name AS userName,
         (SELECT COUNT(*) FROM receipt_items i WHERE i.receipt_id = rc.receipt_id) AS itemsCount,
         COALESCE((SELECT SUM(i.quantity) FROM receipt_items i WHERE i.receipt_id = rc.receipt_id), 0) AS totalQty
  FROM receipts rc LEFT JOIN users u ON u.user_id = rc.user_id`;

r.get('/receipts', perm('receipts.view'), (req, res) => {
  const { status = '' } = req.query;
  const where = status ? 'WHERE rc.status = ?' : '';
  const params = status ? [status] : [];
  res.json(db.prepare(`${receiptListSql} ${where} ORDER BY rc.receipt_id DESC LIMIT 300`).all(...params));
});

r.get('/receipts/:id', perm('receipts.view'), (req, res) => {
  const rc = db.prepare(`${receiptListSql} WHERE rc.receipt_id = ?`).get(+req.params.id);
  if (!rc) return res.status(404).json({ error: 'Приёмка не найдена' });
  const items = db.prepare(`
    SELECT i.item_id AS itemId, i.quantity, i.placed, p.product_id AS productId, p.name, p.sku,
           p.barcode, p.unit, p.length_mm AS lengthMm, p.width_mm AS widthMm, p.height_mm AS heightMm, p.weight_kg AS weightKg
    FROM receipt_items i JOIN products p ON p.product_id = i.product_id
    WHERE i.receipt_id = ? ORDER BY i.item_id`).all(rc.id);
  res.json({ ...rc, items });
});

function validateItems(items) {
  if (!Array.isArray(items) || !items.length) return 'Добавьте хотя бы одну позицию';
  for (const it of items) {
    if (!it.productId || !(+it.quantity > 0)) return 'Каждая позиция: товар и количество > 0';
    if (!db.prepare('SELECT 1 FROM products WHERE product_id = ?').get(+it.productId)) {
      return `Товар #${it.productId} не найден`;
    }
  }
  return null;
}

r.post('/receipts', perm('receipts.create'), (req, res) => {
  const { supplier, comment, items } = req.body || {};
  if (!supplier?.trim()) return res.status(400).json({ error: 'Укажите поставщика' });
  const err = validateItems(items);
  if (err) return res.status(400).json({ error: err });
  const number = nextNumber('receipts', 'number', 'ПР');
  const info = db.prepare('INSERT INTO receipts (number, supplier, comment, user_id) VALUES (?, ?, ?, ?)')
    .run(number, supplier.trim(), comment || null, req.user.id);
  const id = Number(info.lastInsertRowid);
  const ins = db.prepare('INSERT INTO receipt_items (receipt_id, product_id, quantity) VALUES (?, ?, ?)');
  for (const it of items) ins.run(id, +it.productId, +it.quantity);
  logAction(req.user, 'создание', 'receipt', id, { number, supplier, positions: items.length });
  res.json({ id, number });
});

r.put('/receipts/:id', perm('receipts.create'), (req, res) => {
  const id = +req.params.id;
  const rc = db.prepare('SELECT * FROM receipts WHERE receipt_id = ?').get(id);
  if (!rc) return res.status(404).json({ error: 'Приёмка не найдена' });
  if (rc.status !== 'new') return res.status(400).json({ error: 'Редактировать можно только приёмку в статусе «новая»' });
  const { supplier, comment, items } = req.body || {};
  const err = validateItems(items);
  if (err) return res.status(400).json({ error: err });
  db.prepare('UPDATE receipts SET supplier = ?, comment = ? WHERE receipt_id = ?')
    .run(supplier?.trim() || rc.supplier, comment ?? rc.comment, id);
  db.prepare('DELETE FROM receipt_items WHERE receipt_id = ?').run(id);
  const ins = db.prepare('INSERT INTO receipt_items (receipt_id, product_id, quantity) VALUES (?, ?, ?)');
  for (const it of items) ins.run(id, +it.productId, +it.quantity);
  logAction(req.user, 'изменение', 'receipt', id, { number: rc.number });
  res.json({ ok: true });
});

r.post('/receipts/:id/confirm', perm('receipts.confirm'), (req, res) => {
  const id = +req.params.id;
  const rc = db.prepare('SELECT * FROM receipts WHERE receipt_id = ?').get(id);
  if (!rc) return res.status(404).json({ error: 'Приёмка не найдена' });
  if (rc.status !== 'new') return res.status(400).json({ error: 'Подтвердить можно только новую приёмку' });
  const staging = stagingCell();
  const items = db.prepare('SELECT * FROM receipt_items WHERE receipt_id = ?').all(id);
  for (const it of items) addStock(it.product_id, staging.cell_id, it.quantity);
  db.prepare(`UPDATE receipts SET status = 'confirmed' WHERE receipt_id = ?`).run(id);
  logAction(req.user, 'подтверждение приёмки', 'receipt', id, { number: rc.number, cell: staging.code });
  res.json({ ok: true, stagingCell: staging.code });
});

r.post('/receipts/:id/place', perm('receipts.place'), (req, res) => {
  const id = +req.params.id;
  const rc = db.prepare('SELECT * FROM receipts WHERE receipt_id = ?').get(id);
  if (!rc) return res.status(404).json({ error: 'Приёмка не найдена' });
  if (!['confirmed', 'placed'].includes(rc.status)) {
    return res.status(400).json({ error: 'Сначала подтвердите приёмку (товар должен быть в зоне приёмки)' });
  }
  const staging = stagingCell();
  const items = db.prepare('SELECT * FROM receipt_items WHERE receipt_id = ?').all(id);
  const placements = [];
  const problems = [];
  for (const it of items) {
    let remaining = it.quantity - it.placed;
    if (remaining <= 0) continue;
    const from = db.prepare('SELECT * FROM stock WHERE product_id = ? AND cell_id = ?').get(it.product_id, staging.cell_id);
    const inStaging = from ? from.quantity : 0;
    remaining = Math.min(remaining, inStaging);
    if (remaining <= 0) { problems.push(`Товар #${it.product_id}: нет на месте в зоне приёмки`); continue; }
    const candidates = suggestCells(it.product_id, remaining, 20);
    const before = remaining;
    for (const c of candidates) {
      if (remaining <= 0) break;
      const move = Math.min(remaining, c.room);
      if (!takeStock(it.product_id, staging.cell_id, move)) continue;
      addStock(it.product_id, c.cellId, move);
      placements.push({ cell: c.code, productId: it.product_id, qty: move });
      remaining -= move;
    }
    db.prepare('UPDATE receipt_items SET placed = placed + ? WHERE item_id = ?')
      .run(before - remaining, it.item_id);
    if (remaining > 0) {
      const p = db.prepare('SELECT name FROM products WHERE product_id = ?').get(it.product_id);
      problems.push(`«${p?.name}»: не хватило свободных ячеек (${remaining} шт. остались в приёмке)`);
    }
  }
  const allPlaced = db.prepare(`
    SELECT COUNT(*) AS n FROM receipt_items WHERE receipt_id = ? AND placed < quantity`).get(id).n === 0;
  db.prepare(`UPDATE receipts SET status = ? WHERE receipt_id = ?`).run(allPlaced ? 'placed' : 'confirmed', id);
  logAction(req.user, allPlaced ? 'размещение' : 'частичное размещение', 'receipt', id, { number: rc.number, moves: placements.length });
  res.json({ ok: true, complete: allPlaced, placements, problems });
});

r.post('/receipts/:id/cancel', perm('receipts.create'), (req, res) => {
  const id = +req.params.id;
  const rc = db.prepare('SELECT * FROM receipts WHERE receipt_id = ?').get(id);
  if (!rc) return res.status(404).json({ error: 'Приёмка не найдена' });
  if (rc.status === 'placed' || rc.status === 'cancelled') {
    return res.status(400).json({ error: 'Нельзя отменить размещённую или отменённую приёмку' });
  }
  if (rc.status === 'confirmed') {
    const staging = stagingCell();
    const items = db.prepare('SELECT * FROM receipt_items WHERE receipt_id = ?').all(id);
    for (const it of items) {
      const left = it.quantity - it.placed;
      if (left > 0) takeStock(it.product_id, staging.cell_id, Math.min(left,
        db.prepare('SELECT quantity AS q FROM stock WHERE product_id = ? AND cell_id = ?').get(it.product_id, staging.cell_id)?.q || 0));
    }
  }
  db.prepare(`UPDATE receipts SET status = 'cancelled' WHERE receipt_id = ?`).run(id);
  logAction(req.user, 'отмена', 'receipt', id, { number: rc.number });
  res.json({ ok: true });
});

export default r;
