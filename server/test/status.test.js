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
