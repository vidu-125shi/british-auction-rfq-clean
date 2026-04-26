# British Auction RFQ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a take-home-quality RFQ system with British-auction-style bidding (auto-extensions on configurable triggers, forced close cap) using Node + Express + React + SQLite.

**Architecture:** Monorepo with `/server` (Express + better-sqlite3, port 4000) and `/client` (Vite + React, port 5173). Auction extension logic runs synchronously inside a single SQLite transaction on every bid POST. Status is computed from `now()` on read — no background scheduler. Frontend polls (3s details, 5s listing). Mock auth via `X-User-Id` header from a UserSwitcher dropdown.

**Tech Stack:** Node 18+, Express 4, better-sqlite3, node:test + supertest, React 18, Vite, react-router-dom 6, Tailwind CSS 3.

**Source spec:** `docs/superpowers/specs/2026-04-26-british-auction-rfq-design.md`

---

## File Structure

Files this plan creates (all paths relative to repo root `british-auction-rfq/`):

```
.gitignore
package.json                       # root: concurrently + scripts
README.md                          # HLD + run instructions

server/
  package.json
  src/
    index.js                       # express app entry
    db.js                          # better-sqlite3 + migrations
    seed.js                        # seed users
    auth.js                        # X-User-Id middleware
    validators.js                  # request body validation helpers
    routes/
      users.js
      rfqs.js
      bids.js
    services/
      rankings.js                  # pure
      status.js                    # pure
      auctionEngine.js             # pure
    repos/
      rfqRepo.js
      bidRepo.js
      activityRepo.js
  test/
    rankings.test.js
    status.test.js
    auctionEngine.test.js
    api.test.js                    # supertest e2e

client/
  package.json
  vite.config.js
  index.html
  tailwind.config.js
  postcss.config.js
  src/
    main.jsx
    App.jsx
    index.css
    api.js
    hooks/
      useCurrentUser.js
      usePolledRfq.js
    components/
      UserSwitcher.jsx
      Countdown.jsx
      StatusBadge.jsx
      BidsTable.jsx
      ActivityLog.jsx
      BidForm.jsx
    pages/
      ListingPage.jsx
      DetailsPage.jsx
      CreateRfqPage.jsx
```

**Decomposition rationale:**
- Pure logic (`rankings`, `status`, `auctionEngine`) lives outside repos/routes so it can be unit-tested without DB or HTTP.
- Repos own all SQL; routes compose repos + pure services. No SQL leaks out of `repos/`.
- Each frontend component has one responsibility. Pages compose components.

---

## Task 1: Repo skeleton + root tooling

**Files:**
- Create: `package.json` (root)
- Create: `.gitignore`
- Create: `README.md` (skeleton; filled out in Task 20)

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
*.sqlite
*.sqlite-journal
.DS_Store
dist/
.vite/
.env
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "british-auction-rfq",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "install:all": "npm install && npm install --prefix server && npm install --prefix client",
    "seed": "node server/src/seed.js",
    "dev": "concurrently -n server,client -c blue,green \"npm run dev --prefix server\" \"npm run dev --prefix client\"",
    "test": "npm test --prefix server"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

- [ ] **Step 3: Create `README.md` skeleton**

```markdown
# British Auction RFQ

Take-home demo of an RFQ system with British-auction-style bidding.

## Quick start

```bash
npm run install:all
npm run seed
npm run dev
```

Open http://localhost:5173.
```

- [ ] **Step 4: Install root dependencies**

Run: `npm install`
Expected: creates `node_modules/concurrently`, `package-lock.json`.

- [ ] **Step 5: Commit**

```bash
git add .gitignore package.json package-lock.json README.md
git commit -m "feat: scaffold root project with concurrently runner"
```

---

## Task 2: Server scaffold + Express skeleton

**Files:**
- Create: `server/package.json`
- Create: `server/src/index.js`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "british-auction-rfq-server",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node --watch src/index.js",
    "start": "node src/index.js",
    "test": "node --test test/"
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "cors": "^2.8.5",
    "express": "^4.21.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

- [ ] **Step 2: Create `server/src/index.js`**

```js
import express from 'express';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
  });
}

export default app;
```

- [ ] **Step 3: Install server deps**

Run: `npm install --prefix server`

- [ ] **Step 4: Smoke-test the server**

Run: `node --watch server/src/index.js &` then `curl -s http://localhost:4000/api/health`
Expected: `{"ok":true}`. Kill the process after verifying.

- [ ] **Step 5: Commit**

```bash
git add server/
git commit -m "feat(server): scaffold express skeleton with health endpoint"
```

---

## Task 3: Database layer + migrations

**Files:**
- Create: `server/src/db.js`

- [ ] **Step 1: Create `server/src/db.js`** — connection + migrations

```js
import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PATH = path.resolve(__dirname, '..', 'data.sqlite');

export function openDatabase(filePath = DEFAULT_PATH) {
  const db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL,
      role  TEXT NOT NULL CHECK (role IN ('buyer', 'supplier'))
    );

    CREATE TABLE IF NOT EXISTS rfqs (
      id                       INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_id             TEXT NOT NULL UNIQUE,
      name                     TEXT NOT NULL,
      pickup_date              TEXT NOT NULL,
      bid_start_at             TEXT NOT NULL,
      bid_close_initial_at     TEXT NOT NULL,
      bid_close_current_at     TEXT NOT NULL,
      forced_bid_close_at      TEXT NOT NULL,
      trigger_type             TEXT NOT NULL CHECK (trigger_type IN
                                  ('BID_RECEIVED','ANY_RANK_CHANGE','L1_RANK_CHANGE')),
      trigger_window_minutes   INTEGER NOT NULL CHECK (trigger_window_minutes > 0),
      extension_minutes        INTEGER NOT NULL CHECK (extension_minutes > 0),
      created_by               INTEGER NOT NULL REFERENCES users(id),
      created_at               TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bids (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id               INTEGER NOT NULL REFERENCES rfqs(id),
      supplier_id          INTEGER NOT NULL REFERENCES users(id),
      carrier_name         TEXT NOT NULL,
      freight_charges      REAL NOT NULL CHECK (freight_charges >= 0),
      origin_charges       REAL NOT NULL CHECK (origin_charges >= 0),
      destination_charges  REAL NOT NULL CHECK (destination_charges >= 0),
      total_price          REAL NOT NULL,
      transit_time_days    INTEGER NOT NULL CHECK (transit_time_days >= 0),
      quote_validity_days  INTEGER NOT NULL CHECK (quote_validity_days > 0),
      created_at           TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_bids_rfq_supplier_created ON bids(rfq_id, supplier_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS activity_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id      INTEGER NOT NULL REFERENCES rfqs(id),
      event_type  TEXT NOT NULL,
      message     TEXT NOT NULL,
      metadata    TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_activity_log_rfq_created ON activity_log(rfq_id, created_at DESC);
  `);
}
```

- [ ] **Step 2: Smoke-test migration**

Run: `node -e "import('./server/src/db.js').then(m => { const db = m.openDatabase(); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all()); db.close(); })"`
Expected: array containing `users`, `rfqs`, `bids`, `activity_log`.

- [ ] **Step 3: Commit**

```bash
git add server/src/db.js
git commit -m "feat(server): add sqlite connection and schema migrations"
```

---

## Task 4: Seed script

**Files:**
- Create: `server/src/seed.js`

- [ ] **Step 1: Create `server/src/seed.js`**

```js
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
```

- [ ] **Step 2: Run the seed**

Run: `npm run seed`
Expected: `Seeded 6 users.` (or `already seeded` on re-run).

- [ ] **Step 3: Verify users present**

Run: `node -e "import('./server/src/db.js').then(m => { const db=m.openDatabase(); console.log(db.prepare('SELECT * FROM users').all()); db.close(); })"`
Expected: 6 rows with ids 1–6.

- [ ] **Step 4: Commit**

```bash
git add server/src/seed.js
git commit -m "feat(server): seed 2 buyers and 4 suppliers"
```

---

## Task 5: Auth middleware + users route

**Files:**
- Create: `server/src/auth.js`
- Create: `server/src/routes/users.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Create `server/src/auth.js`**

```js
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
```

- [ ] **Step 2: Create `server/src/routes/users.js`**

```js
import { Router } from 'express';

export function usersRouter(db) {
  const r = Router();
  const list = db.prepare('SELECT id, name, role FROM users ORDER BY id');
  r.get('/', (req, res) => {
    res.json(list.all());
  });
  return r;
}
```

- [ ] **Step 3: Wire into `server/src/index.js`** — replace contents

```js
import express from 'express';
import cors from 'cors';
import { openDatabase } from './db.js';
import { attachUser } from './auth.js';
import { usersRouter } from './routes/users.js';

const app = express();
app.use(cors());
app.use(express.json());

const db = openDatabase();
app.use(attachUser(db));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/users', usersRouter(db));

const PORT = process.env.PORT || 4000;
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
}

export default app;
export { db };
```

- [ ] **Step 4: Smoke-test users endpoint**

Start `npm run dev --prefix server` in another terminal. Run: `curl -s http://localhost:4000/api/users | head -c 200`
Expected: JSON array of 6 users.

- [ ] **Step 5: Commit**

```bash
git add server/src/auth.js server/src/routes/users.js server/src/index.js
git commit -m "feat(server): mock auth via X-User-Id and users list endpoint"
```

---

## Task 6: Pure module — rankings (TDD)

**Files:**
- Create: `server/test/rankings.test.js`
- Create: `server/src/services/rankings.js`

- [ ] **Step 1: Write failing test** — `server/test/rankings.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRankings, l1Of } from '../src/services/rankings.js';

test('computeRankings: empty input → empty array', () => {
  assert.deepEqual(computeRankings([]), []);
});

test('computeRankings: ranks ascending by total_price, ties broken by earlier created_at', () => {
  const bids = [
    { supplierId: 1, totalPrice: 100, createdAt: '2026-04-26T10:00:00Z' },
    { supplierId: 2, totalPrice: 90,  createdAt: '2026-04-26T10:01:00Z' },
    { supplierId: 3, totalPrice: 90,  createdAt: '2026-04-26T10:00:30Z' }, // earlier tie
  ];
  const ranked = computeRankings(bids);
  assert.equal(ranked[0].supplierId, 3);
  assert.equal(ranked[0].rank, 1);
  assert.equal(ranked[1].supplierId, 2);
  assert.equal(ranked[1].rank, 2);
  assert.equal(ranked[2].supplierId, 1);
  assert.equal(ranked[2].rank, 3);
});

test('l1Of: returns supplierId of lowest, or null if empty', () => {
  assert.equal(l1Of([]), null);
  assert.equal(l1Of([{ supplierId: 5, totalPrice: 50, createdAt: 'x' }]), 5);
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npm test --prefix server`
Expected: FAIL — `Cannot find module '../src/services/rankings.js'`.

- [ ] **Step 3: Implement** — `server/src/services/rankings.js`

