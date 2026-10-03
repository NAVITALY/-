import { Router } from 'express';
import { db } from '../db.js';
import { auth, perm, logAction } from '../auth.js';
import { cellFill, refreshCellStatus, suggestCells, addStock, takeStock, productVolume } from '../util.js';

const r = Router();
r.use(auth);

/* ---------------- Zones ---------------- */

r.get('/zones', (req, res) => {
  const rows = db.prepare(`
    SELECT z.zone_id AS id, z.name, z.type, z.coord_x AS coordX, z.coord_y AS coordY,
      (SELECT COUNT(*) FROM cells c WHERE c.zone_id = z.zone_id) AS cellsCount
    FROM zones z ORDER BY z.coord_y, z.coord_x, z.name`).all();
  res.json(rows);
});

r.post('/zones', perm('zones.edit'), (req, res) => {
  const { name, type = 'storage', coordX = 0, coordY = 0 } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: 'Укажите название зоны' });
  const info = db.prepare('INSERT INTO zones (name, type, coord_x, coord_y) VALUES (?, ?, ?, ?)')
    .run(name.trim(), type, +coordX, +coordY);
  logAction(req.user, 'создание', 'zone', Number(info.lastInsertRowid), { name });
  res.json({ id: Number(info.lastInsertRowid) });
});

r.put('/zones/:id', perm('zones.edit'), (req, res) => {
  const id = +req.params.id;
  const z = db.prepare('SELECT * FROM zones WHERE zone_id = ?').get(id);
  if (!z) return res.status(404).json({ error: 'Зона не найдена' });
  const { name, type, coordX, coordY } = req.body || {};
  db.prepare('UPDATE zones SET name = ?, type = ?, coord_x = ?, coord_y = ? WHERE zone_id = ?')
    .run(name?.trim() || z.name, type ?? z.type, coordX ?? z.coord_x, coordY ?? z.coord_y, id);
  logAction(req.user, 'изменение', 'zone', id, { name, type });
  res.json({ ok: true });
});

r.delete('/zones/:id', perm('zones.edit'), (req, res) => {
  const id = +req.params.id;
  if (db.prepare('SELECT 1 FROM cells WHERE zone_id = ?').get(id)) {
    return res.status(409).json({ error: 'В зоне есть ячейки — сначала удалите их' });
  }
  const info = db.prepare('DELETE FROM zones WHERE zone_id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Зона не найдена' });
  logAction(req.user, 'удаление', 'zone', id);
  res.json({ ok: true });
});

/* ---------------- Cells ---------------- */

const cellSelect = `
  SELECT c.cell_id AS id, c.code, c.zone_id AS zoneId, z.name AS zoneName, z.type AS zoneType,
         c.rack, c.section, c.level,
         c.length_mm AS lengthMm, c.width_mm AS widthMm, c.height_mm AS heightMm,
         c.max_weight_kg AS maxWeight, c.max_volume_m3 AS maxVolume,
         c.turnover_class AS turnoverClass, c.status
  FROM cells c JOIN zones z ON z.zone_id = c.zone_id`;

function withFill(cell) {
  const f = cellFill(cell.id);
  return {
    ...cell, qty: f.qty, usedWeight: +f.weight.toFixed(2), usedVolume: +f.volume.toFixed(3),
    fillPct: cell.maxVolume > 0 ? Math.min(100, Math.round((f.volume / cell.maxVolume) * 100)) : 0,
  };
}

