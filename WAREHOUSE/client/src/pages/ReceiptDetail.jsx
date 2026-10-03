import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { useAsync, Modal, ErrorBox, Loading, StatusBadge, BarcodeSvg, useToast } from '../components/ui.jsx';
import { printLabels } from '../print.js';
import { useAuth } from '../auth.jsx';
import { ReceiptForm } from './Receipts.jsx';

export default function ReceiptDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const { data, reload, error, loading } = useAsync(() => api(`/receipts/${id}`), [id]);
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState(false);
  const [labels, setLabels] = useState(false);
  const [result, setResult] = useState(null);

  const act = async (name, path) => {
    setBusy(name);
    try {
      const res = await api(`/receipts/${id}/${path}`, { method: 'POST' });
      if (path === 'place') setResult(res);
      else toast(name === 'confirm' ? 'Приёмка подтверждена — товар в зоне приёмки' : 'Готово');
      reload();
    } catch (e) { toast(e.message, 'err'); }
    setBusy('');
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  return (
    <>
      <div className="toolbar">
        <Link to="/receipts" className="btn sm">← К списку</Link>
        <div className="spacer" />
        {data.status === 'new' && can('receipts.create') && <button className="btn" onClick={() => setEdit(true)}>Редактировать</button>}
        {data.status === 'new' && can('receipts.confirm') && (
          <button className="btn primary" disabled={!!busy} onClick={() => act('confirm', 'confirm')}>
            {busy === 'confirm' ? '…' : '✓ Подтвердить приёмку'}
          </button>
        )}
        {data.status === 'confirmed' && can('receipts.place') && (
          <button className="btn primary" disabled={!!busy} onClick={() => act('place', 'place')}>
            {busy === 'place' ? 'Размещаю…' : '⬒ Разместить по ячейкам'}
          </button>
        )}
        {['confirmed', 'placed'].includes(data.status) && can('receipts.view') && (
          <button className="btn" onClick={() => setLabels(true)}>🏷 Этикетки</button>
        )}
        {['new', 'confirmed'].includes(data.status) && can('receipts.create') && (
          <button className="btn danger" disabled={!!busy} onClick={() => act('cancel', 'cancel')}>Отменить</button>
        )}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap' }}>
          <div><div className="muted" style={{ fontSize: 12 }}>Номер</div><b className="mono">{data.number}</b></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Поставщик</div><b>{data.supplier}</b></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Дата</div><b>{fmtDate(data.date)}</b></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Статус</div><StatusBadge status={data.status} kind="receipt" /></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Оформил</div><b>{data.userName || '—'}</b></div>
          {data.comment && <div><div className="muted" style={{ fontSize: 12 }}>Комментарий</div>{data.comment}</div>}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Товар</th><th>Артикул</th><th className="num">Принято</th><th className="num">Размещено</th><th></th></tr></thead>
          <tbody>
            {data.items.map((it, i) => (
              <tr key={it.itemId}>
                <td className="muted">{i + 1}</td>
                <td><Link to={`/products`}>{it.name}</Link></td>
                <td className="mono">{it.sku}</td>
                <td className="num">{it.quantity}</td>
                <td className="num">{it.placed} {it.placed < it.quantity && <span className="badge orange">{it.quantity - it.placed} не размещ.</span>}</td>
                <td className="nowrap"><span className="mono muted" style={{ fontSize: 11 }}>{it.barcode}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.status === 'new' && (
        <p className="hint mt">Порядок работы: <b>1)</b> создать приёмку → <b>2)</b> подтвердить (товар попадёт в зону приёмки, можно печатать этикетки) → <b>3)</b> разместить по ячейкам (система сама подберёт ячейки по классу ходкости, габаритам и грузоподъёмности).</p>
      )}

      {edit && <ReceiptForm initial={data} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); reload(); }} />}
      {labels && <LabelsModal data={data} onClose={() => setLabels(false)} />}
      {result && (
        <Modal title="Результат размещения" onClose={() => setResult(null)}
          footer={<button className="btn primary" onClick={() => setResult(null)}>OK</button>}>
          {result.complete ? <div className="alert ok">Все позиции размещены по ячейкам.</div>
            : <div className="alert info">Размещено частично — остаток лежит в зоне приёмки, повторите размещение после освобождения ячеек.</div>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Ячейка</th><th>Товар</th><th className="num">Кол-во</th></tr></thead>
              <tbody>{result.placements.map((p, i) => (
                <tr key={i}><td className="mono">{p.cell}</td><td>{data.items.find(x => x.productId === p.productId)?.name}</td><td className="num">{p.qty}</td></tr>
              ))}</tbody>
            </table>
          </div>
          {result.problems?.length > 0 && <div className="alert error mt">{result.problems.join('; ')}</div>}
        </Modal>
      )}
    </>
  );
}

function LabelsModal({ data, onClose }) {
  return (
    <Modal title={`Этикетки — ${data.number}`} onClose={onClose} wide
      footer={<>
        <button className="btn" onClick={onClose}>Закрыть</button>
        <button className="btn primary" onClick={() => printLabels(data.number, data.items.map(it => ({ name: it.name, sku: it.sku, barcode: it.barcode, qty: it.quantity, unit: it.unit })))}>🖨 Печать этикеток</button>
      </>}>
      <div className="print-area" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {data.items.map(it => (
          <div key={it.itemId} style={{ border: '1px dashed #94a3b8', borderRadius: 10, padding: 12, textAlign: 'center' }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{it.name}</div>
            <div className="mono muted" style={{ fontSize: 11 }}>{it.sku} · ООО «Домашний интерьер»</div>
            <BarcodeSvg value={it.barcode} height={46} />
            <div style={{ fontSize: 12 }}>принято: <b>{it.quantity} {it.unit}</b></div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
