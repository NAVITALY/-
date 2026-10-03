// Порт server/src/seed.js: демо-данные при первом запуске (один раз, дальше — localStorage).
import bcrypt from 'bcryptjs';
import { store } from './store.js';
import { genBarcode, addStock, dimsFit } from './util.js';

export function isEmpty() {
  return store.all('users').length === 0;
}

export function seedIfEmpty() {
  if (isEmpty()) seed();
}

const pad2 = (n) => String(n).padStart(2, '0');
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 19).replace('T', ' ');

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
  store.reset();

  const roleIds = {};
  for (const [code, name, descr] of [
    ['admin', 'Администратор', 'Полный доступ: справочники, склад, пользователи, отчёты'],
    ['manager', 'Менеджер', 'Просмотр остатков, создание заказов, отчёты'],
    ['warehouse', 'Кладовщик', 'Приёмка, размещение, сборка, инвентаризация'],
    ['loader', 'Грузчик', 'Маршрутный лист и подтверждение сборки'],
  ]) {
    roleIds[code] = store.insert('roles', { code, name, description: descr }).role_id;
  }

  const permIds = {};
  for (const [code, descr] of PERMISSIONS) {
    permIds[code] = store.insert('permissions', { code, description: descr }).perm_id;
  }
  for (const [role, codes] of Object.entries(ROLE_PERMS)) {
    for (const c of codes) store.insert('role_permissions', { role_id: roleIds[role], perm_id: permIds[c] });
  }

  const pw = (s) => bcrypt.hashSync(s, 10);
  const uid = {};
  uid.admin = store.insert('users', { login: 'admin', password_hash: pw('admin123'), full_name: 'Иванов Сергей Петрович', role_id: roleIds.admin, is_active: 1, created_at: nowStr() }).user_id;
  uid.manager = store.insert('users', { login: 'manager', password_hash: pw('manager123'), full_name: 'Петрова Анна Сергеевна', role_id: roleIds.manager, is_active: 1, created_at: nowStr() }).user_id;
  uid.worker = store.insert('users', { login: 'worker', password_hash: pw('worker123'), full_name: 'Сидоров Михаил Иванович', role_id: roleIds.warehouse, is_active: 1, created_at: nowStr() }).user_id;
  uid.loader = store.insert('users', { login: 'loader', password_hash: pw('loader123'), full_name: 'Груздев Павел Николаевич', role_id: roleIds.loader, is_active: 1, created_at: nowStr() }).user_id;

  const catIds = {};
  for (const [name, , children] of CATEGORIES) {
    const pid = store.insert('categories', { name, parent_id: null }).category_id;
    catIds[name] = pid;
    for (const [cname] of children) catIds[cname] = store.insert('categories', { name: cname, parent_id: pid }).category_id;
  }

  const zoneIds = {};
  for (const [name, type, x, y] of ZONES) {
    zoneIds[name] = store.insert('zones', { name, type, coord_x: x, coord_y: y }).zone_id;
  }

  const mkCell = (o) => store.insert('cells', o);
  mkCell({ code: 'ПРИ-000', zone_id: zoneIds['Зона приёмки'], rack: 'ПРИ', section: 0, level: 0, length_mm: 4000, width_mm: 2000, height_mm: 2000, max_weight_kg: 8000, max_volume_m3: 16, turnover_class: null, status: 'free' });
  mkCell({ code: 'ОТР-01', zone_id: zoneIds['Зона отгрузки'], rack: 'ОТР', section: 1, level: 1, length_mm: 2000, width_mm: 1500, height_mm: 1800, max_weight_kg: 2000, max_volume_m3: 5.4, turnover_class: null, status: 'free' });
  mkCell({ code: 'ОТР-02', zone_id: zoneIds['Зона отгрузки'], rack: 'ОТР', section: 2, level: 1, length_mm: 2000, width_mm: 1500, height_mm: 1800, max_weight_kg: 2000, max_volume_m3: 5.4, turnover_class: null, status: 'free' });

  const zoneClass = {
    'Стеллажная А (быстрая)': 'A', 'Стеллажная Б (средняя)': 'B', 'Стеллажная В (медленная)': 'C',
  };
  for (const [zoneName, cls] of Object.entries(zoneClass)) {
    for (let rack = 1; rack <= 3; rack++) {
      for (let s = 1; s <= 4; s++) {
        for (let l = 1; l <= 3; l++) {
          const code = `${cls}${rack}-${pad2(s)}-${l}`;
          mkCell({ code, zone_id: zoneIds[zoneName], rack: `${cls}${rack}`, section: s, level: l, length_mm: 1200, width_mm: 1000, height_mm: 900, max_weight_kg: 300, max_volume_m3: 1.08, turnover_class: cls, status: 'free' });
        }
      }
    }
  }
  for (let rack = 1; rack <= 2; rack++) {
    for (let s = 1; s <= 6; s++) {
      const cls = rack === 1 ? 'B' : 'C';
      mkCell({ code: `К${rack}-${pad2(s)}`, zone_id: zoneIds['Крупногабаритная'], rack: `К${rack}`, section: s, level: 1, length_mm: 2600, width_mm: 1300, height_mm: 2300, max_weight_kg: 900, max_volume_m3: 7.7, turnover_class: cls, status: 'free' });
    }
  }

  const products = [];
  let skuCounter = 1;
  for (const [name, cat, l, w, h, weight, cls, fragile, minStock] of PRODUCTS) {
    const sku = `МИ-${String(skuCounter++).padStart(4, '0')}`;
    const row = store.insert('products', {
      sku, barcode: genBarcode(), name, category_id: catIds[cat],
      length_mm: l, width_mm: w, height_mm: h, weight_kg: weight,
      turnover_class: cls, is_fragile: fragile, min_stock: minStock, unit: 'шт', created_at: nowStr(),
    });
    products.push({ id: row.product_id, name, l, w, h, weight, cls, fragile, sku });
  }

  const cells = store.all('cells')
    .filter(c => store.all('zones').find(z => z.zone_id === c.zone_id)?.type === 'storage')
    .sort((a, b) => a.cell_id - b.cell_id);
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

  const staging = store.all('cells').find(c =>
    store.all('zones').find(z => z.zone_id === c.zone_id)?.type === 'receiving');

  const r1 = store.insert('receipts', { number: 'ПР-2026-0001', supplier: 'ООО «МебельПром»', date: daysAgo(5), status: 'placed', user_id: uid.worker, comment: 'Плановая поставка' }).receipt_id;
  for (const [pi, qty] of [[5, 6], [25, 8], [29, 10]]) {
    store.insert('receipt_items', { receipt_id: r1, product_id: products[pi].id, quantity: qty, placed: qty });
  }

  const r2 = store.insert('receipts', { number: 'ПР-2026-0002', supplier: 'ИП Ковалёв А.Р.', date: daysAgo(1), status: 'confirmed', user_id: uid.worker, comment: 'Ждёт размещения' }).receipt_id;
  for (const [pi, qty] of [[0, 2], [9, 4], [26, 6]]) {
    store.insert('receipt_items', { receipt_id: r2, product_id: products[pi].id, quantity: qty, placed: 0 });
    addStock(products[pi].id, staging.cell_id, qty);
  }

  store.insert('receipts', { number: 'ПР-2026-0003', supplier: 'ООО «Ясон-Мебель»', date: nowStr(), status: 'new', user_id: uid.worker, comment: null });

  const o1 = store.insert('orders', { number: 'ЗАК-2026-0001', customer_name: 'ИП Соколов Д.А.', date: daysAgo(4), status: 'completed', user_id: uid.manager, comment: 'Самовывоз' }).order_id;
  store.insert('order_items', { order_id: o1, product_id: products[21].id, quantity: 2, picked: 2 });
  store.insert('order_items', { order_id: o1, product_id: products[26].id, quantity: 4, picked: 4 });

  const o2 = store.insert('orders', { number: 'ЗАК-2026-0002', customer_name: 'Романова Е.В.', date: daysAgo(1), status: 'new', user_id: uid.manager, comment: 'Доставка 15.09' }).order_id;
  const o3 = store.insert('orders', { number: 'ЗАК-2026-0003', customer_name: 'ООО «Уют» (отель)', date: nowStr(), status: 'picking', user_id: uid.manager, comment: null }).order_id;
  store.insert('order_items', { order_id: o3, product_id: products[5].id, quantity: 2, picked: 1 });

  const reserve = (productId, qty) => {
    let need = qty;
    const rows = store.all('stock')
      .filter(s => s.product_id === productId && s.quantity - (s.reserved || 0) > 0)
      .sort((a, b) => a.stock_id - b.stock_id);
    for (const row of rows) {
      if (need <= 0) break;
      const take = Math.min(need, row.quantity - (row.reserved || 0));
      row.reserved = (row.reserved || 0) + take;
      need -= take;
    }
    store.touch();
  };
  store.insert('order_items', { order_id: o2, product_id: products[9].id, quantity: 2, picked: 0 });
  reserve(products[9].id, 2);
  store.insert('order_items', { order_id: o2, product_id: products[25].id, quantity: 2, picked: 0 });
  reserve(products[25].id, 2);
  reserve(products[5].id, 2);

  const zoneArows = store.all('stock').filter(s => {
    const c = store.all('cells').find(x => x.cell_id === s.cell_id);
    const z = c && store.all('zones').find(zz => zz.zone_id === c.zone_id);
    return z?.name === 'Стеллажная А (быстрая)' && s.quantity > 0;
  }).slice(0, 5);
  let invId = null;
  if (zoneArows.length) {
    invId = store.insert('inventories', { number: 'ИНВ-2026-0001', zone_id: zoneIds['Стеллажная А (быстрая)'], date: daysAgo(10), status: 'closed', user_id: uid.worker }).inventory_id;
    for (const row of zoneArows) {
      store.insert('inventory_items', { inventory_id: invId, product_id: row.product_id, cell_id: row.cell_id, expected_qty: row.quantity, fact_qty: row.quantity });
    }
  }

  const log = (userId, action, entity, entityId, details, date) => {
    store.insert('operation_logs', { user_id: userId, action, entity, entity_id: entityId, details: JSON.stringify(details), timestamp: date });
  };
  log(uid.worker, 'приёмка', 'receipt', r1, { number: 'ПР-2026-0001', positions: 3 }, daysAgo(5));
  log(uid.worker, 'размещение', 'receipt', r1, { number: 'ПР-2026-0001', moves: 3 }, daysAgo(5));
  log(uid.manager, 'создание', 'order', o1, { number: 'ЗАК-2026-0001' }, daysAgo(4));
  log(uid.worker, 'отгрузка', 'order', o1, { number: 'ЗАК-2026-0001' }, daysAgo(3));
  log(uid.worker, 'приёмка', 'receipt', r2, { number: 'ПР-2026-0002', positions: 3 }, daysAgo(1));
  log(uid.manager, 'создание', 'order', o2, { number: 'ЗАК-2026-0002' }, daysAgo(1));
  log(uid.worker, 'сборка начата', 'order', o3, { number: 'ЗАК-2026-0003' }, nowStr());
  log(uid.worker, 'закрытие инвентаризации', 'inventory', invId, { number: 'ИНВ-2026-0001', diffs: 0 }, daysAgo(10));

  store.flush();
}
