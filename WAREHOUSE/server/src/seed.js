import { db } from './db.js';
import bcrypt from 'bcryptjs';
import { genBarcode, addStock, dimsFit } from './util.js';

export function isEmpty() {
  return !db.prepare('SELECT 1 FROM users LIMIT 1').get();
}

const PERMISSIONS = [
  ['dashboard.view', 'Просмотр дашборда'],
  ['products.view', 'Просмотр каталога'],
  ['products.edit', 'Редактирование каталога'],
  ['products.delete', 'Удаление товаров'],
  ['categories.edit', 'Управление категориями'],
  ['cells.view', 'Просмотр ячеек и карты'],
  ['cells.edit', 'Управление ячейками'],
  ['zones.edit', 'Управление зонами'],
  ['stock.view', 'Просмотр остатков'],
  ['stock.move', 'Перемещение товара'],
  ['receipts.view', 'Просмотр приёмок'],
  ['receipts.create', 'Создание приёмок'],
  ['receipts.confirm', 'Подтверждение приёмок'],
  ['receipts.place', 'Размещение товара'],
  ['orders.view', 'Просмотр заказов'],
  ['orders.create', 'Создание заказов'],
  ['orders.pick', 'Сборка заказов'],
  ['orders.complete', 'Отгрузка заказов'],
  ['orders.cancel', 'Отмена заказов'],
  ['inventory.view', 'Просмотр инвентаризаций'],
  ['inventory.create', 'Проведение инвентаризации'],
  ['inventory.close', 'Закрытие инвентаризации'],
  ['reports.view', 'Отчёты'],
  ['logs.view', 'Журнал операций'],
  ['users.manage', 'Управление пользователями'],
];

const ROLE_PERMS = {
  admin: PERMISSIONS.map(p => p[0]),
  manager: ['dashboard.view', 'products.view', 'cells.view', 'stock.view', 'receipts.view',
    'orders.view', 'orders.create', 'orders.cancel', 'inventory.view', 'reports.view', 'logs.view'],
  warehouse: ['dashboard.view', 'products.view', 'products.edit', 'categories.edit', 'cells.view',
    'cells.edit', 'stock.view', 'stock.move', 'receipts.view', 'receipts.create', 'receipts.confirm',
    'receipts.place', 'orders.view', 'orders.pick', 'orders.complete', 'inventory.view',
    'inventory.create', 'inventory.close', 'reports.view'],
  loader: ['dashboard.view', 'orders.view', 'orders.pick'],
};

const CATEGORIES = [
  ['Мягкая мебель', null, [['Диваны'], ['Кресла'], ['Матрасы']]],
  ['Корпусная мебель', null, [['Шкафы'], ['Кухни'], ['Стенки']]],
  ['Столы и стулья', null, [['Столы'], ['Стулья']]],
  ['Аксессуары', null, [['Текстиль'], ['Фурнитура'], ['Зеркала и свет']]],
];

