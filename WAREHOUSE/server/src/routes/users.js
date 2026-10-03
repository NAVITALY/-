import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { auth, perm, logAction } from '../auth.js';

const r = Router();
r.use(auth);

r.get('/roles', (req, res) => {
  res.json(db.prepare('SELECT role_id AS id, code, name, description FROM roles ORDER BY role_id').all());
});

r.get('/users', perm('users.manage'), (req, res) => {
  const rows = db.prepare(`
    SELECT u.user_id AS id, u.login, u.full_name AS fullName, u.is_active AS isActive, u.created_at AS createdAt,
           r.role_id AS roleId, r.name AS roleName, r.code AS roleCode,
           (SELECT COUNT(*) FROM operation_logs l WHERE l.user_id = u.user_id) AS opsCount
    FROM users u JOIN roles r ON r.role_id = u.role_id ORDER BY u.user_id`).all();
  res.json(rows);
});

r.post('/users', perm('users.manage'), (req, res) => {
  const { login, fullName, password, roleId } = req.body || {};
  if (!login || !fullName || !password || !roleId) return res.status(400).json({ error: 'Заполните все поля' });
  if (password.length < 5) return res.status(400).json({ error: 'Пароль должен быть не короче 5 символов' });
  if (db.prepare('SELECT 1 FROM users WHERE login = ?').get(login)) {
    return res.status(409).json({ error: 'Логин уже занят' });
  }
  const info = db.prepare('INSERT INTO users (login, password_hash, full_name, role_id) VALUES (?, ?, ?, ?)')
    .run(login.trim(), bcrypt.hashSync(password, 10), fullName, roleId);
  logAction(req.user, 'создание', 'user', Number(info.lastInsertRowid), { login });
  res.json({ id: Number(info.lastInsertRowid) });
});

r.put('/users/:id', perm('users.manage'), (req, res) => {
  const id = +req.params.id;
  const u = db.prepare('SELECT * FROM users WHERE user_id = ?').get(id);
  if (!u) return res.status(404).json({ error: 'Пользователь не найден' });
  const { fullName, roleId, isActive, password } = req.body || {};
  if (id === req.user.id && isActive === false) {
    return res.status(400).json({ error: 'Нельзя отключить собственную учётную запись' });
  }
  db.prepare('UPDATE users SET full_name = ?, role_id = ?, is_active = ? WHERE user_id = ?')
    .run(fullName ?? u.full_name, roleId ?? u.role_id, isActive === undefined ? u.is_active : (isActive ? 1 : 0), id);
  if (password) {
    if (password.length < 5) return res.status(400).json({ error: 'Пароль должен быть не короче 5 символов' });
    db.prepare('UPDATE users SET password_hash = ? WHERE user_id = ?').run(bcrypt.hashSync(password, 10), id);
  }
  logAction(req.user, 'изменение', 'user', id, { fullName, roleId, isActive, passwordChanged: !!password });
  res.json({ ok: true });
});

r.delete('/users/:id', perm('users.manage'), (req, res) => {
  const id = +req.params.id;
  if (id === req.user.id) return res.status(400).json({ error: 'Нельзя удалить собственную учётную запись' });
  const info = db.prepare('DELETE FROM users WHERE user_id = ?').run(id);
  if (!info.changes) return res.status(404).json({ error: 'Пользователь не найден' });
  logAction(req.user, 'удаление', 'user', id);
  res.json({ ok: true });
});

export default r;
