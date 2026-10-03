import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmtShortDate } from '../api.js';
import { useAsync, Modal, Field, ErrorBox, Loading, Empty, StatusBadge, useToast } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

export default function Inventory() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload, error, loading } = useAsync(() => api('/inventories'), []);
  const [create, setCreate] = useState(false);
  const { data: zones } = useAsync(() => api('/zones'), []);
  const [zoneId, setZoneId] = useState('');

  const start = async () => {
    try {
      const r = await api('/inventories', { method: 'POST', body: { zoneId: zoneId || null } });
      toast(`Инвентаризация ${r.number} создана (${r.positions} позиций)`);
      setCreate(false);
      reload();
    } catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="toolbar">
        <span className="hint">Сверка фактических остатков с учётными по ячейкам</span>
        <div className="spacer" />
        {can('inventory.create') && <button className="btn primary" onClick={() => setCreate(true)}>+ Начать инвентаризацию</button>}
      </div>
      {error && <ErrorBox error={error} />}
      {loading && <Loading />}
      {data && (data.length === 0 ? <Empty text="Инвентаризаций не проводилось" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Номер</th><th>Дата</th><th>Область</th><th>Статус</th><th className="num">Позиций</th><th className="num">Пересчитано</th><th className="num">Расхождений</th><th>Инициатор</th></tr></thead>
            <tbody>
              {data.map(i => (
                <tr key={i.id}>
                  <td><Link to={`/inventory/${i.id}`} className="mono">{i.number}</Link></td>
                  <td className="nowrap">{fmtShortDate(i.date)}</td>
                  <td>{i.zoneName || <b>весь склад</b>}</td>
                  <td><StatusBadge status={i.status} kind="inventory" /></td>
                  <td className="num">{i.itemsCount}</td>
                  <td className="num">{i.countedCount}</td>
                  <td className="num" style={i.diffCount ? { color: 'var(--red)', fontWeight: 700 } : {}}>{i.diffCount}</td>
                  <td className="muted nowrap">{i.userName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {create && (
        <Modal title="Новая инвентаризация" onClose={() => setCreate(false)}
          footer={<><button className="btn" onClick={() => setCreate(false)}>Отмена</button>
            <button className="btn primary" onClick={start}>Создать и пересчитывать</button></>}>
          <Field label="Область пересчёта" hint="Будут зафиксированы текущие учётные остатки выбранных ячеек">
            <select value={zoneId} onChange={e => setZoneId(e.target.value)}>
              <option value="">Весь склад</option>
              {(zones || []).filter(z => z.type === 'storage').map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
            </select>
          </Field>
        </Modal>
      )}
    </>
  );
}
