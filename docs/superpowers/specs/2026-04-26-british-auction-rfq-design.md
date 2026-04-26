# British Auction RFQ — Design Spec

**Date:** 2026-04-26
**Source:** `~/Downloads/british_auction_rfq.md` (assignment brief)
**Scope target:** Take-home assignment quality. Single-process Node + Express + React + SQLite. Mock users via dropdown (no real auth). HTTP polling for live updates. Optimized for clarity and easy local review.

---

## 1. Decisions taken during brainstorming

| # | Decision | Why |
|---|----------|-----|
| 1 | Take-home quality over production realism | The interesting work is the auction logic; infra ceremony distracts from that. |
| 2 | Each RFQ uses **exactly one** extension trigger (radio, not checkboxes) | Matches spec wording; cleaner semantics in activity log ("extended because L1 changed"). |
| 3 | Bid validity rule: **strict underbid against the supplier's own previous bid**; ranking by **total price** = freight + origin + destination | Matches "suppliers continuously lower their prices" and keeps multiple suppliers in the race. |
| 4 | Plain JavaScript (no TypeScript) | Per user preference. |
| 5 | Repo layout: monorepo with separate `/server` + `/client` | Conventional for full-stack take-homes; easy for reviewers to navigate. |
| 6 | Auction tick: **synchronous, on bid submission**. Status computed lazily on read. No background scheduler. | Correct under SQLite's serialized writes; zero race conditions in single Node process; activity log naturally captures every state change. |

---

## 2. Architecture

```
british-auction-rfq/
├── server/                  # Node + Express, port 4000
│   ├── package.json
│   ├── src/
│   │   ├── index.js         # express app entry
│   │   ├── db.js            # better-sqlite3 connection + migrations
│   │   ├── seed.js          # seeds 2 buyers + 4 suppliers
│   │   ├── routes/
│   │   │   ├── users.js
│   │   │   ├── rfqs.js
│   │   │   └── bids.js
│   │   ├── services/
│   │   │   ├── auctionEngine.js   # pure function: trigger + extension logic
│   │   │   └── rankings.js        # latest-per-supplier → L1..Ln
│   │   └── validators.js
│   └── data.sqlite          # gitignored
├── client/                  # React + Vite, port 5173
│   ├── package.json
│   ├── vite.config.js       # proxy /api -> :4000
│   └── src/
│       ├── main.jsx
│       ├── App.jsx          # router + layout
│       ├── pages/
│       │   ├── ListingPage.jsx
│       │   ├── DetailsPage.jsx
│       │   └── CreateRfqPage.jsx
│       ├── components/
│       │   ├── UserSwitcher.jsx     # mock-auth dropdown
│       │   ├── BidForm.jsx
│       │   ├── BidsTable.jsx
│       │   ├── ActivityLog.jsx
│       │   └── Countdown.jsx
│       └── api.js
├── docs/superpowers/specs/2026-04-26-british-auction-rfq-design.md
├── package.json             # root: concurrently + scripts
└── README.md
```

### HLD diagram

```
[ React (Vite) ]  --HTTP/JSON-->  [ Express ]  --sync calls-->  [ better-sqlite3 ]
       |                              |                              |
   polling 3-5s                  routes / services /             data.sqlite
   UserSwitcher                  auctionEngine (pure)
   Countdown
```

### Mock-auth model

`UserSwitcher` writes the selected user id to `localStorage`. Client sends it on every request as `X-User-Id`. Server trusts the header (it is a demo). Buyer-only routes (create RFQ) and supplier-only routes (submit bid) check the role on the user record.

### Data flow (happy path)

1. Buyer opens Create RFQ form → `POST /api/rfqs` → row inserted with `bid_close_current_at = bid_close_initial_at`.
2. Listing page polls `GET /api/rfqs` every 5s → server computes the `status` field on each row from `now()`.
3. Supplier opens Details → polls `GET /api/rfqs/:id` every 3s → bids table, rankings, activity log, and countdown all update.
4. Supplier submits bid → `POST /api/rfqs/:id/bids` → server runs the auction engine in one SQLite transaction (validate → insert bid → recompute rankings → check trigger → maybe extend close → write activity-log rows) → returns the full updated RFQ payload.

