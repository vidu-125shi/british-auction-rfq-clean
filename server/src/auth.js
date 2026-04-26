export function attachUser(db) {
  const getUser = db.prepare('SELECT id, name, role FROM users WHERE id = ?');
  return (req, res, next) => {
    const id = Number(req.header('X-User-Id'));
    if (!id) {
      req.user = null;
      return next();
    }
    const user = getUser.get(id);
    req.user = user || null;
    next();
  };
}

export function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'X-User-Id header missing or invalid' } });
    }
    if (req.user.role !== role) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: `${role} role required` } });
    }
    next();
  };
}
