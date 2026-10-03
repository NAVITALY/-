import React from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Products from './pages/Products.jsx';
import Categories from './pages/Categories.jsx';
import Receipts from './pages/Receipts.jsx';
import ReceiptDetail from './pages/ReceiptDetail.jsx';
import Orders from './pages/Orders.jsx';
import OrderDetail from './pages/OrderDetail.jsx';
import Stock from './pages/Stock.jsx';
import MapPage from './pages/MapPage.jsx';
import Cells from './pages/Cells.jsx';
import Inventory from './pages/Inventory.jsx';
import InventoryDetail from './pages/InventoryDetail.jsx';
import Reports from './pages/Reports.jsx';
import Logs from './pages/Logs.jsx';
import Users from './pages/Users.jsx';

const TITLES = [
  [/^\/$/, 'Дашборд'],
  [/^\/map/, 'Карта склада'],
  [/^\/receipts\/\d+/, 'Приёмка товара'],
  [/^\/receipts/, 'Приёмка товара'],
  [/^\/orders\/\d+/, 'Заказ'],
  [/^\/orders/, 'Заказы на отгрузку'],
  [/^\/stock/, 'Остатки на складе'],
  [/^\/products/, 'Каталог товаров'],
  [/^\/categories/, 'Категории номенклатуры'],
  [/^\/cells/, 'Зоны и ячейки хранения'],
  [/^\/inventory\/\d+/, 'Инвентаризация'],
  [/^\/inventory/, 'Инвентаризация'],
  [/^\/reports/, 'Отчёты'],
  [/^\/logs/, 'Журнал операций'],
  [/^\/users/, 'Пользователи и роли'],
];

export default function App() {
  const { user, loading, can } = useAuth();
  const location = useLocation();

  if (loading) return <div className="empty" style={{ paddingTop: 120 }}>Загрузка…</div>;
  if (location.pathname === '/login') return user ? <Navigate to="/" replace /> : <Login />;
  if (!user) return <Navigate to="/login" replace />;

  const title = (TITLES.find(([re]) => re.test(location.pathname)) || [, 'Склад'])[1];

  return (
    <Routes>
      <Route element={<Layout title={title} />}>
        <Route index element={can('dashboard.view') ? <Dashboard /> : <NoAccess />} />
        <Route path="map" element={can('cells.view') ? <MapPage /> : <NoAccess />} />
        <Route path="receipts" element={can('receipts.view') ? <Receipts /> : <NoAccess />} />
        <Route path="receipts/:id" element={can('receipts.view') ? <ReceiptDetail /> : <NoAccess />} />
        <Route path="orders" element={can('orders.view') ? <Orders /> : <NoAccess />} />
        <Route path="orders/:id" element={can('orders.view') ? <OrderDetail /> : <NoAccess />} />
        <Route path="stock" element={can('stock.view') ? <Stock /> : <NoAccess />} />
        <Route path="products" element={can('products.view') ? <Products /> : <NoAccess />} />
        <Route path="categories" element={can('products.view') ? <Categories /> : <NoAccess />} />
        <Route path="cells" element={can('cells.view') ? <Cells /> : <NoAccess />} />
        <Route path="inventory" element={can('inventory.view') ? <Inventory /> : <NoAccess />} />
        <Route path="inventory/:id" element={can('inventory.view') ? <InventoryDetail /> : <NoAccess />} />
        <Route path="reports" element={can('reports.view') ? <Reports /> : <NoAccess />} />
        <Route path="logs" element={can('logs.view') ? <Logs /> : <NoAccess />} />
        <Route path="users" element={can('users.manage') ? <Users /> : <NoAccess />} />
        <Route path="*" element={<NoAccess />} />
      </Route>
    </Routes>
  );
}

function NoAccess() {
  return <div className="alert error">Недостаточно прав для просмотра этого раздела.</div>;
}
