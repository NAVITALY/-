import React, { useState } from 'react';
import { api, fmtDate } from '../api.js';
import { useAsync, ErrorBox, Loading, Empty } from '../components/ui.jsx';

export default function Logs() {
  const [filters, setF] = useState({ userId: '', action: '', entity: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const qs = new URLSearchParams({ ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), page }).toString();
  const { data, error, loading } = useAsync(() => api(`/logs?${qs}`), [qs]);
  const { data: users } = useAsync(() => api('/users').catch(() => []), []);

  const set = (k, v) => { setF(f => ({ ...f, [k]: v })); setPage(1); };

  const details = (s) => {
    if (!s) return '';
    try {
      const o = JSON.parse(s);
      return Object.entries(o).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ');
    } catch { return s; }
  };

  return (
    <>
      <div className="toolbar">
        <select value={filters.userId} onChange={e => set('userId', e.target.value)}>
          <option value="">Все сотрудники</option>
          {(users || []).map(u => <option key={u.id} value={u.id}>{u.fullName}</option>)}
        </select>
        <input type="text" placeholder="Действие…" value={filters.action} onChange={e => set('action', e.target.value)} />
        <select value={filters.entity} onChange={e => set('entity', e.target.value)}>
          <option value="">Все объекты</option>
          {['product', 'receipt', 'order', 'cell', 'stock', 'inventory', 'user', 'category', 'zone', 'session'].map(x => <option key={x} value={x}>{x}</option>)}
        </select>
        <input type="date" value={filters.from} onChange={e => set('from', e.target.value)} />
        <input type="date" value={filters.to} onChange={e => set('to', e.target.value)} />
        <div className="spacer" />
        <span className="muted">записей: {data?.total ?? '—'}</span>
      </div>
      {error && <ErrorBox error={error} />}
      {loading && <Loading />}
      {data && (data.items.length === 0 ? <Empty text="Операций не найдено" /> : (
        <>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Время</th><th>Сотрудник</th><th>Действие</th><th>Объект</th><th>Детали</th></tr></thead>
              <tbody>
                {data.items.map(l => (
                  <tr key={l.id}>
                    <td className="nowrap muted">{fmtDate(l.timestamp)}</td>
                    <td className="nowrap">{l.userName}</td>
                    <td><b>{l.action}</b></td>
                    <td className="muted nowrap">{l.entity}{l.entityId ? ` #${l.entityId}` : ''}</td>
                    <td className="hint">{details(l.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.pages > 1 && (
            <div className="btn-row mt" style={{ justifyContent: 'center' }}>
              <button className="btn sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>←</button>
              <span className="muted" style={{ alignSelf: 'center' }}>{page} / {data.pages}</span>
              <button className="btn sm" disabled={page >= data.pages} onClick={() => setPage(p => p + 1)}>→</button>
            </div>
          )}
        </>
      ))}
    </>
  );
}