```js
export function computeRankings(latestBidsBySupplier) {
  const sorted = [...latestBidsBySupplier].sort((a, b) => {
    if (a.totalPrice !== b.totalPrice) return a.totalPrice - b.totalPrice;
    return a.createdAt.localeCompare(b.createdAt);
  });
  return sorted.map((bid, i) => ({ ...bid, rank: i + 1 }));
}

export function l1Of(latestBidsBySupplier) {
  if (latestBidsBySupplier.length === 0) return null;
  const ranked = computeRankings(latestBidsBySupplier);
  return ranked[0].supplierId;
}
```

- [ ] **Step 4: Run test — verify pass**

Run: `npm test --prefix server`
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/rankings.js server/test/rankings.test.js
git commit -m "feat(server): pure rankings module with tests"
```

---

## Task 7: Pure module — status (TDD)

**Files:**
- Create: `server/test/status.test.js`
- Create: `server/src/services/status.js`

- [ ] **Step 1: Write failing test** — `server/test/status.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveStatus } from '../src/services/status.js';

const rfq = {
  bidStartAt:         '2026-04-26T10:00:00Z',
  bidCloseCurrentAt:  '2026-04-26T18:00:00Z',
  forcedBidCloseAt:   '2026-04-26T18:30:00Z'
};

test('Scheduled before bidStartAt', () => {
  assert.equal(deriveStatus(rfq, '2026-04-26T09:59:59Z'), 'Scheduled');
});

test('Active during bid window', () => {
  assert.equal(deriveStatus(rfq, '2026-04-26T15:00:00Z'), 'Active');
});

test('Closed after bidCloseCurrentAt but before forcedBidCloseAt', () => {
  assert.equal(deriveStatus(rfq, '2026-04-26T18:15:00Z'), 'Closed');
});

test('ForceClosed when bidCloseCurrentAt has been pushed to forcedBidCloseAt', () => {
  const forced = { ...rfq, bidCloseCurrentAt: '2026-04-26T18:30:00Z' };
  assert.equal(deriveStatus(forced, '2026-04-26T18:31:00Z'), 'ForceClosed');
});
```

- [ ] **Step 2: Run test — verify failure**

Run: `npm test --prefix server`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** — `server/src/services/status.js`

```js
export function deriveStatus(rfq, nowIso) {
  if (nowIso < rfq.bidStartAt) return 'Scheduled';
  if (nowIso < rfq.bidCloseCurrentAt) return 'Active';
  if (rfq.bidCloseCurrentAt >= rfq.forcedBidCloseAt) return 'ForceClosed';
  return 'Closed';
}
```

ISO 8601 UTC strings are lexicographically comparable, so string compare is correct.

- [ ] **Step 4: Run test — verify pass**

Run: `npm test --prefix server`
Expected: rankings + status tests all pass (7 total).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/status.js server/test/status.test.js
git commit -m "feat(server): pure status derivation with tests"
```

---

## Task 8: Pure module — auctionEngine (TDD)

This is the heart of the system. Pure function: given an RFQ, the supplier's previous bid (or null), the latest bids by other suppliers, the proposed new bid, and "now" — return a plan describing whether to accept, what the new rankings are, whether to extend, and the new close time.

**Files:**
- Create: `server/test/auctionEngine.test.js`
- Create: `server/src/services/auctionEngine.js`

- [ ] **Step 1: Write failing tests** — `server/test/auctionEngine.test.js`

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateBid } from '../src/services/auctionEngine.js';

const baseRfq = {
  bidStartAt:           '2026-04-26T10:00:00Z',
  bidCloseCurrentAt:    '2026-04-26T18:00:00Z',
  forcedBidCloseAt:     '2026-04-26T18:30:00Z',
  triggerType:          'BID_RECEIVED',
  triggerWindowMinutes: 10,
  extensionMinutes:     5
};

function bid(supplierId, totalPrice, createdAt) {
  return { supplierId, totalPrice, createdAt };
}

const newBidPlanned = (supplierId, freight) => ({
  supplierId,
  carrierName: 'X',
  freightCharges: freight,
  originCharges: 0,
  destinationCharges: 0,
  transitTimeDays: 3,
  quoteValidityDays: 30
});

test('rejects bid when auction not yet started', () => {
  const r = evaluateBid({
    rfq: baseRfq,
    prevLatestBidBySupplier: null,
    latestBidsBySupplier: [],
    newBidPlanned: newBidPlanned(3, 100),
    nowIso: '2026-04-26T09:59:00Z'
  });
  assert.equal(r.status, 'AUCTION_NOT_ACTIVE');
});

test('rejects bid after current close', () => {
  const r = evaluateBid({
    rfq: baseRfq,
    prevLatestBidBySupplier: null,
    latestBidsBySupplier: [],
    newBidPlanned: newBidPlanned(3, 100),
    nowIso: '2026-04-26T18:00:01Z'
  });
  assert.equal(r.status, 'AUCTION_NOT_ACTIVE');
});

test('rejects bid that is not strictly lower than supplier own previous', () => {
  const r = evaluateBid({
    rfq: baseRfq,
    prevLatestBidBySupplier: bid(3, 100, '2026-04-26T15:00:00Z'),
    latestBidsBySupplier: [bid(3, 100, '2026-04-26T15:00:00Z')],
    newBidPlanned: newBidPlanned(3, 100),
    nowIso: '2026-04-26T15:30:00Z'
  });
  assert.equal(r.status, 'NOT_STRICTLY_LOWER');
});

test('accepts first bid; total_price is sum of three charges', () => {
  const r = evaluateBid({
    rfq: baseRfq,
    prevLatestBidBySupplier: null,
    latestBidsBySupplier: [],
    newBidPlanned: { ...newBidPlanned(3, 50), originCharges: 20, destinationCharges: 30 },
    nowIso: '2026-04-26T15:00:00Z'
  });
  assert.equal(r.status, 'OK');
  assert.equal(r.newBid.totalPrice, 100);
  assert.equal(r.rankingsAfter.length, 1);
  assert.equal(r.rankingsAfter[0].rank, 1);
});

test('BID_RECEIVED trigger: bid inside window extends close', () => {
  const rfq = { ...baseRfq, triggerType: 'BID_RECEIVED' };
  const r = evaluateBid({
    rfq,
    prevLatestBidBySupplier: null,
    latestBidsBySupplier: [],
    newBidPlanned: newBidPlanned(3, 100),
    nowIso: '2026-04-26T17:55:00Z' // inside 10-min window before 18:00
  });
  assert.equal(r.status, 'OK');
  assert.equal(r.shouldExtend, true);
  assert.equal(r.newCloseAt, '2026-04-26T18:00:00.000Z'); // 17:55 + 5 min
  assert.equal(r.capped, false);
});

test('BID_RECEIVED trigger: bid outside window does not extend', () => {
  const rfq = { ...baseRfq, triggerType: 'BID_RECEIVED' };
  const r = evaluateBid({
    rfq,
    prevLatestBidBySupplier: null,
    latestBidsBySupplier: [],
    newBidPlanned: newBidPlanned(3, 100),
    nowIso: '2026-04-26T17:30:00Z' // 30 min before close, window is 10 min
  });
  assert.equal(r.status, 'OK');
  assert.equal(r.shouldExtend, false);
});

test('extension capped at forcedBidCloseAt', () => {
  const rfq = {
    ...baseRfq,
    bidCloseCurrentAt: '2026-04-26T18:28:00Z',
    forcedBidCloseAt:  '2026-04-26T18:30:00Z',
    extensionMinutes: 5
  };
  const r = evaluateBid({
    rfq,
    prevLatestBidBySupplier: null,
    latestBidsBySupplier: [],
    newBidPlanned: newBidPlanned(3, 100),
    nowIso: '2026-04-26T18:27:30Z'
  });
  assert.equal(r.status, 'OK');
  assert.equal(r.shouldExtend, true);
  assert.equal(r.newCloseAt, '2026-04-26T18:30:00.000Z');
  assert.equal(r.capped, true);
});

test('ANY_RANK_CHANGE trigger: extends only if rankings change', () => {
  const rfq = { ...baseRfq, triggerType: 'ANY_RANK_CHANGE' };
  // Existing: supplier 4 at 200, supplier 5 at 300. New bid from 3 at 250 → ranks change.
  const r = evaluateBid({
    rfq,
    prevLatestBidBySupplier: null,
    latestBidsBySupplier: [
      bid(4, 200, '2026-04-26T17:00:00Z'),
      bid(5, 300, '2026-04-26T17:01:00Z')
    ],
    newBidPlanned: newBidPlanned(3, 250),
    nowIso: '2026-04-26T17:55:00Z'
  });
  assert.equal(r.shouldExtend, true);
  assert.equal(r.extensionReason, 'ANY_RANK_CHANGE');
});

test('ANY_RANK_CHANGE trigger: no extension if new bid does not affect order', () => {
  const rfq = { ...baseRfq, triggerType: 'ANY_RANK_CHANGE' };
  // 3 was already last at 400; bidding 350 still keeps 3 last. No order change.
  const r = evaluateBid({
    rfq,
    prevLatestBidBySupplier: bid(3, 400, '2026-04-26T17:00:00Z'),
    latestBidsBySupplier: [
      bid(4, 200, '2026-04-26T17:00:00Z'),
      bid(5, 300, '2026-04-26T17:01:00Z'),
      bid(3, 400, '2026-04-26T17:00:00Z')
    ],
    newBidPlanned: newBidPlanned(3, 350),
    nowIso: '2026-04-26T17:55:00Z'
  });
  assert.equal(r.status, 'OK');
  assert.equal(r.shouldExtend, false);
});

test('L1_RANK_CHANGE trigger: extends only when L1 supplier changes', () => {
  const rfq = { ...baseRfq, triggerType: 'L1_RANK_CHANGE' };
  // L1 was 4 at 200. New bid from 3 at 150 → L1 becomes 3 → extend.
  const r = evaluateBid({
    rfq,
    prevLatestBidBySupplier: null,
    latestBidsBySupplier: [
      bid(4, 200, '2026-04-26T17:00:00Z'),
      bid(5, 300, '2026-04-26T17:01:00Z')
    ],
    newBidPlanned: newBidPlanned(3, 150),
    nowIso: '2026-04-26T17:55:00Z'
  });
  assert.equal(r.shouldExtend, true);
  assert.equal(r.extensionReason, 'L1_RANK_CHANGE');
});

test('L1_RANK_CHANGE trigger: no extension when L1 unchanged even if other ranks shift', () => {
  const rfq = { ...baseRfq, triggerType: 'L1_RANK_CHANGE' };
  // L1 is 4 at 200. New bid from 3 at 250 reshuffles L2/L3 but L1 still 4. No extend.
  const r = evaluateBid({
    rfq,
    prevLatestBidBySupplier: null,
    latestBidsBySupplier: [
      bid(4, 200, '2026-04-26T17:00:00Z'),
      bid(5, 300, '2026-04-26T17:01:00Z')
    ],
    newBidPlanned: newBidPlanned(3, 250),
    nowIso: '2026-04-26T17:55:00Z'
  });
  assert.equal(r.shouldExtend, false);
});
```

- [ ] **Step 2: Run tests — verify failure**

Run: `npm test --prefix server`
Expected: 11 new failures (module not found).

- [ ] **Step 3: Implement** — `server/src/services/auctionEngine.js`

```js
import { computeRankings, l1Of } from './rankings.js';