// name, category, l×w×h mm, weight kg, class, fragile, minStock
const PRODUCTS = [
  ['Диван «Осло» прямой', 'Диваны', 2200, 1000, 850, 78, 'A', 0, 2],
  ['Диван «Осло» угловой', 'Диваны', 2600, 1600, 850, 105, 'A', 0, 2],
  ['Диван «Милан» еврокнижка', 'Диваны', 2300, 1050, 900, 85, 'A', 0, 2],
  ['Диван «Барселона» раскладной', 'Диваны', 2400, 1100, 880, 92, 'B', 0, 1],
  ['Диван «Честер» кожаный', 'Диваны', 2100, 950, 800, 88, 'C', 0, 1],
  ['Кресло «Стокгольм» офисное', 'Кресла', 650, 650, 1100, 18, 'A', 0, 4],
  ['Кресло «Рим» компьютерное', 'Кресла', 680, 680, 1200, 21, 'A', 0, 4],
  ['Кресло-мешок «Груша»', 'Кресла', 900, 900, 1000, 6, 'B', 0, 3],
  ['Кресло «Лофт» с подлокотниками', 'Кресла', 750, 800, 900, 24, 'B', 0, 2],
  ['Матрас «Орто» 90×200', 'Матрасы', 2000, 900, 200, 25, 'A', 0, 3],
  ['Матрас «Орто» 160×200', 'Матрасы', 2000, 1600, 220, 42, 'A', 0, 2],
  ['Матрас детский 70×140', 'Матрасы', 1400, 700, 150, 12, 'B', 0, 2],
  ['Шкаф «Классик» 2-дверный', 'Шкафы', 1800, 600, 2200, 95, 'C', 0, 1],
  ['Шкаф «Модерн» 3-дверный', 'Шкафы', 1600, 650, 2100, 110, 'C', 0, 1],
  ['Шкаф-купе «Милано»', 'Шкафы', 2400, 650, 2200, 140, 'C', 0, 1],
  ['Комод «Прага» 4 ящика', 'Шкафы', 900, 450, 850, 45, 'B', 0, 2],
  ['Кухня «Алиса» 2,0 м', 'Кухни', 2000, 600, 2100, 130, 'C', 0, 1],
  ['Кухня «Марта» 2,4 м', 'Кухни', 2400, 600, 2100, 155, 'C', 0, 1],
  ['Кухонная секция «Базовая»', 'Кухни', 800, 600, 850, 38, 'B', 0, 2],
  ['Стенка «Вена»', 'Стенки', 3200, 550, 2000, 165, 'C', 0, 1],
  ['Стенка «Гранд» модульная', 'Стенки', 3600, 450, 1800, 145, 'C', 0, 1],
  ['Тумба под ТВ «Модерн»', 'Стенки', 1200, 450, 550, 28, 'B', 0, 3],
  ['Стол обеденный «Скандо»', 'Столы', 1600, 900, 760, 35, 'A', 0, 2],
  ['Стол обеденный «Лофт» стекло', 'Столы', 1400, 800, 760, 42, 'B', 1, 1],
  ['Стол журнальный «Дуб»', 'Столы', 1000, 600, 450, 18, 'B', 0, 3],
  ['Стол письменный «Офис»', 'Столы', 1200, 600, 760, 25, 'A', 0, 3],
  ['Стул «Венский»', 'Стулья', 450, 500, 950, 7, 'A', 0, 12],
  ['Стул «Эрго» мягкий', 'Стулья', 500, 550, 900, 9, 'A', 0, 10],
  ['Стул барный «Хром»', 'Стулья', 400, 400, 1050, 8, 'B', 0, 4],
  ['Подушка декоративная «Вяз»', 'Текстиль', 450, 450, 120, 0.6, 'A', 0, 15],
  ['Плед флисовый 150×200', 'Текстиль', 400, 300, 80, 1.2, 'A', 0, 10],
  ['Чехол на диван «Жаккард»', 'Текстиль', 500, 400, 60, 1.5, 'B', 0, 6],
  ['Петли мебельные (компл.)', 'Фурнитура', 200, 150, 60, 0.4, 'A', 0, 25],
  ['Направляющие шариковые 450', 'Фурнитура', 480, 60, 60, 0.9, 'A', 0, 20],
  ['Ручки скобы (уп. 10 шт.)', 'Фурнитура', 250, 100, 50, 0.5, 'B', 0, 15],
  ['Зеркало настенное «Рама»', 'Зеркала и свет', 800, 50, 1200, 12, 'B', 1, 2],
  ['Лампа торшер «Ткань»', 'Зеркала и свет', 350, 350, 1600, 5, 'C', 1, 2],
  ['Люстра «Хрусталь»', 'Зеркала и свет', 600, 600, 400, 6, 'C', 1, 1],
];

const ZONES = [
  ['Зона приёмки', 'receiving', 0, 0],
  ['Стеллажная А (быстрая)', 'storage', 1, 1],
  ['Стеллажная Б (средняя)', 'storage', 1, 2],
  ['Стеллажная В (медленная)', 'storage', 1, 3],
  ['Крупногабаритная', 'storage', 2, 2],
  ['Зона отгрузки', 'shipping', 3, 1],
];

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

