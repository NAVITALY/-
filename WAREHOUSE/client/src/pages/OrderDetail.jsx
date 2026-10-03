import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { useAsync, ErrorBox, Loading, StatusBadge, useToast } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import ScanModal from '../components/ScanModal.jsx';

export default function OrderDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload, error, loading } = useAsync(() => api(`/orders/${id}`), [id]);
  const [route, setRoute] = useState(null);
  const [busy, setBusy] = useState('');
  const [scanFor, setScanFor] = useState(null);

  const start = async () => {
    setBusy('start');
    try { const r = await api(`/orders/${id}/start`, { method: 'POST' }); setRoute(r.route); toast('Сборка начата, маршрут построен'); reload(); }
    catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };
  const loadRoute = async () => {
    try { setRoute(await api(`/orders/${id}/route`)); } catch (e) { toast(e.message, 'err'); }
  };
  const pick = async (line, qty) => {
    try {
      const r = await api(`/orders/${id}/pick`, { method: 'POST', body: { productId: line.productId, cellId: line.cellId, quantity: qty } });
      toast(`Собрано ${qty} шт. из ${line.cellCode}`);
      if (r.allPicked) toast('Все позиции собраны — можно отгружать');
      const nr = await api(`/orders/${id}/route`);
      setRoute(nr);
      reload();
    } catch (e) { toast(e.message, 'err'); }
  };
  const complete = async (force) => {
    setBusy('complete');
    try { await api(`/orders/${id}/complete${force ? '?force=1' : ''}`, { method: 'POST' }); toast('Заказ отгружен'); reload(); }
    catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };
  const cancel = async () => {
    setBusy('cancel');
    try { await api(`/orders/${id}/cancel`, { method: 'POST' }); toast('Заказ отменён, резерв снят'); reload(); }
    catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };

  const onScan = async (code) => {
    setScanFor(null);
    try {
      const p = await api(`/products/barcode/${encodeURIComponent(code)}`);
      const line = (route || []).find(l => l.productId === p.id && !l.missing);
      if (line) { pick(line, line.qty); }
      else toast('Этот товар не нужен в текущей сборке', 'err');
    } catch (e) { toast(e.message, 'err'); }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  return (
    <>
      <div className="toolbar">
        <Link to="/orders" className="btn sm">← К списку</Link>
        <div className="spacer" />
        {data.status === 'new' && can('orders.pick') && <button className="btn primary" disabled={!!busy} onClick={start}>{busy === 'start' ? '…' : '▶ Начать сборку'}</button>}
        {data.status === 'picking' && !route && can('orders.pick') && <button className="btn" onClick={loadRoute}>Показать маршрут</button>}
        {data.status === 'picking' && route && can('orders.pick') && <button className="btn" onClick={() => setScanFor(true)}>📷 Сканировать при сборке</button>}
        {data.status === 'picking' && can('orders.complete') && (
          <button className="btn primary" disabled={!!busy} onClick={() => complete(false)}>{busy === 'complete' ? '…' : '✓ Отгрузить'}</button>
        )}
        {data.status === 'picking' && data.pickedQty > 0 && data.pickedQty < data.totalQty && can('orders.complete') && (
          <button className="btn" disabled={!!busy} onClick={() => complete(true)}>Отгрузить частично</button>
        )}
        {['new', 'picking'].includes(data.status) && can('orders.cancel') && (
          <button className="btn danger" disabled={!!busy} onClick={cancel}>Отменить</button>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap' }}>
          <div><div className="muted" style={{ fontSize: 12 }}>Номер</div><b className="mono">{data.number}</b></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Покупатель</div><b>{data.customerName}</b></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Дата</div><b>{fmtDate(data.date)}</b></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Статус</div><StatusBadge status={data.status} kind="order" /></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Собрано</div><b>{data.pickedQty} / {data.totalQty}</b></div>
          {data.comment && <div><div className="muted" style={{ fontSize: 12 }}>Комментарий</div>{data.comment}</div>}
        </div>
      </div>

      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table>
          <thead><tr><th>Товар</th><th>Артикул</th><th className="num">Заказано</th><th className="num">Собрано</th></tr></thead>
          <tbody>
            {data.items.map(it => (
              <tr key={it.itemId}>
                <td>{it.name}</td>
                <td className="mono">{it.sku}</td>
                <td className="num">{it.quantity}</td>
                <td className="num">{it.picked} {it.picked < it.quantity && <span className="badge orange">осталось {it.quantity - it.picked}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {route && (
        <div className="card">
          <h3>Маршрутный лист сборки</h3>
          <p className="hint">Порядок обхода оптимизирован по зонам и ярусам. Сканируйте штрихкод товара или нажимайте «Собрать».</p>
          <div className="table-wrap" style={{ boxShadow: 'none' }}>
            <table>
              <thead><tr><th>#</th><th>Ячейка</th><th>Зона</th><th>Товар</th><th className="num">Взять</th><th></th></tr></thead>
              <tbody>
                {route.map((l, i) => (
                  <tr key={i} style={l.missing ? { background: 'var(--red-soft)' } : {}}>
                    <td className="muted">{i + 1}</td>
                    <td className="mono">{l.cellCode}</td>
                    <td className="muted">{l.zoneName || '—'}</td>
                    <td>{l.name}</td>
                    <td className="num">{l.qty}</td>
                    <td>{!l.missing && can('orders.pick') && data.status === 'picking' && (
                      <button className="btn sm primary" onClick={() => pick(l, l.qty)}>Собрать {l.qty}</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {scanFor && <ScanModal onCode={onScan} onClose={() => setScanFor(false)} />}
    </>
  );
}
