const BASE = 'http://localhost:3001/api';
let token = null;
let passed = 0, failed = 0;

async function req(method, url, body, tok = token) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: 'Bearer ' + tok } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`PASS  ${name}`); }
  else { failed++; console.log(`FAIL  ${name} ${extra}`); }
}

const run = async () => {
  let r = await req('GET', '/health', null, null);
  check('health', r.status === 200 && r.data.ok);

  r = await req('POST', '/auth/login', { login: 'admin', password: 'admin123' }, null);
  check('login admin', r.status === 200 && r.data.token, JSON.stringify(r.data));
  token = r.data?.token;

  r = await req('POST', '/auth/login', { login: 'admin', password: 'wrong' }, null);
  check('login wrong password -> 401', r.status === 401);

  r = await req('GET', '/auth/me');
  check('me', r.status === 200 && r.data.user.permissions.includes('users.manage'));

  r = await req('GET', '/products');
  check('products list', r.status === 200 && r.data.length >= 30, `len=${r.data?.length}`);
  const products = r.data;

  r = await req('GET', '/categories');
  check('categories', r.status === 200 && r.data.length >= 10);

  r = await req('GET', '/zones');
  check('zones', r.status === 200 && r.data.length === 6);

  r = await req('GET', '/cells');
  check('cells list', r.status === 200 && r.data.length > 100, `len=${r.data?.length}`);

  r = await req('GET', '/cells/map');
  check('map', r.status === 200 && r.data.some(z => z.cells.length));

  const p0 = products.find(p => p.totalQty > 0);
  r = await req('GET', `/products/barcode/${p0.barcode}`);
  check('barcode lookup', r.status === 200 && r.data.id === p0.id);

  r = await req('GET', '/stock');
  check('stock', r.status === 200 && r.data.length > 0);

  // product CRUD
  r = await req('POST', '/products', { name: 'Тест-товар полка', categoryId: null, lengthMm: 800, widthMm: 300, heightMm: 1200, weightKg: 15, turnoverClass: 'B', isFragile: 0, minStock: 1 });
  check('create product', r.status === 200 && r.data.id, JSON.stringify(r.data));
  const newProdId = r.data?.id;
  r = await req('PUT', `/products/${newProdId}`, { name: 'Тест-товар полка 2', minStock: 5 });
  check('update product', r.status === 200);
  r = await req('DELETE', `/products/${newProdId}`);
  check('delete product', r.status === 200);

  // receipt flow
  r = await req('POST', '/receipts', {
    supplier: 'Тест-поставщик', comment: 'автотест',
    items: [{ productId: newProdId, quantity: 0 }],
  });
  check('create receipt invalid -> 400', r.status === 400);

  const vol = p => p.lengthMm * p.widthMm * p.heightMm;
  const prodA = products.filter(p => p.turnoverClass === 'A' && !p.isFragile).sort((x, y) => vol(x) - vol(y))[0];
  const prodB = products.filter(p => p.turnoverClass === 'B' && !p.isFragile).sort((x, y) => vol(x) - vol(y))[0];
  r = await req('POST', '/receipts', {
    supplier: 'Тест-поставщик',
    items: [{ productId: prodA.id, quantity: 4 }, { productId: prodB.id, quantity: 3 }],
  });
  check('create receipt', r.status === 200 && r.data.number?.startsWith('ПР-'), JSON.stringify(r.data));
  const rcId = r.data?.id;
  r = await req('POST', `/receipts/${rcId}/confirm`);
  check('confirm receipt', r.status === 200, JSON.stringify(r.data));
  r = await req('POST', `/receipts/${rcId}/place`);
  check('place receipt', r.status === 200 && r.data.complete, JSON.stringify(r.data));
  r = await req('GET', `/receipts/${rcId}`);
  check('receipt placed status', r.data.status === 'placed');

  // order flow
  r = await req('POST', '/orders', {
    customerName: 'Тест-покупатель',
    items: [{ productId: prodA.id, quantity: 2 }],
  });
  check('create order', r.status === 200 && r.data.number?.startsWith('ЗАК-'), JSON.stringify(r.data));
  const ordId = r.data?.id;

  r = await req('POST', '/orders', {
    customerName: 'Жадный', items: [{ productId: prodA.id, quantity: 99999 }],
  });
  check('order shortage -> 409', r.status === 409);

  r = await req('POST', `/orders/${ordId}/start`);
  check('start picking', r.status === 200 && r.data.route.length > 0, JSON.stringify(r.data));
  const line = r.data.route[0];
  r = await req('POST', `/orders/${ordId}/pick`, { productId: line.productId, cellId: line.cellId, quantity: line.qty });
  check('pick line', r.status === 200 && r.data.allPicked, JSON.stringify(r.data));
  r = await req('POST', `/orders/${ordId}/complete`);
  check('complete order', r.status === 200);

  r = await req('GET', '/orders');
  check('orders list', r.status === 200 && r.data.some(o => o.status === 'completed'));

  // inventory flow
  r = await req('POST', '/inventories', { zoneId: null });
  check('create inventory', r.status === 200 && r.data.positions > 0, JSON.stringify(r.data));
  const invId = r.data?.id;
  r = await req('GET', `/inventories/${invId}`);
  const invItems = r.data.items;
  const invItem = invItems[0];
  r = await req('PUT', `/inventories/${invId}/items/${invItem.itemId}`, { factQty: invItem.expectedQty + 1 });
  check('count item', r.status === 200);
  for (const it of invItems.slice(1)) {
    await req('PUT', `/inventories/${invId}/items/${it.itemId}`, { factQty: it.expectedQty });
  }
  r = await req('POST', `/inventories/${invId}/close`);
  check('close inventory with diff', r.status === 200 && r.data.diffs.length === 1, JSON.stringify(r.data));

  // stock move
  const stockRows = (await req('GET', '/stock')).data;
  const s1 = stockRows.find(s => s.qty > 1);
  const dims = (a, b, c) => [a, b, c].sort((x, y) => x - y);
  const [pl0, pl1, pl2] = dims(s1.lengthMm, s1.widthMm, s1.heightMm);
  const freeCell = (await req('GET', '/cells?status=free')).data.find(c =>
    c.zoneType === 'storage' && (() => { const d = dims(c.lengthMm, c.widthMm, c.heightMm); return pl0 <= d[0] && pl1 <= d[1] && pl2 <= d[2]; })());
  r = await req('POST', '/stock/move', { productId: s1.productId, fromCellId: s1.cellId, toCellId: freeCell.id, quantity: 1 });
  check('move stock', r.status === 200, JSON.stringify(r.data) + ' ' + JSON.stringify(freeCell));

  // reports / dashboard / logs
  for (const url of ['/reports/stock-by-product', '/reports/stock-by-cell', '/reports/cell-utilization', '/reports/movements', '/reports/low-stock', '/dashboard', '/logs?page=1']) {
    r = await req('GET', url);
    check(`GET ${url}`, r.status === 200);
  }

  // RBAC: manager cannot create products
  r = await req('POST', '/auth/login', { login: 'manager', password: 'manager123' }, null);
  const mgrToken = r.data?.token;
  r = await req('POST', '/products', { name: 'x', lengthMm: 1, widthMm: 1, heightMm: 1, weightKg: 1, turnoverClass: 'A' }, mgrToken);
  check('manager create product -> 403', r.status === 403);
  r = await req('GET', '/users', null, mgrToken);
  check('manager users -> 403', r.status === 403);
  r = await req('GET', '/dashboard', null, mgrToken);
  check('manager dashboard -> 200', r.status === 200);

  // loader can pick but not create orders
  r = await req('POST', '/auth/login', { login: 'loader', password: 'loader123' }, null);
  r = await req('POST', '/orders', { customerName: 'x', items: [] }, r.data?.token);
  check('loader create order -> 403', r.status === 403);

  // no token
  r = await req('GET', '/products', null, null);
  check('no token -> 401', r.status === 401);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
};

run().catch(e => { console.error('CRASH', e); process.exit(2); });
