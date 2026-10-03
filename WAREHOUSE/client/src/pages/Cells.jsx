import React, { useState } from 'react';
import { api } from '../api.js';
import { useAsync, Modal, Field, ErrorBox, Loading, Empty, StatusBadge, ClassTag, Bar, useToast } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

export default function Cells() {
  const { can } = useAuth();
  const toast = useToast();
  const [zoneId, setZoneId] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const { data: zones, reload: reloadZones } = useAsync(() => api('/zones'), []);
  const { data: cells, reload, loading, error } = useAsync(
    () => api(`/cells?zoneId=${zoneId}&status=${status}&q=${encodeURIComponent(q)}`), [zoneId, status, q]);
  const [zoneForm, setZoneForm] = useState(null);
  const [cellForm, setCellForm] = useState(null);
  const [bulk, setBulk] = useState(false);

  const saveZone = async () => {
    try {
      if (zoneForm.id) await api(`/zones/${zoneForm.id}`, { method: 'PUT', body: zoneForm });
      else await api('/zones', { method: 'POST', body: zoneForm });
      toast('Зона сохранена'); setZoneForm(null); reloadZones(); reload();
    } catch (e) { toast(e.message, 'err'); }
  };

  const delZone = async (z) => {
    if (!confirm(`Удалить зону «${z.name}»?`)) return;
    try { await api(`/zones/${z.id}`, { method: 'DELETE' }); toast('Зона удалена'); reloadZones(); reload(); }
    catch (e) { toast(e.message, 'err'); }
  };

  const saveCell = async () => {
    try {
      if (cellForm.id) await api(`/cells/${cellForm.id}`, { method: 'PUT', body: cellForm });
      else await api('/cells', { method: 'POST', body: cellForm });
      toast('Ячейка сохранена'); setCellForm(null); reload();
    } catch (e) { toast(e.message, 'err'); }
  };

  const delCell = async (c) => {
    if (!confirm(`Удалить ячейку ${c.code}?`)) return;
    try { await api(`/cells/${c.id}`, { method: 'DELETE' }); toast('Ячейка удалена'); reload(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="split">
        <div className="stack">
          <div className="card">
            <div className="panel-title">
              <h3>Ячейки хранения</h3>
              <div className="spacer" style={{ flex: 1 }} />
              {can('cells.edit') && <>
                <button className="btn sm" onClick={() => setBulk(true)}>⊞ Сгенерировать стеллаж</button>
                <button className="btn sm primary" onClick={() => setCellForm({ zoneId: zoneId || '', lengthMm: 1200, widthMm: 1000, heightMm: 900, maxWeight: 300 })}>+ Ячейка</button>
              </>}
            </div>
            <div className="toolbar">
              <input type="search" placeholder="Поиск адреса…" value={q} onChange={e => setQ(e.target.value)} />
              <select value={zoneId} onChange={e => setZoneId(e.target.value)}>
                <option value="">Все зоны</option>
                {(zones || []).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
              <select value={status} onChange={e => setStatus(e.target.value)}>
                <option value="">Любой статус</option>
                <option value="free">Свободна</option>
                <option value="occupied">Занята</option>
                <option value="blocked">Заблокирована</option>
                <option value="maintenance">Обслуживание</option>
              </select>
            </div>
            {error && <ErrorBox error={error} />}
            {loading && <Loading />}
            {cells && (cells.length === 0 ? <Empty /> : (
              <div className="table-wrap" style={{ boxShadow: 'none', maxHeight: 560, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th>Адрес</th><th>Зона</th><th>Класс</th><th className="num">Шт.</th><th>Заполнение</th><th>Статус</th><th></th></tr></thead>
                  <tbody>
                    {cells.map(c => (
                      <tr key={c.id}>
                        <td className="mono">{c.code}</td>
                        <td className="muted nowrap">{c.zoneName}</td>
                        <td><ClassTag cls={c.turnoverClass} /></td>
                        <td className="num">{c.qty || '—'}</td>
                        <td>{c.maxVolume ? <> <Bar pct={c.fillPct} /> <span className="muted" style={{ fontSize: 11 }}>{c.fillPct}%</span></> : '—'}</td>
                        <td><StatusBadge status={c.status} /></td>
                        {can('cells.edit') && <td className="nowrap">
                          <button className="link-btn" onClick={() => setCellForm({ ...c })}>Изменить</button>
                          {' · '}<button className="link-btn" style={{ color: 'var(--red)' }} onClick={() => delCell(c)}>✕</button>
                        </td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="panel-title">
            <h3>Зоны склада</h3>
            <div style={{ flex: 1 }} />
            {can('zones.edit') && <button className="btn sm primary" onClick={() => setZoneForm({ type: 'storage', coordX: 0, coordY: 0 })}>+ Зона</button>}
          </div>
          {(zones || []).map(z => (
            <div key={z.id} style={{ padding: '8px 0', borderBottom: '1px solid #eef1f6', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1 }}>
                <b>{z.name}</b>
                <div className="muted" style={{ fontSize: 12 }}>
                  {{ storage: 'хранение', receiving: 'приёмка', shipping: 'отгрузка' }[z.type]} · {z.cellsCount} ячеек · координаты ({z.coordX};{z.coordY})
                </div>
              </div>
              {can('zones.edit') && <>
                <button className="link-btn" onClick={() => setZoneForm({ ...z })}>✎</button>
                <button className="link-btn" style={{ color: 'var(--red)' }} onClick={() => delZone(z)}>✕</button>
              </>}
            </div>
          ))}
          <p className="hint mt">Координаты зон используются алгоритмом размещения: чем ближе к отгрузке, тем выше приоритет для ходовых (класс A) товаров.</p>
        </div>
      </div>

      {zoneForm && (
        <Modal title={zoneForm.id ? 'Зона' : 'Новая зона'} onClose={() => setZoneForm(null)}
          footer={<><button className="btn" onClick={() => setZoneForm(null)}>Отмена</button><button className="btn primary" onClick={saveZone}>Сохранить</button></>}>
          <Field label="Название"><input value={zoneForm.name || ''} onChange={e => setZoneForm({ ...zoneForm, name: e.target.value })} /></Field>
          <Field label="Тип">
            <select value={zoneForm.type} onChange={e => setZoneForm({ ...zoneForm, type: e.target.value })}>
              <option value="storage">Хранение</option>
              <option value="receiving">Приёмка</option>
              <option value="shipping">Отгрузка</option>
            </select>
          </Field>
          <div className="grid2">
            <Field label="Координата X"><input type="number" value={zoneForm.coordX} onChange={e => setZoneForm({ ...zoneForm, coordX: +e.target.value })} /></Field>
            <Field label="Координата Y"><input type="number" value={zoneForm.coordY} onChange={e => setZoneForm({ ...zoneForm, coordY: +e.target.value })} /></Field>
          </div>
        </Modal>
      )}

      {cellForm && (
        <Modal title={cellForm.id ? `Ячейка ${cellForm.code}` : 'Новая ячейка'} onClose={() => setCellForm(null)}
          footer={<><button className="btn" onClick={() => setCellForm(null)}>Отмена</button><button className="btn primary" onClick={saveCell}>Сохранить</button></>}>
          <div className="grid2">
            <Field label="Адрес (код)"><input value={cellForm.code || ''} onChange={e => setCellForm({ ...cellForm, code: e.target.value })} placeholder="A1-01-4" /></Field>
            <Field label="Зона">
              <select value={cellForm.zoneId || ''} onChange={e => setCellForm({ ...cellForm, zoneId: e.target.value })}>
                <option value="">— выбрать —</option>
                {(zones || []).map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="grid4">
            <Field label="Стеллаж"><input value={cellForm.rack || ''} onChange={e => setCellForm({ ...cellForm, rack: e.target.value })} /></Field>
            <Field label="Секция"><input type="number" value={cellForm.section ?? ''} onChange={e => setCellForm({ ...cellForm, section: +e.target.value })} /></Field>
            <Field label="Ярус"><input type="number" value={cellForm.level ?? ''} onChange={e => setCellForm({ ...cellForm, level: +e.target.value })} /></Field>
            <Field label="Класс">
              <select value={cellForm.turnoverClass || ''} onChange={e => setCellForm({ ...cellForm, turnoverClass: e.target.value })}>
                <option value="">—</option><option value="A">A</option><option value="B">B</option><option value="C">C</option>
              </select>
            </Field>
          </div>
          <div className="grid4">
            <Field label="Д, мм"><input type="number" value={cellForm.lengthMm || ''} onChange={e => setCellForm({ ...cellForm, lengthMm: +e.target.value })} /></Field>
            <Field label="Ш, мм"><input type="number" value={cellForm.widthMm || ''} onChange={e => setCellForm({ ...cellForm, widthMm: +e.target.value })} /></Field>
            <Field label="В, мм"><input type="number" value={cellForm.heightMm || ''} onChange={e => setCellForm({ ...cellForm, heightMm: +e.target.value })} /></Field>
            <Field label="Макс. вес, кг"><input type="number" value={cellForm.maxWeight || ''} onChange={e => setCellForm({ ...cellForm, maxWeight: +e.target.value })} /></Field>
          </div>
          {cellForm.id && (
            <Field label="Статус">
              <select value={cellForm.status} onChange={e => setCellForm({ ...cellForm, status: e.target.value })}>
                <option value="free">Свободна</option>
                <option value="occupied">Занята</option>
                <option value="blocked">Заблокирована</option>
                <option value="maintenance">Обслуживание</option>
              </select>
            </Field>
          )}
        </Modal>
      )}

      {bulk && <BulkModal zones={zones || []} defaultZone={zoneId} onClose={() => setBulk(false)} onDone={() => { setBulk(false); reload(); }} />}
    </>
  );
}

function BulkModal({ zones, defaultZone, onClose, onDone }) {
  const toast = useToast();
  const [f, setF] = useState({ zoneId: defaultZone || '', rack: 'A4', sections: 4, levels: 3, lengthMm: 1200, widthMm: 1000, heightMm: 900, maxWeight: 300, turnoverClass: 'A' });
  const save = async () => {
    try {
      const r = await api('/cells/bulk', { method: 'POST', body: f });
      toast(`Создано ячеек: ${r.created}`);
      onDone();
    } catch (e) { toast(e.message, 'err'); }
  };
  return (
    <Modal title="Генерация стеллажа" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn primary" onClick={save}>Создать {f.sections * f.levels} ячеек</button></>}>
      <p className="hint">Будут созданы ячейки вида <b className="mono">{f.rack}-01-1 … {f.rack}-{String(f.sections).padStart(2, '0')}-{f.levels}</b></p>
      <div className="grid2">
        <Field label="Зона">
          <select value={f.zoneId} onChange={e => setF({ ...f, zoneId: e.target.value })}>
            <option value="">— выбрать —</option>
            {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
          </select>
        </Field>
        <Field label="Префикс стеллажа"><input value={f.rack} onChange={e => setF({ ...f, rack: e.target.value })} /></Field>
      </div>
      <div className="grid4">
        <Field label="Секций"><input type="number" min="1" max="30" value={f.sections} onChange={e => setF({ ...f, sections: +e.target.value })} /></Field>
        <Field label="Ярусов"><input type="number" min="1" max="8" value={f.levels} onChange={e => setF({ ...f, levels: +e.target.value })} /></Field>
        <Field label="Класс"><select value={f.turnoverClass} onChange={e => setF({ ...f, turnoverClass: e.target.value })}><option>A</option><option>B</option><option>C</option><option value="">—</option></select></Field>
        <Field label="Макс. вес, кг"><input type="number" value={f.maxWeight} onChange={e => setF({ ...f, maxWeight: +e.target.value })} /></Field>
      </div>
      <div className="grid3">
        <Field label="Глубина, мм"><input type="number" value={f.lengthMm} onChange={e => setF({ ...f, lengthMm: +e.target.value })} /></Field>
        <Field label="Ширина, мм"><input type="number" value={f.widthMm} onChange={e => setF({ ...f, widthMm: +e.target.value })} /></Field>
        <Field label="Высота, мм"><input type="number" value={f.heightMm} onChange={e => setF({ ...f, heightMm: +e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
