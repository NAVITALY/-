import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, getToken, setToken } from './api.js';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!getToken()) { setLoading(false); return; }
    try {
      const { user } = await api('/auth/me');
      setUser(user);
    } catch { setToken(null); }
    setLoading(false);
  };

  useEffect(() => {
    load();
    const onLogout = () => setUser(null);
    window.addEventListener('wh-logout', onLogout);
    return () => window.removeEventListener('wh-logout', onLogout);
  }, []);

  const login = async (loginName, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { login: loginName, password } });
    setToken(data.token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => { setToken(null); setUser(null); };
  const can = (...codes) => !!user && codes.some(c => user.permissions.includes(c));

  return <AuthCtx.Provider value={{ user, loading, login, logout, can }}>{children}</AuthCtx.Provider>;
}
