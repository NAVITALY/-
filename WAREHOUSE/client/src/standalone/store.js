// Автономное хранилище: мини-БД в localStorage (без сервера и Node в рантайме).
// Таблицы и поля повторяют схему server/src/db.js (snake_case), чтобы портированная
// бизнес-логика работала 1-в-1 с серверной. В Node (автотесты) — память.

export const DB_KEY = 'wh_standalone_db_v1';
export const SESSION_KEY = 'wh_standalone_session_v1';
export const TOKEN_KEY = 'wh_token';

export const TABLES = [
  'roles', 'permissions', 'role_permissions', 'users', 'categories', 'products',
  'zones', 'cells', 'stock', 'receipts', 'receipt_items', 'orders', 'order_items',
  'inventories', 'inventory_items', 'operation_logs',
];

export const ID_FIELD = {
  roles: 'role_id', permissions: 'perm_id', users: 'user_id', categories: 'category_id',
  products: 'product_id', zones: 'zone_id', cells: 'cell_id', stock: 'stock_id',
  receipts: 'receipt_id', receipt_items: 'item_id', orders: 'order_id', order_items: 'item_id',
  inventories: 'inventory_id', inventory_items: 'item_id', operation_logs: 'log_id',
};

const hasLS = () => typeof localStorage !== 'undefined';

function freshDb() {
  const db = { v: 1, seq: {}, tables: {} };
  for (const t of TABLES) { db.seq[t] = 0; db.tables[t] = []; }
  return db;
}

function readLS(key) {
  try {
    if (!hasLS()) return null;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function writeLS(key, val) {
  try { if (hasLS()) localStorage.setItem(key, JSON.stringify(val)); } catch { /* переполнение — живём в памяти */ }
}

class Store {
  constructor() {
    this.db = readLS(DB_KEY) || freshDb();
    // защита от битой/старой структуры
    if (!this.db.tables || !this.db.seq) this.db = freshDb();
    for (const t of TABLES) {
      if (!Array.isArray(this.db.tables[t])) this.db.tables[t] = [];
      if (typeof this.db.seq[t] !== 'number') this.db.seq[t] = this.db.tables[t].length;
    }
    this.timer = null;
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => this.flush());
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(); });
    }
  }

  all(table) { return this.db.tables[table]; }

  insert(table, obj) {
    const id = ++this.db.seq[table];
    const row = { ...obj, [ID_FIELD[table]]: id };
    this.db.tables[table].push(row);
    this.scheduleSave();
    return row;
  }

  removeWhere(table, pred) {
    const arr = this.db.tables[table];
    let n = 0;
    for (let i = arr.length - 1; i >= 0; i--) {
      if (pred(arr[i])) { arr.splice(i, 1); n++; }
    }
    if (n) this.scheduleSave();
    return n;
  }

  touch() { this.scheduleSave(); }

  scheduleSave() {
    if (!hasLS()) return;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 250);
  }

  flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    writeLS(DB_KEY, this.db);
  }

  replaceAll(db) { this.db = db; this.flush(); }

  reset() { this.db = freshDb(); this.flush(); }
}

export const store = new Store();

// --- сессии (замена JWT): token -> { userId, exp } ---
export function loadSessions() { return readLS(SESSION_KEY) || {}; }
export function saveSessions(s) { writeLS(SESSION_KEY, s); }
export function clearAllSessions() { try { if (hasLS()) localStorage.removeItem(SESSION_KEY); } catch { /* noop */ } }
