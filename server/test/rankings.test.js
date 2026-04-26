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
    { supplierId: 3, totalPrice: 90,  createdAt: '2026-04-26T10:00:30Z' },
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
