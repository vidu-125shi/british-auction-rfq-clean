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
    nowIso: '2026-04-26T17:55:00Z'
  });
  assert.equal(r.status, 'OK');
  assert.equal(r.shouldExtend, true);
  assert.equal(r.newCloseAt, '2026-04-26T18:05:00.000Z');
  assert.equal(r.capped, false);
});

test('BID_RECEIVED trigger: bid outside window does not extend', () => {
  const rfq = { ...baseRfq, triggerType: 'BID_RECEIVED' };
  const r = evaluateBid({
    rfq,
    prevLatestBidBySupplier: null,
    latestBidsBySupplier: [],
    newBidPlanned: newBidPlanned(3, 100),
    nowIso: '2026-04-26T17:30:00Z'
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
