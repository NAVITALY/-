import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, fmtDate } from '../api.js';
import { useAsync, ErrorBox, Loading, StatusBadge, Empty, useToast } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import ScanModal from '../components/ScanModal.jsx';

export default function InventoryDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload, error, loading } = useAsync(() => api(`/inventories/${id}`), [id]);
  const [scanFor, setScanFor] = useState(null);

  const setFact = async (item, qty) => {
    try {
      await api(`/inventories/${id}/items/${item.itemId}`, { method: 'PUT', body: { factQty: qty } });
      reload();
    } catch (e) { toast(e.message, 'err'); }
  };

  const close = (force) => {
    if (!confirm(force ? 'Закрыть с пропуском непересчитанных позиций?' : 'Закрыть инвентаризацию? Расхождения будут проведены по фактическому количеству.')) return;
    api(`/inventories/${id}/close${force ? '?force=1' : ''}`, { method: 'POST' })
      .then(r => { toast(`Закрыто. Расхождений скорректировано: ${r.diffs.length}`); reload(); })
      .catch(e => toast(e.message, 'err'));
  };

  const onScan = async (code) => {
    const item = scanFor;
    setScanFor(null);
    try {
      const p = await api(`/products/barcode/${encodeURIComponent(code)}`);
      const match = item.items.find(i => i.productId === p.id && !i.factQty && i.cellCode === item.cell);
      if (match) setFact(match, (match.expectedQty));
      else toast('Совпадение не найдено — введите количество вручную', 'err');
    } catch (e) { toast(e.message, 'err'); }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const byCell = new Map();
  for (const it of data.items) {
    if (!byCell.has(it.cellCode)) byCell.set(it.cellCode, []);
    byCell.get(it.cellCode).push(it);
  }
  const counted = data.items.filter(i => i.factQty !== null).length;
  const diffs = data.items.filter(i => i.factQty !== null && i.factQty !== i.expectedQty);

  return (
    <>
      <div className="toolbar">
        <Link to="/inventory" className="btn sm">← К списку</Link>
        <div className="spacer" />
        {data.status === 'open' && can('inventory.close') && <>
          <button className="btn" onClick={() => close(true)}>Закрыть с пропуском</button>
          <button className="btn primary" disabled={counted < data.items.length} onClick={() => close(false)}>✓ Закрыть и провести</button>
        </>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 30, flexWrap: 'wrap', alignItems: 'center' }}>
          <div><div className="muted" style={{ fontSize: 12 }}>Номер</div><b className="mono">{data.number}</b></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Дата</div><b>{fmtDate(data.date)}</b></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Область</div><b>{data.zoneName || 'весь склад'}</b></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Статус</div><StatusBadge status={data.status} kind="inventory" /></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Прогресс</div><b>{counted} / {data.items.length}</b></div>
          <div><div className="muted" style={{ fontSize: 12 }}>Расхождений</div><b style={diffs.length ? { color: 'var(--red)' } : {}}>{diffs.length}</b></div>
        </div>
      </div>

      {data.status === 'open' && <p className="hint">Обходите ячейки по порядку, вводите фактическое количество. Кнопка 📷 — быстрый ввод по штрихкоду первого товара в ячейке (берётся учётное количество).</p>}

      {[...byCell.entries()].map(([cellCode, items]) => (
        <div className="card" key={cellCode} style={{ marginBottom: 10 }}>
          <div className="panel-title">
            <h3 className="mono">Ячейка {cellCode}</h3>
            <div style={{ flex: 1 }} />
            {data.status === 'open' && items.every(i => i.factQty !== null) && <span className="badge green">пересчитана</span>}
            {data.status === 'open' && items.some(i => i.factQty === null) && items.some(i => i.factQty !== null) && <span className="badge orange">частично</span>}
          </div>
          <table>
            <thead><tr><th>Товар</th><th>Артикул</th><th className="num">Ожидается</th><th className="num" style={{ width: 140 }}>Факт</th></tr></thead>
            <tbody>
              {items.map(it => (
                <tr key={it.itemId} style={it.factQty !== null && it.factQty !== it.expectedQty ? { background: 'var(--red-soft)' } : {}}>
                  <td>{it.name}</td>
                  <td className="mono">{it.sku}</td>
                  <td className="num">{it.expectedQty}</td>
                  <td className="num">
                    {data.status === 'open' && can('inventory.create') ? (
                      <input type="number" min="0" defaultValue={it.factQty ?? ''} placeholder="—"
                        style={{ width: 90, textAlign: 'right' }}
                        onKeyDown={e => e.key === 'Enter' && setFact(it, e.target.value === '' ? null : +e.target.value)}
                        onBlur={e => { const v = e.target.value === '' ? null : +e.target.value; if (v !== it.factQty) setFact(it, v); }} />
                    ) : (
                      <b>{it.factQty ?? '—'}</b>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.status === 'open' && can('inventory.create') && (
            <button className="btn sm mt" onClick={() => setScanFor({ cell: cellCode, items })}>📷 Сканировать</button>
          )}
        </div>
      ))}
      {byCell.size === 0 && <Empty text="Нет позиций" />}
      {scanFor && <ScanModal onCode={onScan} onClose={() => setScanFor(null)} />}
    </>
  );
}
