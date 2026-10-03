import { db } from './db.js';

const year = () => new Date().toISOString().slice(0, 4);

export function nextNumber(table, column, prefix) {
  const re = new RegExp(`^${prefix}-${year()}-(\\d+)$`);
  let max = 0;
  for (const row of db.prepare(`SELECT ${column} AS n FROM ${table}`).all()) {
    const m = re.exec(row.n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${year()}-${String(max + 1).padStart(4, '0')}`;
}

export function genBarcode() {
  let base = '200' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += +base[i] * (i % 2 === 0 ? 1 : 3);
  return base + String((10 - (sum % 10)) % 10);
}

export function genSku() {
  return 'МИ-' + Math.random().toString(36).slice(2, 8).toUpperCase();
}

export function productVolume(p) {
  return (p.length_mm * p.width_mm * p.height_mm) / 1e9;
}

export function cellFill(cellId) {
  const rows = db.prepare(`
    SELECT s.quantity AS qty, p.weight_kg AS w, p.length_mm AS l, p.width_mm AS wd, p.height_mm AS h
    FROM stock s JOIN products p ON p.product_id = s.product_id
    WHERE s.cell_id = ? AND s.quantity > 0`).all(cellId);
  let weight = 0, volume = 0, qty = 0;
  for (const r of rows) {
    qty += r.qty;
    weight += r.qty * r.w;
    volume += (r.qty * r.l * r.wd * r.h) / 1e9;
  }
  return { qty, weight, volume };
}

export function refreshCellStatus(cellId) {
  const cell = db.prepare('SELECT * FROM cells WHERE cell_id = ?').get(cellId);
  if (!cell || cell.status === 'blocked' || cell.status === 'maintenance') return;
  const { qty } = cellFill(cellId);
  const status = qty > 0 ? 'occupied' : 'free';
  if (status !== cell.status) {
    db.prepare('UPDATE cells SET status = ? WHERE cell_id = ?').run(status, cellId);
  }
}

export function zoneDistance(z1, z2) {
  return Math.hypot((z1?.coord_x ?? 0) - (z2?.coord_x ?? 0), (z1?.coord_y ?? 0) - (z2?.coord_y ?? 0));
}

export function shippingZone() {
  return db.prepare(`SELECT * FROM zones WHERE type = 'shipping' LIMIT 1`).get()
    || db.prepare('SELECT * FROM zones ORDER BY zone_id LIMIT 1').get();
}

export function stagingCell() {
  let cell = db.prepare(`SELECT c.* FROM cells c JOIN zones z ON z.zone_id = c.zone_id
                         WHERE z.type = 'receiving' ORDER BY c.cell_id LIMIT 1`).get();
  if (!cell) {
    const zone = db.prepare(`SELECT * FROM zones WHERE type = 'receiving' LIMIT 1`).get()
      || (() => {
        db.prepare(`INSERT INTO zones (name, type, coord_x, coord_y) VALUES ('Зона приёмки', 'receiving', 0, 0)`).run();
        return db.prepare(`SELECT * FROM zones WHERE type = 'receiving' LIMIT 1`).get();
      })();
    db.prepare(`INSERT INTO cells (code, zone_id, rack, section, level, length_mm, width_mm, height_mm, max_weight_kg, max_volume_m3)
                VALUES ('ПРИ-000', ?, 'ПРИ', 0, 0, 2000, 1200, 1800, 5000, 20)`).run(zone.zone_id);
    cell = db.prepare(`SELECT c.* FROM cells c JOIN zones z ON z.zone_id = c.zone_id
                       WHERE z.type = 'receiving' ORDER BY c.cell_id LIMIT 1`).get();
  }
  return cell;
}

export function addStock(productId, cellId, qty) {
  const row = db.prepare('SELECT * FROM stock WHERE product_id = ? AND cell_id = ?').get(productId, cellId);
  if (row) {
    db.prepare('UPDATE stock SET quantity = quantity + ? WHERE stock_id = ?').run(qty, row.stock_id);
  } else {
    db.prepare('INSERT INTO stock (product_id, cell_id, quantity) VALUES (?, ?, ?)').run(productId, cellId, qty);
  }
  refreshCellStatus(cellId);
}

export function takeStock(productId, cellId, qty) {
  const row = db.prepare('SELECT * FROM stock WHERE product_id = ? AND cell_id = ?').get(productId, cellId);
  if (!row || row.quantity < qty) return false;
  const newQty = row.quantity - qty;
  const newRes = Math.max(0, row.reserved - qty);
  if (newQty <= 0) {
    db.prepare('DELETE FROM stock WHERE stock_id = ?').run(row.stock_id);
  } else {
    db.prepare('UPDATE stock SET quantity = ?, reserved = ? WHERE stock_id = ?').run(newQty, newRes, row.stock_id);
  }
  refreshCellStatus(cellId);
  return true;
}

export function dimsFit(p, c) {
  const pd = [p.length_mm, p.width_mm, p.height_mm].sort((a, b) => a - b);
  const cd = [c.length_mm, c.width_mm, c.height_mm].sort((a, b) => a - b);
  return pd[0] <= cd[0] && pd[1] <= cd[1] && pd[2] <= cd[2];
}

export function suggestCells(productId, qty, limit = 5) {
  const p = db.prepare('SELECT * FROM products WHERE product_id = ?').get(productId);
  if (!p) return [];
  const unitVol = productVolume(p);
  const ship = shippingZone();
  const sameProduct = db.prepare(`
    SELECT c.*, z.name AS zone_name, z.coord_x, z.coord_y, s.quantity AS in_cell
    FROM stock s
    JOIN cells c ON c.cell_id = s.cell_id
    JOIN zones z ON z.zone_id = c.zone_id AND z.type = 'storage'
    WHERE s.product_id = ? AND s.quantity > 0 AND c.status = 'occupied'
    ORDER BY s.quantity DESC`).all(productId);

  const empty = db.prepare(`
    SELECT c.*, z.name AS zone_name, z.coord_x, z.coord_y, 0 AS in_cell
    FROM cells c
    JOIN zones z ON z.zone_id = c.zone_id AND z.type = 'storage'
    WHERE c.status = 'free'
      AND (?1 = '' OR c.turnover_class = ?1)
      AND (?2 = 0 OR c.level <= 2)
    ORDER BY c.level ASC,
      (z.coord_x - ?3) * (z.coord_x - ?3) + (z.coord_y - ?4) * (z.coord_y - ?4) ASC`).all(
    p.turnover_class, p.is_fragile, ship?.coord_x ?? 0, ship?.coord_y ?? 0);

  const anyFree = db.prepare(`
    SELECT c.*, z.name AS zone_name, z.coord_x, z.coord_y, 0 AS in_cell
    FROM cells c
    JOIN zones z ON z.zone_id = c.zone_id AND z.type = 'storage'
    WHERE c.status = 'free' AND (?1 = '' OR c.turnover_class != ?1)
      AND (?2 = 0 OR c.level <= 2)
    ORDER BY (z.coord_x - ?3) * (z.coord_x - ?3) + (z.coord_y - ?4) * (z.coord_y - ?4) ASC`).all(
    p.turnover_class, p.is_fragile, ship?.coord_x ?? 0, ship?.coord_y ?? 0);

  const result = [];
  for (const c of sameProduct) {
    if (!dimsFit(p, c)) continue;
    const fill = cellFill(c.cell_id);
    const freeW = c.max_weight_kg - fill.weight;
    const freeV = c.max_volume_m3 - fill.volume;
    const room = Math.min(Math.floor(freeW / (p.weight_kg || 0.001)), Math.floor(freeV / (unitVol || 0.000001)));
    if (room > 0) result.push({ ...cellOut(c), room, reason: 'докладка в ту же ячейку' });
    if (result.length >= limit) return result;
  }
  let rest = qty;
  for (const c of empty) {
    if (!dimsFit(p, c)) continue;
    const roomW = Math.floor(c.max_weight_kg / (p.weight_kg || 0.001));
    const roomV = Math.floor(c.max_volume_m3 / (unitVol || 0.000001));
    const room = Math.min(roomW, roomV);
    if (room <= 0) continue;
    result.push({ ...cellOut(c), room, reason: `свободна, класс ${c.turnover_class || '—'}` });
    rest -= room;
    if (rest <= 0) break;
  }
  if (rest > 0) {
    for (const c of anyFree) {
      if (!dimsFit(p, c)) continue;
      const roomW = Math.floor(c.max_weight_kg / (p.weight_kg || 0.001));
      const roomV = Math.floor(c.max_volume_m3 / (unitVol || 0.000001));
      const room = Math.min(roomW, roomV);
      if (room <= 0) continue;
      result.push({ ...cellOut(c), room, reason: 'вне зоны класса — по габаритам' });
      rest -= room;
      if (rest <= 0) break;
    }
  }
  return result.slice(0, limit);
}

function cellOut(c) {
  return {
    cellId: c.cell_id, code: c.code, zone: c.zone_name, rack: c.rack,
    section: c.section, level: c.level, status: c.status,
    turnoverClass: c.turnover_class, maxWeight: c.max_weight_kg, maxVolume: c.max_volume_m3,
  };
}
