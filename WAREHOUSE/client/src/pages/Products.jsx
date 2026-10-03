import React, { useState } from 'react';
import { api, fmtNum } from '../api.js';
import { useAsync, Modal, Field, ErrorBox, Loading, Empty, StatusBadge, ClassTag, BarcodeSvg, useToast } from '../components/ui.jsx';
import { printLabels } from '../print.js';
import { useAuth } from '../auth.jsx';
import ScanModal from '../components/ScanModal.jsx';

const EMPTY_FORM = { name: '', categoryId: '', lengthMm: '', widthMm: '', heightMm: '', weightKg: '', turnoverClass: 'B', isFragile: 0, minStock: '0', sku: '', barcode: '', unit: 'шт' };

export default function Products() {
  const { can } = useAuth();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [turn, setTurn] = useState('');
  const [scan, setScan] = useState(false);
  const [form, setForm] = useState(null);
  const [detail, setDetail] = useState(null);

  const { data: categories } = useAsync(() => api('/categories'), []);
  const list = useAsync(() => api(`/products?q=${encodeURIComponent(q)}&categoryId=${cat}&turnover=${turn}`), [q, cat, turn]);

  const openScan = async (code) => {
    setScan(false);
    try {
      const p = await api(`/products/barcode/${encodeURIComponent(code)}`);
      setDetail(p);
    } catch (e) { toast(e.message, 'err'); }
  };

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.id) await api(`/products/${form.id}`, { method: 'PUT', body: form });
      else await api('/products', { method: 'POST', body: form });
      toast(form.id ? 'Товар обновлён' : 'Товар добавлен');
      setForm(null);
      list.reload();
    } catch (e2) { toast(e2.message, 'err'); }
  };

  const remove = async (p) => {
    if (!confirm(`Удалить товар «${p.name}»?`)) return;
    try { await api(`/products/${p.id}`, { method: 'DELETE' }); toast('Товар удалён'); list.reload(); }
    catch (e) { toast(e.message, 'err'); }
  };

  return (
    <>
      <div className="toolbar">
        <input type="search" placeholder="Поиск: название, артикул, штрихкод…" value={q} onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <select value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">Все категории</option>
          {(categories || []).map(c => <option key={c.id} value={c.id}>{c.parentId ? '— ' : ''}{c.name}</option>)}
        </select>
        <select value={turn} onChange={e => setTurn(e.target.value)}>
          <option value="">Класс: любой</option>
          <option value="A">A — быстрая</option>
          <option value="B">B — средняя</option>
          <option value="C">C — медленная</option>
        </select>
        <button className="btn" onClick={() => setScan(true)} title="Поиск по камере">📷 Сканировать</button>
        {can('products.edit') && <button className="btn primary" onClick={() => setForm({ ...EMPTY_FORM })}>+ Товар</button>}
      </div>

      {list.error && <ErrorBox error={list.error} />}
      {list.loading && <Loading />}
      {list.data && (list.data.length === 0 ? <Empty text="Товары не найдены" /> : (
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>Артикул</th><th>Наименование</th><th>Категория</th><th>Габариты, мм</th>
              <th className="num">Вес, кг</th><th>Класс</th><th className="num">Остаток</th><th></th>
            </tr></thead>
            <tbody>
              {list.data.map(p => (
                <tr key={p.id}>
                  <td className="mono nowrap">{p.sku}</td>
                  <td>
                    <span className="link-btn" style={{ fontSize: 13.5 }} onClick={() => setDetail(p)}>{p.name}</span>
                    {p.isFragile ? <span className="badge yellow" style={{ marginLeft: 6 }}>хрупкий</span> : null}
                  </td>
                  <td className="muted nowrap">{p.parentCategoryName ? p.parentCategoryName + ' / ' : ''}{p.categoryName || '—'}</td>
                  <td className="mono nowrap">{p.lengthMm}×{p.widthMm}×{p.heightMm}</td>
                  <td className="num">{p.weightKg}</td>
                  <td><ClassTag cls={p.turnoverClass} /></td>
                  <td className="num">
                    {p.totalQty} <span className="muted">/ {fmtNum(p.reservedQty)} рез.</span>
                    {p.minStock > 0 && p.totalQty < p.minStock && <span className="badge red" style={{ marginLeft: 6 }}>мало</span>}
                  </td>
                  <td className="nowrap">
                    {can('products.edit') && <button className="link-btn" onClick={() => setForm({
                      id: p.id, sku: p.sku, barcode: p.barcode, name: p.name, categoryId: p.categoryId || '',
                      lengthMm: p.lengthMm, widthMm: p.widthMm, heightMm: p.heightMm, weightKg: p.weightKg,
                      turnoverClass: p.turnoverClass, isFragile: p.isFragile, minStock: p.minStock, unit: p.unit,
                    })}>Изменить</button>}
                    {can('products.delete') && <> · <button className="link-btn" style={{ color: 'var(--red)' }} onClick={() => remove(p)}>Удалить</button></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {scan && <ScanModal onCode={openScan} onClose={() => setScan(false)} />}

      {form && (
        <Modal title={form.id ? 'Редактирование товара' : 'Новый товар'} onClose={() => setForm(null)} wide
          footer={<>
            <button className="btn" onClick={() => setForm(null)}>Отмена</button>
            <button className="btn primary" onClick={save}>Сохранить</button>
          </>}>
          <form onSubmit={save}>
            <div className="grid2">
              <Field label="Наименование *"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Категория">
                <select value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">— без категории —</option>
                  {(categories || []).map(c => <option key={c.id} value={c.id}>{c.parentId ? '— ' : ''}{c.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid4">
              <Field label="Длина, мм *"><input type="number" min="1" required value={form.lengthMm} onChange={e => setForm({ ...form, lengthMm: e.target.value })} /></Field>
              <Field label="Ширина, мм *"><input type="number" min="1" required value={form.widthMm} onChange={e => setForm({ ...form, widthMm: e.target.value })} /></Field>
              <Field label="Высота, мм *"><input type="number" min="1" required value={form.heightMm} onChange={e => setForm({ ...form, heightMm: e.target.value })} /></Field>
              <Field label="Вес, кг *"><input type="number" min="0.01" step="0.01" required value={form.weightKg} onChange={e => setForm({ ...form, weightKg: e.target.value })} /></Field>
            </div>
            <div className="grid4">
              <Field label="Класс ходкости">
                <select value={form.turnoverClass} onChange={e => setForm({ ...form, turnoverClass: e.target.value })}>
                  <option value="A">A — быстрая оборачиваемость</option>
                  <option value="B">B — средняя</option>
                  <option value="C">C — медленная</option>
                </select>
              </Field>
              <Field label="Мин. остаток"><input type="number" min="0" value={form.minStock} onChange={e => setForm({ ...form, minStock: e.target.value })} /></Field>
              <Field label="Артикул (SKU)"><input value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} placeholder="сгенерировать" /></Field>
              <Field label="Штрихкод"><input value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} placeholder="сгенерировать" /></Field>
            </div>
            <div className="check">
              <input type="checkbox" id="fragile" checked={!!form.isFragile} onChange={e => setForm({ ...form, isFragile: e.target.checked ? 1 : 0 })} />
              <label htmlFor="fragile">Хрупкий товар (размещать на нижних ярусах)</label>
            </div>
          </form>
        </Modal>
      )}

      {detail && <ProductDetail id={detail.id} onClose={() => setDetail(null)} />}
    </>
  );
}

function ProductDetail({ id, onClose }) {
  const { data, error } = useAsync(() => api(`/products/${id}`), [id]);
  return (
    <Modal title={data?.name || 'Карточка товара'} onClose={onClose} wide>
      {error && <ErrorBox error={error} />}
      {!data && <Loading />}
      {data && (
        <>
          <div className="split">
            <div>
              <table>
                <tbody>
                  <tr><td className="muted">Артикул</td><td className="mono">{data.sku}</td></tr>
                  <tr><td className="muted">Категория</td><td>{data.parentCategoryName ? data.parentCategoryName + ' / ' : ''}{data.categoryName || '—'}</td></tr>
                  <tr><td className="muted">Габариты (Д×Ш×В)</td><td>{data.lengthMm} × {data.widthMm} × {data.heightMm} мм</td></tr>
                  <tr><td className="muted">Объём / вес</td><td>{data.volumeM3} м³ / {data.weightKg} кг</td></tr>
                  <tr><td className="muted">Класс ходкости</td><td><ClassTag cls={data.turnoverClass} /></td></tr>
                  <tr><td className="muted">Хрупкость</td><td>{data.isFragile ? 'да — только нижние ярусы' : 'нет'}</td></tr>
                  <tr><td className="muted">Мин. остаток</td><td>{data.minStock} {data.unit}</td></tr>
                  <tr><td className="muted">Остаток сейчас</td><td><b>{data.totalQty}</b> {data.unit} (в резерве {data.reservedQty})</td></tr>
                </tbody>
              </table>
              <h3 className="mt">Размещение по ячейкам</h3>
              {data.cells.length === 0 ? <Empty text="Товара нет на складе" /> : (
                <table>
                  <thead><tr><th>Ячейка</th><th>Зона</th><th className="num">Кол-во</th><th className="num">Резерв</th></tr></thead>
                  <tbody>{data.cells.map(c => (
                    <tr key={c.stockId}><td className="mono">{c.cellCode}</td><td>{c.zoneName}</td><td className="num">{c.qty}</td><td className="num">{c.reserved}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
            <div className="card" style={{ textAlign: 'center' }}>
              <h3>Этикетка</h3>
              <BarcodeSvg value={data.barcode} height={54} />
              <div className="mono" style={{ marginTop: 6 }}>{data.barcode}</div>
              <p className="muted" style={{ fontSize: 12 }}>{data.name}<br />{data.sku}</p>
              <button className="btn sm" onClick={() => printLabels(data.sku, [{ name: data.name, sku: data.sku, barcode: data.barcode }], true)}>🖨 Печать</button>
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
