import { Router } from 'express';
import { db } from '../db.js';
import { auth, perm, logAction } from '../auth.js';
import { genBarcode, genSku, productVolume, cellFill } from '../util.js';

const r = Router();
r.use(auth);

/* ---------------- Categories ---------------- */

r.get('/categories', (req, res) => {
  const rows = db.prepare(`
    SELECT c.category_id AS id, c.name, c.parent_id AS parentId,
      (SELECT COUNT(*) FROM products p WHERE p.category_id = c.category_id) AS productsCount
    FROM categories c ORDER BY c.parent_id IS NOT NULL, c.name`).all();
  res.json(rows);
});

r.post('/categories', perm('categories.edit'), (req, res) => {
  const { name, parentId } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Укажите название' });
  const info = db.prepare('INSERT INTO categories (name, parent_id) VALUES (?, ?)')
    .run(name.trim(), parentId || null);
  logAction(req.user, 'создание', 'category', Number(info.lastInsertRowid), { name });
  res.json({ id: Number(info.lastInsertRowid) });
});

r.put('/categories/:id', perm('categories.edit'), (req, res) => {
  const id = +req.params.id;
  const c = db.prepare('SELECT * FROM categories WHERE category_id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Категория не найдена' });
  const { name, parentId } = req.body || {};
  if (parentId && +parentId === id) return res.status(400).json({ error: 'Категория не может быть родителем самой себе' });
  db.prepare('UPDATE categories SET name = ?, parent_id = ? WHERE category_id = ?')
    .run(name?.trim() || c.name, parentId === undefined ? c.parent_id : (parentId || null), id);
  logAction(req.user, 'изменение', 'category', id, { name, parentId });
  res.json({ ok: true });
});

r.delete('/categories/:id', perm('categories.edit'), (req, res) => {
  const id = +req.params.id;
  if (db.prepare('SELECT 1 FROM categories WHERE parent_id = ?').get(id)) {
    return res.status(409).json({ error: 'Сначала удалите вложенные категории' });
  }
  if (db.prepare('SELECT 1 FROM products WHERE category_id = ?').get(id)) {
    return res.status(409).json({ error: 'В категории есть товары' });
  }
  const info = db.prepare('DELETE FROM categories WHERE category_id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Категория не найдена' });
  logAction(req.user, 'удаление', 'category', id);
  res.json({ ok: true });
});

/* ---------------- Products ---------------- */

const productSql = `
  SELECT p.product_id AS id, p.sku, p.barcode, p.name, p.category_id AS categoryId,
         c.name AS categoryName, pc.name AS parentCategoryName,
         p.length_mm AS lengthMm, p.width_mm AS widthMm, p.height_mm AS heightMm,
         p.weight_kg AS weightKg, p.turnover_class AS turnoverClass, p.is_fragile AS isFragile,
         p.min_stock AS minStock, p.unit, p.created_at AS createdAt,
         COALESCE((SELECT SUM(s.quantity) FROM stock s WHERE s.product_id = p.product_id), 0) AS totalQty,
         COALESCE((SELECT SUM(s.reserved) FROM stock s WHERE s.product_id = p.product_id), 0) AS reservedQty
  FROM products p
  LEFT JOIN categories c ON c.category_id = p.category_id
  LEFT JOIN categories pc ON pc.category_id = c.parent_id`;

function productOut(row) {
  return { ...row, volumeM3: +(row.lengthMm * row.widthMm * row.heightMm / 1e9).toFixed(4) };
}