const MS_PER_MIN = 60 * 1000;

export function evaluateBid({ rfq, prevLatestBidBySupplier, latestBidsBySupplier, newBidPlanned, nowIso }) {
  // 1. Active-window check
  if (nowIso < rfq.bidStartAt || nowIso >= rfq.bidCloseCurrentAt) {
    return { status: 'AUCTION_NOT_ACTIVE' };
  }

  // 2. Compute total price
  const totalPrice =
    Number(newBidPlanned.freightCharges) +
    Number(newBidPlanned.originCharges) +
    Number(newBidPlanned.destinationCharges);

  // 3. Strict-underbid against supplier's own previous
  if (prevLatestBidBySupplier && totalPrice >= prevLatestBidBySupplier.totalPrice) {
    return {
      status: 'NOT_STRICTLY_LOWER',
      previousTotalPrice: prevLatestBidBySupplier.totalPrice
    };
  }

  // 4. Build ranking-before and ranking-after
  const newBid = { ...newBidPlanned, totalPrice, createdAt: nowIso };
  const rankingsBefore = computeRankings(latestBidsBySupplier);
  const latestAfter = mergeLatest(latestBidsBySupplier, newBid);
  const rankingsAfter = computeRankings(latestAfter);

  // 5. Within trigger window?
  const triggerStartIso = subtractMinutes(rfq.bidCloseCurrentAt, rfq.triggerWindowMinutes);
  const withinTriggerWindow = nowIso >= triggerStartIso && nowIso < rfq.bidCloseCurrentAt;

  // 6. Trigger evaluation
  let shouldExtend = false;
  let extensionReason = null;
  if (withinTriggerWindow) {
    if (rfq.triggerType === 'BID_RECEIVED') {
      shouldExtend = true;
      extensionReason = 'BID_RECEIVED';
    } else if (rfq.triggerType === 'ANY_RANK_CHANGE') {
      if (orderChanged(rankingsBefore, rankingsAfter)) {
        shouldExtend = true;
        extensionReason = 'ANY_RANK_CHANGE';
      }
    } else if (rfq.triggerType === 'L1_RANK_CHANGE') {
      if (l1Of(latestBidsBySupplier) !== l1Of(latestAfter)) {
        shouldExtend = true;
        extensionReason = 'L1_RANK_CHANGE';
      }
    }
  }

  // 7. Compute new close time, cap at forced
  let newCloseAt = null;
  let capped = false;
  if (shouldExtend) {
    const candidate = addMinutes(nowIso, rfq.extensionMinutes);
    if (candidate >= rfq.forcedBidCloseAt) {
      newCloseAt = rfq.forcedBidCloseAt;
      capped = true;
    } else {
      newCloseAt = candidate;
    }
    // If candidate is earlier than current close (e.g. trigger window > extension), don't shrink:
    if (newCloseAt <= rfq.bidCloseCurrentAt) {
      shouldExtend = false;
      extensionReason = null;
      newCloseAt = null;
      capped = false;
    }
  }

  return {
    status: 'OK',
    newBid,
    rankingsBefore,
    rankingsAfter,
    l1Before: l1Of(latestBidsBySupplier),
    l1After: l1Of(latestAfter),
    withinTriggerWindow,
    shouldExtend,
    extensionReason,
    newCloseAt,
    capped
  };
}

function mergeLatest(latestBidsBySupplier, newBid) {
  const others = latestBidsBySupplier.filter(b => b.supplierId !== newBid.supplierId);
  return [...others, newBid];
}

function orderChanged(before, after) {
  if (before.length !== after.length) return true;
  for (let i = 0; i < before.length; i++) {
    if (before[i].supplierId !== after[i].supplierId) return true;
  }
  return false;
}

function addMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * MS_PER_MIN).toISOString();
}

function subtractMinutes(iso, minutes) {
  return new Date(new Date(iso).getTime() - minutes * MS_PER_MIN).toISOString();
}
```

- [ ] **Step 4: Run tests — verify pass**

Run: `npm test --prefix server`
Expected: all 18 tests pass (3 rankings + 4 status + 11 engine).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/auctionEngine.js server/test/auctionEngine.test.js
git commit -m "feat(server): pure auction engine with full trigger coverage"
```

---

## Task 9: Repos (rfqRepo, bidRepo, activityRepo)

**Files:**
- Create: `server/src/repos/rfqRepo.js`
- Create: `server/src/repos/bidRepo.js`
- Create: `server/src/repos/activityRepo.js`

These are thin SQL wrappers — no auction logic. Tests come implicitly via the API e2e (Task 12).

- [ ] **Step 1: Create `server/src/repos/rfqRepo.js`**

```js
export function makeRfqRepo(db) {
  const insertStmt = db.prepare(`
    INSERT INTO rfqs (
      reference_id, name, pickup_date,
      bid_start_at, bid_close_initial_at, bid_close_current_at, forced_bid_close_at,
      trigger_type, trigger_window_minutes, extension_minutes,
      created_by
    ) VALUES (
      @referenceId, @name, @pickupDate,
      @bidStartAt, @bidCloseAt, @bidCloseAt, @forcedBidCloseAt,
      @triggerType, @triggerWindowMinutes, @extensionMinutes,
      @createdBy
    )
  `);
  const getByIdStmt = db.prepare(`SELECT * FROM rfqs WHERE id = ?`);
  const listStmt    = db.prepare(`SELECT * FROM rfqs ORDER BY id DESC`);
  const updateCloseStmt = db.prepare(`UPDATE rfqs SET bid_close_current_at = ? WHERE id = ?`);

  return {
    create(data) {
      const info = insertStmt.run(data);
      return getByIdStmt.get(info.lastInsertRowid);
    },
    getById(id) {
      return getByIdStmt.get(id);
    },
    list() {
      return listStmt.all();
    },
    updateCurrentClose(id, isoTime) {
      updateCloseStmt.run(isoTime, id);
    }
  };
}

export function rfqRowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    referenceId: row.reference_id,
    name: row.name,
    pickupDate: row.pickup_date,
    bidStartAt: row.bid_start_at,
    bidCloseInitialAt: row.bid_close_initial_at,
    bidCloseCurrentAt: row.bid_close_current_at,
    forcedBidCloseAt: row.forced_bid_close_at,
    triggerType: row.trigger_type,
    triggerWindowMinutes: row.trigger_window_minutes,
    extensionMinutes: row.extension_minutes,
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}
```

- [ ] **Step 2: Create `server/src/repos/bidRepo.js`**

```js
export function makeBidRepo(db) {
  const insertStmt = db.prepare(`
    INSERT INTO bids (
      rfq_id, supplier_id, carrier_name,
      freight_charges, origin_charges, destination_charges, total_price,
      transit_time_days, quote_validity_days, created_at
    ) VALUES (
      @rfqId, @supplierId, @carrierName,
      @freightCharges, @originCharges, @destinationCharges, @totalPrice,
      @transitTimeDays, @quoteValidityDays, @createdAt
    )
  `);

  const latestPerSupplierStmt = db.prepare(`
    SELECT b.*
    FROM bids b
    INNER JOIN (
      SELECT supplier_id, MAX(created_at) AS max_created
      FROM bids
      WHERE rfq_id = ?
      GROUP BY supplier_id
    ) m ON m.supplier_id = b.supplier_id AND m.max_created = b.created_at
    WHERE b.rfq_id = ?
  `);

  const latestForSupplierStmt = db.prepare(`
    SELECT * FROM bids
    WHERE rfq_id = ? AND supplier_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);

  return {
    insert(data) {
      const info = insertStmt.run(data);
      return info.lastInsertRowid;
    },
    latestPerSupplier(rfqId) {
      return latestPerSupplierStmt.all(rfqId, rfqId).map(rowToBid);
    },
    latestForSupplier(rfqId, supplierId) {
      const row = latestForSupplierStmt.get(rfqId, supplierId);
      return row ? rowToBid(row) : null;
    }
  };
}

export function rowToBid(row) {
  return {
    id: row.id,
    rfqId: row.rfq_id,
    supplierId: row.supplier_id,
    carrierName: row.carrier_name,
    freightCharges: row.freight_charges,
    originCharges: row.origin_charges,
    destinationCharges: row.destination_charges,
    totalPrice: row.total_price,
    transitTimeDays: row.transit_time_days,
    quoteValidityDays: row.quote_validity_days,
    createdAt: row.created_at
  };
}
```

- [ ] **Step 3: Create `server/src/repos/activityRepo.js`**

```js
export function makeActivityRepo(db) {
  const insertStmt = db.prepare(`
    INSERT INTO activity_log (rfq_id, event_type, message, metadata, created_at)
    VALUES (@rfqId, @eventType, @message, @metadata, @createdAt)
  `);
  const listStmt = db.prepare(`
    SELECT * FROM activity_log WHERE rfq_id = ? ORDER BY created_at DESC, id DESC
  `);
  return {
    insert(data) {
      insertStmt.run({ ...data, metadata: data.metadata ? JSON.stringify(data.metadata) : null });
    },
    list(rfqId) {
      return listStmt.all(rfqId).map(r => ({
        id: r.id,
        eventType: r.event_type,
        message: r.message,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        createdAt: r.created_at
      }));
    }
  };
}
```

- [ ] **Step 4: Commit**

```bash
git add server/src/repos/
git commit -m "feat(server): add rfq/bid/activity repos"
```

---

## Task 10: Validators

**Files:**
- Create: `server/src/validators.js`

- [ ] **Step 1: Create `server/src/validators.js`**

```js
export class ValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function validateCreateRfqBody(body) {
  const required = ['referenceId', 'name', 'pickupDate', 'bidStartAt', 'bidCloseAt', 'forcedBidCloseAt',
                    'triggerType', 'triggerWindowMinutes', 'extensionMinutes'];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === '') {
      throw new ValidationError('MISSING_FIELD', `${k} is required`);
    }
  }
  if (!['BID_RECEIVED', 'ANY_RANK_CHANGE', 'L1_RANK_CHANGE'].includes(body.triggerType)) {
    throw new ValidationError('INVALID_TRIGGER', 'triggerType must be one of BID_RECEIVED, ANY_RANK_CHANGE, L1_RANK_CHANGE');
  }
  if (!(Number.isInteger(body.triggerWindowMinutes) && body.triggerWindowMinutes > 0)) {
    throw new ValidationError('INVALID_WINDOW', 'triggerWindowMinutes must be a positive integer');
  }
  if (!(Number.isInteger(body.extensionMinutes) && body.extensionMinutes > 0)) {
    throw new ValidationError('INVALID_EXTENSION', 'extensionMinutes must be a positive integer');
  }
  if (!(body.bidStartAt < body.bidCloseAt)) {
    throw new ValidationError('INVALID_TIMING', 'bidStartAt must be before bidCloseAt');
  }
  if (!(body.bidCloseAt < body.forcedBidCloseAt)) {
    throw new ValidationError('INVALID_TIMING', 'bidCloseAt must be before forcedBidCloseAt');
  }
  if (body.pickupDate < body.bidCloseAt.slice(0, 10)) {
    throw new ValidationError('INVALID_TIMING', 'pickupDate must be on or after bidCloseAt date');
  }
}

