const TOKEN_KEY = 'wh_token';

// VITE_STANDALONE=1 (single-file сборка): бэкенд выполняется прямо в браузере,
// данные — в localStorage. Сервер и Node в рантайме не нужны.
const STANDALONE = import.meta.env.VITE_STANDALONE === '1';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }

export async function api(path, { method = 'GET', body } = {}) {
  if (STANDALONE) {
    const { localApi, ApiError } = await import('./standalone/backend.js');
    try {
      return await localApi(path, { method, body });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401 && !path.startsWith('/auth/login')) {
          setToken(null);
          window.dispatchEvent(new Event('wh-logout'));
        }
        throw Object.assign(new Error(e.message), { status: e.status });
      }
      throw e;
    }
  }
  const token = getToken();
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    setToken(null);
    window.dispatchEvent(new Event('wh-logout'));
  }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Ошибка ${res.status}`), { status: res.status, data });
  return data;
}

export const fmtDate = (s) => s ? new Date(String(s).replace(' ', 'T') + 'Z').toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtShortDate = (s) => s ? new Date(String(s).replace(' ', 'T') + 'Z').toLocaleDateString('ru-RU') : '—';
export const fmtNum = (n) => new Intl.NumberFormat('ru-RU').format(n ?? 0);

export function toCsv(rows, headers) {
  const esc = v => { const s = String(v ?? ''); return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return '\ufeff' + [headers.join(';'), ...rows.map(r => r.map(esc).join(';'))].join('\n');
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
