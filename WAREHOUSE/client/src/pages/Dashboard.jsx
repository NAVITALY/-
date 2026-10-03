import React from 'react';
import { Link } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { api, fmtDate, fmtNum } from '../api.js';
import { useAsync, ErrorBox, Loading, Empty } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

const PIE_COLORS = { free: '#22c55e', occupied: '#ef4444', blocked: '#94a3b8', maintenance: '#eab308' };

export default function Dashboard() {
  const { data, error, loading } = useAsync(() => api('/dashboard'), []);
  const { can } = useAuth();
  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const pieData = [
    { name: 'Занято', value: data.cells.occupied || 0, key: 'occupied' },
    { name: 'Свободно', value: data.cells.free || 0, key: 'free' },
    { name: 'Заблокировано', value: data.cells.blocked || 0, key: 'blocked' },
    { name: 'Обслуживание', value: data.cells.maintenance || 0, key: 'maintenance' },
  ].filter(x => x.value > 0);
  const occPct = data.cells.total ? Math.round((data.cells.occupied / data.cells.total) * 100) : 0;

  return (
    <>
      <div className="kpis">
        <div className="kpi accent">
          <div className="label">Ячеек занято</div>
          <div className="value">{occPct}%</div>
          <div className="hint">{data.cells.occupied} из {data.cells.total} ячеек</div>
        </div>
        <div className="kpi green">
          <div className="label">Товаров на складе</div>
          <div className="value">{fmtNum(data.stock.totalQty)}</div>
          <div className="hint">{fmtNum(data.stock.skuCount)} SKU · {fmtNum(data.stock.reservedQty)} в резерве</div>
        </div>
        <div className="kpi orange">
          <div className="label">Приёмок сегодня</div>
          <div className="value">{data.receiptsToday}</div>
          <div className="hint">в работе: {data.pending.receipts}</div>
        </div>
        <div className="kpi red">
          <div className="label">Заказов в работе</div>
          <div className="value">{data.pending.orders}</div>
          <div className="hint">отгружено сегодня: {data.ordersToday}</div>
        </div>
        <div className="kpi">
          <div className="label">Позиций номенклатуры</div>
          <div className="value">{fmtNum(data.products)}</div>
          <div className="hint">инвентаризаций открыто: {data.pending.inventories}</div>
        </div>
      </div>

      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="panel-title"><h3>Заполненность по зонам</h3></div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.byZone} margin={{ left: -20 }}>
                <XAxis dataKey="zone" tick={{ fontSize: 11 }} interval={0} tickFormatter={v => v.replace(/\s*\(.*\)/, '')} />
                <YAxis unit="%" tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => [v + '%', 'занято']} />
                <Bar dataKey="pct" fill="#4f46e5" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <div className="panel-title"><h3>Остатки по категориям</h3></div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data.byCategory} layout="vertical" margin={{ left: 60 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="qty" fill="#16a34a" radius={[0, 5, 5, 0]} name="шт" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <h3>Документы в работе</h3>
            <div style={{ display: 'grid', gridTemplateColumns: can('receipts.view') ? '1fr 1fr' : '1fr', gap: 24 }}>
              {can('receipts.view') && (
                <div>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Приёмки ждут подтверждения или размещения</div>
                  {data.pendingReceipts.length === 0 && <Empty text="Все приёмки завершены" />}
                  {data.pendingReceipts.map(rc => (
                    <Link to={`/receipts/${rc.id}`} key={rc.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #eef1f6', color: 'inherit' }}>
                      <span className="mono">{rc.number}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rc.supplier}</span>
                      {rc.status === 'confirmed' && <span className="badge orange nowrap">разместить {rc.toPlace} шт.</span>}
                      {rc.status === 'new' && <span className="badge blue nowrap">ожидает приёмки</span>}
                    </Link>
                  ))}
                </div>
              )}
              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>Заказы ждут сборки или отгрузки</div>
                {data.pendingOrders.length === 0 && <Empty text="Нет активных заказов" />}
                {data.pendingOrders.map(o => (
                  <Link to={`/orders/${o.id}`} key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #eef1f6', color: 'inherit' }}>
                    <span className="mono">{o.number}</span>
                    <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.customerName}</span>
                    {o.status === 'new' && <span className="badge blue nowrap">к сборке</span>}
                    {o.status === 'picking' && <span className="badge orange nowrap">собрано {o.pickedQty}/{o.totalQty}</span>}
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <h3>Динамика за 7 дней</h3>
            <ResponsiveContainer width="100%" height={210}>
              <BarChart data={data.weekly} margin={{ left: -20 }}>
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="receipts" name="Приёмки" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                <Bar dataKey="orders" name="Отгрузки" fill="#16a34a" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <h3>Статус ячеек</h3>
            <ResponsiveContainer width="100%" height={190}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72} paddingAngle={2}>
                  {pieData.map(p => <Cell key={p.key} fill={PIE_COLORS[p.key]} />)}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <div className="panel-title">
              <h3>Дефицит (ниже минимума)</h3>
              {can('products.edit') && <Link className="link-btn" to="/products">Пополнить</Link>}
            </div>
            {data.lowStock.length === 0 && <Empty text="Минимальные остатки в норме" />}
            {data.lowStock.map(s => (
              <div key={s.productId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderBottom: '1px solid #eef1f6' }}>
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</span>
                <span className="nowrap"><b className={s.qty === 0 ? 'muted' : ''} style={{ color: s.qty === 0 ? 'var(--red)' : undefined }}>{s.qty}</b> <span className="muted">/ мин {s.minStock}</span></span>
              </div>
            ))}
          </div>

          <div className="card">
            <div className="panel-title"><h3>Последние операции</h3>{can('logs.view') && <Link className="link-btn" to="/logs">Весь журнал</Link>}</div>
            {data.recentLogs.map((l, i) => (
              <div key={i} style={{ padding: '5px 0', borderBottom: '1px solid #eef1f6', fontSize: 13 }}>
                <b>{l.action}</b> <span className="muted">{l.entity}</span>
                <div className="muted" style={{ fontSize: 11.5 }}>{l.userName} · {fmtDate(l.timestamp)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
