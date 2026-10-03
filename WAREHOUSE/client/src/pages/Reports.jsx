import React, { useState } from 'react';
import { api, toCsv, downloadCsv } from '../api.js';
import { useAsync, ErrorBox, Loading, Empty } from '../components/ui.jsx';

const TABS = [
  ['stock-by-product', 'Остатки по товарам'],
  ['stock-by-cell', 'Распределение по ячейкам'],
  ['cell-utilization', 'Заполненность зон'],
  ['movements', 'Движение товара'],
  ['low-stock', 'Дефицит минимума'],
];

export default function Reports() {
  const [tab, setTab] = useState('stock-by-product');
  const { data, error, loading } = useAsync(() => api(`/reports/${tab}`), [tab]);

  const cols = {
    'stock-by-product': [
      ['sku', 'Артикул'], ['name', 'Товар'], ['categoryName', 'Категория'], ['turnoverClass', 'Класс'],
      ['qty', 'Остаток'], ['reserved', 'Резерв'], ['totalWeight', 'Вес, кг'],
    ],
    'stock-by-cell': [['cellCode', 'Ячейка'], ['zoneName', 'Зона'], ['positions', 'Позиций'], ['qty', 'Всего шт.'], ['status', 'Статус']],
    'cell-utilization': [['zone', 'Зона'], ['cells', 'Ячеек'], ['occupied', 'Занято'], ['occupiedPct', 'Занятость, %'], ['volumePct', 'Объём, %'], ['weightPct', 'Вес, %']],
    'movements': [['timestamp', 'Время'], ['userName', 'Сотрудник'], ['action', 'Операция'], ['entity', 'Объект'], ['details', 'Детали']],
    'low-stock': [['sku', 'Артикул'], ['name', 'Товар'], ['qty', 'Остаток'], ['minStock', 'Минимум'], ['unit', 'Ед.']],
  }[tab];

  const exportCsv = () => {
    const rows = (data || []).map(r => cols.map(([k]) => k === 'details' ? safeJson(r[k]) : r[k]));
    downloadCsv(`${tab}.csv`, toCsv(rows, cols.map(([, h]) => h)));
  };

  return (
    <>
      <div className="toolbar">
        {TABS.map(([k, label]) => (
          <button key={k} className={`btn ${tab === k ? 'primary' : ''}`} onClick={() => setTab(k)}>{label}</button>
        ))}
        <div className="spacer" />
        <button className="btn" onClick={exportCsv} disabled={!data?.length}>⬇ CSV</button>
      </div>
      {error && <ErrorBox error={error} />}
      {loading && <Loading />}
      {data && (data.length === 0 ? <Empty /> : (
        <div className="table-wrap">
          <table>
            <thead><tr>{cols.map(([k, h]) => <th key={k} className={typeof data[0][k] === 'number' ? 'num' : ''}>{h}</th>)}</tr></thead>
            <tbody>
              {data.map((r, i) => (
                <tr key={i}>{cols.map(([k]) => (
                  <td key={k} className={typeof r[k] === 'number' ? 'num' : (k === 'sku' || k === 'cellCode' ? 'mono' : '')}>
                    {k === 'details' ? safeJson(r[k]) : (r[k] ?? '—')}
                  </td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </>
  );
}

function safeJson(s) {
  if (!s) return '';
  try { const o = JSON.parse(s); return Object.entries(o).map(([k, v]) => `${k}: ${v}`).join(', '); }
  catch { return s; }
}