---

## 3. Database schema

SQLite via `better-sqlite3`. All tables created via a single migration run at boot.

```sql
CREATE TABLE users (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  name  TEXT NOT NULL,
  role  TEXT NOT NULL CHECK (role IN ('buyer', 'supplier'))
);

CREATE TABLE rfqs (
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

CREATE TABLE bids (
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
CREATE INDEX idx_bids_rfq_supplier_created ON bids(rfq_id, supplier_id, created_at DESC);

CREATE TABLE activity_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  rfq_id      INTEGER NOT NULL REFERENCES rfqs(id),
  event_type  TEXT NOT NULL,    -- 'BID_SUBMITTED' | 'EXTENSION' | 'EXTENSION_CAPPED' | 'AUCTION_OPENED' | 'AUCTION_CLOSED'
  message     TEXT NOT NULL,
  metadata    TEXT,             -- JSON string
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_activity_log_rfq_created ON activity_log(rfq_id, created_at DESC);
```

### Modeling notes

- **Status is derived, never stored.** Computed from `now()` vs `bid_close_current_at` and `forced_bid_close_at`. Prevents stale-status bugs.
- **Bids are immutable history.** A supplier's "current bid" = their most recent row for an RFQ. The strict-underbid validation reads the previous row before inserting.
- **`total_price` is denormalized** so ranking is a simple `ORDER BY total_price ASC`.
- **`activity_log.metadata`** is a JSON string (no JSON1 dependency).
- All datetimes are ISO strings in UTC; client formats to local timezone.

### Status derivation

```
if now < bid_start_at                                  → "Scheduled"
else if now < bid_close_current_at                     → "Active"
else if bid_close_current_at >= forced_bid_close_at    → "ForceClosed"
else                                                   → "Closed"
```

---

## 4. API surface

All endpoints live under `/api`. JSON in/out. Auth = `X-User-Id` header. Errors return `{ error: { code, message } }` with HTTP 400/403/404/409.

### Users

```
GET /api/users
→ [ { id, name, role }, ... ]
```

### RFQs

```
GET /api/rfqs
→ [
    {
      id, referenceId, name,
      bidCloseCurrentAt, forcedBidCloseAt,
      status,                         // Scheduled | Active | Closed | ForceClosed
      lowestBid: { supplierName, totalPrice } | null
    },
    ...
  ]

POST /api/rfqs              (buyer only)
body: {
  referenceId, name, pickupDate,
  bidStartAt, bidCloseAt, forcedBidCloseAt,
  triggerType, triggerWindowMinutes, extensionMinutes
}
→ 201 (same shape as GET /api/rfqs/:id)

validation:
- referenceId unique, non-empty
- bidStartAt < bidCloseAt < forcedBidCloseAt
- triggerWindowMinutes > 0, extensionMinutes > 0
- pickupDate >= date(bidCloseAt)

GET /api/rfqs/:id
→ {
    id, referenceId, name, pickupDate,
    bidStartAt, bidCloseInitialAt, bidCloseCurrentAt, forcedBidCloseAt,
    triggerType, triggerWindowMinutes, extensionMinutes,
    status,
    createdBy: { id, name },
    bids: [
      {
        rank, supplier: { id, name },
        carrierName, freightCharges, originCharges, destinationCharges,
        totalPrice, transitTimeDays, quoteValidityDays, submittedAt
      }, ...
    ],
    activityLog: [
      { id, eventType, message, metadata, createdAt }, ...
    ]
  }
```

### Bids

