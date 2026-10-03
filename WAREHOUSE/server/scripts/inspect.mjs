import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('data/warehouse.db');
console.log('stock rows:', db.prepare('SELECT COUNT(*) n FROM stock').get().n);
console.log('total qty:', db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM stock').get().q);
console.log(db.prepare(`SELECT z.name, SUM(s.quantity) qty FROM stock s JOIN cells c ON c.cell_id=s.cell_id JOIN zones z ON z.zone_id=c.zone_id GROUP BY z.name ORDER BY z.name`).all());
console.log('receipts:', db.prepare('SELECT number, status FROM receipts ORDER BY receipt_id').all());
console.log('last logs:', db.prepare('SELECT action, entity, details, timestamp FROM operation_logs ORDER BY log_id DESC LIMIT 8').all());
