import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db, jwtSecret } from './db.js';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function signToken(user) {
  return jwt.sign({ sub: user.user_id, login: user.login }, jwtSecret(), { expiresIn: '12h' });
}

export function userPayload(userId) {
  const u = db.prepare(`
    SELECT u.user_id, u.login, u.full_name, u.is_active, r.role_id, r.code AS role_code, r.name AS role_name
    FROM users u JOIN roles r ON r.role_id = u.role_id WHERE u.user_id = ?`).get(userId);
  if (!u) return null;
  const perms = db.prepare(`
    SELECT p.code FROM role_permissions rp
    JOIN permissions p ON p.perm_id = rp.perm_id
    WHERE rp.role_id = ?`).all(u.role_id).map(r => r.code);
  return {
    id: u.user_id, login: u.login, fullName: u.full_name, isActive: !!u.is_active,
    role: { id: u.role_id, code: u.role_code, name: u.role_name },
    permissions: perms,
  };
}

export function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Требуется авторизация' });
  try {
    const data = jwt.verify(token, jwtSecret());
    const user = userPayload(data.sub);
    if (!user) return res.status(401).json({ error: 'Пользователь не найден' });
    if (!user.isActive) return res.status(403).json({ error: 'Учётная запись отключена' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Сессия истекла, войдите заново' });
  }
}

export function perm(...codes) {
  return (req, res, next) => {
    if (!codes.some(c => req.user.permissions.includes(c))) {
      return res.status(403).json({ error: 'Недостаточно прав для этого действия' });
    }
    next();
  };
}

export function logAction(user, action, entity, entityId = null, details = null) {
  db.prepare(`INSERT INTO operation_logs (user_id, action, entity, entity_id, details)
              VALUES (?, ?, ?, ?, ?)`)
    .run(user?.id ?? null, action, entity, entityId, details ? JSON.stringify(details) : null);
}
