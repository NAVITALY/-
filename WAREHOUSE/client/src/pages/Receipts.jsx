import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtShortDate, fmtDate } from '../api.js';
import { useAsync, Modal, Field, ErrorBox, Loading, Empty, StatusBadge, useToast } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

export default function Receipts() {
  const { can } = useAuth();
  const [status, setStatus] = useState('');
  const { data, reload, error, loading } = useAsync(
    () => api(`/receipts${status ? '?status=' + status : ''}`), [status]);
  const [form, setForm] = useState(false);

  return (
    <>
      <div className="toolbar">
        <select value={status} onChange={e => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          <option value="new">Новые</option>
          <option value="confirmed">Ждут размещения</option>
          <option value="placed">Размещены</option>
          <option value="cancelled">Отменённые</option>
        </select>
        <div className="spacer" />
        {can('receipts.create') && <button className="btn primary" onClick={() => setForm(true)}>+ Новая приёмка</button>}
      </div>

      {error && <ErrorBox error={error} />}
      {loading && <Loading />}
      {data && (data.length === 0 ? <Empty text="Приёмок нет" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Номер</th><th>Дата</th><th>Поставщик</th><th className="num">Позиций</th><th className="num">Кол-во</th><th>Статус</th><th>Кладовщик</th></tr></thead>
            <tbody>
              {data.map(rc => (
                <tr key={rc.id}>
                  <td><Link to={`/receipts/${rc.id}`} className="mono">{rc.number}</Link></td>
                  <td className="nowrap">{fmtShortDate(rc.date)}</td>
                  <td>{rc.supplier}</td>
                  <td className="num">{rc.itemsCount}</td>
                  <td className="num">{rc.totalQty}</td>
                  <td><StatusBadge status={rc.status} kind="receipt" /></td>
                  <td className="muted nowrap">{rc.userName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {form && <ReceiptForm onClose={() => setForm(false)} onSaved={() => { setForm(false); reload(); }} />}
    </>
  );
}

export function ReceiptForm({ onClose, onSaved, initial }) {
  const toast = useToast();
  const [supplier, setSupplier] = useState(initial?.supplier || '');
  const [comment, setComment] = useState(initial?.comment || '');
  const [items, setItems] = useState(initial?.items?.map(i => ({ productId: i.productId, name: i.name, quantity: i.quantity })) || []);
  const [pick, setPick] = useState('');
  const { data: found } = useAsync(
    () => pick ? api(`/products?q=${encodeURIComponent(pick)}`) : Promise.resolve([]), [pick]);

  const add = (p) => {
    setItems(list => {
      const ex = list.find(i => i.productId === p.id);
      if (ex) return list.map(i => i.productId === p.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...list, { productId: p.id, name: p.name, quantity: 1 }];
    });
    setPick('');
  };

  const save = async () => {
    try {
      if (initial?.id) await api(`/receipts/${initial.id}`, { method: 'PUT', body: { supplier, comment, items } });
      else await api('/receipts', { method: 'POST', body: { supplier, comment, items } });
      toast(initial?.id ? 'Приёмка обновлена' : 'Приёмка создана');
      onSaved();
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <Modal title={initial?.id ? `Приёмка ${initial.number}` : 'Приёмка товара'} onClose={onClose} wide
      footer={<>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn primary" onClick={save} disabled={!supplier || !items.length}>Сохранить</button>
      </>}>
      <div className="grid2">
        <Field label="Поставщик *"><input value={supplier} onChange={e => setSupplier(e.target.value)} placeholder="ООО «Поставщик»" /></Field>
        <Field label="Комментарий"><input value={comment} onChange={e => setComment(e.target.value)} /></Field>
      </div>
      <Field label="Поиск товара для добавления">
        <input value={pick} onChange={e => setPick(e.target.value)} placeholder="название или артикул…" />
      </Field>
      {!!pick && (found || []).length > 0 && (
        <div className="card" style={{ maxHeight: 150, overflow: 'auto', marginBottom: 12 }}>
          {found.slice(0, 8).map(p => (
            <div key={p.id} style={{ padding: '5px 6px', cursor: 'pointer', borderBottom: '1px solid #eef1f6' }} onClick={() => add(p)}>
              <b>{p.name}</b> <span className="mono muted">{p.sku}</span> <span className="muted">остаток {p.totalQty}</span>
            </div>
          ))}
        </div>
      )}
      {items.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Товар</th><th className="num" style={{ width: 110 }}>Количество</th><th></th></tr></thead>
            <tbody>
              {items.map((it, idx) => (
                <tr key={it.productId}>
                  <td>{it.name}</td>
                  <td className="num">
                    <input type="number" min="1" value={it.quantity} style={{ width: 80 }}
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