```
POST /api/rfqs/:id/bids     (supplier only)
body: {
  carrierName,
  freightCharges, originCharges, destinationCharges,
  transitTimeDays, quoteValidityDays
}
→ 201 (same shape as GET /api/rfqs/:id — full updated RFQ)

errors:
  409 AUCTION_NOT_ACTIVE   — outside [bidStartAt, bidCloseCurrentAt]
  409 NOT_STRICTLY_LOWER   — total_price >= supplier's previous total_price
  400 INVALID_CHARGES      — negative or non-numeric
  403 NOT_SUPPLIER
```

POST returns the full updated RFQ so the client refreshes bids and activity log atomically (no follow-up GET race, no flicker).

### Out of scope

- No PATCH/DELETE on RFQs or bids (auctions are append-only).
- No WebSockets. Frontend polls.
- No pagination. Demo data volume.

---

## 5. UI pages

Three pages, one shared shell. React Router for navigation. Tailwind for styling.

### Shell — `App.jsx`

- Header: app title, `UserSwitcher` (dropdown of seeded users with role badge), nav links.
- Routes: `/` ListingPage; `/rfqs/new` CreateRfqPage (link hidden when current user is not buyer); `/rfqs/:id` DetailsPage.
- `useCurrentUser()` hook reads `localStorage`; switching the dropdown rerenders.

### ListingPage — `/`

Polls `GET /api/rfqs` every 5s. Table columns: Reference, Name, Status, Lowest Bid (with supplier), Closes, Forced Close.

- Status pill colors: Scheduled gray, Active green, Closed slate, ForceClosed red.
- "Closes" column shows live countdown for Active rows (a `<Countdown>` ticking every second client-side off `bidCloseCurrentAt`); shows formatted time for non-Active rows.
- Row click → `/rfqs/:id`.
- Top-right "+ New RFQ" button visible only to buyers.

### CreateRfqPage — `/rfqs/new`

Single form, three grouped sections:

1. **RFQ details:** Reference ID, Name, Pickup Date.
2. **Auction window:** Bid Start (datetime-local), Bid Close, Forced Bid Close. Inline validation: red text below the field as soon as ordering rules break.
3. **Auction config:** Trigger Type (radio with one-line descriptions of each), Trigger Window X (minutes), Extension Duration Y (minutes).

Submit disabled until valid. On 201, redirect to `/rfqs/:id`.

### DetailsPage — `/rfqs/:id`

Polls `GET /api/rfqs/:id` every 3s.

```
┌─────────────────────────────────────────────────────────────┐
│ RFQ-2026-001 · Mumbai → Delhi reefer        [Status: Active]│
│ Pickup: 2026-04-30 · Forced Close: 2026-04-26 18:30         │
│ ⏱  Closes in 04:12  (current close: 18:00)                  │
│ Trigger: L1 rank change · Window: 10 min · Extension: 5 min │
└─────────────────────────────────────────────────────────────┘

┌────── Bids (sorted by total) ──────┐  ┌─── Activity log ───┐
│ L1  SupCo     Acme    70k  ...     │  │ 17:59 EXTENSION    │
│ L2  FastShip  Speedy  72k  ...     │  │ 17:58 BID_SUBMITTED│
│ L3  TruckIt   BlueArr 75k  ...     │  │ 17:45 BID_SUBMITTED│
└─────────────────────────────────────┘  └────────────────────┘

┌── Submit a bid (supplier only) ───┐
│ [Carrier] [Freight] [Origin] ...  │
│ Live total: ₹___       [ Submit ] │
└───────────────────────────────────┘
```

- **Header card** — RFQ metadata + live countdown to `bidCloseCurrentAt` (changes mid-poll if extension fires).
- **Bids table** — left column. L1/L2/L3… badge, supplier, carrier, three charge columns, total (bold), transit time, quote validity, submitted-at (relative). Highlights the row of the current user's own latest bid.
- **Activity log** — right column, newest first, scrollable. Each entry: timestamp, event-type pill, human message. Extension entries expand to show `metadata` (old/new close time, triggering bid id).
- **BidForm** — rendered only when current user role is `supplier` AND status is Active. "Live total" computed from charges as the user types. On submit, optimistic disable + spinner; success replaces the polled RFQ payload (instant update). On 409 NOT_STRICTLY_LOWER, inline error: "Your previous bid was ₹X — new bid must be lower."

