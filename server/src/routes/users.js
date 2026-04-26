import { Router } from 'express';

export function usersRouter(db) {
  const r = Router();
  const list = db.prepare('SELECT id, name, role FROM users ORDER BY id');
  r.get('/', (req, res) => {
    res.json(list.all());
  });
  return r;
}
