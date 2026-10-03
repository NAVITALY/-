import JsBarcode from 'jsbarcode';

const CSS = `
  @page { margin: 8mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: 'Segoe UI', Arial, sans-serif; color: #000; margin: 0; }
  .labels { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }
  .labels.single { grid-template-columns: 1fr; max-width: 96mm; margin: 0 auto; }
  .label { border: 1px dashed #64748b; border-radius: 3mm; padding: 4mm 3mm; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  .label .name { font-weight: 700; font-size: 12pt; margin-bottom: 1mm; }
  .label .sku { font-size: 8pt; color: #333; margin-bottom: 2mm; }
  .label svg { max-width: 100%; height: auto; }
  .label .code { font-family: Consolas, monospace; font-size: 8.5pt; margin-top: 1mm; }
  .label .qty { font-size: 10pt; margin-top: 1.5mm; }
  .head { font-size: 9pt; color: #444; margin-bottom: 4mm; display: flex; justify-content: space-between; }
`;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function barcodeSvg(value, height = 46) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    JsBarcode(svg, String(value), { format: 'CODE128', height, fontSize: 12, margin: 4, displayValue: false });
  } catch { return ''; }
  return new XMLSerializer().serializeToString(svg);
}

function printHtml(title, body) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>${body}</body></html>`);
  doc.close();
  const go = () => {
    frame.contentWindow.focus();
    frame.contentWindow.print();
    setTimeout(() => frame.remove(), 3000);
  };
  if (doc.readyState === 'complete') setTimeout(go, 150);
  else frame.onload = () => setTimeout(go, 150);
}

export function printLabels(docTitle, items, single = false) {
  const body = `
    <div class="head"><span>Склад — ООО «Домашний интерьер»</span><span>${esc(docTitle)}</span></div>
    <div class="labels${single ? ' single' : ''}">${items.map(it => `
      <div class="label">
        <div class="name">${esc(it.name)}</div>
        <div class="sku">${esc(it.sku)} · ООО «Домашний интерьер»</div>
        ${barcodeSvg(it.barcode, single ? 60 : 46)}
        <div class="code">${esc(it.barcode)}</div>
        ${it.qty ? `<div class="qty">Принято: <b>${esc(it.qty)} ${esc(it.unit || 'шт')}</b></div>` : ''}
      </div>`).join('')}
    </div>`;
  printHtml(`Этикетки — ${docTitle}`, body);
}