### Polling lifecycle

`usePolledRfq(id, 3000)` hook:
- Pauses when status is Closed or ForceClosed (no further changes possible).
- Pauses when tab is hidden (`document.visibilityState`).
- Resumes on focus.

### Empty/edge states

- No bids yet → bids table shows "No bids yet — be the first to quote."
- Auction not yet started → countdown shows "Starts in HH:MM:SS"; BidForm hidden.
- Auction closed → BidForm hidden; banner: "Auction closed at HH:MM. Final L1: SupplierName at ₹X."

---

## 6. Concurrency model

Single Node process. `better-sqlite3` is fully synchronous and SQLite serializes writes. The bid-submission path runs inside `db.transaction(...)`:

```
BEGIN
  read rfq row (status check via now() vs bid_close_current_at)
  read supplier's latest bid in this rfq
  validate strict-underbid
  insert new bid row
  read all latest-per-supplier bids (for ranking + L1 trigger)
  determine if extension triggers fire
  if trigger AND auction is in window:
    new_close = min(now + extension_minutes, forced_bid_close_at)
    update rfqs.bid_close_current_at
    insert activity_log (EXTENSION or EXTENSION_CAPPED)
  insert activity_log (BID_SUBMITTED)
COMMIT
```

Two simultaneous bid POSTs serialize at the SQLite write lock, so trigger evaluation always sees a consistent latest-bid set. No external locking needed.

### Auction engine — pure function

`auctionEngine.evaluateBid({ rfq, prevLatestBidsBySupplier, newBid, now })` returns:

```js
{
  rankingsBefore, rankingsAfter,
  l1ChangedFrom, l1ChangedTo,
  withinTriggerWindow,
  shouldExtend, extensionReason,
  newCloseAt, capped
}
```

Pure (no DB calls; takes `now` as an arg). The route handler executes the resulting plan inside the transaction. This makes trigger logic trivially testable at any simulated moment.

---

## 7. Testing

Two layers, demo-grade:

1. **`auctionEngine` unit tests with `node:test`:**
   - Strict underbid rejection.
   - Each trigger type fires (and only fires) under its condition.
   - Extension capped at forced close.
   - Bid outside `[bidStartAt, bidCloseCurrentAt]` rejected.
   - L1-change detection when a supplier's lower bid jumps over the previous L1.

2. **One end-to-end happy-path test with `supertest`** against the Express app using `:memory:` SQLite: create RFQ → 3 suppliers bid → assert rankings, extension fired, activity log shape.

No frontend tests. Reviewers run the UI manually.

---

## 8. Run story

Root `package.json` scripts:

```json
{
  "scripts": {
    "install:all": "npm install && npm install --prefix server && npm install --prefix client",
    "seed": "node server/src/seed.js",
    "dev": "concurrently -n server,client -c blue,green \"npm run dev --prefix server\" \"npm run dev --prefix client\"",
    "test": "npm test --prefix server"
  }
}
```

Reviewer runs:

```bash
npm run install:all
npm run seed       # one-time mock users
npm run dev        # API on :4000, Vite on :5173
```

Vite proxies `/api/*` to `:4000`. Open `http://localhost:5173`. README documents the seeded users so the reviewer can switch personas.

---

## 9. Out of scope (YAGNI)

- Real auth, password hashing, sessions
- Email/notifications when an auction extends or closes
- File attachments on RFQs
- Audit trail beyond the activity log (no soft-delete, no `updated_at`)
- Multi-tenant / org isolation
- Production hardening: strict CORS, rate limiting, helmet (kept minimal; mentioned in README)

---

## 10. Deliverables checklist (assignment)

- [x] Simple HLD with architecture diagram — section 2
- [x] Schema design for database tables — section 3
- [ ] Backend code — to be implemented
- [ ] Frontend code — to be implemented