export function validateBidBody(body) {
  const required = ['carrierName', 'freightCharges', 'originCharges', 'destinationCharges', 'transitTimeDays', 'quoteValidityDays'];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === '') {
      throw new ValidationError('MISSING_FIELD', `${k} is required`);
    }
  }
  for (const k of ['freightCharges', 'originCharges', 'destinationCharges']) {
    if (typeof body[k] !== 'number' || body[k] < 0 || Number.isNaN(body[k])) {
      throw new ValidationError('INVALID_CHARGES', `${k} must be a non-negative number`);
    }
  }
  if (!Number.isInteger(body.transitTimeDays) || body.transitTimeDays < 0) {
    throw new ValidationError('INVALID_TRANSIT', 'transitTimeDays must be a non-negative integer');
  }
  if (!Number.isInteger(body.quoteValidityDays) || body.quoteValidityDays <= 0) {
    throw new ValidationError('INVALID_VALIDITY', 'quoteValidityDays must be a positive integer');
  }
}

export function errorMiddleware(err, req, res, next) {
  if (err instanceof ValidationError) {
    return res.status(400).json({ error: { code: err.code, message: err.message } });
  }
  console.error(err);
  res.status(500).json({ error: { code: 'INTERNAL', message: 'unexpected server error' } });
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/validators.js
git commit -m "feat(server): request body validators and error middleware"
```

---

## Task 11: RFQ routes (create, list, get-by-id)

**Files:**
- Create: `server/src/routes/rfqs.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Create `server/src/routes/rfqs.js`**

```js
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { validateCreateRfqBody, ValidationError } from '../validators.js';
import { rfqRowToApi } from '../repos/rfqRepo.js';
import { deriveStatus } from '../services/status.js';
import { computeRankings } from '../services/rankings.js';

export function rfqsRouter({ rfqRepo, bidRepo, activityRepo, db }) {
  const r = Router();

  // POST /api/rfqs (buyer only)
  r.post('/', requireRole('buyer'), (req, res, next) => {
    try {
      validateCreateRfqBody(req.body);
      const created = rfqRepo.create({
        referenceId: req.body.referenceId,
        name: req.body.name,
        pickupDate: req.body.pickupDate,
        bidStartAt: req.body.bidStartAt,
        bidCloseAt: req.body.bidCloseAt,
        forcedBidCloseAt: req.body.forcedBidCloseAt,
        triggerType: req.body.triggerType,
        triggerWindowMinutes: req.body.triggerWindowMinutes,
        extensionMinutes: req.body.extensionMinutes,
        createdBy: req.user.id
      });
      activityRepo.insert({
        rfqId: created.id,
        eventType: 'AUCTION_OPENED',
        message: `Auction created. Bidding from ${req.body.bidStartAt} to ${req.body.bidCloseAt}.`,
        metadata: null,
        createdAt: new Date().toISOString()
      });
      const detail = buildDetailPayload({ rfqRepo, bidRepo, activityRepo, db }, created.id);
      res.status(201).json(detail);
    } catch (e) {
      if (e.message && e.message.includes('UNIQUE constraint failed: rfqs.reference_id')) {
        return res.status(409).json({ error: { code: 'DUPLICATE_REFERENCE', message: 'referenceId already exists' } });
      }
      next(e);
    }
  });

  // GET /api/rfqs (listing)
  r.get('/', (req, res) => {
    const rows = rfqRepo.list();
    const now = new Date().toISOString();
    const result = rows.map(row => {
      const api = rfqRowToApi(row);
      const latest = bidRepo.latestPerSupplier(row.id);
      const ranked = computeRankings(latest.map(b => ({ supplierId: b.supplierId, totalPrice: b.totalPrice, createdAt: b.createdAt })));
      const lowestSupplier = ranked[0];
      let lowestBid = null;
      if (lowestSupplier) {
        const supplier = db.prepare('SELECT name FROM users WHERE id = ?').get(lowestSupplier.supplierId);
        lowestBid = { supplierName: supplier ? supplier.name : `#${lowestSupplier.supplierId}`, totalPrice: lowestSupplier.totalPrice };
      }
      return {
        id: api.id,
        referenceId: api.referenceId,
        name: api.name,
        bidCloseCurrentAt: api.bidCloseCurrentAt,
        forcedBidCloseAt: api.forcedBidCloseAt,
        status: deriveStatus(api, now),
        lowestBid
      };
    });
    res.json(result);
  });

  // GET /api/rfqs/:id (details)
  r.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    const detail = buildDetailPayload({ rfqRepo, bidRepo, activityRepo, db }, id);
    if (!detail) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'rfq not found' } });
    res.json(detail);
  });

  return r;
}

export function buildDetailPayload({ rfqRepo, bidRepo, activityRepo, db }, id) {
  const row = rfqRepo.getById(id);
  if (!row) return null;
  const api = rfqRowToApi(row);
  const now = new Date().toISOString();

  const latest = bidRepo.latestPerSupplier(id);
  const ranked = computeRankings(latest.map(b => ({
    supplierId: b.supplierId, totalPrice: b.totalPrice, createdAt: b.createdAt
  })));
  const supplierLookup = db.prepare('SELECT id, name FROM users WHERE id = ?');
  const bidsForApi = ranked.map(r => {
    const full = latest.find(b => b.supplierId === r.supplierId);
    const sup = supplierLookup.get(r.supplierId) || { id: r.supplierId, name: `#${r.supplierId}` };
    return {
      rank: r.rank,
      supplier: { id: sup.id, name: sup.name },
      carrierName: full.carrierName,
      freightCharges: full.freightCharges,
      originCharges: full.originCharges,
      destinationCharges: full.destinationCharges,
      totalPrice: full.totalPrice,
      transitTimeDays: full.transitTimeDays,
      quoteValidityDays: full.quoteValidityDays,
      submittedAt: full.createdAt
    };
  });

  const creator = supplierLookup.get(api.createdBy) || { id: api.createdBy, name: `#${api.createdBy}` };

  return {
    id: api.id,
    referenceId: api.referenceId,
    name: api.name,
    pickupDate: api.pickupDate,
    bidStartAt: api.bidStartAt,
    bidCloseInitialAt: api.bidCloseInitialAt,
    bidCloseCurrentAt: api.bidCloseCurrentAt,
    forcedBidCloseAt: api.forcedBidCloseAt,
    triggerType: api.triggerType,
    triggerWindowMinutes: api.triggerWindowMinutes,
    extensionMinutes: api.extensionMinutes,
    status: deriveStatus(api, now),
    createdBy: { id: creator.id, name: creator.name },
    bids: bidsForApi,
    activityLog: activityRepo.list(id)
  };
}
```

- [ ] **Step 2: Wire into `server/src/index.js`** — replace existing contents

```js
import express from 'express';
import cors from 'cors';
import { openDatabase } from './db.js';
import { attachUser } from './auth.js';
import { usersRouter } from './routes/users.js';
import { rfqsRouter } from './routes/rfqs.js';
import { makeRfqRepo } from './repos/rfqRepo.js';
import { makeBidRepo } from './repos/bidRepo.js';
import { makeActivityRepo } from './repos/activityRepo.js';
import { errorMiddleware } from './validators.js';

export function createApp(db) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(attachUser(db));

  const rfqRepo = makeRfqRepo(db);
  const bidRepo = makeBidRepo(db);
  const activityRepo = makeActivityRepo(db);

  app.get('/api/health', (req, res) => res.json({ ok: true }));
  app.use('/api/users', usersRouter(db));
  app.use('/api/rfqs', rfqsRouter({ rfqRepo, bidRepo, activityRepo, db }));

  app.use(errorMiddleware);
  return app;
}

if (process.env.NODE_ENV !== 'test') {
  const db = openDatabase();
  const app = createApp(db);
  const PORT = process.env.PORT || 4000;
  app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
}
```

- [ ] **Step 3: Smoke-test** — buyer creates an RFQ

Start server, then run:

```bash
curl -s -X POST http://localhost:4000/api/rfqs \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: 1' \
  -d '{
    "referenceId":"RFQ-TEST-001",
    "name":"Smoke test",
    "pickupDate":"2026-05-01",
    "bidStartAt":"2026-04-26T10:00:00Z",
    "bidCloseAt":"2026-04-26T18:00:00Z",
    "forcedBidCloseAt":"2026-04-26T18:30:00Z",
    "triggerType":"BID_RECEIVED",
    "triggerWindowMinutes":10,
    "extensionMinutes":5
  }' | head -c 300
```

Expected: 201 response with full RFQ detail payload.

Then: `curl -s http://localhost:4000/api/rfqs | head -c 300` — listing shows the new RFQ.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/rfqs.js server/src/index.js
git commit -m "feat(server): RFQ create/list/get-by-id endpoints"
```

---

## Task 12: Bid route + auction engine wiring

**Files:**
- Create: `server/src/routes/bids.js`
- Modify: `server/src/index.js`

- [ ] **Step 1: Create `server/src/routes/bids.js`**

```js
import { Router } from 'express';
import { requireRole } from '../auth.js';
import { validateBidBody } from '../validators.js';
import { evaluateBid } from '../services/auctionEngine.js';
import { rfqRowToApi } from '../repos/rfqRepo.js';
import { buildDetailPayload } from './rfqs.js';

