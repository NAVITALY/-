import React, { useState } from 'react';
import { useAuth } from '../auth.jsx';
import WarehouseLogo from '../components/Logo.jsx';

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ login: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await login(form.login.trim(), form.password); }
    catch (err) { setError(err.message); }
    setBusy(false);
  };

  const quick = async (l, p) => {
    setBusy(true); setError(null);
    try { await login(l, p); } catch (err) { setError(err.message); }
    setBusy(false);
  };

  const resetDemo = async () => {
    if (!window.confirm('Сбросить все данные и вернуть демо-данные?')) return;
    const m = await import('../standalone/backend.js');
    m.resetDemo();
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo-mark"><WarehouseLogo /></div>
        <h2 style={{ marginBottom: 2 }}>Склад «Домашний интерьер»</h2>
        <p className="muted" style={{ marginTop: 0 }}>Вход в систему управления складом</p>
        {error && <div className="alert error">{error}</div>}
        <div className="field">
          <label>Логин</label>
          <input autoFocus value={form.login} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} autoComplete="username" />
        </div>
        <div className="field">
          <label>Пароль</label>
          <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} autoComplete="current-password" />
        </div>
        <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
          {busy ? 'Вход…' : 'Войти'}
        </button>
        <div className="login-hint">
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn sm" onClick={() => quick('admin', 'admin123')}>Администратор</button>
            <button type="button" className="btn sm" onClick={() => quick('manager', 'manager123')}>Менеджер</button>
            <button type="button" className="btn sm" onClick={() => quick('worker', 'worker123')}>Кладовщик</button>
            <button type="button" className="btn sm" onClick={() => quick('loader', 'loader123')}>Грузчик</button>
          </div>
        </div>
        {import.meta.env.VITE_STANDALONE === '1' && (
          <p className="muted" style={{ textAlign: 'center', fontSize: 12 }}>
            Данные хранятся в этом браузере.{' '}
            <button type="button" className="btn sm" onClick={resetDemo}>Сбросить демо-данные</button>
          </p>
        )}
      </form>
    </div>
  );
}
