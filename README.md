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
- Extension formula: `newClose = min(currentClose + Y, forcedClose)`. Extensions are capped at the forced bid close time.

## Tests

```bash
npm test
```

Covers:
- Pure rankings and status modules.
- All three extension trigger types under in-window and out-of-window conditions.
- Extension capping at forced close.
- End-to-end happy path: create RFQ → three suppliers bid → assert ranks, extension, activity log, role enforcement.

## Out of scope

Real auth, notifications, file attachments, multi-tenant org isolation, production hardening (strict CORS, rate limiting). The full design spec lists what's intentionally deferred.

## Project layout

```
server/   # Express + SQLite. Pure auction logic in services/.
client/   # React + Vite + Tailwind.
docs/     # Design spec and implementation plan.
```