export function bidsRouter({ rfqRepo, bidRepo, activityRepo, db }) {
  const r = Router({ mergeParams: true });

  r.post('/', requireRole('supplier'), (req, res, next) => {
    try {
      validateBidBody(req.body);
      const rfqId = Number(req.params.rfqId);
      const supplierId = req.user.id;
      const nowIso = new Date().toISOString();

      const txn = db.transaction(() => {
        const row = rfqRepo.getById(rfqId);
        if (!row) return { http: 404, body: { error: { code: 'NOT_FOUND', message: 'rfq not found' } } };
        const rfq = rfqRowToApi(row);

        const prevLatestBidBySupplier = bidRepo.latestForSupplier(rfqId, supplierId);
        const latestBidsBySupplier = bidRepo.latestPerSupplier(rfqId);

        const newBidPlanned = {
          supplierId,
          carrierName: req.body.carrierName,
          freightCharges: req.body.freightCharges,
          originCharges: req.body.originCharges,
          destinationCharges: req.body.destinationCharges,
          transitTimeDays: req.body.transitTimeDays,
          quoteValidityDays: req.body.quoteValidityDays
        };

        const plan = evaluateBid({ rfq, prevLatestBidBySupplier, latestBidsBySupplier, newBidPlanned, nowIso });

        if (plan.status === 'AUCTION_NOT_ACTIVE') {
          return { http: 409, body: { error: { code: 'AUCTION_NOT_ACTIVE', message: 'auction is not currently accepting bids' } } };
        }
        if (plan.status === 'NOT_STRICTLY_LOWER') {
          return { http: 409, body: { error: {
            code: 'NOT_STRICTLY_LOWER',
            message: `new bid total must be strictly lower than your previous bid (${plan.previousTotalPrice})`,
            previousTotalPrice: plan.previousTotalPrice
          } } };
        }

        // Insert the bid
        bidRepo.insert({
          rfqId,
          supplierId,
          carrierName: plan.newBid.carrierName,
          freightCharges: plan.newBid.freightCharges,
          originCharges: plan.newBid.originCharges,
          destinationCharges: plan.newBid.destinationCharges,
          totalPrice: plan.newBid.totalPrice,
          transitTimeDays: plan.newBid.transitTimeDays,
          quoteValidityDays: plan.newBid.quoteValidityDays,
          createdAt: nowIso
        });

        // Apply extension if any
        if (plan.shouldExtend) {
          rfqRepo.updateCurrentClose(rfqId, plan.newCloseAt);
          activityRepo.insert({
            rfqId,
            eventType: plan.capped ? 'EXTENSION_CAPPED' : 'EXTENSION',
            message: extensionMessage(plan, rfq.bidCloseCurrentAt),
            metadata: {
              reason: plan.extensionReason,
              previousCloseAt: rfq.bidCloseCurrentAt,
              newCloseAt: plan.newCloseAt,
              capped: plan.capped
            },
            createdAt: nowIso
          });
        }

        // Always log the bid
        activityRepo.insert({
          rfqId,
          eventType: 'BID_SUBMITTED',
          message: `${req.user.name} submitted bid: total ${plan.newBid.totalPrice}`,
          metadata: { supplierId, totalPrice: plan.newBid.totalPrice },
          createdAt: nowIso
        });

        return { http: 201, body: buildDetailPayload({ rfqRepo, bidRepo, activityRepo, db }, rfqId) };
      });

      const result = txn();
      res.status(result.http).json(result.body);
    } catch (e) {
      next(e);
    }
  });

  return r;
}

function extensionMessage(plan, prevCloseAt) {
  const reason = ({
    BID_RECEIVED: 'bid received in trigger window',
    ANY_RANK_CHANGE: 'rankings changed in trigger window',
    L1_RANK_CHANGE: 'L1 supplier changed in trigger window'
  })[plan.extensionReason];
  const cappedNote = plan.capped ? ' (capped at forced close)' : '';
  return `Auction extended from ${prevCloseAt} to ${plan.newCloseAt} — ${reason}${cappedNote}.`;
}
```

- [ ] **Step 2: Wire bids router under `/api/rfqs/:rfqId/bids`**

In `server/src/index.js`, update `createApp` — replace the `app.use('/api/rfqs', ...)` line with:

```js
  app.use('/api/rfqs', rfqsRouter({ rfqRepo, bidRepo, activityRepo, db }));
  app.use('/api/rfqs/:rfqId/bids', bidsRouter({ rfqRepo, bidRepo, activityRepo, db }));
```

Add the import at the top: `import { bidsRouter } from './routes/bids.js';`

- [ ] **Step 3: Smoke-test the full flow**

With server running and the RFQ from Task 11 in place (or recreate), submit a bid as a supplier:

```bash
curl -s -X POST http://localhost:4000/api/rfqs/1/bids \
  -H 'Content-Type: application/json' \
  -H 'X-User-Id: 3' \
  -d '{
    "carrierName":"Acme Express",
    "freightCharges":50000,
    "originCharges":3000,
    "destinationCharges":2000,
    "transitTimeDays":3,
    "quoteValidityDays":30
  }' | head -c 500
```

Expected: 201 with bids array containing one bid (rank L1).

Re-submit a higher bid — expect 409 NOT_STRICTLY_LOWER. Submit a lower one — expect 201.

- [ ] **Step 4: Commit**

```bash
git add server/src/routes/bids.js server/src/index.js
git commit -m "feat(server): bid submission with transactional auction engine"
```

---

## Task 13: End-to-end happy-path test

**Files:**
- Create: `server/test/api.test.js`

- [ ] **Step 1: Add test helper for in-memory DB + happy path**

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import Database from 'better-sqlite3';
import { createApp } from '../src/index.js';

function setupDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  // Inline migration (don't rely on file path resolution)
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('buyer','supplier'))
    );
    CREATE TABLE rfqs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, pickup_date TEXT NOT NULL,
      bid_start_at TEXT NOT NULL, bid_close_initial_at TEXT NOT NULL,
      bid_close_current_at TEXT NOT NULL, forced_bid_close_at TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_window_minutes INTEGER NOT NULL,
      extension_minutes INTEGER NOT NULL,
      created_by INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE bids (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id INTEGER NOT NULL REFERENCES rfqs(id),
      supplier_id INTEGER NOT NULL REFERENCES users(id),
      carrier_name TEXT NOT NULL,
      freight_charges REAL NOT NULL, origin_charges REAL NOT NULL, destination_charges REAL NOT NULL,
      total_price REAL NOT NULL,
      transit_time_days INTEGER NOT NULL, quote_validity_days INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rfq_id INTEGER NOT NULL REFERENCES rfqs(id),
      event_type TEXT NOT NULL, message TEXT NOT NULL,
      metadata TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const insertUser = db.prepare('INSERT INTO users (name, role) VALUES (?, ?)');
  insertUser.run('Buyer', 'buyer');           // id 1
  insertUser.run('Supplier A', 'supplier');   // id 2
  insertUser.run('Supplier B', 'supplier');   // id 3
  insertUser.run('Supplier C', 'supplier');   // id 4
  return db;
}

function isoNowPlusMinutes(min) {
  return new Date(Date.now() + min * 60 * 1000).toISOString();
}

test('happy path: create RFQ, three suppliers bid, ranks + extensions reflected', async () => {
  const db = setupDb();
  const app = createApp(db);

  // Buyer creates an RFQ where the auction is currently active
  const rfqRes = await request(app)
    .post('/api/rfqs')
    .set('X-User-Id', '1')
    .send({
      referenceId: 'RFQ-T-1',
      name: 'Test Auction',
      pickupDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      bidStartAt: isoNowPlusMinutes(-1),                  // started 1 min ago
      bidCloseAt: isoNowPlusMinutes(5),                   // closes in 5 min
      forcedBidCloseAt: isoNowPlusMinutes(60),
      triggerType: 'L1_RANK_CHANGE',
      triggerWindowMinutes: 10,                            // we are inside the window
      extensionMinutes: 3
    });

  assert.equal(rfqRes.status, 201, JSON.stringify(rfqRes.body));
  const rfqId = rfqRes.body.id;

  // Supplier A bids 1000 (becomes L1)
  const a = await request(app)
    .post(`/api/rfqs/${rfqId}/bids`)
    .set('X-User-Id', '2')
    .send({ carrierName: 'A', freightCharges: 800, originCharges: 100, destinationCharges: 100, transitTimeDays: 3, quoteValidityDays: 30 });
  assert.equal(a.status, 201);
  assert.equal(a.body.bids[0].supplier.name, 'Supplier A');
  assert.equal(a.body.bids[0].totalPrice, 1000);

  const closeAfterA = a.body.bidCloseCurrentAt;

  // Supplier B bids 900 — should change L1, extending the auction
  const b = await request(app)
    .post(`/api/rfqs/${rfqId}/bids`)
    .set('X-User-Id', '3')
    .send({ carrierName: 'B', freightCharges: 700, originCharges: 100, destinationCharges: 100, transitTimeDays: 4, quoteValidityDays: 30 });
  assert.equal(b.status, 201);
  assert.equal(b.body.bids[0].supplier.name, 'Supplier B');
  assert.equal(b.body.bids[0].totalPrice, 900);
  assert.ok(b.body.bidCloseCurrentAt > closeAfterA, 'auction should extend after L1 change');
  assert.ok(b.body.activityLog.some(e => e.eventType === 'EXTENSION'));

  // Supplier A re-bids same amount (1000) — must be rejected (not strictly lower)
  const aAgain = await request(app)
    .post(`/api/rfqs/${rfqId}/bids`)
    .set('X-User-Id', '2')
    .send({ carrierName: 'A', freightCharges: 800, originCharges: 100, destinationCharges: 100, transitTimeDays: 3, quoteValidityDays: 30 });
  assert.equal(aAgain.status, 409);
  assert.equal(aAgain.body.error.code, 'NOT_STRICTLY_LOWER');

  // Supplier C bids 950 — between A and B, no L1 change (B still L1) → no extension under L1_RANK_CHANGE
  const c = await request(app)
    .post(`/api/rfqs/${rfqId}/bids`)
    .set('X-User-Id', '4')
    .send({ carrierName: 'C', freightCharges: 750, originCharges: 100, destinationCharges: 100, transitTimeDays: 5, quoteValidityDays: 30 });
  assert.equal(c.status, 201);
  // Final order: B (900) < C (950) < A (1000)
  assert.deepEqual(c.body.bids.map(b => b.supplier.name), ['Supplier B', 'Supplier C', 'Supplier A']);

  // Supplier-only enforcement: buyer attempting to bid is rejected
  const buyerBid = await request(app)
    .post(`/api/rfqs/${rfqId}/bids`)
    .set('X-User-Id', '1')
    .send({ carrierName: 'X', freightCharges: 1, originCharges: 0, destinationCharges: 0, transitTimeDays: 1, quoteValidityDays: 1 });
  assert.equal(buyerBid.status, 403);
});
```

- [ ] **Step 2: Run e2e test**

Run: `npm test --prefix server`
Expected: all 19 tests pass (3 + 4 + 11 + 1).

- [ ] **Step 3: Commit**

```bash
git add server/test/api.test.js
git commit -m "test(server): e2e happy path covering create + bid + extension"
```

---

## Task 14: Client scaffold + Tailwind + Router

**Files:**
- Create: `client/package.json`
- Create: `client/vite.config.js`
- Create: `client/index.html`
- Create: `client/postcss.config.js`
- Create: `client/tailwind.config.js`
- Create: `client/src/main.jsx`
- Create: `client/src/index.css`
- Create: `client/src/App.jsx` (skeleton)

- [ ] **Step 1: Create `client/package.json`**

```json
{
  "name": "british-auction-rfq-client",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.27.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.3",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.47",
    "tailwindcss": "^3.4.14",
    "vite": "^5.4.10"
  }
}
```

- [ ] **Step 2: Create `client/vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000'
    }
  }
});
```

