import React, { useState } from 'react';
import { api } from '../api.js';
import { useAsync, Modal, Field, ErrorBox, Loading, Empty, useToast } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';
import ScanModal from '../components/ScanModal.jsx';

export default function Stock() {
  const { can } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [zone, setZone] = useState('');
  const { data: zones } = useAsync(() => api('/zones'), []);
  const { data, reload, error, loading } = useAsync(
    () => api(`/stock?q=${encodeURIComponent(q)}&zoneId=${zone}`), [q, zone]);
  const [move, setMove] = useState(null);
  const [scan, setScan] = useState(false);

  const onScan = async (code) => {
    setScan(false);
    try {
      const p = await api(`/products/barcode/${encodeURIComponent(code)}`);
      setQ(p.sku);
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Поиск: товар, артикул, адрес ячейки…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <select value={zone} onChange={e => setZone(e.target.value)}>
          <option value="">Все зоны</option>
          {(zones || []).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
        </select>
        <button className="btn" onClick={() => setScan(true)}>📷</button>
      </div>
      {error && <ErrorBox error={error} />}
      {loading && <Loading />}
      {data && (data.length === 0 ? <Empty text="Остатков нет" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Ячейка</th><th>Зона</th><th>Товар</th><th>Артикул</th><th className="num">Кол-во</th><th className="num">Резерв</th><th className="num">Свободно</th><th></th></tr></thead>
            <tbody>
              {data.map(s => (
                <tr key={s.id}>
                  <td className="mono nowrap">{s.cellCode}</td>
                  <td className="muted nowrap">{s.zoneName}</td>
                  <td>{s.productName}</td>
                  <td className="mono">{s.sku}</td>
                  <td className="num"><b>{s.qty}</b></td>
                  <td className="num muted">{s.reserved || '—'}</td>
                  <td className="num">{s.qty - s.reserved}</td>
                  <td>{can('stock.move') && s.qty - s.reserved > 0 && (
                    <button className="link-btn" onClick={() => setMove(s)}>Переместить</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {move && <MoveModal row={move} onClose={() => setMove(false)} onDone={() => { setMove(false); reload(); }} />}
      {scan && <ScanModal onCode={onScan} onClose={() => setScan(false)} />}
    </>
  );
}

function MoveModal({ row, onClose, onDone }) {
  const toast = useToast();
  const [toCellId, setToCellId] = useState('');
  const [qty, setQty] = useState(1);
  const [suggest, setSuggest] = useState([]);
  const { data: cells } = useAsync(() => api('/cells?status=free'), []);

  const loadSuggest = async () => {
    try { setSuggest(await api(`/cells/suggest?productId=${row.productId}&qty=${qty}`)); }
    catch (e) { toast(e.message, 'err'); }
  };

  const save = async () => {
    try {
      await api('/stock/move', { method: 'POST', body: { productId: row.productId, fromCellId: row.cellId, toCellId: +toCellId, quantity: qty } });
      toast('Товар перемещён');
      onDone();
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <Modal title={`Перемещение: ${row.productName}`} onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn primary" disabled={!toCellId || !(qty > 0)} onClick={save}>Переместить</button>
      </>}>
      <p>Из ячейки <b className="mono">{row.cellCode}</b> (свободно {row.qty - row.reserved} шт.)</p>
      <div className="grid2">
        <Field label="Количество">
          <input type="number" min="1" max={row.qty - row.reserved} value={qty} onChange={e => setQty(+e.target.value)} />
        </Field>
        <Field label="В ячейку">
          <select value={toCellId} onChange={e => setToCellId(e.target.value)}>
            <option value="">— выбрать —</option>
            {(cells || []).filter(c => c.code !== row.cellCode).map(c => (
              <option key={c.id} value={c.id}>{c.code} ({c.zoneName})</option>
            ))}
          </select>
        </Field>
      </div>
      <button className="btn sm" onClick={loadSuggest}>💡 Подобрать ячейку автоматически</button>
      {suggest.length > 0 && (
        <div className="table-wrap mt" style={{ boxShadow: 'none' }}>
          <table>
            <thead><tr><th>Ячейка</th><th>Зона</th><th className="num">Вместит</th><th>Причина</th><th></th></tr></thead>
            <tbody>{suggest.map(s => (
              <tr key={s.cellId}>
                <td className="mono">{s.code}</td><td className="muted">{s.zone}</td>
                <td className="num">{s.room}</td><td className="hint">{s.reason}</td>
                <td><button className="link-btn" onClick={() => setToCellId(String(s.cellId))}>выбрать</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}