export function seed() {
  db.exec(`
    DELETE FROM inventory_items; DELETE FROM inventories;
    DELETE FROM order_items; DELETE FROM orders;
    DELETE FROM receipt_items; DELETE FROM receipts;
    DELETE FROM stock; DELETE FROM cells; DELETE FROM zones;
    DELETE FROM products; DELETE FROM categories;
    DELETE FROM operation_logs; DELETE FROM users;
    DELETE FROM role_permissions; DELETE FROM permissions; DELETE FROM roles;
  `);

  const insRole = db.prepare('INSERT INTO roles (code, name, description) VALUES (?, ?, ?)');
  const roleIds = {};
  for (const [code, name, descr] of [
    ['admin', 'Администратор', 'Полный доступ: справочники, склад, пользователи, отчёты'],
    ['manager', 'Менеджер', 'Просмотр остатков, создание заказов, отчёты'],
    ['warehouse', 'Кладовщик', 'Приёмка, размещение, сборка, инвентаризация'],
    ['loader', 'Грузчик', 'Маршрутный лист и подтверждение сборки'],
  ]) {
    const info = insRole.run(code, name, descr);
    roleIds[code] = Number(info.lastInsertRowid);
  }

  const insPerm = db.prepare('INSERT INTO permissions (code, description) VALUES (?, ?)');
  const permIds = {};
  for (const [code, descr] of PERMISSIONS) {
    permIds[code] = Number(insPerm.run(code, descr).lastInsertRowid);
  }
  const insRP = db.prepare('INSERT INTO role_permissions (role_id, perm_id) VALUES (?, ?)');
  for (const [role, codes] of Object.entries(ROLE_PERMS)) {
    for (const c of codes) insRP.run(roleIds[role], permIds[c]);
  }

  const insUser = db.prepare('INSERT INTO users (login, password_hash, full_name, role_id) VALUES (?, ?, ?, ?)');
  const pw = (s) => bcrypt.hashSync(s, 10);
  const uid = {};
  uid.admin = Number(insUser.run('admin', pw('admin123'), 'Иванов Сергей Петрович', roleIds.admin).lastInsertRowid);
  uid.manager = Number(insUser.run('manager', pw('manager123'), 'Петрова Анна Сергеевна', roleIds.manager).lastInsertRowid);
  uid.worker = Number(insUser.run('worker', pw('worker123'), 'Сидоров Михаил Иванович', roleIds.warehouse).lastInsertRowid);
  uid.loader = Number(insUser.run('loader', pw('loader123'), 'Груздев Павел Николаевич', roleIds.loader).lastInsertRowid);

  const insCat = db.prepare('INSERT INTO categories (name, parent_id) VALUES (?, ?)');
  const catIds = {};
  for (const [name, , children] of CATEGORIES) {
    const pid = Number(insCat.run(name, null).lastInsertRowid);
    catIds[name] = pid;
    for (const [cname] of children) catIds[cname] = Number(insCat.run(cname, pid).lastInsertRowid);
  }

  const insZone = db.prepare('INSERT INTO zones (name, type, coord_x, coord_y) VALUES (?, ?, ?, ?)');
  const zoneIds = {};
  for (const [name, type, x, y] of ZONES) zoneIds[name] = Number(insZone.run(name, type, x, y).lastInsertRowid);

  const insCell = db.prepare(`
    INSERT INTO cells (code, zone_id, rack, section, level, length_mm, width_mm, height_mm,
                       max_weight_kg, max_volume_m3, turnover_class, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  insCell.run('ПРИ-000', zoneIds['Зона приёмки'], 'ПРИ', 0, 0, 4000, 2000, 2000, 8000, 16, null, 'free');
  insCell.run('ОТР-01', zoneIds['Зона отгрузки'], 'ОТР', 1, 1, 2000, 1500, 1800, 2000, 5.4, null, 'free');
  insCell.run('ОТР-02', zoneIds['Зона отгрузки'], 'ОТР', 2, 1, 2000, 1500, 1800, 2000, 5.4, null, 'free');

  const zoneClass = {
    'Стеллажная А (быстрая)': 'A', 'Стеллажная Б (средняя)': 'B', 'Стеллажная В (медленная)': 'C',
  };
  for (const [zoneName, cls] of Object.entries(zoneClass)) {
    for (let rack = 1; rack <= 3; rack++) {
      for (let s = 1; s <= 4; s++) {
        for (let l = 1; l <= 3; l++) {
          const code = `${cls}${rack}-${String(s).padStart(2, '0')}-${l}`;
          insCell.run(code, zoneIds[zoneName], `${cls}${rack}`, s, l, 1200, 1000, 900, 300, 1.08, cls, 'free');
        }
      }
    }
  }
  for (let rack = 1; rack <= 2; rack++) {
    for (let s = 1; s <= 6; s++) {
      const cls = rack === 1 ? 'B' : 'C';
      insCell.run(`К${rack}-${String(s).padStart(2, '0')}`, zoneIds['Крупногабаритная'], `К${rack}`, s, 1,
        2600, 1300, 2300, 900, 7.7, cls, 'free');
    }
  }

  const insProduct = db.prepare(`
    INSERT INTO products (sku, barcode, name, category_id, length_mm, width_mm, height_mm,
                          weight_kg, turnover_class, is_fragile, min_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const products = [];
  let skuCounter = 1;
  for (const [name, cat, l, w, h, weight, cls, fragile, minStock] of PRODUCTS) {
    const sku = `МИ-${String(skuCounter++).padStart(4, '0')}`;
    const info = insProduct.run(sku, genBarcode(), name, catIds[cat], l, w, h, weight, cls, fragile, minStock);
    products.push({ id: Number(info.lastInsertRowid), name, l, w, h, weight, cls, fragile, sku });
  }

  const cells = db.prepare(`
    SELECT c.*, z.name AS zoneName FROM cells c JOIN zones z ON z.zone_id = c.zone_id
    WHERE z.type = 'storage' ORDER BY c.cell_id`).all();
  const fills = new Map(cells.map(c => [c.cell_id, { weight: 0, volume: 0, product: null }]));
  const big = p => (p.l * p.w * p.h) / 1e9;

  for (const p of products) {
    const vol = big(p);
    const pdims = { length_mm: p.l, width_mm: p.w, height_mm: p.h };
    let placed = 0, attempts = 0;
    while (placed < 2 && attempts < 400) {
      const c = cells[rnd(0, cells.length - 1)];
      attempts++;
      if (c.turnover_class !== p.cls) continue;
      if (p.fragile && c.level > 2) continue;
      if (!dimsFit(pdims, c)) continue;
      const f = fills.get(c.cell_id);
      if (f.weight + p.weight > c.max_weight_kg) continue;
      if (f.volume + vol > c.max_volume_m3) continue;
      f.weight += p.weight; f.volume += vol;
      addStock(p.id, c.cell_id, rnd(1, 3));
      placed++;
    }
    if (!placed) {
      const cands = cells.filter(c => dimsFit(pdims, c) &&
        (c.turnover_class === p.cls || c.rack?.startsWith('К')) && (!p.fragile || c.level <= 2));
      const free = cands.find(c => !fills.get(c.cell_id).product)
        || cands.find(c => { const f = fills.get(c.cell_id);
          return f.weight + p.weight <= c.max_weight_kg && f.volume + vol <= c.max_volume_m3; });
      if (free) {
        const f = fills.get(free.cell_id);
        const roomV = Math.floor((free.max_volume_m3 - f.volume) / vol);
        const roomW = Math.floor((free.max_weight_kg - f.weight) / p.weight);
        const qty = Math.min(rnd(1, 3), Math.max(1, roomV, 0), Math.max(1, roomW, 0));
        addStock(p.id, free.cell_id, qty);
        f.product = p.id;
        f.weight += p.weight * qty;
        f.volume += vol * qty;
        placed++;
      }
    }
  }

  const insReceipt = db.prepare(`
    INSERT INTO receipts (number, supplier, date, status, user_id, comment)
    VALUES (?, ?, datetime('now', ?), ?, ?, ?)`);
  const insRItem = db.prepare('INSERT INTO receipt_items (receipt_id, product_id, quantity, placed) VALUES (?, ?, ?, ?)');

  const r1 = Number(insReceipt.run('ПР-2026-0001', 'ООО «МебельПром»', '-5 days', 'placed', uid.worker, 'Плановая поставка').lastInsertRowid);
  for (const [pi, qty] of [[5, 6], [25, 8], [29, 10]]) insRItem.run(r1, products[pi].id, qty, qty);

  const r2 = Number(insReceipt.run('ПР-2026-0002', 'ИП Ковалёв А.Р.', '-1 days', 'confirmed', uid.worker, 'Ждёт размещения').lastInsertRowid);
  const staging = db.prepare(`SELECT c.cell_id FROM cells c JOIN zones z ON z.zone_id = c.zone_id WHERE z.type = 'receiving' LIMIT 1`).get();
  for (const [pi, qty] of [[0, 2], [9, 4], [26, 6]]) {
    insRItem.run(r2, products[pi].id, qty, 0);
    addStock(products[pi].id, staging.cell_id, qty);
  }

  insReceipt.run('ПР-2026-0003', 'ООО «Ясон-Мебель»', '0 days', 'new', uid.worker, null);

  const insOrder = db.prepare(`
    INSERT INTO orders (number, customer_name, date, status, user_id, comment)
    VALUES (?, ?, datetime('now', ?), ?, ?, ?)`);
  const insOItem = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, picked) VALUES (?, ?, ?, ?)');

  const o1 = Number(insOrder.run('ЗАК-2026-0001', 'ИП Соколов Д.А.', '-4 days', 'completed', uid.manager, 'Самовывоз').lastInsertRowid);
  insOItem.run(o1, products[21].id, 2, 2);
  insOItem.run(o1, products[26].id, 4, 4);

  const o2 = Number(insOrder.run('ЗАК-2026-0002', 'Романова Е.В.', '-1 days', 'new', uid.manager, 'Доставка 15.09').lastInsertRowid);
  const o3 = Number(insOrder.run('ЗАК-2026-0003', 'ООО «Уют» (отель)', '0 days', 'picking', uid.manager, null).lastInsertRowid);
  insOItem.run(o3, products[5].id, 2, 1);

  const reserve = (productId, qty) => {
    let need = qty;
    const rows = db.prepare(`
      SELECT s.* FROM stock s JOIN cells c ON c.cell_id = s.cell_id
      WHERE s.product_id = ? AND s.quantity - s.reserved > 0 ORDER BY s.stock_id`).all(productId);
    const upd = db.prepare('UPDATE stock SET reserved = reserved + ? WHERE stock_id = ?');
    for (const row of rows) {
      if (need <= 0) break;
      const take = Math.min(need, row.quantity - row.reserved);
      upd.run(take, row.stock_id);
      need -= take;
    }
  };
  insOItem.run(o2, products[9].id, 2, 0);
  reserve(products[9].id, 2);
  insOItem.run(o2, products[25].id, 2, 0);
  reserve(products[25].id, 2);
  reserve(products[5].id, 2);

  const insInv = db.prepare(`
    INSERT INTO inventories (number, zone_id, date, status, user_id)
    VALUES (?, ?, datetime('now', '-10 days'), 'closed', ?)`);
  const insInvItem = db.prepare(`
    INSERT INTO inventory_items (inventory_id, product_id, cell_id, expected_qty, fact_qty)
    VALUES (?, ?, ?, ?, ?)`);
  const zoneA = db.prepare(`SELECT s.product_id, s.cell_id, s.quantity FROM stock s
    JOIN cells c ON c.cell_id = s.cell_id JOIN zones z ON z.zone_id = c.zone_id
    WHERE z.name = 'Стеллажная А (быстрая)' AND s.quantity > 0 LIMIT 5`).all();
  let invId = null;
  if (zoneA.length) {
    invId = Number(insInv.run('ИНВ-2026-0001', zoneIds['Стеллажная А (быстрая)'], uid.worker).lastInsertRowid);
    for (const row of zoneA) insInvItem.run(invId, row.product_id, row.cell_id, row.quantity, row.quantity);
  }

  const insLog = db.prepare(`
    INSERT INTO operation_logs (user_id, action, entity, entity_id, details, timestamp)
    VALUES (?, ?, ?, ?, ?, datetime('now', ?))`);
  insLog.run(uid.worker, 'приёмка', 'receipt', r1, JSON.stringify({ number: 'ПР-2026-0001', positions: 3 }), '-5 days');
  insLog.run(uid.worker, 'размещение', 'receipt', r1, JSON.stringify({ number: 'ПР-2026-0001', moves: 3 }), '-5 days');
  insLog.run(uid.manager, 'создание', 'order', o1, JSON.stringify({ number: 'ЗАК-2026-0001' }), '-4 days');
  insLog.run(uid.worker, 'отгрузка', 'order', o1, JSON.stringify({ number: 'ЗАК-2026-0001' }), '-3 days');
  insLog.run(uid.worker, 'приёмка', 'receipt', r2, JSON.stringify({ number: 'ПР-2026-0002', positions: 3 }), '-1 days');
  insLog.run(uid.manager, 'создание', 'order', o2, JSON.stringify({ number: 'ЗАК-2026-0002' }), '-1 days');
  insLog.run(uid.worker, 'сборка начата', 'order', o3, JSON.stringify({ number: 'ЗАК-2026-0003' }), '0 days');
  insLog.run(uid.worker, 'закрытие инвентаризации', 'inventory', invId, JSON.stringify({ number: 'ИНВ-2026-0001', diffs: 0 }), '-10 days');

  console.log('Демо-данные загружены. Пользователи: admin/admin123, manager/manager123, worker/worker123, loader/loader123');
}

if (process.argv[1] && process.argv[1].endsWith('seed.js')) {
  seed();
}
