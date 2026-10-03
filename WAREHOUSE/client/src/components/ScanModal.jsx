import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Modal } from './ui.jsx';

export default function ScanModal({ onCode, onClose }) {
  const [error, setError] = useState(null);
  const [manual, setManual] = useState('');
  const scannerRef = useRef(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const el = document.getElementById('scan-region');
    const scanner = new Html5Qrcode('scan-region');
    scannerRef.current = scanner;
    scanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 260, height: 160 } },
      (text) => {
        scanner.stop().catch(() => {});
        onCode(text);
      },
      () => {}
    ).catch(() => setError(!window.isSecureContext
      ? 'Браузер блокирует камеру на небезопасном адресе (http). Откройте сайт по https:// или через localhost. Либо введите штрихкод вручную ниже.'
      : 'Камера недоступна. Разрешите доступ к камере для сайта или введите штрихкод вручную.'));
    return () => { scanner.stop().catch(() => {}); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal title="Сканирование штрихкода" onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Закрыть</button>}>
      <div id="scan-region" className="scan-video" style={{ minHeight: 240, background: '#0f172a' }} />
      {error && <div className="alert error mt">{error}</div>}
      <div className="field mt">
        <label>Или введите штрихкод / артикул вручную</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={manual} onChange={e => setManual(e.target.value)} placeholder="200xxxxxxxxxx или МИ-0001"
            onKeyDown={e => e.key === 'Enter' && manual.trim() && onCode(manual.trim())} />
          <button className="btn primary" disabled={!manual.trim()} onClick={() => onCode(manual.trim())}>Найти</button>
        </div>
      </div>
    </Modal>
  );
}