- [ ] **Step 3: Create `client/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>British Auction RFQ</title>
  </head>
  <body class="bg-slate-50">
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create Tailwind config files**

`client/postcss.config.js`:
```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {}
  }
};
```

`client/tailwind.config.js`:
```js
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: { extend: {} },
  plugins: []
};
```

- [ ] **Step 5: Create `client/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 6: Create `client/src/main.jsx`**

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

- [ ] **Step 7: Create `client/src/App.jsx` skeleton**

```jsx
import { Routes, Route, Link } from 'react-router-dom';

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-6">
        <Link to="/" className="text-lg font-semibold">British Auction RFQ</Link>
        <nav className="flex gap-4 text-sm text-slate-700">
          <Link to="/">Auctions</Link>
          <Link to="/rfqs/new">New RFQ</Link>
        </nav>
      </header>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<div>Listing page goes here</div>} />
          <Route path="/rfqs/new" element={<div>Create page goes here</div>} />
          <Route path="/rfqs/:id" element={<div>Details page goes here</div>} />
        </Routes>
      </main>
    </div>
  );
}
```

- [ ] **Step 8: Install client deps**

Run: `npm install --prefix client`

- [ ] **Step 9: Smoke-test client**

Run: `npm run dev --prefix client` (Vite serves on 5173). Visit `http://localhost:5173` — header + nav visible, Tailwind background applied. Kill the process after verifying.

- [ ] **Step 10: Commit**

```bash
git add client/
git commit -m "feat(client): scaffold vite + react + tailwind + router"
```

---

## Task 15: API helper + UserSwitcher + useCurrentUser hook

