import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { ToastProvider } from './components/ui.jsx';
import './styles.css';

// В автономной сборке (открытие двойным кликом, file://) нет сервера,
// поэтому маршруты храним после # — HashRouter. В серверном режиме — как было.
const Router = import.meta.env.VITE_STANDALONE === '1' ? HashRouter : BrowserRouter;

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Router>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </Router>
  </React.StrictMode>
);
