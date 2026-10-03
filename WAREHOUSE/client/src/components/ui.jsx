import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';

/* ---------- toasts ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setItems(s => [...s, { id, text, kind }]);
    setTimeout(() => setItems(s => s.filter(t => t.id !== id)), 3800);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {items.map(t => <div key={t.id} className={`toast ${t.kind === 'err' ? 'err' : ''}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- async hook ---------- */
export function useAsync(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    fnRef.current()
      .then(d => { if (alive) { setData(d); setError(null); } })
      .catch(e => { if (alive) setError(e.message || 'Ошибка'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick(t => t + 1), []);
  return { data, error, loading, reload, setData };
}

/* ---------- modal ---------- */
export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = e => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'lg' : ''}`}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="x" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- form helpers ---------- */
export function Field({ label, children, hint }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

/* ---------- badges ---------- */
const STATUS_MAP = {
  new: ['gray', 'Новая'], confirmed: ['blue', 'Подтверждена'], placed: ['green', 'Размещена'],
  picking: ['orange', 'Сборка'], completed: ['green', 'Отгружен'], cancelled: ['red', 'Отменён'],
  open: ['blue', 'Открыта'], closed: ['green', 'Закрыта'],
  free: ['green', 'Свободна'], occupied: ['red', 'Занята'], blocked: ['gray', 'Заблокирована'], maintenance: ['yellow', 'Обслуживание'],
};
const STATUS_OVERRIDES = {
  receipt: { new: ['blue', 'Новая'] },
  order: { new: ['blue', 'Новый'] },
};

export function StatusBadge({ status, kind }) {
  const info = (kind && STATUS_OVERRIDES[kind]?.[status]) || STATUS_MAP[status] || ['gray', status];
  return <span className={`badge ${info[0]}`}>{info[1]}</span>;
}

export function ClassTag({ cls }) {
  if (!cls) return <span className="muted">—</span>;
  return <span className={`tag ${cls}`}>{cls}</span>;
}

/* ---------- progress ---------- */
export function Bar({ pct }) {
  const cls = pct >= 85 ? 'bad' : pct >= 60 ? 'warn' : '';
  return <span className="progress" title={`${pct}%`}><i className={cls} style={{ width: Math.min(100, pct) + '%' }} /></span>;
}

/* ---------- barcode svg ---------- */
export function BarcodeSvg({ value, height = 40, displayValue = true }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !value) return;
    try {
      JsBarcode(ref.current, String(value), { format: 'CODE128', height, fontSize: 12, margin: 6, displayValue });
    } catch { /* invalid */ }
  }, [value, height, displayValue]);
  if (!value) return null;
  return <svg ref={ref} className="barcode-box" />;
}

export function Empty({ text = 'Нет данных' }) {
  return <div className="empty">{text}</div>;
}

export function Loading() {
  return <div className="empty">Загрузка…</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="alert error">{error}</div>;
}
