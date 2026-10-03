import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { verifyPassword, signToken, userPayload, auth, logAction } from '../auth.js';

const r = Router();

r.post('/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'Укажите логин и пароль' });
  const u = db.prepare('SELECT * FROM users WHERE login = ?').get(String(login).trim());
  if (!u || !verifyPassword(password, u.password_hash)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  if (!u.is_active) return res.status(403).json({ error: 'Учётная запись отключена' });
  const user = userPayload(u.user_id);
  logAction(user, 'вход', 'session', u.user_id, { login: u.login });
  res.json({ token: signToken(u), user });
});

r.get('/me', auth, (req, res) => res.json({ user: req.user }));

r.put('/password', auth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  const u = db.prepare('SELECT * FROM users WHERE user_id = ?').get(req.user.id);
  if (!verifyPassword(oldPassword || '', u.password_hash)) {
    return res.status(400).json({ error: 'Текущий пароль указан неверно' });
  }
  if (!newPassword || newPassword.length < 5) {
    return res.status(400).json({ error: 'Новый пароль должен быть не короче 5 символов' });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE user_id = ?').run(bcrypt.hashSync(newPassword, 10), u.user_id);
  logAction(req.user, 'смена пароля', 'user', u.user_id);
  res.json({ ok: true });
});

export default r;