r.get('/cells', (req, res) => {
  const { zoneId = '', status = '', q = '' } = req.query;
  const conds = [], params = [];
  if (zoneId) { conds.push('c.zone_id = ?'); params.push(+zoneId); }
  if (status) { conds.push('c.status = ?'); params.push(status); }
  if (q) { conds.push('c.code LIKE ?'); params.push(`%${q}%`); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const rows = db.prepare(`${cellSelect} ${where} ORDER BY z.name, c.rack, c.section, c.level LIMIT 1000`).all(...params);
  res.json(rows.map(withFill));
});

r.get('/cells/map', (req, res) => {
  const zones = db.prepare('SELECT * FROM zones ORDER BY coord_y, coord_x').all();
  const cells = db.prepare(`${cellSelect} ORDER BY z.name, c.rack, c.section, c.level`).all();
  const byZone = new Map();
  for (const c of cells) {
    const w = withFill(c);
    if (!byZone.has(w.zoneId)) byZone.set(w.zoneId, []);
    byZone.get(w.zoneId).push(w);
  }
  res.json(zones.map(z => ({
    id: z.zone_id, name: z.name, type: z.type, coordX: z.coord_x, coordY: z.coord_y,
    cells: byZone.get(z.zone_id) || [],
  })));
});

r.get('/cells/suggest', perm('receipts.place'), (req, res) => {
  const { productId, qty } = req.query;
  res.json(suggestCells(+productId, +qty || 1, 8));
});

r.get('/cells/:id/contents', (req, res) => {
  const cell = db.prepare(`${cellSelect} WHERE c.cell_id = ?`).get(+req.params.id);
  if (!cell) return res.status(404).json({ error: 'Ячейка не найдена' });
  const items = db.prepare(`
    SELECT s.stock_id AS stockId, s.quantity AS qty, s.reserved AS reserved,
           p.product_id AS productId, p.name, p.sku, p.weight_kg AS weightKg
    FROM stock s JOIN products p ON p.product_id = s.product_id
    WHERE s.cell_id = ? AND s.quantity > 0 ORDER BY p.name`).all(+req.params.id);
  res.json({ ...withFill(cell), items });
});

r.post('/cells', perm('cells.edit'), (req, res) => {
  const b = req.body || {};
  if (!b.code?.trim()) return res.status(400).json({ error: 'Укажите адрес (код) ячейки' });
  if (!b.zoneId) return res.status(400).json({ error: 'Выберите зону' });
  if (db.prepare('SELECT 1 FROM cells WHERE code = ?').get(b.code.trim())) {
    return res.status(409).json({ error: 'Ячейка с таким адресом уже существует' });
  }
  const l = +b.lengthMm || 1200, w = +b.widthMm || 1000, h = +b.heightMm || 1000;
  const info = db.prepare(`
    INSERT INTO cells (code, zone_id, rack, section, level, length_mm, width_mm, height_mm, max_weight_kg, max_volume_m3, turnover_class, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(b.code.trim(), +b.zoneId, b.rack || null, +b.section || 0, +b.level || 0,
      l, w, h, +b.maxWeight || 100, +b.maxVolume || +(l * w * h / 1e9).toFixed(2),
      b.turnoverClass || null, b.status || 'free');
  logAction(req.user, 'создание', 'cell', Number(info.lastInsertRowid), { code: b.code });
  res.json({ id: Number(info.lastInsertRowid) });
});

r.post('/cells/bulk', perm('cells.edit'), (req, res) => {
  const b = req.body || {};
  const { zoneId, rack, sections = 4, levels = 3, lengthMm = 1200, widthMm = 1000, heightMm = 1000, maxWeight = 200, turnoverClass } = b;
  if (!zoneId || !rack?.trim()) return res.status(400).json({ error: 'Укажите зону и имя стеллажа' });
  const zone = db.prepare('SELECT * FROM zones WHERE zone_id = ?').get(+zoneId);
  if (!zone) return res.status(404).json({ error: 'Зона не найдена' });
  const vol = +(lengthMm * widthMm * heightMm / 1e9).toFixed(2);
  let created = 0;
  const ins = db.prepare(`
    INSERT INTO cells (code, zone_id, rack, section, level, length_mm, width_mm, height_mm, max_weight_kg, max_volume_m3, turnover_class)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (let s = 1; s <= +sections; s++) {
    for (let l = 1; l <= +levels; l++) {
      const code = `${String(rack).trim()}-${String(s).padStart(2, '0')}-${l}`;
      if (db.prepare('SELECT 1 FROM cells WHERE code = ?').get(code)) continue;
      ins.run(code, +zoneId, String(rack).trim(), s, l, +lengthMm, +widthMm, +heightMm, +maxWeight, vol, turnoverClass || null);
      created++;
    }
  }
  logAction(req.user, 'генерация ячеек', 'cell', null, { rack, created });
  res.json({ created });
});

r.put('/cells/:id', perm('cells.edit'), (req, res) => {
  const id = +req.params.id;
  const c = db.prepare('SELECT * FROM cells WHERE cell_id = ?').get(id);
  if (!c) return res.status(404).json({ error: 'Ячейка не найдена' });
  const b = req.body || {};
  const num = (v, d) => (v === undefined || v === null || v === '' || isNaN(+v) ? d : +v);
  const l = num(b.lengthMm, c.length_mm), w = num(b.widthMm, c.width_mm), h = num(b.heightMm, c.height_mm);
  db.prepare(`
    UPDATE cells SET code = ?, zone_id = ?, rack = ?, section = ?, level = ?, length_mm = ?, width_mm = ?,
      height_mm = ?, max_weight_kg = ?, max_volume_m3 = ?, turnover_class = ?, status = ? WHERE cell_id = ?`)
    .run(b.code?.trim() || c.code, b.zoneId ?? c.zone_id, b.rack ?? c.rack, b.section ?? c.section,
      b.level ?? c.level, l, w, h, num(b.maxWeight, c.max_weight_kg), num(b.maxVolume, c.max_volume_m3),
      b.turnoverClass === undefined ? c.turnover_class : (b.turnoverClass || null), b.status ?? c.status, id);
  refreshCellStatus(id);
  logAction(req.user, 'изменение', 'cell', id, { code: b.code, status: b.status });
  res.json({ ok: true });
});

r.delete('/cells/:id', perm('cells.edit'), (req, res) => {
  const id = +req.params.id;
  const { q } = db.prepare('SELECT COALESCE(SUM(quantity),0) AS q FROM stock WHERE cell_id = ?').get(id);
  if (q > 0) return res.status(409).json({ error: 'В ячейке есть товар — переместите или отгрузите его' });
  db.prepare('DELETE FROM stock WHERE cell_id = ?').run(id);
  const info = db.prepare('DELETE FROM cells WHERE cell_id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Ячейка не найдена' });
  logAction(req.user, 'удаление', 'cell', id);
  res.json({ ok: true });
});

/* ---------------- Stock ---------------- */

r.get('/stock', perm('stock.view'), (req, res) => {
  const { productId = '', cellId = '', zoneId = '', q = '' } = req.query;
  const conds = ['s.quantity > 0'], params = [];
  if (productId) { conds.push('s.product_id = ?'); params.push(+productId); }
  if (cellId) { conds.push('s.cell_id = ?'); params.push(+cellId); }
  if (zoneId) { conds.push('c.zone_id = ?'); params.push(+zoneId); }
  if (q) { conds.push('(p.name LIKE ? OR p.sku LIKE ? OR c.code LIKE ?)'); params.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const rows = db.prepare(`
    SELECT s.stock_id AS id, s.quantity AS qty, s.reserved AS reserved,
           p.product_id AS productId, p.name AS productName, p.sku, p.unit, p.weight_kg AS weightKg,
           p.length_mm AS lengthMm, p.width_mm AS widthMm, p.height_mm AS heightMm,
           c.cell_id AS cellId, c.code AS cellCode, z.name AS zoneName, z.zone_id AS zoneId
    FROM stock s
    JOIN products p ON p.product_id = s.product_id
    JOIN cells c ON c.cell_id = s.cell_id
    JOIN zones z ON z.zone_id = c.zone_id
    WHERE ${conds.join(' AND ')} ORDER BY c.code, p.name LIMIT 1000`).all(...params);
  res.json(rows);
});

r.post('/stock/move', perm('stock.move'), (req, res) => {
  const { productId, fromCellId, toCellId, quantity } = req.body || {};
  const qty = +quantity;
  if (!productId || !fromCellId || !toCellId || !(qty > 0)) {
    return res.status(400).json({ error: 'Укажите товар, ячейки и количество' });
  }
  if (+fromCellId === +toCellId) return res.status(400).json({ error: 'Ячейки совпадают' });
  const p = db.prepare('SELECT * FROM products WHERE product_id = ?').get(+productId);
  const from = db.prepare('SELECT * FROM cells WHERE cell_id = ?').get(+fromCellId);
  const to = db.prepare('SELECT * FROM cells WHERE cell_id = ?').get(+toCellId);
  if (!p || !from || !to) return res.status(404).json({ error: 'Товар или ячейка не найдены' });
  if (to.status === 'blocked' || to.status === 'maintenance') {
    return res.status(400).json({ error: `Ячейка ${to.code} в статусе «${to.status}»` });
  }
  const src = db.prepare('SELECT * FROM stock WHERE product_id = ? AND cell_id = ?').get(+productId, +fromCellId);
  if (!src || src.quantity < qty) return res.status(400).json({ error: 'В исходной ячейке недостаточно товара' });
  if (src.reserved > 0 && src.reserved + qty > src.quantity) {
    return res.status(400).json({ error: 'Часть товара зарезервирована под заказы' });
  }
  const fill = cellFill(to.cell_id);
  const addW = qty * p.weight_kg, addV = qty * productVolume(p);
  if (fill.weight + addW > to.max_weight_kg) return res.status(400).json({ error: `Превышение грузоподъёмности ячейки ${to.code}` });
  if (fill.volume + addV > to.max_volume_m3) return res.status(400).json({ error: `Товар не помещается в ячейку ${to.code} по объёму` });
  takeStock(+productId, +fromCellId, qty);
  addStock(+productId, +toCellId, qty);
  logAction(req.user, 'перемещение', 'stock', src.stock_id, { product: p.name, from: from.code, to: to.code, qty });
  res.json({ ok: true });
});

export default r;
