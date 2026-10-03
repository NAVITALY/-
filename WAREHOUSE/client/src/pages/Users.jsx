import React, { useState } from 'react';
import { api, fmtShortDate } from '../api.js';
import { useAsync, Modal, Field, ErrorBox, Loading, StatusBadge, useToast } from '../components/ui.jsx';
import { useAuth } from '../auth.jsx';

export default function Users() {
  const { user: me } = useAuth();
  const toast = useToast();
  const { data, reload, error, loading } = useAsync(() => api('/users'), []);
  const { data: roles } = useAsync(() => api('/roles'), []);
  const [form, setForm] = useState(null);

  const save = async () => {
    try {
      if (form.id) await api(`/users/${form.id}`, { method: 'PUT', body: form });
      else await api('/users', { method: 'POST', body: form });
      toast('Сохранено'); setForm(null); reload();
    } catch (e) { toast(e.message, 'err'); }
  };

  const toggle = async (u) => {
    try {
      await api(`/users/${u.id}`, { method: 'PUT', body: { isActive: !u.isActive } });
      toast(u.isActive ? 'Учётная запись отключена' : 'Учётная запись включена');
      reload();
    } catch (e) { toast(e.message, 'err'); }
  };

  const remove = async (u) => {
    if (!confirm(`Удалить пользователя ${u.login}? История операций сохранится.`)) return;
    try { await api(`/users/${u.id}`, { method: 'DELETE' }); toast('Удалён'); reload(); }
    catch (e) { toast(e.message, 'err'); }
  };

  if (loading) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <>
      <div className="toolbar">
        <span className="hint">Права определяются ролью: администратор, менеджер, кладовщик, грузчик</span>
        <div className="spacer" />
        <button className="btn primary" onClick={() => setForm({ fullName: '', login: '', password: '', roleId: roles?.find(r => r.code === 'warehouse')?.id })}>+ Пользователь</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Логин</th><th>ФИО</th><th>Роль</th><th>Статус</th><th className="num">Операций</th><th>Создан</th><th></th></tr></thead>
          <tbody>
            {data.map(u => (
              <tr key={u.id}>
                <td className="mono">{u.login}{u.id === me.id && <span className="badge blue" style={{ marginLeft: 6 }}>это вы</span>}</td>
                <td>{u.fullName}</td>
                <td>{u.roleName}</td>
                <td>{u.isActive ? <span className="badge green">активен</span> : <span className="badge red">отключён</span>}</td>
                <td className="num muted">{u.opsCount}</td>
                <td className="muted nowrap">{fmtShortDate(u.createdAt)}</td>
                <td className="nowrap">
                  <button className="link-btn" onClick={() => setForm({ ...u, password: '' })}>Изменить</button>
                  {' · '}<button className="link-btn" onClick={() => toggle(u)}>{u.isActive ? 'Отключить' : 'Включить'}</button>
                  {u.id !== me.id && <> · <button className="link-btn" style={{ color: 'var(--red)' }} onClick={() => remove(u)}>Удалить</button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {form && (
        <Modal title={form.id ? `Пользователь ${form.login}` : 'Новый пользователь'} onClose={() => setForm(null)}
          footer={<>
            <button className="btn" onClick={() => setForm(null)}>Отмена</button>
            <button className="btn primary" onClick={save}>Сохранить</button>
          </>}>
          <div className="grid2">
            <Field label="Логин"><input value={form.login || ''} disabled={!!form.id} onChange={e => setForm({ ...form, login: e.target.value })} /></Field>
            <Field label="ФИО"><input value={form.fullName} onChange={e => setForm({ ...form, fullName: e.target.value })} /></Field>
          </div>
          <div className="grid2">
            <Field label="Роль">
              <select value={form.roleId || ''} onChange={e => setForm({ ...form, roleId: +e.target.value })}>
                {(roles || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
            <Field label={form.id ? 'Новый пароль (не обязательно)' : 'Пароль *'}>
              <input type="text" value={form.password || ''} onChange={e => setForm({ ...form, password: e.target.value })} placeholder={form.id ? 'без изменений' : 'минимум 5 символов'} />
            </Field>
          </div>
        </Modal>
      )}
    </>
  );
}
