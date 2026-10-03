import React, { useState } from 'react';
import { api } from '../api.js';
import { useAsync, Modal, ErrorBox, Loading, Empty, StatusBadge, Bar, useToast } from '../components/ui.jsx';

function cellClass(c) {
  if (c.status === 'blocked') return 'blocked';
  if (c.status === 'maintenance') return 'maintenance';
  if (c.status === 'free') return 'free';
  if (c.fillPct >= 66) return 'occ-high';
  if (c.fillPct >= 33) return 'occ-mid';
  return 'occ-low';
}

export default function MapPage() {
  const { data: zones, error, loading } = useAsync(() => api('/cells/map'), []);
  const [sel, setSel] = useState(null);

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <>
      <div className="map-legend">
        <span><i className="sw" style={{ background: '#d7f2df' }} />свободна</span>
        <span><i className="sw" style={{ background: '#fdeeb3' }} />занята &lt;33%</span>
        <span><i className="sw" style={{ background: '#fcd9a8' }} />33–66%</span>
        <span><i className="sw" style={{ background: '#f6b8b8' }} />&gt;66%</span>
        <span><i className="sw" style={{ background: '#d7dbe2' }} />заблокирована</span>
        <span><i className="sw" style={{ background: '#c7d7fe' }} />обслуживание</span>
      </div>
      <div className="map-zones">
        {zones.map(z => {
          const byRack = new Map();
          for (const c of z.cells) {
            const rk = c.rack || '—';
            if (!byRack.has(rk)) byRack.set(rk, []);
            byRack.get(rk).push(c);
          }
          const occ = z.cells.filter(c => c.status === 'occupied').length;
          return (
            <div className="map-zone" key={z.id} style={{ maxWidth: '100%' }}>
              <h3>
                {z.name}
                <span className="badge blue" style={{ fontWeight: 500 }}>{occ}/{z.cells.length} занято</span>
              </h3>
              <div className="map-racks">
                {[...byRack.entries()].map(([rack, cells]) => {
                  const levels = [...new Set(cells.map(c => c.level))].sort((a, b) => b - a);
                  const sections = [...new Set(cells.map(c => c.section))].sort((a, b) => a - b);
                  return (
                    <div className="map-rack" key={rack}>
                      <div className="rack-name">стеллаж {rack}</div>
                      {levels.map(lv => (
                        <div className="map-row" key={lv}>
                          {sections.map(sx => {
                            const c = cells.find(x => x.level === lv && x.section === sx);
                            if (!c) return <div key={sx} style={{ width: 44, height: 30 }} />;
                            return (
                              <div key={sx} className={`map-cell ${cellClass(c)}`}
                                title={`${c.code} · ${Math.round(c.usedVolume)}/${c.maxVolume} м³ · ${c.qty} шт.`}
                                onClick={() => setSel(c)}>
                                {c.section}·{c.level}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {sel && <CellModal cellId={sel.id} onClose={() => setSel(null)} />}
    </>
  );
}

function CellModal({ cellId, onClose }) {
  const { data, error, loading } = useAsync(() => api(`/cells/${cellId}/contents`), [cellId]);
  return (
    <Modal title={`Ячейка ${data?.code || ''}`} onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Закрыть</button>}>
      {loading && <Loading />}
      {error && <ErrorBox error={error} />}
      {data && (
        <>
          <p className="muted" style={{ marginTop: 0 }}>
            {data.zoneName} · стеллаж {data.rack}, секция {data.section}, ярус {data.level} · <StatusBadge status={data.status} />
          </p>
          <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 8 }}>
            <div className="kpi"><div className="label">Заполнение по объёму</div><div className="value">{data.fillPct}%</div><Bar pct={data.fillPct} /></div>
            <div className="kpi"><div className="label">Вес</div><div className="value">{data.usedWeight} / {data.maxWeight} кг</div></div>
          </div>
          <h3>Содержимое</h3>
          {data.items.length === 0 ? <Empty text="Ячейка пуста" /> : (
            <table>
              <thead><tr><th>Товар</th><th>Артикул</th><th className="num">Кол-во</th><th className="num">Резерв</th></tr></thead>
              <tbody>{data.items.map(i => (
                <tr key={i.stockId}><td>{i.name}</td><td className="mono">{i.sku}</td><td className="num">{i.qty}</td><td className="num muted">{i.reserved || '—'}</td></tr>
              ))}</tbody>
            </table>
          )}
        </>
      )}
    </Modal>
  );
}
