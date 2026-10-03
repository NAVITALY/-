// Порт server/src/util.js на локальное хранилище (1-в-1 по поведению).
import { store } from './store.js';

const year = () => new Date().toISOString().slice(0, 4);

export function nextNumber(table, column, prefix) {
  const re = new RegExp(`^${prefix}-${year()}-(\\d+)$`);
  let max = 0;
  for (const row of store.all(table)) {
    const m = re.exec(row[column]);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${year()}-${String(max + 1).padStart(4, '0')}`;
}

export function genBarcode() {
  const base = '200' + String(Math.floor(Math.random() * 1e9)).padStart(9, '0');
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
  let weight = 0, volume = 0, qty = 0;
  for (const s of store.all('stock')) {
    if (s.cell_id !== cellId || !(s.quantity > 0)) continue;
    const p = store.all('products').find(x => x.product_id === s.product_id);
    if (!p) continue;
    qty += s.quantity;
    weight += s.quantity * p.weight_kg;
    volume += (s.quantity * p.length_mm * p.width_mm * p.height_mm) / 1e9;
  }
  return { qty, weight, volume };
}

export function refreshCellStatus(cellId) {
  const cell = store.all('cells').find(c => c.cell_id === cellId);
  if (!cell || cell.status === 'blocked' || cell.status === 'maintenance') return;
  const { qty } = cellFill(cellId);
  const status = qty > 0 ? 'occupied' : 'free';
  if (status !== cell.status) { cell.status = status; store.touch(); }
}

export function shippingZone() {
  return store.all('zones').find(z => z.type === 'shipping')
    || store.all('zones').slice().sort((a, b) => a.zone_id - b.zone_id)[0];
}

export function stagingCell() {
  const ordered = store.all('cells')
    .filter(c => (store.all('zones').find(z => z.zone_id === c.zone_id)?.type) === 'receiving')
    .sort((a, b) => a.cell_id - b.cell_id);
  let cell = ordered[0];
  if (!cell) {
    let zone = store.all('zones').find(z => z.type === 'receiving');
    if (!zone) zone = store.insert('zones', { name: 'Зона приёмки', type: 'receiving', coord_x: 0, coord_y: 0 });
    cell = store.insert('cells', {
      code: 'ПРИ-000', zone_id: zone.zone_id, rack: 'ПРИ', section: 0, level: 0,
      length_mm: 2000, width_mm: 1200, height_mm: 1800,
      max_weight_kg: 5000, max_volume_m3: 20, turnover_class: null, status: 'free',
    });
  }
  return cell;
}

export function addStock(productId, cellId, qty) {
  const row = store.all('stock').find(s => s.product_id === productId && s.cell_id === cellId);
  if (row) { row.quantity += qty; }
  else { store.insert('stock', { product_id: productId, cell_id: cellId, quantity: qty, reserved: 0 }); return refreshCellStatus(cellId); }
  store.touch();
  refreshCellStatus(cellId);
}

export function takeStock(productId, cellId, qty) {
  const arr = store.all('stock');
  const idx = arr.findIndex(s => s.product_id === productId && s.cell_id === cellId);
  if (idx < 0) return false;
  const row = arr[idx];
  if (row.quantity < qty) return false;
  const newQty = row.quantity - qty;
  const newRes = Math.max(0, (row.reserved || 0) - qty);
  if (newQty <= 0) { arr.splice(idx, 1); }
  else { row.quantity = newQty; row.reserved = newRes; }
  store.touch();
  refreshCellStatus(cellId);
  return true;
}

export function dimsFit(p, c) {
  const pd = [p.length_mm, p.width_mm, p.height_mm].sort((a, b) => a - b);
  const cd = [c.length_mm, c.width_mm, c.height_mm].sort((a, b) => a - b);
  return pd[0] <= cd[0] && pd[1] <= cd[1] && pd[2] <= cd[2];
}

function zoneOf(cell) { return store.all('zones').find(z => z.zone_id === cell.zone_id); }

export function suggestCells(productId, qty, limit = 5) {
  const p = store.all('products').find(x => x.product_id === productId);
  if (!p) return [];
  const unitVol = productVolume(p);
  const ship = shippingZone();
  const sx = ship?.coord_x ?? 0, sy = ship?.coord_y ?? 0;
  const dist2 = (c) => { const z = zoneOf(c); return ((z?.coord_x ?? 0) - sx) ** 2 + ((z?.coord_y ?? 0) - sy) ** 2; };

  const storageCells = store.all('cells').filter(c => zoneOf(c)?.type === 'storage');

  const sameProduct = [];
  for (const s of store.all('stock')) {
    if (s.product_id !== productId || !(s.quantity > 0)) continue;
    const c = storageCells.find(x => x.cell_id === s.cell_id && x.status === 'occupied');
    if (c) sameProduct.push({ ...c, zone_name: zoneOf(c)?.name, coord_x: zoneOf(c)?.coord_x, coord_y: zoneOf(c)?.coord_y, in_cell: s.quantity });
  }
  sameProduct.sort((a, b) => b.in_cell - a.in_cell);

  const empty = storageCells
    .filter(c => c.status === 'free'
      && (c.turnover_class === p.turnover_class)
      && (!p.is_fragile || c.level <= 2))
    .map(c => ({ ...c, zone_name: zoneOf(c)?.name }))
    .sort((a, b) => (a.level - b.level) || (dist2(a) - dist2(b)));

  const anyFree = storageCells
    .filter(c => c.status === 'free'
      && (c.turnover_class !== p.turnover_class)
      && (!p.is_fragile || c.level <= 2))
    .map(c => ({ ...c, zone_name: zoneOf(c)?.name }))
    .sort((a, b) => dist2(a) - dist2(b));

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
