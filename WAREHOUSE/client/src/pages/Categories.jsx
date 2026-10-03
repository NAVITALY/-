import React, { Fragment, useState } from 'react';
import { api } from '../api.js';
import { useAsync, Modal, Field, ErrorBox, Loading, useToast } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

export default function Categories() {
  const { can } = useAuth();
  const toast = useToast();
  const { data, reload, error, loading } = useAsync(() => api('/categories'), []);
  const [form, setForm] = useState(null);

  const roots = (data || []).filter(c => !c.parentId);
  const childrenOf = id => (data || []).filter(c => c.parentId === id);

  const save = async (e) => {
    e.preventDefault();
    try {
      if (form.id) await api(`/categories/${form.id}`, { method: 'PUT', body: form });
      else await api('/categories', { method: 'POST', body: form });
      toast('Сохранено'); setForm(null); reload();
    } catch (e2) { toast(e2.message, 'err'); }
  };

  const remove = async (c) => {
    if (!confirm(`Удалить категорию «${c.name}»?`)) return;
    try { await api(`/categories/${c.id}`, { method: 'DELETE' }); toast('Удалено'); reload(); }
    catch (e) { toast(e.message, 'err'); }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const row = (c, depth) => (
    <tr key={c.id}>
      <td style={{ paddingLeft: 12 + depth * 22 }}>{depth > 0 ? '└ ' : '▸ '}{depth === 0 && <b>{c.name}</b>}{depth > 0 && c.name}</td>
      <td className="num muted">{c.productsCount}</td>
      {can('categories.edit') && <td className="nowrap" style={{ textAlign: 'right' }}>
        <button className="link-btn" onClick={() => setForm({ id: c.id, name: c.name, parentId: c.parentId || '' })}>Изменить</button>
        {' · '}
        <button className="link-btn" style={{ color: 'var(--red)' }} onClick={() => remove(c)}>Удалить</button>
      </td>}
    </tr>
  );

  return (
    <>
      <div className="toolbar">
        <span className="hint">Иерархия номенклатуры: раздел → подраздел. Товары привязываются к конечным категориям.</span>
        <div className="spacer" />
        {can('categories.edit') && <button className="btn primary" onClick={() => setForm({ name: '', parentId: '' })}>+ Категория</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Категория</th><th className="num">Товаров</th>{can('categories.edit') && <th style={{ textAlign: 'right' }}></th>}</tr></thead>
          <tbody>
            {roots.map(rt => (
              <Fragment key={rt.id}>
                {row(rt, 0)}
                {childrenOf(rt.id).map(ch => row(ch, 1))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal title={form.id ? 'Категория' : 'Новая категория'} onClose={() => setForm(null)}
          footer={<>
            <button className="btn" onClick={() => setForm(null)}>Отмена</button>
            <button className="btn primary" onClick={save}>Сохранить</button>
          </>}>
          <form onSubmit={save}>
            <Field label="Название"><input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Родительская категория">
              <select value={form.parentId} onChange={e => setForm({ ...form, parentId: e.target.value })}>
                <option value="">— верхний уровень —</option>
                {roots.filter(c => c.id !== form.id).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          </form>
        </Modal>
      )}
    </>
  );
}
