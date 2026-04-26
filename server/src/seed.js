import { openDatabase } from './db.js';

const SEED_USERS = [
  { name: 'Buyer Alice',    role: 'buyer' },
  { name: 'Buyer Bob',      role: 'buyer' },
  { name: 'Supplier Acme',  role: 'supplier' },
  { name: 'Supplier Beta',  role: 'supplier' },
  { name: 'Supplier Gamma', role: 'supplier' },
  { name: 'Supplier Delta', role: 'supplier' }
];

const db = openDatabase();
const existing = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (existing > 0) {
  console.log(`Users already seeded (${existing}); skipping.`);
} else {
  const insert = db.prepare('INSERT INTO users (name, role) VALUES (?, ?)');
  const seed = db.transaction((users) => {
    for (const u of users) insert.run(u.name, u.role);
  });
  seed(SEED_USERS);
  console.log(`Seeded ${SEED_USERS.length} users.`);
}
db.close();
