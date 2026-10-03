import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { isEmpty } from './seed.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import catalogRoutes from './routes/catalog.js';
import storageRoutes from './routes/storage.js';
import receiptRoutes from './routes/receipts.js';
import orderRoutes from './routes/orders.js';
import inventoryRoutes from './routes/inventories.js';
import reportRoutes from './routes/reports.js';
import logRoutes from './routes/logs.js';
import dashboardRoutes from './routes/dashboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRoutes);
app.use('/api', userRoutes);
app.use('/api', catalogRoutes);
app.use('/api', storageRoutes);
app.use('/api', receiptRoutes);
app.use('/api', orderRoutes);
app.use('/api', inventoryRoutes);
app.use('/api', reportRoutes);
app.use('/api', logRoutes);
app.use('/api', dashboardRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Метод API не найден' }));

const dist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

if (isEmpty()) {
  console.log('База данных пуста — загружаем демо-данные...');
  const { seed } = await import('./seed.js');
  seed();
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API склада: http://localhost:${PORT}`));
