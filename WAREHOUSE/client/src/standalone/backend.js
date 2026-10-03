// Автономный бэкенд: порт всех Express-роутов сервера (server/src/routes/*)
// на локальное хранилище. Поведение, проверки, статусы и форматы ответов — 1-в-1.
import bcrypt from 'bcryptjs';
import { store, loadSessions, saveSessions, TOKEN_KEY } from './store.js';
import { seedIfEmpty, seed } from './seed.js';
import {
  nextNumber, genBarcode, genSku, productVolume, cellFill, refreshCellStatus,
  stagingCell, addStock, takeStock, dimsFit, suggestCells,
} from './util.js';

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new ApiError(status, message); };
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const like = (val, q) => String(val ?? '').toLowerCase().includes(String(q ?? '').toLowerCase());

// ---------- auth ----------
function getStoredToken() {
  try { return typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null; }
  catch { return null; }
}

function newToken() {
  const a = new Uint8Array(24);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  return Array.from(a).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function userPayload(userId) {
  const u = store.all('users').find(x => x.user_id === userId);
  if (!u) return null;
  const r = store.all('roles').find(x => x.role_id === u.role_id);
  const permIds = store.all('role_permissions').filter(x => x.role_id === u.role_id).map(x => x.perm_id);
  const perms = store.all('permissions').filter(x => permIds.includes(x.perm_id)).map(x => x.code);
  return {
    id: u.user_id, login: u.login, fullName: u.full_name, isActive: !!u.is_active,
    role: r ? { id: r.role_id, code: r.code, name: r.name } : null,
    permissions: perms,
  };
}

function meFromToken(token) {
  if (!token) fail(401, 'Требуется авторизация');
  const sessions = loadSessions();
  const s = sessions[token];
  if (!s || s.exp < Date.now()) fail(401, 'Сессия истекла, войдите заново');
  const user = userPayload(s.userId);
  if (!user) fail(401, 'Пользователь не найден');
  if (!user.isActive) fail(403, 'Учётная запись отключена');
  return user;
}

function need(user, ...codes) {
  if (!codes.some(c => user.permissions.includes(c))) fail(403, 'Недостаточно прав для этого действия');
}

function logAction(user, action, entity, entityId = null, details = null) {
  store.insert('operation_logs', {
    user_id: user?.id ?? null, action, entity, entity_id: entityId,
    details: details ? JSON.stringify(details) : null, timestamp: nowStr(),
  });
}

function fullNameOf(userId) {
  if (userId == null) return '—';
  return store.all('users').find(u => u.user_id === userId)?.full_name || '—';
}

// ---------- общие проекции ----------
function productRow(p) {
  const c = store.all('categories').find(x => x.category_id === p.category_id);
  const pc = c && store.all('categories').find(x => x.category_id === c.parent_id);
  let totalQty = 0, reservedQty = 0;
  for (const s of store.all('stock')) {
    if (s.product_id !== p.product_id) continue;
    totalQty += s.quantity; reservedQty += s.reserved || 0;
  }
  return {
    id: p.product_id, sku: p.sku, barcode: p.barcode, name: p.name,
    categoryId: p.category_id, categoryName: c?.name || null, parentCategoryName: pc?.name || null,
    lengthMm: p.length_mm, widthMm: p.width_mm, heightMm: p.height_mm,
    weightKg: p.weight_kg, turnoverClass: p.turnover_class, isFragile: p.is_fragile,
    minStock: p.min_stock, unit: p.unit, createdAt: p.created_at,
    totalQty, reservedQty,
    volumeM3: +((p.length_mm * p.width_mm * p.height_mm) / 1e9).toFixed(4),
  };
}

function validateProduct(b) {
  if (!b.name || !String(b.name).trim()) return 'Укажите название товара';
  for (const f of ['lengthMm', 'widthMm', 'heightMm']) {
    if (!(+b[f] > 0)) return 'Габариты должны быть больше нуля';
  }
  if (!(+b.weightKg > 0)) return 'Вес должен быть больше нуля';
  if (!['A', 'B', 'C'].includes(b.turnoverClass)) return 'Класс ходкости: A, B или C';
  return null;
}

function zoneOf(cell) { return store.all('zones').find(z => z.zone_id === cell.zone_id); }

function cellRow(c) {
  const z = zoneOf(c);
  return {
    id: c.cell_id, code: c.code, zoneId: c.zone_id, zoneName: z?.name || null, zoneType: z?.type || null,
    rack: c.rack, section: c.section, level: c.level,
    lengthMm: c.length_mm, widthMm: c.width_mm, heightMm: c.height_mm,
    maxWeight: c.max_weight_kg, maxVolume: c.max_volume_m3,
    turnoverClass: c.turnover_class, status: c.status,
  };
}

function withFill(c) {
  const base = cellRow(c);
  const f = cellFill(c.cell_id);
  return {
    ...base, qty: f.qty, usedWeight: +f.weight.toFixed(2), usedVolume: +f.volume.toFixed(3),
    fillPct: c.max_volume_m3 > 0 ? Math.min(100, Math.round((f.volume / c.max_volume_m3) * 100)) : 0,
  };
}

function receiptListRow(rc) {
  const items = store.all('receipt_items').filter(i => i.receipt_id === rc.receipt_id);
  return {
    id: rc.receipt_id, number: rc.number, supplier: rc.supplier, date: rc.date,
    status: rc.status, comment: rc.comment, userName: fullNameOf(rc.user_id),
    itemsCount: items.length, totalQty: items.reduce((a, i) => a + i.quantity, 0),
  };
}

function receiptDetail(id) {
  const rc = store.all('receipts').find(x => x.receipt_id === id);
  if (!rc) fail(404, 'Приёмка не найдена');
  const items = store.all('receipt_items')
    .filter(i => i.receipt_id === id)
    .sort((a, b) => a.item_id - b.item_id)
    .map(i => {
      const p = store.all('products').find(x => x.product_id === i.product_id) || {};
      return {
        itemId: i.item_id, quantity: i.quantity, placed: i.placed,
        productId: i.product_id, name: p.name, sku: p.sku, barcode: p.barcode, unit: p.unit,
        lengthMm: p.length_mm, widthMm: p.width_mm, heightMm: p.height_mm, weightKg: p.weight_kg,
      };
    });
  return { ...receiptListRow(rc), items };
}

function validateItems(items) {
  if (!Array.isArray(items) || !items.length) return 'Добавьте хотя бы одну позицию';
  for (const it of items) {
    if (!it.productId || !(+it.quantity > 0)) return 'Некорректная позиция: нужен товар и количество';
    if (!store.all('products').some(p => p.product_id === +it.productId)) return 'Товар не найден';
  }
  return null;
}

function orderListRow(o) {
  const items = store.all('order_items').filter(i => i.order_id === o.order_id);
  return {
    id: o.order_id, number: o.number, customerName: o.customer_name, date: o.date,
    status: o.status, comment: o.comment, userName: fullNameOf(o.user_id),
    totalQty: items.reduce((a, i) => a + i.quantity, 0),
    pickedQty: items.reduce((a, i) => a + (i.picked || 0), 0),
  };
}

function orderItems(orderId) {
  return store.all('order_items')
    .filter(i => i.order_id === orderId)
    .sort((a, b) => a.item_id - b.item_id)
    .map(i => {
      const p = store.all('products').find(x => x.product_id === i.product_id) || {};
      return {
        itemId: i.item_id, quantity: i.quantity, picked: i.picked || 0,
        productId: i.product_id, name: p.name, sku: p.sku, barcode: p.barcode, unit: p.unit,
      };
    });
}

function availableQty(productId) {
  let a = 0;
  for (const s of store.all('stock')) {
    if (s.product_id !== productId) continue;
    const c = store.all('cells').find(x => x.cell_id === s.cell_id);
    if (!c || c.status === 'blocked') continue;
    a += s.quantity - (s.reserved || 0);
  }
  return a;
}

function buildRoute(orderId) {
  const lines = [];
  for (const it of orderItems(orderId)) {
    let needQty = it.quantity - (it.picked || 0);
    if (needQty <= 0) continue;
    const rows = [];
    for (const s of store.all('stock')) {
      if (s.product_id !== it.productId || !(s.quantity > 0) || !((s.reserved || 0) > 0)) continue;
      const c = store.all('cells').find(x => x.cell_id === s.cell_id);
      if (!c) continue;
      const z = zoneOf(c);
      rows.push({
        stockId: s.stock_id, qty: s.quantity, res: s.reserved || 0,
        cellId: c.cell_id, cellCode: c.code, rack: c.rack, section: c.section, level: c.level,
        cx: z?.coord_x ?? 0, cy: z?.coord_y ?? 0, zoneName: z?.name || null,
      });
    }
    rows.sort((a, b) => (a.cy - b.cy) || (a.cx - b.cx)
      || String(a.rack ?? '').localeCompare(String(b.rack ?? ''), 'ru')
      || ((a.section ?? 0) - (b.section ?? 0)) || ((a.level ?? 0) - (b.level ?? 0)));
    for (const r of rows) {
      if (needQty <= 0) break;
      const q = Math.min(needQty, r.res, r.qty);
      if (q > 0) {
        lines.push({
          productId: it.productId, name: it.name, sku: it.sku,
          cellId: r.cellId, cellCode: r.cellCode, zoneName: r.zoneName,
          rack: r.rack, section: r.section, level: r.level, qty: q, stockId: r.stockId,
        });
        needQty -= q;
      }
    }
    if (needQty > 0) {
      lines.push({
        productId: it.productId, name: it.name, sku: it.sku,
        cellId: null, cellCode: '—', zoneName: null, qty: needQty, missing: true,
      });
    }
  }
  return lines;
}

function releaseReserve(orderId) {
  for (const it of store.all('order_items').filter(i => i.order_id === orderId && (i.picked || 0) < i.quantity)) {
    let needQty = it.quantity - (it.picked || 0);
    const rows = store.all('stock')
      .filter(s => s.product_id === it.product_id && (s.reserved || 0) > 0)
      .sort((a, b) => a.stock_id - b.stock_id);
    for (const s of rows) {
      if (needQty <= 0) break;
      const rel = Math.min(needQty, s.reserved);
      s.reserved = Math.max(0, s.reserved - rel);
      needQty -= rel;
    }
  }
  store.touch();
}

// ---------- роутер ----------
export async function localApi(rawPath, { method = 'GET', body } = {}) {
  seedIfEmpty();
  const qi = rawPath.indexOf('?');
  const urlPath = qi < 0 ? rawPath : rawPath.slice(0, qi);
  const query = Object.fromEntries(new URLSearchParams(qi < 0 ? '' : rawPath.slice(qi + 1)));
  const M = method.toUpperCase();
  const seg = urlPath.split('/').filter(Boolean);

  // публичный вход
  if (M === 'POST' && urlPath === '/auth/login') {
    const { login, password } = body || {};
    if (!login || !password) fail(400, 'Укажите логин и пароль');
    const u = store.all('users').find(x => x.login === String(login).trim());
    if (!u || !bcrypt.compareSync(String(password), u.password_hash)) fail(401, 'Неверный логин или пароль');
    if (!u.is_active) fail(403, 'Учётная запись отключена');
    const user = userPayload(u.user_id);
    const token = newToken();
    const sessions = loadSessions();
    sessions[token] = { userId: u.user_id, exp: Date.now() + 12 * 3600e3 };
    saveSessions(sessions);
    logAction(user, 'вход', 'session', u.user_id, { login: u.login });
    return { token, user };
  }

  const me = meFromToken(getStoredToken());

  // --- auth/me, password ---
  if (M === 'GET' && urlPath === '/auth/me') return { user: me };
  if (M === 'PUT' && urlPath === '/auth/password') {
    const u = store.all('users').find(x => x.user_id === me.id);
    if (!u || !bcrypt.compareSync(String(body?.oldPassword || ''), u.password_hash)) {
      fail(400, 'Текущий пароль указан неверно');
    }
    if (!body?.newPassword || String(body.newPassword).length < 5) {
      fail(400, 'Новый пароль должен быть не короче 5 символов');
    }
    u.password_hash = bcrypt.hashSync(String(body.newPassword), 10);
    store.touch();
    logAction(me, 'смена пароля', 'user', u.user_id);
    return { ok: true };
  }

  // --- roles / users ---
  if (M === 'GET' && urlPath === '/roles') {
    return store.all('roles')
      .slice().sort((a, b) => a.role_id - b.role_id)
      .map(r => ({ id: r.role_id, code: r.code, name: r.name, description: r.description }));
  }
  if (seg[0] === 'users' && seg.length === 1) {
    if (M === 'GET') {
      need(me, 'users.manage');
      return store.all('users')
        .slice().sort((a, b) => a.user_id - b.user_id)
        .map(u => {
          const r = store.all('roles').find(x => x.role_id === u.role_id) || {};
          return {
            id: u.user_id, login: u.login, fullName: u.full_name, isActive: u.is_active,
            createdAt: u.created_at, roleId: u.role_id, roleName: r.name, roleCode: r.code,
            opsCount: store.all('operation_logs').filter(l => l.user_id === u.user_id).length,
          };
        });
    }
    if (M === 'POST') {
      need(me, 'users.manage');
      const b = body || {};
      if (!b.login || !b.fullName || !b.password || b.roleId == null) fail(400, 'Заполните все поля');
      if (String(b.password).length < 5) fail(400, 'Пароль должен быть не короче 5 символов');
      if (store.all('users').some(u => u.login === String(b.login).trim())) fail(409, 'Логин уже занят');
      const row = store.insert('users', {
        login: String(b.login).trim(), password_hash: bcrypt.hashSync(String(b.password), 10),
        full_name: b.fullName, role_id: +b.roleId, is_active: 1, created_at: nowStr(),
      });
      logAction(me, 'создание', 'user', row.user_id, { login: row.login });
      return { id: row.user_id };
    }
  }
  if (seg[0] === 'users' && seg.length === 2) {
    const id = +seg[1];
    if (M === 'PUT') {
      need(me, 'users.manage');
      const u = store.all('users').find(x => x.user_id === id);
      if (!u) fail(404, 'Пользователь не найден');
      const b = body || {};
      if (id === me.id && b.isActive === false) fail(400, 'Нельзя отключить собственную учётную запись');
      if (b.fullName !== undefined) u.full_name = b.fullName;
      if (b.roleId !== undefined && b.roleId !== null && b.roleId !== '') u.role_id = +b.roleId;
      if (b.isActive !== undefined) u.is_active = b.isActive ? 1 : 0;
      let pwChanged = false;
      if (b.password) {
        if (String(b.password).length < 5) fail(400, 'Пароль должен быть не короче 5 символов');
        u.password_hash = bcrypt.hashSync(String(b.password), 10);
        pwChanged = true;
      }
      store.touch();
      logAction(me, 'изменение', 'user', id, { fullName: u.full_name, roleId: u.role_id, isActive: !!u.is_active, passwordChanged: pwChanged });
      return { ok: true };
    }
    if (M === 'DELETE') {
      need(me, 'users.manage');
      if (id === me.id) fail(400, 'Нельзя удалить собственную учётную запись');
      const n = store.removeWhere('users', x => x.user_id === id);
      if (!n) fail(404, 'Пользователь не найден');
      logAction(me, 'удаление', 'user', id);
      return { ok: true };
    }
  }

  // --- categories ---
  if (seg[0] === 'categories' && seg.length === 1) {
    if (M === 'GET') {
      return store.all('categories')
        .map(c => ({
          id: c.category_id, name: c.name, parentId: c.parent_id,
          productsCount: store.all('products').filter(p => p.category_id === c.category_id).length,
        }))
        .sort((a, b) => ((a.parentId != null) - (b.parentId != null)) || a.name.localeCompare(b.name, 'ru'));
    }
    if (M === 'POST') {
      need(me, 'categories.edit');
      const b = body || {};
      if (!b.name || !String(b.name).trim()) fail(400, 'Укажите название категории');
      const row = store.insert('categories', { name: String(b.name).trim(), parent_id: b.parentId ? +b.parentId : null });
      logAction(me, 'создание', 'category', row.category_id, { name: row.name });
      return { id: row.category_id };
    }
  }
  if (seg[0] === 'categories' && seg.length === 2) {
    const id = +seg[1];
    if (M === 'PUT') {
      need(me, 'categories.edit');
      const c = store.all('categories').find(x => x.category_id === id);
      if (!c) fail(404, 'Категория не найдена');
      const b = body || {};
      if (b.parentId && +b.parentId === id) fail(400, 'Категория не может быть родителем самой себе');
      if (b.name !== undefined) c.name = String(b.name).trim() || c.name;
      if (b.parentId !== undefined) c.parent_id = b.parentId ? +b.parentId : null;
      store.touch();
      logAction(me, 'изменение', 'category', id, { name: c.name });
      return { ok: true };
    }
    if (M === 'DELETE') {
      need(me, 'categories.edit');
      if (store.all('categories').some(x => x.parent_id === id)) fail(409, 'Сначала удалите вложенные категории');
      if (store.all('products').some(x => x.category_id === id)) fail(409, 'В категории есть товары');
      const n = store.removeWhere('categories', x => x.category_id === id);
      if (!n) fail(404, 'Категория не найдена');
      return { ok: true };
    }
  }

  // --- products ---
  if (seg[0] === 'products' && seg.length === 1) {
    if (M === 'GET') {
      let list = store.all('products').map(productRow);
      if (query.q) list = list.filter(p => like(p.name, query.q) || like(p.sku, query.q) || like(p.barcode, query.q));
      if (query.categoryId) {
        const cid = +query.categoryId;
        list = list.filter(p => {
          const c = store.all('categories').find(x => x.category_id === p.categoryId);
          return p.categoryId === cid || c?.parent_id === cid;
        });
      }
      if (query.fragile === '1' || query.fragile === 'true') list = list.filter(p => p.isFragile);
      if (query.turnover) list = list.filter(p => p.turnoverClass === query.turnover);
      return list.sort((a, b) => a.name.localeCompare(b.name, 'ru')).slice(0, 500);
    }
    if (M === 'POST') {
      need(me, 'products.edit');
      const b = body || {};
      const verr = validateProduct(b);
      if (verr) fail(400, verr);
      const skuVal = String(b.sku || '').trim() || genSku();
      if (store.all('products').some(p => p.sku === skuVal)) fail(409, 'Артикул уже используется');
      let barcode = String(b.barcode || '').trim();
      if (!barcode || store.all('products').some(p => p.barcode === barcode)) {
        barcode = null;
        for (let i = 0; i < 20; i++) {
          const g = genBarcode();
          if (!store.all('products').some(p => p.barcode === g)) { barcode = g; break; }
        }
        if (!barcode) fail(500, 'Не удалось сгенерировать штрихкод');
      }
      const row = store.insert('products', {
        sku: skuVal, barcode, name: String(b.name).trim(),
        category_id: b.categoryId ? +b.categoryId : null,
        length_mm: +b.lengthMm, width_mm: +b.widthMm, height_mm: +b.heightMm,
        weight_kg: +b.weightKg, turnover_class: b.turnoverClass,
        is_fragile: b.isFragile ? 1 : 0, min_stock: +(b.minStock ?? 0) || 0,
        unit: b.unit || 'шт', created_at: nowStr(),
      });
      logAction(me, 'создание', 'product', row.product_id, { name: row.name, sku: row.sku });
      return { id: row.product_id, sku: row.sku, barcode: row.barcode };
    }
  }
  if (seg[0] === 'products' && seg[1] === 'barcode' && seg.length === 3 && M === 'GET') {
    need(me, 'products.view');
    const code = decodeURIComponent(seg[2]);
    const p = store.all('products').find(x => x.barcode === code || x.sku === code);
    if (!p) fail(404, 'Товар не найден по штрихкоду/артикулу');
    return productRow(p);
  }
  if (seg[0] === 'products' && seg.length === 2) {
    const id = +seg[1];
    if (M === 'GET') {
      const p = store.all('products').find(x => x.product_id === id);
      if (!p) fail(404, 'Товар не найден');
      const cells = store.all('stock')
        .filter(s => s.product_id === id && s.quantity > 0)
        .map(s => {
          const c = store.all('cells').find(x => x.cell_id === s.cell_id) || {};
          return {
            stockId: s.stock_id, cellId: s.cell_id, cellCode: c.code,
            zoneName: zoneOf(c)?.name || null, qty: s.quantity, reserved: s.reserved || 0,
          };
        })
        .sort((a, b) => String(a.cellCode).localeCompare(String(b.cellCode), 'ru'));
      return { ...productRow(p), cells };
    }
    if (M === 'PUT') {
      need(me, 'products.edit');
      const p = store.all('products').find(x => x.product_id === id);
      if (!p) fail(404, 'Товар не найден');
      const b = body || {};
      const merged = {
        name: b.name ?? p.name, lengthMm: b.lengthMm ?? p.length_mm,
        widthMm: b.widthMm ?? p.width_mm, heightMm: b.heightMm ?? p.height_mm,
        weightKg: b.weightKg ?? p.weight_kg, turnoverClass: b.turnoverClass ?? p.turnover_class,
      };
      const verr = validateProduct(merged);
      if (verr) fail(400, verr);
      const sku = b.sku !== undefined ? String(b.sku).trim() : p.sku;
      if (sku !== p.sku && store.all('products').some(x => x.sku === sku && x.product_id !== id)) {
        fail(409, 'Артикул уже используется');
      }
      const barcode = b.barcode !== undefined ? String(b.barcode).trim() : p.barcode;
      if (barcode !== p.barcode && store.all('products').some(x => x.barcode === barcode && x.product_id !== id)) {
        fail(409, 'Штрихкод уже используется');
      }
      p.sku = sku; p.barcode = barcode; p.name = String(merged.name).trim();
      p.category_id = b.categoryId === undefined ? p.category_id : (b.categoryId ? +b.categoryId : null);
      p.length_mm = +merged.lengthMm; p.width_mm = +merged.widthMm; p.height_mm = +merged.heightMm;
      p.weight_kg = +merged.weightKg; p.turnover_class = merged.turnoverClass;
      p.is_fragile = b.isFragile === undefined ? p.is_fragile : (b.isFragile ? 1 : 0);
      p.min_stock = b.minStock === undefined ? p.min_stock : (+b.minStock || 0);
      p.unit = b.unit || p.unit;
      store.touch();
      logAction(me, 'изменение', 'product', id, { name: p.name });
      return { ok: true };
    }
    if (M === 'DELETE') {
      need(me, 'products.delete');
      const q = store.all('stock').filter(s => s.product_id === id).reduce((a, s) => a + s.quantity, 0);
      if (q > 0) fail(409, 'У товара есть остатки, сначала переместите или спишите их');
      store.removeWhere('stock', s => s.product_id === id);
      const n = store.removeWhere('products', x => x.product_id === id);
      if (!n) fail(404, 'Товар не найден');
      logAction(me, 'удаление', 'product', id);
      return { ok: true };
    }
  }

  // --- zones ---
  if (seg[0] === 'zones' && seg.length === 1) {
    if (M === 'GET') {
      return store.all('zones')
        .map(z => ({
          id: z.zone_id, name: z.name, type: z.type, coordX: z.coord_x, coordY: z.coord_y,
          cellsCount: store.all('cells').filter(c => c.zone_id === z.zone_id).length,
        }))
        .sort((a, b) => (a.coordY - b.coordY) || (a.coordX - b.coordX) || a.name.localeCompare(b.name, 'ru'));
    }
    if (M === 'POST') {
      need(me, 'zones.edit');
      const b = body || {};
      if (!b.name || !String(b.name).trim()) fail(400, 'Укажите название зоны');
      const row = store.insert('zones', {
        name: String(b.name).trim(), type: b.type || 'storage',
        coord_x: +(b.coordX ?? 0) || 0, coord_y: +(b.coordY ?? 0) || 0,
      });
      logAction(me, 'создание', 'zone', row.zone_id, { name: row.name });
      return { id: row.zone_id };
    }
  }
  if (seg[0] === 'zones' && seg.length === 2) {
    const id = +seg[1];
    if (M === 'PUT') {
      need(me, 'zones.edit');
      const z = store.all('zones').find(x => x.zone_id === id);
      if (!z) fail(404, 'Зона не найдена');
      const b = body || {};
      if (b.name !== undefined) z.name = String(b.name).trim() || z.name;
      if (b.type !== undefined) z.type = b.type;
      if (b.coordX !== undefined) z.coord_x = +b.coordX || 0;
      if (b.coordY !== undefined) z.coord_y = +b.coordY || 0;
      store.touch();
      return { ok: true };
    }
    if (M === 'DELETE') {
      need(me, 'zones.edit');
      if (store.all('cells').some(c => c.zone_id === id)) fail(409, 'В зоне есть ячейки, сначала удалите их');
      const n = store.removeWhere('zones', x => x.zone_id === id);
      if (!n) fail(404, 'Зона не найдена');
      return { ok: true };
    }
  }

  // --- cells ---
  if (seg[0] === 'cells' && seg.length === 1) {
    if (M === 'GET') {
      let list = store.all('cells').map(withFill);
      if (query.zoneId) list = list.filter(c => c.zoneId === +query.zoneId);
      if (query.status) list = list.filter(c => c.status === query.status);
      if (query.q) list = list.filter(c => like(c.code, query.q));
      return list
        .sort((a, b) => String(a.zoneName).localeCompare(String(b.zoneName), 'ru')
          || String(a.rack ?? '').localeCompare(String(b.rack ?? ''), 'ru')
          || ((a.section ?? 0) - (b.section ?? 0)) || ((a.level ?? 0) - (b.level ?? 0)))
        .slice(0, 1000);
    }
    if (M === 'POST') {
      need(me, 'cells.edit');
      const b = body || {};
      if (!b.code || !String(b.code).trim()) fail(400, 'Укажите код ячейки');
      if (b.zoneId == null || b.zoneId === '') fail(400, 'Укажите зону');
      if (store.all('cells').some(c => c.code === String(b.code).trim())) fail(409, 'Ячейка с таким кодом уже есть');
      const l = +(b.lengthMm ?? 1200) || 1200, w = +(b.widthMm ?? 1000) || 1000, h = +(b.heightMm ?? 1000) || 1000;
      const row = store.insert('cells', {
        code: String(b.code).trim(), zone_id: +b.zoneId,
        rack: b.rack || null, section: b.section != null && b.section !== '' ? +b.section : 0,
        level: b.level != null && b.level !== '' ? +b.level : 0,
        length_mm: l, width_mm: w, height_mm: h,
        max_weight_kg: b.maxWeight != null && b.maxWeight !== '' ? +b.maxWeight : 100,
        max_volume_m3: b.maxVolume != null && b.maxVolume !== '' ? +b.maxVolume : +((l * w * h) / 1e9).toFixed(2),
        turnover_class: b.turnoverClass || null, status: b.status || 'free',
      });
      logAction(me, 'создание', 'cell', row.cell_id, { code: row.code });
      return { id: row.cell_id };
    }
  }
  if (M === 'GET' && urlPath === '/cells/map') {
    const zones = store.all('zones').slice()
      .sort((a, b) => (a.coord_y - b.coord_y) || (a.coord_x - b.coord_x));
    const byZone = new Map(zones.map(z => [z.zone_id, []]));
    for (const c of store.all('cells')) {
      if (byZone.has(c.zone_id)) byZone.get(c.zone_id).push(withFill(c));
    }
    for (const arr of byZone.values()) {
      arr.sort((a, b) => String(a.rack ?? '').localeCompare(String(b.rack ?? ''), 'ru')
        || ((a.section ?? 0) - (b.section ?? 0)) || ((a.level ?? 0) - (b.level ?? 0)));
    }
    return zones.map(z => ({
      id: z.zone_id, name: z.name, type: z.type, coordX: z.coord_x, coordY: z.coord_y,
      cells: byZone.get(z.zone_id),
    }));
  }
  if (M === 'GET' && urlPath === '/cells/suggest') {
    need(me, 'receipts.place');
    return suggestCells(+(query.productId || 0), +(query.qty || 1), 8);
  }
  if (M === 'POST' && urlPath === '/cells/bulk') {
    need(me, 'cells.edit');
    const b = body || {};
    if (b.zoneId == null || !b.rack || !String(b.rack).trim()) fail(400, 'Укажите зону и стеллаж');
    const zone = store.all('zones').find(z => z.zone_id === +b.zoneId);
    if (!zone) fail(404, 'Зона не найдена');
    const sections = +(b.sections || 4), levels = +(b.levels || 3);
    const l = +(b.lengthMm || 1200), w = +(b.widthMm || 1000), h = +(b.heightMm || 1000);
    const vol = +(((l * w * h) / 1e9).toFixed(2));
    const rack = String(b.rack).trim();
    let created = 0;
    for (let s = 1; s <= sections; s++) {
      for (let lv = 1; lv <= levels; lv++) {
        const code = `${rack}-${String(s).padStart(2, '0')}-${lv}`;
        if (store.all('cells').some(c => c.code === code)) continue;
        store.insert('cells', {
          code, zone_id: zone.zone_id, rack, section: s, level: lv,
          length_mm: l, width_mm: w, height_mm: h,
          max_weight_kg: +(b.maxWeight || 200), max_volume_m3: vol,
          turnover_class: b.turnoverClass || null, status: 'free',
        });
        created++;
      }
    }
    logAction(me, 'генерация ячеек', 'cell', null, { rack, created });
    return { created };
  }
  if (seg[0] === 'cells' && seg.length === 3 && seg[2] === 'contents' && M === 'GET') {
    const c = store.all('cells').find(x => x.cell_id === +seg[1]);
    if (!c) fail(404, 'Ячейка не найдена');
    const items = store.all('stock')
      .filter(s => s.cell_id === c.cell_id && s.quantity > 0)
      .map(s => {
        const p = store.all('products').find(x => x.product_id === s.product_id) || {};
        return {
          stockId: s.stock_id, qty: s.quantity, reserved: s.reserved || 0,
          productId: s.product_id, name: p.name, sku: p.sku, weightKg: p.weight_kg,
        };
      })
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
    return { ...withFill(c), items };
  }
  if (seg[0] === 'cells' && seg.length === 2) {
    const id = +seg[1];
    const num = (v, d) => (v === undefined || v === null || v === '' || Number.isNaN(+v) ? d : +v);
    if (M === 'PUT') {
      need(me, 'cells.edit');
      const c = store.all('cells').find(x => x.cell_id === id);
      if (!c) fail(404, 'Ячейка не найдена');
      const b = body || {};
      if (b.code !== undefined) c.code = String(b.code).trim() || c.code;
      if (b.zoneId !== undefined && b.zoneId !== null && b.zoneId !== '') c.zone_id = +b.zoneId;
      if (b.rack !== undefined) c.rack = b.rack;
      if (b.section !== undefined) c.section = num(b.section, c.section);
      if (b.level !== undefined) c.level = num(b.level, c.level);
      c.length_mm = num(b.lengthMm, c.length_mm);
      c.width_mm = num(b.widthMm, c.width_mm);
      c.height_mm = num(b.heightMm, c.height_mm);
      c.max_weight_kg = num(b.maxWeight, c.max_weight_kg);
      c.max_volume_m3 = num(b.maxVolume, c.max_volume_m3);
      if (b.turnoverClass !== undefined) c.turnover_class = b.turnoverClass || null;
      if (b.status !== undefined) c.status = b.status;
      store.touch();
      refreshCellStatus(id);
      return { ok: true };
    }
    if (M === 'DELETE') {
      need(me, 'cells.edit');
      const q = store.all('stock').filter(s => s.cell_id === id).reduce((a, s) => a + s.quantity, 0);
      if (q > 0) fail(409, 'В ячейке есть товар, сначала переместите его');
      store.removeWhere('stock', s => s.cell_id === id);
      const n = store.removeWhere('cells', x => x.cell_id === id);
      if (!n) fail(404, 'Ячейка не найдена');
      return { ok: true };
    }
  }

  // --- stock ---
  if (M === 'GET' && urlPath === '/stock') {
    need(me, 'stock.view');
    let rows = [];
    for (const s of store.all('stock')) {
      if (!(s.quantity > 0)) continue;
      const p = store.all('products').find(x => x.product_id === s.product_id) || {};
      const c = store.all('cells').find(x => x.cell_id === s.cell_id) || {};
      rows.push({
        id: s.stock_id, qty: s.quantity, reserved: s.reserved || 0,
        productId: s.product_id, productName: p.name, sku: p.sku, unit: p.unit, weightKg: p.weight_kg,
        lengthMm: p.length_mm, widthMm: p.width_mm, heightMm: p.height_mm,
        cellId: s.cell_id, cellCode: c.code, zoneName: zoneOf(c)?.name || null,
        zoneId: c.zone_id,
      });
    }
    if (query.productId) rows = rows.filter(r => r.productId === +query.productId);
    if (query.cellId) rows = rows.filter(r => r.cellId === +query.cellId);
    if (query.zoneId) rows = rows.filter(r => r.zoneId === +query.zoneId);
    if (query.q) rows = rows.filter(r => like(r.productName, query.q) || like(r.sku, query.q) || like(r.cellCode, query.q));
    return rows
      .sort((a, b) => String(a.cellCode).localeCompare(String(b.cellCode), 'ru')
        || String(a.productName).localeCompare(String(b.productName), 'ru'))
      .slice(0, 1000);
  }
  if (M === 'POST' && urlPath === '/stock/move') {
    need(me, 'stock.move');
    const b = body || {};
    const qty = +b.quantity;
    if (!b.productId || !b.fromCellId || !b.toCellId || !(qty > 0)) fail(400, 'Укажите товар, ячейки и количество');
    if (+b.fromCellId === +b.toCellId) fail(400, 'Ячейки совпадают');
    const p = store.all('products').find(x => x.product_id === +b.productId);
    const from = store.all('cells').find(x => x.cell_id === +b.fromCellId);
    const to = store.all('cells').find(x => x.cell_id === +b.toCellId);
    if (!p || !from || !to) fail(404, 'Товар или ячейка не найдены');
    if (to.status === 'blocked' || to.status === 'maintenance') fail(400, `Ячейка ${to.code} в статусе «${to.status}»`);
    const src = store.all('stock').find(s => s.product_id === p.product_id && s.cell_id === from.cell_id);
    if (!src || src.quantity < qty) fail(400, 'В исходной ячейке недостаточно товара');
    if ((src.reserved || 0) > 0 && (src.reserved || 0) + qty > src.quantity) {
      fail(400, 'Часть товара зарезервирована под заказы');
    }
    const fill = cellFill(to.cell_id);
    const addW = qty * p.weight_kg, addV = qty * productVolume(p);
    if (fill.weight + addW > to.max_weight_kg) fail(400, 'Превышение грузоподъёмности ячейки');
    if (fill.volume + addV > to.max_volume_m3) fail(400, 'Превышение объёма ячейки');
    takeStock(p.product_id, from.cell_id, qty);
    addStock(p.product_id, to.cell_id, qty);
    logAction(me, 'перемещение', 'stock', src.stock_id, { product: p.product_id, from: from.code, to: to.code, qty });
    return { ok: true };
  }

  // --- receipts ---
  if (seg[0] === 'receipts' && seg.length === 1) {
    if (M === 'GET') {
      need(me, 'receipts.view');
      let list = store.all('receipts').map(receiptListRow);
      if (query.status) list = list.filter(r => r.status === query.status);
      return list.sort((a, b) => b.id - a.id).slice(0, 300);
    }
    if (M === 'POST') {
      need(me, 'receipts.create');
      const b = body || {};
      if (!b.supplier || !String(b.supplier).trim()) fail(400, 'Укажите поставщика');
      const verr = validateItems(b.items);
      if (verr) fail(400, verr);
      const number = nextNumber('receipts', 'number', 'ПР');
      const row = store.insert('receipts', {
        number, supplier: String(b.supplier).trim(), date: nowStr(),
        status: 'new', user_id: me.id, comment: b.comment || null,
      });
      for (const it of b.items) {
        store.insert('receipt_items', { receipt_id: row.receipt_id, product_id: +it.productId, quantity: +it.quantity, placed: 0 });
      }
      logAction(me, 'создание', 'receipt', row.receipt_id, { number, supplier: row.supplier, positions: b.items.length });
      return { id: row.receipt_id, number };
    }
  }
  if (seg[0] === 'receipts' && seg.length === 2 && M === 'GET') {
    need(me, 'receipts.view');
    return receiptDetail(+seg[1]);
  }
  if (seg[0] === 'receipts' && seg.length === 2 && M === 'PUT') {
    need(me, 'receipts.create');
    const rc = store.all('receipts').find(x => x.receipt_id === +seg[1]);
    if (!rc) fail(404, 'Приёмка не найдена');
    if (rc.status !== 'new') fail(400, 'Редактировать можно только новую приёмку');
    const b = body || {};
    if (b.supplier !== undefined) rc.supplier = String(b.supplier).trim() || rc.supplier;
    if (b.comment !== undefined) rc.comment = b.comment || null;
    if (b.items !== undefined) {
      const verr = validateItems(b.items);
      if (verr) fail(400, verr);
      store.removeWhere('receipt_items', i => i.receipt_id === rc.receipt_id);
      for (const it of b.items) {
        store.insert('receipt_items', { receipt_id: rc.receipt_id, product_id: +it.productId, quantity: +it.quantity, placed: 0 });
      }
    }
    store.touch();
    return { ok: true };
  }
  if (seg[0] === 'receipts' && seg.length === 3 && M === 'POST') {
    const rc = store.all('receipts').find(x => x.receipt_id === +seg[1]);
    if (!rc) fail(404, 'Приёмка не найдена');
    const op = seg[2];
    if (op === 'confirm') {
      need(me, 'receipts.confirm');
      if (rc.status !== 'new') fail(400, 'Подтвердить можно только новую приёмку');
      const staging = stagingCell();
      for (const it of store.all('receipt_items').filter(i => i.receipt_id === rc.receipt_id)) {
        addStock(it.product_id, staging.cell_id, it.quantity);
      }
      rc.status = 'confirmed';
      store.touch();
      logAction(me, 'приёмка', 'receipt', rc.receipt_id, { number: rc.number, cell: staging.code });
      return { ok: true, stagingCell: staging.code };
    }
    if (op === 'place') {
      need(me, 'receipts.place');
      if (rc.status !== 'confirmed' && rc.status !== 'placed') fail(400, 'Сначала подтвердите приёмку');
      const staging = stagingCell();
      const placements = [], problems = [];
      const prodName = (pid) => store.all('products').find(p => p.product_id === pid)?.name || `#${pid}`;
      for (const it of store.all('receipt_items').filter(i => i.receipt_id === rc.receipt_id)) {
        let remaining = it.quantity - (it.placed || 0);
        if (remaining <= 0) continue;
        const from = store.all('stock').find(s => s.product_id === it.product_id && s.cell_id === staging.cell_id);
        remaining = Math.min(remaining, from?.quantity || 0);
        if (remaining <= 0) { problems.push(`Товар ${prodName(it.product_id)}: нет в зоне приёмки`); continue; }
        const before = remaining;
        for (const c of suggestCells(it.product_id, remaining, 20)) {
          while (remaining > 0 && c.room > 0) {
            const move = Math.min(remaining, c.room);
            if (!takeStock(it.product_id, staging.cell_id, move)) break;
            addStock(it.product_id, c.cellId, move);
            placements.push({ cell: c.code, productId: it.productId, qty: move });
            remaining -= move; c.room -= move;
          }
          if (remaining <= 0) break;
        }
        it.placed = (it.placed || 0) + (before - remaining);
        if (remaining > 0) problems.push(`«${prodName(it.product_id)}»: не хватило свободных ячеек (${remaining} шт. остались в приёмке)`);
      }
      const allPlaced = !store.all('receipt_items')
        .some(i => i.receipt_id === rc.receipt_id && (i.placed || 0) < i.quantity);
      rc.status = allPlaced ? 'placed' : 'confirmed';
      store.touch();
      logAction(me, allPlaced ? 'размещение' : 'частичное размещение', 'receipt', rc.receipt_id, { number: rc.number, moves: placements.length });
      return { ok: true, complete: allPlaced, placements, problems };
    }
    if (op === 'cancel') {
      need(me, 'receipts.create');
      if (rc.status === 'placed' || rc.status === 'cancelled') fail(400, 'Нельзя отменить размещённую или отменённую приёмку');
      if (rc.status === 'confirmed') {
        const staging = stagingCell();
        for (const it of store.all('receipt_items').filter(i => i.receipt_id === rc.receipt_id)) {
          const left = it.quantity - (it.placed || 0);
          if (left > 0) {
            const cur = store.all('stock').find(s => s.product_id === it.product_id && s.cell_id === staging.cell_id);
            takeStock(it.product_id, staging.cell_id, Math.min(left, cur?.quantity || 0));
          }
        }
      }
      rc.status = 'cancelled';
      store.touch();
      logAction(me, 'отмена', 'receipt', rc.receipt_id, { number: rc.number });
      return { ok: true };
    }
  }

  // --- orders ---
  if (seg[0] === 'orders' && seg.length === 1) {
    if (M === 'GET') {
      need(me, 'orders.view');
      let list = store.all('orders').map(orderListRow);
      if (query.status) list = list.filter(o => o.status === query.status);
      return list.sort((a, b) => b.id - a.id).slice(0, 300);
    }
    if (M === 'POST') {
      need(me, 'orders.create');
      const b = body || {};
      if (!b.customerName || !String(b.customerName).trim()) fail(400, 'Укажите покупателя');
      if (!Array.isArray(b.items) || !b.items.length) fail(400, 'Добавьте хотя бы одну позицию');
      const shortages = [];
      for (const it of b.items) {
        if (!it.productId || !(+it.quantity > 0)) fail(400, 'Некорректная позиция заказа');
        const p = store.all('products').find(x => x.product_id === +it.productId);
        if (!p) fail(400, 'Товар не найден');
        const avail = availableQty(p.product_id);
        if (avail < +it.quantity) shortages.push(`«${p.name}»: нужно ${it.quantity}, свободно ${avail}`);
      }
      if (shortages.length) fail(409, 'Недостаточно свободных остатков: ' + shortages.join('; '));
      const number = nextNumber('orders', 'number', 'ЗАК');
      const row = store.insert('orders', {
        number, customer_name: String(b.customerName).trim(), date: nowStr(),
        status: 'new', user_id: me.id, comment: b.comment || null,
      });
      for (const it of b.items) {
        store.insert('order_items', { order_id: row.order_id, product_id: +it.productId, quantity: +it.quantity, picked: 0 });
        let needQty = +it.quantity;
        const rows = store.all('stock')
          .filter(s => s.product_id === +it.productId && s.quantity - (s.reserved || 0) > 0
            && store.all('cells').find(c => c.cell_id === s.cell_id)?.status !== 'blocked')
          .sort((a, b) => a.cell_id - b.cell_id);
        for (const s of rows) {
          if (needQty <= 0) break;
          const take = Math.min(needQty, s.quantity - (s.reserved || 0));
          s.reserved = (s.reserved || 0) + take;
          needQty -= take;
        }
      }
      store.touch();
      logAction(me, 'создание', 'order', row.order_id, { number });
      return { id: row.order_id, number };
    }
  }
  if (seg[0] === 'orders' && seg[1] === 'check' && seg.length === 3 && M === 'GET') {
    need(me, 'orders.view');
    return { available: availableQty(+seg[2]) };
  }
  if (seg[0] === 'orders' && seg.length === 2 && M === 'GET') {
    need(me, 'orders.view');
    const o = store.all('orders').find(x => x.order_id === +seg[1]);
    if (!o) fail(404, 'Заказ не найден');
    return { ...orderListRow(o), items: orderItems(o.order_id) };
  }
  if (seg[0] === 'orders' && seg.length === 3 && M === 'POST') {
    const o = store.all('orders').find(x => x.order_id === +seg[1]);
    if (!o) fail(404, 'Заказ не найден');
    const op = seg[2];
    if (op === 'start') {
      need(me, 'orders.pick');
      if (o.status !== 'new') fail(400, 'Заказ уже в работе или закрыт');
      o.status = 'picking';
      store.touch();
      logAction(me, 'сборка начата', 'order', o.order_id, { number: o.number });
      return { ok: true, route: buildRoute(o.order_id) };
    }
    if (op === 'pick') {
      need(me, 'orders.pick');
      if (o.status !== 'picking') fail(400, 'Сборка не начата');
      const b = body || {};
      const qty = +b.quantity;
      if (!b.productId || !b.cellId || !(qty > 0)) fail(400, 'Укажите товар, ячейку и количество');
      const it = store.all('order_items').find(i => i.order_id === o.order_id && i.product_id === +b.productId);
      if (!it) fail(404, 'Позиция не найдена в заказе');
      if ((it.picked || 0) + qty > it.quantity) fail(400, `Можно собрать не более ${it.quantity - (it.picked || 0)} шт.`);
      const arr = store.all('stock');
      const idx = arr.findIndex(s => s.product_id === +b.productId && s.cell_id === +b.cellId);
      if (idx < 0 || arr[idx].quantity < qty) fail(400, 'В выбранной ячейке нет столько товара');
      const s = arr[idx];
      const newQty = s.quantity - qty, newRes = Math.max(0, (s.reserved || 0) - qty);
      if (newQty <= 0) arr.splice(idx, 1);
      else { s.quantity = newQty; s.reserved = newRes; }
      refreshCellStatus(+b.cellId);
      it.picked = (it.picked || 0) + qty;
      store.touch();
      const cell = store.all('cells').find(c => c.cell_id === +b.cellId);
      logAction(me, 'сборка', 'order', o.order_id, { product: it.product_id, cell: cell?.code, qty });
      const rest = store.all('order_items').filter(i => i.order_id === o.order_id && (i.picked || 0) < i.quantity).length;
      return { ok: true, allPicked: rest === 0 };
    }
    if (op === 'complete') {
      need(me, 'orders.complete');
      if (o.status !== 'picking') fail(400, 'Заказ не в сборке');
      const rest = store.all('order_items').filter(i => i.order_id === o.order_id && (i.picked || 0) < i.quantity);
      if (rest.length && !query.force) {
        fail(400, 'Заказ собран не полностью. Подтвердите частичную отгрузку или отмените заказ.');
      }
      releaseReserve(o.order_id);
      o.status = 'completed';
      store.touch();
      logAction(me, 'отгрузка', 'order', o.order_id, { number: o.number, partial: rest.length > 0 });
      return { ok: true };
    }
    if (op === 'cancel') {
      need(me, 'orders.cancel');
      if (o.status === 'completed' || o.status === 'cancelled') fail(400, 'Закрытый заказ нельзя отменить');
      releaseReserve(o.order_id);
      o.status = 'cancelled';
      store.touch();
      logAction(me, 'отмена', 'order', o.order_id, { number: o.number });
      return { ok: true };
    }
  }
  if (seg[0] === 'orders' && seg.length === 3 && seg[2] === 'route' && M === 'GET') {
    need(me, 'orders.pick');
    const o = store.all('orders').find(x => x.order_id === +seg[1]);
    if (!o) fail(404, 'Заказ не найден');
    return buildRoute(o.order_id);
  }

  // --- inventories ---
  if (seg[0] === 'inventories' && seg.length === 1) {
    if (M === 'GET') {
      need(me, 'inventory.view');
      return store.all('inventories')
        .map(inv => {
          const items = store.all('inventory_items').filter(i => i.inventory_id === inv.inventory_id);
          const z = store.all('zones').find(x => x.zone_id === inv.zone_id);
          return {
            id: inv.inventory_id, number: inv.number, date: inv.date, status: inv.status,
            zoneName: z?.name || null, zoneId: inv.zone_id, userName: fullNameOf(inv.user_id),
            itemsCount: items.length,
            countedCount: items.filter(i => i.fact_qty != null).length,
            diffCount: items.filter(i => i.fact_qty != null && i.fact_qty !== i.expected_qty).length,
          };
        })
        .sort((a, b) => b.id - a.id).slice(0, 200);
    }
    if (M === 'POST') {
      need(me, 'inventory.create');
      const zoneId = body?.zoneId ? +body.zoneId : null;
      const rows = store.all('stock').filter(s => {
        if (!(s.quantity > 0)) return false;
        if (zoneId == null) return true;
        return store.all('cells').find(c => c.cell_id === s.cell_id)?.zone_id === zoneId;
      });
      if (!rows.length) fail(400, 'Нет остатков для пересчёта');
      const number = nextNumber('inventories', 'number', 'ИНВ');
      const inv = store.insert('inventories', {
        number, zone_id: zoneId, date: nowStr(), status: 'open', user_id: me.id,
      });
      for (const r of rows) {
        store.insert('inventory_items', {
          inventory_id: inv.inventory_id, product_id: r.product_id, cell_id: r.cell_id,
          expected_qty: r.quantity, fact_qty: null,
        });
      }
      logAction(me, 'создание', 'inventory', inv.inventory_id, { number, positions: rows.length });
      return { id: inv.inventory_id, number, positions: rows.length };
    }
  }
  if (seg[0] === 'inventories' && seg.length === 2 && M === 'GET') {
    need(me, 'inventory.view');
    const inv = store.all('inventories').find(x => x.inventory_id === +seg[1]);
    if (!inv) fail(404, 'Инвентаризация не найдена');
    const z = store.all('zones').find(x => x.zone_id === inv.zone_id);
    const items = store.all('inventory_items')
      .filter(i => i.inventory_id === inv.inventory_id)
      .map(t => {
        const p = store.all('products').find(x => x.product_id === t.product_id) || {};
        const c = store.all('cells').find(x => x.cell_id === t.cell_id) || {};
        return {
          itemId: t.item_id, expectedQty: t.expected_qty, factQty: t.fact_qty,
          productId: t.product_id, name: p.name, sku: p.sku, unit: p.unit,
          cellId: t.cell_id, cellCode: c.code,
        };
      })
      .sort((a, b) => String(a.cellCode).localeCompare(String(b.cellCode), 'ru')
        || String(a.name).localeCompare(String(b.name), 'ru'));
    return {
      id: inv.inventory_id, number: inv.number, date: inv.date, status: inv.status,
      zoneId: inv.zone_id, zoneName: z?.name || null, userName: fullNameOf(inv.user_id), items,
    };
  }
  if (seg[0] === 'inventories' && seg.length === 4 && seg[2] === 'items' && M === 'PUT') {
    need(me, 'inventory.create');
    const inv = store.all('inventories').find(x => x.inventory_id === +seg[1]);
    if (!inv) fail(404, 'Инвентаризация не найдена');
    if (inv.status !== 'open') fail(400, 'Инвентаризация уже закрыта');
    const it = store.all('inventory_items')
      .find(x => x.item_id === +seg[3] && x.inventory_id === inv.inventory_id);
    if (!it) fail(404, 'Позиция не найдена');
    const fq = body?.factQty;
    if (fq === null || fq === undefined || fq === '') { it.fact_qty = null; }
    else {
      const q = +fq;
      if (!Number.isInteger(q) || q < 0) fail(400, 'Факт должен быть целым числом ≥ 0');
      it.fact_qty = q;
    }
    store.touch();
    return { ok: true };
  }
  if (seg[0] === 'inventories' && seg.length === 3 && seg[2] === 'close' && M === 'POST') {
    need(me, 'inventory.close');
    const inv = store.all('inventories').find(x => x.inventory_id === +seg[1]);
    if (!inv) fail(404, 'Инвентаризация не найдена');
    if (inv.status !== 'open') fail(400, 'Инвентаризация уже закрыта');
    const items = store.all('inventory_items').filter(i => i.inventory_id === inv.inventory_id);
    const unchecked = items.filter(i => i.fact_qty == null).length;
    if (unchecked > 0 && !query.force) fail(400, `Не пересчитано позиций: ${unchecked}. Досчитайте или закройте принудительно.`);
    const diffs = [];
    for (const t of items) {
      if (t.fact_qty == null || t.fact_qty === t.expected_qty) continue;
      const arr = store.all('stock');
      const row = arr.find(s => s.product_id === t.product_id && s.cell_id === t.cell_id);
      const delta = t.fact_qty - t.expected_qty;
      if (row) {
        const q = Math.max(0, row.quantity + delta);
        if (q === 0) arr.splice(arr.indexOf(row), 1);
        else { row.quantity = q; row.reserved = Math.min(row.reserved || 0, q); }
      } else if (t.fact_qty > 0) {
        store.insert('stock', { product_id: t.product_id, cell_id: t.cell_id, quantity: t.fact_qty, reserved: 0 });
      }
      refreshCellStatus(t.cell_id);
      const p = store.all('products').find(x => x.product_id === t.product_id) || {};
      const c = store.all('cells').find(x => x.cell_id === t.cell_id) || {};
      diffs.push({ product: p.name, cell: c.code, delta });
    }
    inv.status = 'closed';
    store.touch();
    logAction(me, 'закрытие инвентаризации', 'inventory', inv.inventory_id, { number: inv.number, diffs: diffs.length });
    return { ok: true, diffs };
  }
  if (seg[0] === 'inventories' && seg.length === 2 && M === 'DELETE') {
    need(me, 'inventory.create');
    const inv = store.all('inventories').find(x => x.inventory_id === +seg[1]);
    if (!inv) fail(404, 'Инвентаризация не найдена');
    if (inv.status !== 'open') fail(400, 'Нельзя удалить закрытую инвентаризацию');
    store.removeWhere('inventory_items', i => i.inventory_id === inv.inventory_id);
    store.removeWhere('inventories', x => x.inventory_id === inv.inventory_id);
    return { ok: true };
  }

  // --- reports ---
  if (seg[0] === 'reports' && seg.length === 2 && M === 'GET') {
    need(me, 'reports.view');
    const rep = seg[1];
    if (rep === 'stock-by-product') {
      return store.all('products')
        .map(p => {
          let qty = 0, reserved = 0;
          for (const s of store.all('stock')) {
            if (s.product_id !== p.product_id) continue;
            qty += s.quantity; reserved += s.reserved || 0;
          }
          const c = store.all('categories').find(x => x.category_id === p.category_id);
          return {
            productId: p.product_id, sku: p.sku, name: p.name, unit: p.unit,
            categoryName: c?.name || null, turnoverClass: p.turnover_class,
            qty, reserved, totalWeight: +(qty * p.weight_kg).toFixed(1),
          };
        })
        .filter(r => r.qty > 0 || (store.all('products').find(p => p.product_id === r.productId)?.min_stock || 0) > 0)
        .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }
    if (rep === 'stock-by-cell') {
      return store.all('cells')
        .map(c => {
          const rows = store.all('stock').filter(s => s.cell_id === c.cell_id && s.quantity > 0);
          return {
            cellCode: c.code, zoneName: zoneOf(c)?.name || null, status: c.status,
            positions: rows.length, qty: rows.reduce((a, s) => a + s.quantity, 0),
          };
        })
        .sort((a, b) => String(a.zoneName).localeCompare(String(b.zoneName), 'ru')
          || String(a.cellCode).localeCompare(String(b.cellCode), 'ru'));
    }
    if (rep === 'cell-utilization') {
      const groups = new Map();
      for (const c of store.all('cells')) {
        const zn = zoneOf(c)?.name || '—';
        if (!groups.has(zn)) {
          groups.set(zn, { zone: zn, cells: 0, occupied: 0, usedVolume: 0, totalVolume: 0, usedWeight: 0, totalWeight: 0 });
        }
        const g = groups.get(zn);
        const f = cellFill(c.cell_id);
        g.cells++;
        if (f.qty > 0) g.occupied++;
        g.usedVolume += f.volume; g.totalVolume += c.max_volume_m3 || 0;
        g.usedWeight += f.weight; g.totalWeight += c.max_weight_kg || 0;
      }
      return [...groups.values()].map(g => ({
        zone: g.zone, cells: g.cells, occupied: g.occupied,
        usedVolume: +g.usedVolume.toFixed(1), totalVolume: +g.totalVolume.toFixed(1),
        usedWeight: Math.round(g.usedWeight), totalWeight: Math.round(g.totalWeight),
        volumePct: g.totalVolume > 0 ? Math.round((g.usedVolume / g.totalVolume) * 100) : 0,
        weightPct: g.totalWeight > 0 ? Math.round((g.usedWeight / g.totalWeight) * 100) : 0,
        occupiedPct: g.cells > 0 ? Math.round((g.occupied / g.cells) * 100) : 0,
      }));
    }
    if (rep === 'movements') {
      const acts = ['приёмка', 'подтверждение приёмки', 'размещение', 'частичное размещение', 'сборка', 'отгрузка', 'перемещение', 'закрытие инвентаризации', 'резерв'];
      return store.all('operation_logs')
        .filter(l => acts.some(a => (l.action || '').includes(a))
          && (!query.entity || l.entity === query.entity)
          && (!query.from || l.timestamp >= query.from + ' 00:00:00')
          && (!query.to || l.timestamp <= query.to + ' 23:59:59'))
        .sort((a, b) => b.log_id - a.log_id).slice(0, 1000)
        .map(l => ({
          id: l.log_id, action: l.action, entity: l.entity, details: l.details,
          timestamp: l.timestamp, userName: fullNameOf(l.user_id),
        }));
    }
    if (rep === 'low-stock') {
      return store.all('products')
        .map(p => ({
          productId: p.product_id, sku: p.sku, name: p.name, unit: p.unit, minStock: p.min_stock,
          qty: store.all('stock').filter(s => s.product_id === p.product_id).reduce((a, s) => a + s.quantity, 0),
        }))
        .filter(r => r.minStock > 0 && r.qty < r.minStock)
        .sort((a, b) => a.qty - b.qty);
    }
  }

  // --- logs ---
  if (seg[0] === 'logs' && seg.length === 1 && M === 'GET') {
    need(me, 'logs.view');
    const page = Math.max(1, +(query.page || 1));
    const filtered = store.all('operation_logs').filter(l =>
      (query.userId == null || query.userId === '' || l.user_id === +query.userId)
      && (!query.action || like(l.action, query.action))
      && (!query.entity || l.entity === query.entity)
      && (!query.from || l.timestamp >= query.from + ' 00:00:00')
      && (!query.to || l.timestamp <= query.to + ' 23:59:59'));
    const total = filtered.length;
    const items = filtered.sort((a, b) => b.log_id - a.log_id).slice((page - 1) * 50, page * 50)
      .map(l => ({
        id: l.log_id, action: l.action, entity: l.entity, entityId: l.entity_id,
        details: l.details, timestamp: l.timestamp,
        userName: fullNameOf(l.user_id), userId: l.user_id,
      }));
    return { total, page, pages: Math.ceil(total / 50), items };
  }

  // --- dashboard ---
  if (seg[0] === 'dashboard' && seg.length === 1 && M === 'GET') {
    const cells = store.all('cells');
    const stocks = store.all('stock').filter(s => s.quantity > 0);
    const today = new Date().toISOString().slice(0, 10);
    const isToday = (d) => (d || '').slice(0, 10) === today;
    const lowStock = store.all('products')
      .map(p => ({
        productId: p.product_id, name: p.name, sku: p.sku, unit: p.unit, minStock: p.min_stock,
        qty: store.all('stock').filter(s => s.product_id === p.product_id).reduce((a, s) => a + s.quantity, 0),
      }))
      .filter(r => r.minStock > 0 && r.qty < r.minStock)
      .sort((a, b) => a.qty - b.qty).slice(0, 8);
    const byZone = store.all('zones').map(z => {
      const zcells = cells.filter(c => c.zone_id === z.zone_id);
      const occupied = zcells.filter(c => c.status === 'occupied').length;
      return {
        zone: z.name, total: zcells.length, occupied,
        pct: zcells.length ? Math.round((occupied / zcells.length) * 100) : 0,
      };
    }).sort((a, b) => a.zone.localeCompare(b.zone, 'ru'));
    const catMap = new Map();
    for (const s of stocks) {
      const p = store.all('products').find(x => x.product_id === s.product_id);
      if (!p) continue;
      const c = store.all('categories').find(x => x.category_id === p.category_id);
      const pc = c && store.all('categories').find(x => x.category_id === c.parent_id);
      const name = (pc || c)?.name || 'Без категории';
      catMap.set(name, (catMap.get(name) || 0) + s.quantity);
    }
    const byCategory = [...catMap.entries()].map(([name, qty]) => ({ name, qty }))
      .filter(r => r.qty > 0).sort((a, b) => b.qty - a.qty).slice(0, 8);
    const countBy = (arr, key) => {
      const m = new Map();
      for (const r of arr) m.set(r[key], (m.get(r[key]) || 0) + 1);
      return [...m.entries()].map(([status, n]) => ({ status, n }));
    };
    const pendingReceipts = store.all('receipts')
      .filter(r => r.status === 'new' || r.status === 'confirmed')
      .sort((a, b) => b.receipt_id - a.receipt_id).slice(0, 5)
      .map(rc => ({
        id: rc.receipt_id, number: rc.number, supplier: rc.supplier, status: rc.status, date: rc.date,
        toPlace: store.all('receipt_items').filter(i => i.receipt_id === rc.receipt_id)
          .reduce((a, i) => a + (i.quantity - (i.placed || 0)), 0) ?? 0,
      }));
    const pendingOrders = store.all('orders')
      .filter(o => o.status === 'new' || o.status === 'picking')
      .sort((a, b) => b.order_id - a.order_id).slice(0, 5)
      .map(o => ({ ...orderListRow(o) }));
    const weekly = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      weekly.push({
        day: d.slice(5).split('-').reverse().join('.'),
        receipts: store.all('receipts').filter(r => (r.date || '').slice(0, 10) === d).length,
        orders: store.all('orders').filter(o => (o.date || '').slice(0, 10) === d).length,
      });
    }
    return {
      cells: {
        total: cells.length,
        free: cells.filter(c => c.status === 'free').length,
        occupied: cells.filter(c => c.status === 'occupied').length,
        blocked: cells.filter(c => c.status === 'blocked').length,
        maintenance: cells.filter(c => c.status === 'maintenance').length,
      },
      stock: {
        skuCount: new Set(stocks.map(s => s.product_id)).size,
        totalQty: stocks.reduce((a, s) => a + s.quantity, 0),
        reservedQty: stocks.reduce((a, s) => a + (s.reserved || 0), 0),
      },
      products: store.all('products').length,
      receiptsToday: store.all('receipts').filter(r => isToday(r.date)).length,
      ordersToday: store.all('orders').filter(o => isToday(o.date)).length,
      pending: {
        receipts: store.all('receipts').filter(r => r.status === 'new' || r.status === 'confirmed').length,
        orders: store.all('orders').filter(o => o.status === 'new' || o.status === 'picking').length,
        inventories: store.all('inventories').filter(x => x.status === 'open').length,
      },
      lowStock, byZone, byCategory,
      recentLogs: store.all('operation_logs').slice().sort((a, b) => b.log_id - a.log_id).slice(0, 10)
        .map(l => ({ action: l.action, entity: l.entity, details: l.details, timestamp: l.timestamp, userName: fullNameOf(l.user_id) })),
      ordersByStatus: countBy(store.all('orders'), 'status'),
      receiptsByStatus: countBy(store.all('receipts'), 'status'),
      pendingReceipts, pendingOrders, weekly,
    };
  }

  fail(404, 'Метод API не найден');
}

// Полный сброс демо-данных (кнопка на странице входа в автономном режиме).
export function resetDemo() {
  seed();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(SESSION_KEY);
    }
  } catch { /* noop */ }
  try { window.dispatchEvent(new Event('wh-logout')); } catch { /* noop */ }
}
