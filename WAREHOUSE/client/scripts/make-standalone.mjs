// Копирует собранный автономный index.html в корень проекта как «Склад.html»
// (файл для переноса на другой ПК — открывается двойным кликом).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, '..', 'dist-standalone', 'index.html');
const dst = path.join(__dirname, '..', '..', 'Склад.html');

if (!fs.existsSync(src)) {
  console.error('Нет сборки: сначала выполните vite build --config vite.standalone.config.js');
  process.exit(1);
}
fs.copyFileSync(src, dst);
console.log('Готов автономный файл: ' + dst + ' (' + (fs.statSync(dst).size / 1048576).toFixed(2) + ' МБ)');
