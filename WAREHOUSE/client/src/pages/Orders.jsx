import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtShortDate } from '../api.js';
import { useAsync, Modal, Field, ErrorBox, Loading, Empty, StatusBadge, useToast } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

export default function Orders() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const { data, reload, error, loading } = useAsync(() => api(`/orders${status ? '?status=' + status : ''}`), [status]);
  const [form, setForm] = useState(false);

  return (
    <>
      <div className="toolbar">
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          <option value="new">Новые</option>
          <option value="picking">В сборке</option>
          <option value="completed">Отгружены</option>
          <option value="cancelled">Отменённые</option>
        </select>
        <div className="spacer" />
        {can('orders.create') && <button className="btn primary" onClick={() => setForm(true)}>+ Новый заказ</button>}
      </div>

      {error && <ErrorBox error={error} />}
      {loading && <Loading />}
      {data && (data.length === 0 ? <Empty text="Заказов нет" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Номер</th><th>Дата</th><th>Покупатель</th><th className="num">Позиций собрано</th><th>Статус</th><th>Менеджер</th></tr></thead>
            <tbody>
              {data.map(o => (
                <tr key={o.id}>
                  <td><Link to={`/orders/${o.id}`} className="mono">{o.number}</Link></td>
                  <td className="nowrap">{fmtShortDate(o.date)}</td>
                  <td>{o.customerName}</td>
                  <td className="num">{o.pickedQty} / {o.totalQty}</td>
                  <td><StatusBadge status={o.status} kind="order" /></td>
                  <td className="muted nowrap">{o.userName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {form && <OrderForm onClose={() => setForm(false)} onSaved={() => { setForm(false); reload(); }} />}
    </>
  );
}

export function OrderForm({ onClose, onSaved }) {
  const toast = useToast();
  const [customer, setCustomer] = useState('');
  const [comment, setComment] = useState('');
  const [items, setItems] = useState([]);
  const [pick, setPick] = useState('');
  const { data: found } = useAsync(() => pick ? api(`/products?q=${encodeURIComponent(pick)}`) : Promise.resolve([]), [pick]);

  const add = (p) => {
    setItems(l => l.some(i => i.productId === p.id)
      ? l.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i)
      : [...l, { productId: p.id, name: p.name, quantity: 1, available: p.totalQty - p.reservedQty }]);
    setPick('');
  };

  const save = async () => {
    try {
      const res = await api('/orders', { method: 'POST', body: { customerName: customer, comment, items } });
      toast(`Заказ ${res.number} создан, товар зарезервирован`);
      onSaved(res);
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <Modal title="Заказ на отгрузку" onClose={onClose} wide
      footer={<>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn primary" onClick={save} disabled={!customer || !items.length}>Создать и зарезервировать</button>
      </>}>
      <div className="grid2">
        <Field label="Покупатель *"><input value={customer} onChange={e => setCustomer(e.target.value)} /></Field>
        <Field label="Комментарий"><input value={comment} onChange={e => setComment(e.target.value)} /></Field>
      </div>
      <Field label="Поиск товара">
        <input value={pick} onChange={e => setPick(e.target.value)} placeholder="название или артикул…" />
      </Field>
      {!!pick && (found || []).length > 0 && (
        <div className="card" style={{ maxHeight: 150, overflow: 'auto', marginBottom: 12 }}>
          {found.slice(0, 8).map(p => (
            <div key={p.id} style={{ padding: '5px 6px', cursor: 'pointer', borderBottom: '1px solid #eef1f6' }} onClick={() => add(p)}>
              <b>{p.name}</b> <span className="mono muted">{p.sku}</span>{' '}
              <span className={p.totalQty - p.reservedQty > 0 ? 'muted' : 'badge red'}>свободно {p.totalQty - p.reservedQty}</span>
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Товар</th><th className="num">Свободно</th><th className="num" style={{ width: 100 }}>Количество</th><th></th></tr></thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={it.productId}>
                  <td>{it.name}</td>
                  <td className="num muted">{it.available}</td>
                  <td className="num">
                    <input type="number" min="1" value={it.quantity} style={{ width: 72 }}
                      onChange={e => setItems(l => l.map((x, i) => i === idx ? { ...x, quantity: +e.target.value } : x))} />
                  </td>
                  <td><button className="link-btn" style={{ color: 'var(--red)' }} onClick={() => setItems(l => l.filter((_, i) => i !== idx))}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