r.get('/products', (req, res) => {
  const { q = '', categoryId = '', fragile = '', turnover = '' } = req.query;
  const conds = [], params = [];
  if (q) {
    conds.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (categoryId) {
    conds.push('(p.category_id = ? OR c.parent_id = ?)');
    params.push(+categoryId, +categoryId);
  }
  if (fragile === '1') conds.push('p.is_fragile = 1');
  if (turnover) { conds.push('p.turnover_class = ?'); params.push(turnover); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(`${productSql} ${where} ORDER BY p.name LIMIT 500`).all(...params);
  res.json(rows.map(productOut));
});

r.get('/products/barcode/:code', perm('products.view'), (req, res) => {
  const row = db.prepare(`${productSql} WHERE p.barcode = ? OR p.sku = ?`).get(req.params.code, req.params.code);
  if (!row) return res.status(404).json({ error: 'Товар не найден по штрихкоду/артикулу' });
  res.json(productOut(row));
});

r.get('/products/:id', (req, res) => {
  const row = db.prepare(`${productSql} WHERE p.product_id = ?`).get(+req.params.id);
  if (!row) return res.status(404).json({ error: 'Товар не найден' });
  const cells = db.prepare(`
    SELECT s.stock_id AS stockId, s.cell_id AS cellId, cc.code AS cellCode, z.name AS zoneName,
           s.quantity AS qty, s.reserved AS reserved
    FROM stock s
    JOIN cells cc ON cc.cell_id = s.cell_id
    JOIN zones z ON z.zone_id = cc.zone_id
    WHERE s.product_id = ? AND s.quantity > 0 ORDER BY cc.code`).all(+req.params.id);
  res.json({ ...productOut(row), cells });
});

function validateProduct(b) {
  if (!b.name?.trim()) return 'Укажите наименование товара';
  if (!(+b.lengthMm > 0 && +b.widthMm > 0 && +b.heightMm > 0)) return 'Габариты должны быть больше нуля';
  if (!(+b.weightKg > 0)) return 'Укажите вес (> 0)';
  if (!['A', 'B', 'C'].includes(b.turnoverClass)) return 'Класс оборачиваемости: A, B или C';
  return null;
}

r.post('/products', perm('products.edit'), (req, res) => {
  const b = req.body || {};
  const err = validateProduct(b);
  if (err) return res.status(400).json({ error: err });
  const sku = (b.sku || '').trim() || genSku();
  let barcode = (b.barcode || '').trim();
  for (let i = 0; !barcode || db.prepare('SELECT 1 FROM products WHERE barcode = ?').get(barcode); i++) {
    if (i > 20) return res.status(500).json({ error: 'Не удалось сгенерировать штрихкод' });
    barcode = genBarcode();
  }
  if (db.prepare('SELECT 1 FROM products WHERE sku = ?').get(sku)) {
    return res.status(409).json({ error: 'Артикул уже используется' });
  }
  const info = db.prepare(`
    INSERT INTO products (sku, barcode, name, category_id, length_mm, width_mm, height_mm, weight_kg,
                          turnover_class, is_fragile, min_stock, unit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sku, barcode, b.name.trim(), b.categoryId || null, +b.lengthMm, +b.widthMm, +b.heightMm, +b.weightKg,
      b.turnoverClass, b.isFragile ? 1 : 0, +b.minStock || 0, b.unit || 'шт');
  const id = Number(info.lastInsertRowid);
  logAction(req.user, 'создание', 'product', id, { name: b.name, sku, barcode });
  res.json({ id, sku, barcode });
});

r.put('/products/:id', perm('products.edit'), (req, res) => {
  const id = +req.params.id;
  const p = db.prepare('SELECT * FROM products WHERE product_id = ?').get(id);
  if (!p) return res.status(404).json({ error: 'Товар не найден' });
  const b = req.body || {};
  const merged = {
    name: b.name ?? p.name, lengthMm: b.lengthMm ?? p.length_mm, widthMm: b.widthMm ?? p.width_mm,
    heightMm: b.heightMm ?? p.height_mm, weightKg: b.weightKg ?? p.weight_kg,
    turnoverClass: b.turnoverClass ?? p.turnover_class,
  };
  const err = validateProduct(merged);
  if (err) return res.status(400).json({ error: err });
  const sku = (b.sku ?? p.sku).trim();
  if (sku !== p.sku && db.prepare('SELECT 1 FROM products WHERE sku = ? AND product_id != ?').get(sku, id)) {
    return res.status(409).json({ error: 'Артикул уже используется' });
  }
  const barcode = (b.barcode ?? p.barcode).trim();
  if (barcode !== p.barcode && db.prepare('SELECT 1 FROM products WHERE barcode = ? AND product_id != ?').get(barcode, id)) {
    return res.status(409).json({ error: 'Штрихкод уже используется' });
  }
  db.prepare(`
    UPDATE products SET sku = ?, barcode = ?, name = ?, category_id = ?, length_mm = ?, width_mm = ?,
      height_mm = ?, weight_kg = ?, turnover_class = ?, is_fragile = ?, min_stock = ?, unit = ?
    WHERE product_id = ?`)
    .run(sku, barcode, merged.name, b.categoryId === undefined ? p.category_id : (b.categoryId || null),
      +merged.lengthMm, +merged.widthMm, +merged.heightMm, +merged.weightKg, merged.turnoverClass,
      b.isFragile === undefined ? p.is_fragile : (b.isFragile ? 1 : 0),
      b.minStock === undefined ? p.min_stock : +b.minStock, b.unit || p.unit, id);
  logAction(req.user, 'изменение', 'product', id, { name: merged.name });
  res.json({ ok: true });
});

r.delete('/products/:id', perm('products.delete'), (req, res) => {
  const id = +req.params.id;
  const stockRow = db.prepare('SELECT SUM(quantity) AS q FROM stock WHERE product_id = ?').get(id);
  if (stockRow?.q > 0) return res.status(409).json({ error: 'У товара есть остатки на складе — удаление запрещено' });
  db.prepare('DELETE FROM stock WHERE product_id = ?').run(id);
  const info = db.prepare('DELETE FROM products WHERE product_id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Товар не найден' });
  logAction(req.user, 'удаление', 'product', id);
  res.json({ ok: true });
});

export default r;
