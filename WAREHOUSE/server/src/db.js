import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(dataDir, 'warehouse.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
`);

db.exec(`
CREATE TABLE IF NOT EXISTS roles (
  role_id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS permissions (
  perm_id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(role_id) ON DELETE CASCADE,
  perm_id INTEGER NOT NULL REFERENCES permissions(perm_id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, perm_id)
);

CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(role_id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  category_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(category_id)
);

CREATE TABLE IF NOT EXISTS products (
  product_id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(category_id),
  length_mm REAL NOT NULL DEFAULT 0,
  width_mm REAL NOT NULL DEFAULT 0,
  height_mm REAL NOT NULL DEFAULT 0,
  weight_kg REAL NOT NULL DEFAULT 0,
  turnover_class TEXT NOT NULL DEFAULT 'B' CHECK (turnover_class IN ('A','B','C')),
  is_fragile INTEGER NOT NULL DEFAULT 0,
  min_stock INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'шт',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS zones (
  zone_id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL DEFAULT 'storage',
  coord_x INTEGER NOT NULL DEFAULT 0,
  coord_y INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS cells (
  cell_id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  zone_id INTEGER NOT NULL REFERENCES zones(zone_id),
  rack TEXT,
  section INTEGER,
  level INTEGER,
  length_mm REAL NOT NULL DEFAULT 0,
  width_mm REAL NOT NULL DEFAULT 0,
  height_mm REAL NOT NULL DEFAULT 0,
  max_weight_kg REAL NOT NULL DEFAULT 100,
  max_volume_m3 REAL NOT NULL DEFAULT 1,
  turnover_class TEXT CHECK (turnover_class IN ('A','B','C') OR turnover_class IS NULL),
  status TEXT NOT NULL DEFAULT 'free' CHECK (status IN ('free','occupied','blocked','maintenance'))
);

CREATE TABLE IF NOT EXISTS stock (
  stock_id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  cell_id INTEGER NOT NULL REFERENCES cells(cell_id),
  quantity INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  UNIQUE (product_id, cell_id)
);

CREATE TABLE IF NOT EXISTS receipts (
  receipt_id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  supplier TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','confirmed','placed','cancelled')),
  user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  comment TEXT
);

CREATE TABLE IF NOT EXISTS receipt_items (
  item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_id INTEGER NOT NULL REFERENCES receipts(receipt_id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  placed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS orders (
  order_id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','picking','completed','cancelled')),
  user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  comment TEXT
);

CREATE TABLE IF NOT EXISTS order_items (
  item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  picked INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS inventories (
  inventory_id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL UNIQUE,
  zone_id INTEGER REFERENCES zones(zone_id),
  date TEXT NOT NULL DEFAULT (datetime('now')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inventory_items (
  item_id INTEGER PRIMARY KEY AUTOINCREMENT,
  inventory_id INTEGER NOT NULL REFERENCES inventories(inventory_id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  cell_id INTEGER NOT NULL REFERENCES cells(cell_id),
  expected_qty INTEGER NOT NULL,
  fact_qty INTEGER
);

CREATE TABLE IF NOT EXISTS operation_logs (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id INTEGER,
  details TEXT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stock_product ON stock(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_cell ON stock(cell_id);
CREATE INDEX IF NOT EXISTS idx_logs_ts ON operation_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
`);

let secret = null;
export function jwtSecret() {
  if (secret) return secret;
  const f = path.join(dataDir, '.jwt-secret');
  if (fs.existsSync(f)) {
    secret = fs.readFileSync(f, 'utf8').trim();
  } else {
    secret = crypto.randomUUID() + crypto.randomUUID();
    fs.writeFileSync(f, secret);
  }
  return secret;
}