**Files:**
- Create: `client/src/api.js`
- Create: `client/src/hooks/useCurrentUser.js`
- Create: `client/src/components/UserSwitcher.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Create `client/src/api.js`**

```js
function userId() {
  return localStorage.getItem('userId') || '';
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId()
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.code = json?.error?.code;
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export const api = {
  listUsers:   ()                => request('GET',  '/api/users'),
  listRfqs:    ()                => request('GET',  '/api/rfqs'),
  getRfq:      (id)              => request('GET',  `/api/rfqs/${id}`),
  createRfq:   (body)            => request('POST', '/api/rfqs', body),
  submitBid:   (rfqId, body)     => request('POST', `/api/rfqs/${rfqId}/bids`, body)
};
```

- [ ] **Step 2: Create `client/src/hooks/useCurrentUser.js`**

```js
import { useEffect, useState } from 'react';
import { api } from '../api.js';

export function useCurrentUser() {
  const [users, setUsers] = useState([]);
  const [currentId, setCurrentId] = useState(() => {
    const stored = localStorage.getItem('userId');
    return stored ? Number(stored) : null;
  });

  useEffect(() => {
    api.listUsers().then(setUsers).catch(console.error);
  }, []);

  useEffect(() => {
    if (currentId == null) {
      localStorage.removeItem('userId');
    } else {
      localStorage.setItem('userId', String(currentId));
    }
  }, [currentId]);

  const current = users.find(u => u.id === currentId) || null;
  return { users, current, setCurrentId };
}
```

- [ ] **Step 3: Create `client/src/components/UserSwitcher.jsx`**

```jsx
import { useCurrentUser } from '../hooks/useCurrentUser.js';

export default function UserSwitcher() {
  const { users, current, setCurrentId } = useCurrentUser();

  return (
    <div className="ml-auto flex items-center gap-2 text-sm">
      <span className="text-slate-500">Acting as:</span>
      <select
        className="border border-slate-300 rounded px-2 py-1 bg-white"
        value={current?.id ?? ''}
        onChange={e => setCurrentId(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">— select user —</option>
        {users.map(u => (
          <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 4: Update `client/src/App.jsx`** — mount UserSwitcher and gate "New RFQ" link by role

```jsx
import { Routes, Route, Link } from 'react-router-dom';
import UserSwitcher from './components/UserSwitcher.jsx';
import { useCurrentUser } from './hooks/useCurrentUser.js';

export default function App() {
  const { current } = useCurrentUser();

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center gap-6">
        <Link to="/" className="text-lg font-semibold">British Auction RFQ</Link>
        <nav className="flex gap-4 text-sm text-slate-700">
          <Link to="/">Auctions</Link>
          {current?.role === 'buyer' && <Link to="/rfqs/new">New RFQ</Link>}
        </nav>
        <UserSwitcher />
      </header>
      <main className="p-6">
        <Routes>
          <Route path="/" element={<div>Listing page goes here</div>} />
          <Route path="/rfqs/new" element={<div>Create page goes here</div>} />
          <Route path="/rfqs/:id" element={<div>Details page goes here</div>} />
        </Routes>
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Smoke-test**

Start `npm run dev` from repo root. Open `http://localhost:5173`. Switch users via dropdown — "New RFQ" link appears only when a buyer is selected.

- [ ] **Step 6: Commit**

```bash
git add client/src/api.js client/src/hooks/useCurrentUser.js client/src/components/UserSwitcher.jsx client/src/App.jsx
git commit -m "feat(client): mock auth dropdown + useCurrentUser hook"
```

---

## Task 16: Shared display components — Countdown, StatusBadge

**Files:**
- Create: `client/src/components/Countdown.jsx`
- Create: `client/src/components/StatusBadge.jsx`

- [ ] **Step 1: Create `client/src/components/Countdown.jsx`**

```jsx
import { useEffect, useState } from 'react';

function diffParts(targetIso) {
  const ms = new Date(targetIso).getTime() - Date.now();
  if (ms <= 0) return null;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return { h, m, s };
}

export default function Countdown({ targetIso, prefix = '' }) {
  const [parts, setParts] = useState(() => diffParts(targetIso));

  useEffect(() => {
    const id = setInterval(() => setParts(diffParts(targetIso)), 1000);
    return () => clearInterval(id);
  }, [targetIso]);

  if (!parts) return <span className="text-slate-400">—</span>;
  const { h, m, s } = parts;
  const pad = (n) => String(n).padStart(2, '0');
  return (
    <span className="font-mono">
      {prefix}{h > 0 ? `${pad(h)}:` : ''}{pad(m)}:{pad(s)}
    </span>
  );
}
```

- [ ] **Step 2: Create `client/src/components/StatusBadge.jsx`**

```jsx
const COLORS = {
  Scheduled:    'bg-slate-200 text-slate-700',
  Active:       'bg-green-100 text-green-800',
  Closed:       'bg-slate-300 text-slate-700',
  ForceClosed:  'bg-red-100 text-red-800'
};

export default function StatusBadge({ status }) {
  const cls = COLORS[status] || 'bg-slate-100 text-slate-700';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Countdown.jsx client/src/components/StatusBadge.jsx
git commit -m "feat(client): countdown and status badge components"
```

---

## Task 17: ListingPage

**Files:**
- Create: `client/src/pages/ListingPage.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Create `client/src/pages/ListingPage.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Countdown from '../components/Countdown.jsx';

export default function ListingPage() {
  const [rfqs, setRfqs] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.listRfqs();
        if (!cancelled) setRfqs(data);
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    }
    load();
    const id = setInterval(load, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (error) return <div className="text-red-700">Error: {error}</div>;

  return (
    <div className="max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Auctions</h1>
      <table className="w-full bg-white border border-slate-200 rounded">
        <thead className="bg-slate-100 text-left text-xs uppercase tracking-wider text-slate-600">
          <tr>
            <th className="p-3">Reference</th>
            <th className="p-3">Name</th>
            <th className="p-3">Status</th>
            <th className="p-3">Lowest bid</th>
            <th className="p-3">Closes</th>
            <th className="p-3">Forced close</th>
          </tr>
        </thead>
        <tbody>
          {rfqs.length === 0 && (
            <tr><td colSpan={6} className="p-4 text-center text-slate-500">No RFQs yet.</td></tr>
          )}
          {rfqs.map(r => (
            <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="p-3"><Link className="text-blue-700 underline" to={`/rfqs/${r.id}`}>{r.referenceId}</Link></td>
              <td className="p-3">{r.name}</td>
              <td className="p-3"><StatusBadge status={r.status} /></td>
              <td className="p-3">
                {r.lowestBid
                  ? <span>₹{r.lowestBid.totalPrice.toLocaleString()} <span className="text-slate-500">({r.lowestBid.supplierName})</span></span>
                  : <span className="text-slate-400">—</span>}
              </td>
              <td className="p-3">
                {r.status === 'Active'
                  ? <Countdown targetIso={r.bidCloseCurrentAt} prefix="in " />
                  : new Date(r.bidCloseCurrentAt).toLocaleString()}
              </td>
              <td className="p-3">{new Date(r.forcedBidCloseAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Mount route in `client/src/App.jsx`** — replace the `<Route path="/" ...>` line with:

```jsx
import ListingPage from './pages/ListingPage.jsx';
// ...
<Route path="/" element={<ListingPage />} />
```

- [ ] **Step 3: Manual smoke-test**

With server running, open `http://localhost:5173`. Listing page shows the RFQ from earlier curl smoke tests. Status updates within 5s when the auction closes.

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/ListingPage.jsx client/src/App.jsx
git commit -m "feat(client): listing page with polling and live countdown"
```

---

## Task 18: CreateRfqPage

**Files:**
- Create: `client/src/pages/CreateRfqPage.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Create `client/src/pages/CreateRfqPage.jsx`**

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useCurrentUser } from '../hooks/useCurrentUser.js';

const TRIGGER_OPTIONS = [
  { value: 'BID_RECEIVED',    label: 'Any bid received in trigger window' },
  { value: 'ANY_RANK_CHANGE', label: 'Any supplier rank change in trigger window' },
  { value: 'L1_RANK_CHANGE',  label: 'Lowest bidder (L1) changes in trigger window' }
];

const initial = {
  referenceId: '',
  name: '',
  pickupDate: '',
  bidStartAt: '',
  bidCloseAt: '',
  forcedBidCloseAt: '',
  triggerType: 'L1_RANK_CHANGE',
  triggerWindowMinutes: 10,
  extensionMinutes: 5
};

function toIso(localDt) {
  // datetime-local strings come without timezone; treat as local and convert to ISO UTC
  if (!localDt) return '';
  return new Date(localDt).toISOString();
}

function validate(form) {
  const errs = {};
  if (!form.referenceId) errs.referenceId = 'required';
  if (!form.name) errs.name = 'required';
  if (!form.pickupDate) errs.pickupDate = 'required';
  if (!form.bidStartAt) errs.bidStartAt = 'required';
  if (!form.bidCloseAt) errs.bidCloseAt = 'required';
  if (!form.forcedBidCloseAt) errs.forcedBidCloseAt = 'required';
  if (form.bidStartAt && form.bidCloseAt && !(form.bidStartAt < form.bidCloseAt))
    errs.bidCloseAt = 'must be after bid start';
  if (form.bidCloseAt && form.forcedBidCloseAt && !(form.bidCloseAt < form.forcedBidCloseAt))
    errs.forcedBidCloseAt = 'must be after bid close';
  if (form.pickupDate && form.bidCloseAt && form.pickupDate < form.bidCloseAt.slice(0, 10))
    errs.pickupDate = 'must be on or after bid close date';
  if (!(form.triggerWindowMinutes > 0)) errs.triggerWindowMinutes = 'must be > 0';
  if (!(form.extensionMinutes > 0)) errs.extensionMinutes = 'must be > 0';
  return errs;
}

export default function CreateRfqPage() {
  const { current } = useCurrentUser();
  const nav = useNavigate();
  const [form, setForm] = useState(initial);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState(null);

  if (!current) return <div>Pick a user from the top-right dropdown to continue.</div>;
  if (current.role !== 'buyer') return <div className="text-slate-700">Only buyers can create RFQs.</div>;

  const errors = validate(form);
  const isValid = Object.keys(errors).length === 0;

  function update(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    if (!isValid) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const created = await api.createRfq({
        referenceId: form.referenceId,
        name: form.name,
        pickupDate: form.pickupDate,
        bidStartAt: toIso(form.bidStartAt),
        bidCloseAt: toIso(form.bidCloseAt),
        forcedBidCloseAt: toIso(form.forcedBidCloseAt),
        triggerType: form.triggerType,
        triggerWindowMinutes: Number(form.triggerWindowMinutes),
        extensionMinutes: Number(form.extensionMinutes)
      });
      nav(`/rfqs/${created.id}`);
    } catch (err) {
      setServerError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass = 'w-full border border-slate-300 rounded px-3 py-2 text-sm';

  return (
    <form onSubmit={submit} className="max-w-2xl mx-auto bg-white p-6 rounded border border-slate-200 space-y-6">
      <h1 className="text-2xl font-semibold">Create RFQ</h1>

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-wider text-slate-600">RFQ details</h2>
        <Field label="Reference ID" error={errors.referenceId}>
          <input className={fieldClass} value={form.referenceId} onChange={e => update('referenceId', e.target.value)} />
        </Field>
        <Field label="Name" error={errors.name}>
          <input className={fieldClass} value={form.name} onChange={e => update('name', e.target.value)} />
        </Field>
        <Field label="Pickup date" error={errors.pickupDate}>
          <input type="date" className={fieldClass} value={form.pickupDate} onChange={e => update('pickupDate', e.target.value)} />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-wider text-slate-600">Auction window</h2>
        <Field label="Bid start" error={errors.bidStartAt}>
          <input type="datetime-local" className={fieldClass} value={form.bidStartAt} onChange={e => update('bidStartAt', e.target.value)} />
        </Field>
        <Field label="Bid close" error={errors.bidCloseAt}>
          <input type="datetime-local" className={fieldClass} value={form.bidCloseAt} onChange={e => update('bidCloseAt', e.target.value)} />
        </Field>
        <Field label="Forced bid close" error={errors.forcedBidCloseAt}>
          <input type="datetime-local" className={fieldClass} value={form.forcedBidCloseAt} onChange={e => update('forcedBidCloseAt', e.target.value)} />
        </Field>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm uppercase tracking-wider text-slate-600">Auction config</h2>
        <div>
          <div className="text-sm font-medium mb-1">Trigger type</div>
          {TRIGGER_OPTIONS.map(opt => (
            <label key={opt.value} className="flex items-center gap-2 py-1 text-sm">
              <input
                type="radio"
                name="triggerType"
                value={opt.value}
                checked={form.triggerType === opt.value}
                onChange={() => update('triggerType', opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
        <Field label="Trigger window (X, minutes)" error={errors.triggerWindowMinutes}>
          <input type="number" min="1" className={fieldClass}
                 value={form.triggerWindowMinutes}
                 onChange={e => update('triggerWindowMinutes', Number(e.target.value))} />
        </Field>
        <Field label="Extension duration (Y, minutes)" error={errors.extensionMinutes}>
          <input type="number" min="1" className={fieldClass}
                 value={form.extensionMinutes}
                 onChange={e => update('extensionMinutes', Number(e.target.value))} />
        </Field>
      </section>

      {serverError && <div className="text-red-700 text-sm">Error: {serverError}</div>}

      <button type="submit" disabled={!isValid || submitting}
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
        {submitting ? 'Creating…' : 'Create RFQ'}
      </button>
    </form>
  );
}

function Field({ label, error, children }) {
  return (
    <label className="block">
      <span className="text-sm font-medium block mb-1">{label}</span>
      {children}
      {error && <span className="text-red-600 text-xs">{error}</span>}
    </label>
  );
}
```

- [ ] **Step 2: Mount route** — `client/src/App.jsx`

Add import: `import CreateRfqPage from './pages/CreateRfqPage.jsx';`
Replace placeholder route: `<Route path="/rfqs/new" element={<CreateRfqPage />} />`

- [ ] **Step 3: Manual smoke-test**

Switch to a buyer user, click "New RFQ", fill the form, submit. Confirm redirect to `/rfqs/:id` (page is still placeholder until Task 19).

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/CreateRfqPage.jsx client/src/App.jsx
git commit -m "feat(client): create RFQ form with inline validation"
```

---

## Task 19: DetailsPage + BidsTable + ActivityLog + BidForm + usePolledRfq

**Files:**
- Create: `client/src/hooks/usePolledRfq.js`
- Create: `client/src/components/BidsTable.jsx`
- Create: `client/src/components/ActivityLog.jsx`
- Create: `client/src/components/BidForm.jsx`
- Create: `client/src/pages/DetailsPage.jsx`
- Modify: `client/src/App.jsx`

- [ ] **Step 1: Create `client/src/hooks/usePolledRfq.js`**

```js
import { useEffect, useRef, useState, useCallback } from 'react';
import { api } from '../api.js';

export function usePolledRfq(id, intervalMs = 3000) {
  const [rfq, setRfq] = useState(null);
  const [error, setError] = useState(null);
  const cancelledRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const data = await api.getRfq(id);
      if (!cancelledRef.current) setRfq(data);
    } catch (e) {
      if (!cancelledRef.current) setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    cancelledRef.current = false;
    refresh();

    let timer = null;
    function start() {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        if (rfq && (rfq.status === 'Closed' || rfq.status === 'ForceClosed')) return;
        refresh();
      }, intervalMs);
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null; }
    }
    start();
    document.addEventListener('visibilitychange', start);
    return () => {
      cancelledRef.current = true;
      stop();
      document.removeEventListener('visibilitychange', start);
    };
  }, [id, intervalMs, refresh, rfq?.status]);

  return { rfq, error, refresh, setRfq };
}
```

- [ ] **Step 2: Create `client/src/components/BidsTable.jsx`**

```jsx
export default function BidsTable({ bids, currentSupplierId }) {
  if (!bids || bids.length === 0) {
    return <div className="text-slate-500 italic p-4">No bids yet — be the first to quote.</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-100 text-xs uppercase tracking-wider text-slate-600">
        <tr>
          <th className="p-2 text-left">Rank</th>
          <th className="p-2 text-left">Supplier</th>
          <th className="p-2 text-left">Carrier</th>
          <th className="p-2 text-right">Freight</th>
          <th className="p-2 text-right">Origin</th>
          <th className="p-2 text-right">Dest.</th>
          <th className="p-2 text-right">Total</th>
          <th className="p-2 text-right">Transit</th>
          <th className="p-2 text-right">Validity</th>
          <th className="p-2 text-right">Submitted</th>
        </tr>
      </thead>
      <tbody>
        {bids.map(b => {
          const isMine = currentSupplierId != null && b.supplier.id === currentSupplierId;
          return (
            <tr key={b.supplier.id} className={`border-t border-slate-100 ${isMine ? 'bg-blue-50' : ''}`}>
              <td className="p-2 font-semibold">L{b.rank}</td>
              <td className="p-2">{b.supplier.name}{isMine && ' (you)'}</td>
              <td className="p-2">{b.carrierName}</td>
              <td className="p-2 text-right">{b.freightCharges.toLocaleString()}</td>
              <td className="p-2 text-right">{b.originCharges.toLocaleString()}</td>
              <td className="p-2 text-right">{b.destinationCharges.toLocaleString()}</td>
              <td className="p-2 text-right font-semibold">{b.totalPrice.toLocaleString()}</td>
              <td className="p-2 text-right">{b.transitTimeDays}d</td>
              <td className="p-2 text-right">{b.quoteValidityDays}d</td>
              <td className="p-2 text-right text-slate-500">{new Date(b.submittedAt).toLocaleTimeString()}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

- [ ] **Step 3: Create `client/src/components/ActivityLog.jsx`**

```jsx
const PILL = {
  AUCTION_OPENED:    'bg-slate-200 text-slate-700',
  BID_SUBMITTED:     'bg-blue-100 text-blue-800',
  EXTENSION:         'bg-amber-100 text-amber-800',
  EXTENSION_CAPPED:  'bg-red-100 text-red-800',
  AUCTION_CLOSED:    'bg-slate-300 text-slate-700'
};

export default function ActivityLog({ entries }) {
  if (!entries || entries.length === 0) {
    return <div className="text-slate-500 italic p-3 text-sm">No activity yet.</div>;
  }
  return (
    <ol className="divide-y divide-slate-100 text-sm">
      {entries.map(e => (
        <li key={e.id} className="p-2">
          <div className="flex items-start gap-2">
            <span className="text-slate-400 text-xs w-20 flex-none">{new Date(e.createdAt).toLocaleTimeString()}</span>
            <span className={`inline-block px-2 rounded text-xs ${PILL[e.eventType] || 'bg-slate-100'}`}>
              {e.eventType}
            </span>
          </div>
          <div className="ml-22 mt-1">{e.message}</div>
          {e.metadata && (
            <pre className="ml-22 mt-1 text-xs text-slate-500 whitespace-pre-wrap">
              {JSON.stringify(e.metadata, null, 2)}
            </pre>
          )}
        </li>
      ))}
    </ol>
  );
}
```

- [ ] **Step 4: Create `client/src/components/BidForm.jsx`**

```jsx
import { useState } from 'react';
import { api } from '../api.js';

const empty = { carrierName: '', freightCharges: '', originCharges: '', destinationCharges: '', transitTimeDays: '', quoteValidityDays: '' };

export default function BidForm({ rfqId, onSubmitted, previousTotal }) {
  const [form, setForm] = useState(empty);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  const total =
    (Number(form.freightCharges) || 0) +
    (Number(form.originCharges) || 0) +
    (Number(form.destinationCharges) || 0);

  const required = ['carrierName', 'freightCharges', 'originCharges', 'destinationCharges', 'transitTimeDays', 'quoteValidityDays'];
  const missing = required.some(k => form[k] === '' || form[k] === null);
  const violatesUnderbid = previousTotal != null && total >= previousTotal;
  const canSubmit = !missing && !violatesUnderbid && !submitting;

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const updated = await api.submitBid(rfqId, {
        carrierName: form.carrierName,
        freightCharges: Number(form.freightCharges),
        originCharges: Number(form.originCharges),
        destinationCharges: Number(form.destinationCharges),
        transitTimeDays: Number(form.transitTimeDays),
        quoteValidityDays: Number(form.quoteValidityDays)
      });
      setForm(empty);
      onSubmitted(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const fieldCls = 'w-full border border-slate-300 rounded px-2 py-1 text-sm';

  return (
    <form onSubmit={submit} className="bg-white border border-slate-200 rounded p-4 space-y-3">
      <h3 className="font-medium">Submit a bid</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs text-slate-600">Carrier name</span>
          <input className={fieldCls} value={form.carrierName} onChange={e => set('carrierName', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Freight charges</span>
          <input type="number" min="0" className={fieldCls} value={form.freightCharges} onChange={e => set('freightCharges', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Origin charges</span>
          <input type="number" min="0" className={fieldCls} value={form.originCharges} onChange={e => set('originCharges', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Destination charges</span>
          <input type="number" min="0" className={fieldCls} value={form.destinationCharges} onChange={e => set('destinationCharges', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Transit time (days)</span>
          <input type="number" min="0" className={fieldCls} value={form.transitTimeDays} onChange={e => set('transitTimeDays', e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-600">Quote validity (days)</span>
          <input type="number" min="1" className={fieldCls} value={form.quoteValidityDays} onChange={e => set('quoteValidityDays', e.target.value)} />
        </label>
      </div>
      <div className="text-sm">
        <span className="text-slate-600">Live total: </span>
        <span className="font-semibold">{total.toLocaleString()}</span>
        {previousTotal != null && (
          <span className="text-slate-500 ml-3">your previous: {previousTotal.toLocaleString()}</span>
        )}
        {violatesUnderbid && (
          <span className="ml-3 text-red-700">must be strictly lower than your previous bid</span>
        )}
      </div>
      {error && <div className="text-red-700 text-sm">{error}</div>}
      <button type="submit" disabled={!canSubmit}
              className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-50">
        {submitting ? 'Submitting…' : 'Submit bid'}
      </button>
    </form>
  );
}
```

- [ ] **Step 5: Create `client/src/pages/DetailsPage.jsx`**

```jsx
import { useParams } from 'react-router-dom';
import { usePolledRfq } from '../hooks/usePolledRfq.js';
import { useCurrentUser } from '../hooks/useCurrentUser.js';
import StatusBadge from '../components/StatusBadge.jsx';
import Countdown from '../components/Countdown.jsx';
import BidsTable from '../components/BidsTable.jsx';
import ActivityLog from '../components/ActivityLog.jsx';
import BidForm from '../components/BidForm.jsx';

const TRIGGER_LABELS = {
  BID_RECEIVED: 'Any bid received',
  ANY_RANK_CHANGE: 'Any rank change',
  L1_RANK_CHANGE: 'L1 rank change'
};

export default function DetailsPage() {
  const { id } = useParams();
  const rfqId = Number(id);
  const { rfq, error, setRfq } = usePolledRfq(rfqId, 3000);
  const { current } = useCurrentUser();

  if (error) return <div className="text-red-700">Error: {error}</div>;
  if (!rfq)  return <div>Loading…</div>;

  const myBid = current?.role === 'supplier'
    ? rfq.bids.find(b => b.supplier.id === current.id)
    : null;

  const showBidForm = current?.role === 'supplier' && rfq.status === 'Active';

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <div className="bg-white border border-slate-200 rounded p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">{rfq.referenceId} · {rfq.name}</h1>
          <StatusBadge status={rfq.status} />
        </div>
        <div className="text-sm text-slate-600 mt-1">
          Pickup: {rfq.pickupDate} · Forced close: {new Date(rfq.forcedBidCloseAt).toLocaleString()}
        </div>
        <div className="text-sm mt-2">
          {rfq.status === 'Active' && (
            <>⏱ Closes in <Countdown targetIso={rfq.bidCloseCurrentAt} /> (current close: {new Date(rfq.bidCloseCurrentAt).toLocaleTimeString()})</>
          )}
          {rfq.status === 'Scheduled' && (
            <>Starts in <Countdown targetIso={rfq.bidStartAt} /></>
          )}
          {(rfq.status === 'Closed' || rfq.status === 'ForceClosed') && (
            <span className="text-slate-700">
              Auction {rfq.status === 'ForceClosed' ? 'force-' : ''}closed at {new Date(rfq.bidCloseCurrentAt).toLocaleString()}.
              {rfq.bids[0] && <> Final L1: {rfq.bids[0].supplier.name} at ₹{rfq.bids[0].totalPrice.toLocaleString()}.</>}
            </span>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-2">
          Trigger: {TRIGGER_LABELS[rfq.triggerType]} · Window: {rfq.triggerWindowMinutes} min · Extension: {rfq.extensionMinutes} min
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
        <div className="bg-white border border-slate-200 rounded">
          <div className="px-4 py-2 border-b border-slate-200 font-medium text-sm">Bids</div>
          <BidsTable bids={rfq.bids} currentSupplierId={current?.role === 'supplier' ? current.id : null} />
        </div>
        <div className="bg-white border border-slate-200 rounded">
          <div className="px-4 py-2 border-b border-slate-200 font-medium text-sm">Activity log</div>
          <div className="max-h-96 overflow-y-auto">
            <ActivityLog entries={rfq.activityLog} />
          </div>
        </div>
      </div>

      {showBidForm && (
        <BidForm
          rfqId={rfqId}
          previousTotal={myBid ? myBid.totalPrice : null}
          onSubmitted={(updated) => setRfq(updated)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Mount route** — `client/src/App.jsx`

Add import: `import DetailsPage from './pages/DetailsPage.jsx';`
Replace placeholder route: `<Route path="/rfqs/:id" element={<DetailsPage />} />`

- [ ] **Step 7: Full manual end-to-end test**

1. `npm run dev` from repo root.
2. Switch to a buyer; create an RFQ with `bidStartAt` = now, `bidCloseAt` = now + 2 min, `forcedBidCloseAt` = now + 10 min, trigger window 10 min, extension 1 min, trigger type L1_RANK_CHANGE.
3. Switch to Supplier Acme; submit a bid. Verify rank, activity log entry, countdown.
4. Switch to Supplier Beta; submit a lower bid. Verify L1 changes, auction extends, EXTENSION entry shows.
5. As Acme, try to submit same total — UI inline error blocks submit; force-submit via DevTools to confirm 409 response.
6. Wait for auction to close — status flips to Closed, BidForm hidden, banner shows final L1.

- [ ] **Step 8: Commit**

```bash
git add client/src/hooks/usePolledRfq.js client/src/components/BidsTable.jsx client/src/components/ActivityLog.jsx client/src/components/BidForm.jsx client/src/pages/DetailsPage.jsx client/src/App.jsx
git commit -m "feat(client): RFQ details page with bids, activity log, and bid form"
```

---

## Task 20: README + final polish

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md` contents**

```markdown
# British Auction RFQ

Take-home demo of an RFQ system with British-auction-style bidding: configurable extension triggers, automatic bid-time extensions, and a forced-close cap.

## Stack

- **Backend:** Node 18+, Express 4, better-sqlite3
- **Frontend:** React 18, Vite, Tailwind CSS, react-router-dom 6
- **Tests:** node:test + supertest

## Quick start

```bash
npm run install:all   # installs root + server + client
npm run seed          # seeds 6 mock users
npm run dev           # API on :4000, Vite on :5173
```

Open `http://localhost:5173`. Pick a user from the top-right dropdown (buyer or supplier).

Seeded users:
- Buyer Alice (id 1), Buyer Bob (id 2)
- Supplier Acme (id 3), Supplier Beta (id 4), Supplier Gamma (id 5), Supplier Delta (id 6)

## High-level design

```
[ React (Vite) ]  --HTTP/JSON-->  [ Express ]  --sync-->  [ better-sqlite3 ]
       |                              |                        |
   polling 3-5s                  routes / services /      data.sqlite
   UserSwitcher                  auctionEngine (pure)
   Countdown
```

The auction extension logic is a single pure function (`server/src/services/auctionEngine.js`) that runs inside a SQLite transaction on every bid POST. SQLite serializes writes, so concurrent bid submissions are processed correctly without explicit locking. Auction status is computed on read from `now()` against the close timestamps — no background scheduler.

## Database schema

Four tables: `users`, `rfqs`, `bids`, `activity_log`. See `server/src/db.js` for the full DDL, or the design spec in `docs/superpowers/specs/`.

## Auction behavior

- Each RFQ has **one** trigger type chosen at creation:
  - `BID_RECEIVED` — any bid in the trigger window extends the auction.
  - `ANY_RANK_CHANGE` — any change in supplier ordering extends the auction.
  - `L1_RANK_CHANGE` — only a change in the lowest bidder extends the auction.
- A new bid by a supplier must be **strictly lower** than that supplier's previous bid.
- Bids are ranked by `freight + origin + destination`.
- Extensions are capped at the forced bid close time. Extensions never shrink the auction.

## Tests

```bash
npm test
```

Covers:
- Pure rankings and status modules.
- All three extension trigger types under in-window and out-of-window conditions.
- Extension capping at forced close.
- End-to-end happy path: create RFQ → three suppliers bid → assert ranks, extension, activity log.

## Out of scope

Real auth, notifications, file attachments, multi-tenant org isolation, production hardening (strict CORS, rate limiting). The full design spec lists what's intentionally deferred.

## Project layout

```
server/   # Express + SQLite. Pure auction logic in services/.
client/   # React + Vite + Tailwind.
docs/     # Design spec and this implementation plan.
```
```

- [ ] **Step 2: Run full test suite once more**

Run: `npm test`
Expected: 19 tests pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: write full README with HLD, run instructions, behavior notes"
```

---

## Self-review against the spec

**Spec coverage:**
- §5.1 RFQ creation form fields → Task 18.
- §5.2 Quote submission fields → Task 19 (BidForm).
- §6.1 Trigger window X → schema (Task 3), engine (Task 8), UI (Task 18).
- §6.2 Extension Y → same.
- §6.3 a/b/c trigger types → engine tests cover all three (Task 8).
- §7 validation rules (forced > close; extension never beyond forced) → engine cap test + validators.
- §8 listing page fields → Task 17.
- §8 details page fields → Task 19.
- §8 activity log → Tasks 9, 12, 19.
- §9 deliverables: HLD/diagram → README (Task 20). Schema → README + db.js. Backend → Tasks 2–13. Frontend → Tasks 14–19.

No gaps detected.

**Placeholder scan:** No "TBD", "TODO", "implement later", "similar to", or unspecified-test references anywhere in this plan.

**Type consistency:** `evaluateBid` shape declared in Task 8 is consumed identically in Task 12 (route handler) — `status`, `newBid`, `shouldExtend`, `newCloseAt`, `extensionReason`, `capped` all referenced consistently. `rfqRowToApi` field names match the API response shapes used in Tasks 11, 12, 17, 19.

No issues to fix.
