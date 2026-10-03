import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import WarehouseLogo from './Logo.jsx';

const NAV = [
  { group: 'Обзор', items: [
    { to: '/', label: 'Дашборд', icon: '▦', perm: ['dashboard.view'] },
    { to: '/map', label: 'Карта склада', icon: '▣', perm: ['cells.view'] },
  ]},
  { group: 'Складские операции', items: [
    { to: '/receipts', label: 'Приёмка', icon: '⬇', perm: ['receipts.view'] },
    { to: '/orders', label: 'Заказы', icon: '⬆', perm: ['orders.view'] },
    { to: '/stock', label: 'Остатки', icon: '☰', perm: ['stock.view'] },
    { to: '/inventory', label: 'Инвентаризация', icon: '✓', perm: ['inventory.view'] },
  ]},
  { group: 'Справочники', items: [
    { to: '/products', label: 'Товары', icon: '🛢', perm: ['products.view'] },
    { to: '/categories', label: 'Категории', icon: '❏', perm: ['products.view'] },
    { to: '/cells', label: 'Зоны и ячейки', icon: '⊞', perm: ['cells.view'] },
  ]},
  { group: 'Аналитика', items: [
    { to: '/reports', label: 'Отчёты', icon: '◔', perm: ['reports.view'] },
    { to: '/logs', label: 'Журнал операций', icon: '≡', perm: ['logs.view'] },
    { to: '/users', label: 'Пользователи', icon: '☻', perm: ['users.manage'] },
  ]},
];

export default function Layout({ title }) {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const initials = (user?.fullName || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

  return (
    <div className="shell">
      {open && <div className="scrim" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="logo">
          <div className="logo-mark"><WarehouseLogo /></div>
          <div>
            <div className="logo-title">Домашний интерьер</div>
            <div className="logo-sub">Управление складом</div>
          </div>
        </div>
        <nav className="nav" onClick={() => setOpen(false)}>
          {NAV.map(g => {
            const items = g.items.filter(i => can(...i.perm));
            if (!items.length) return null;
            return (
              <div key={g.group}>
                <div className="nav-group">{g.group}</div>
                {items.map(i => (
                  <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => isActive ? 'active' : ''}>
                    <span className="ico">{i.icon}</span>{i.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="side-user">
          <div className="avatar">{initials}</div>
          <div className="who"><b>{user?.fullName}</b><span>{user?.role?.name}</span></div>
          <button className="side-exit" title="Завершить сеанс" onClick={() => { logout(); navigate('/login'); }}>Выйти</button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn sm burger" onClick={() => setOpen(o => !o)}>☰</button>
          <h1>{title}</h1>
          <div className="spacer" />
          <span className="muted nowrap top-date">{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
        </header>
        <div className="content"><Outlet /></div>
      </div>
    </div>
  );
}
