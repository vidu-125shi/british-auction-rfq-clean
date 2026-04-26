import { computeRankings, l1Of } from './rankings.js';

const MS_PER_MIN = 60 * 1000;

export function evaluateBid({ rfq, prevLatestBidBySupplier, latestBidsBySupplier, newBidPlanned, nowIso }) {
  // 1. Active-window check
  if (toMs(nowIso) < toMs(rfq.bidStartAt) || toMs(nowIso) >= toMs(rfq.bidCloseCurrentAt)) {
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
  const triggerStartMs = toMs(rfq.bidCloseCurrentAt) - rfq.triggerWindowMinutes * MS_PER_MIN;
  const withinTriggerWindow =
    toMs(nowIso) >= triggerStartMs && toMs(nowIso) < toMs(rfq.bidCloseCurrentAt);

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
    // Extension adds Y minutes to the current close time (not to "now"),
    // matching the spec example: bid at 5:55 with close at 6:00 and Y=5 → 6:05.
    const candidateMs = toMs(rfq.bidCloseCurrentAt) + rfq.extensionMinutes * MS_PER_MIN;
    if (candidateMs >= toMs(rfq.forcedBidCloseAt)) {
      newCloseAt = new Date(toMs(rfq.forcedBidCloseAt)).toISOString();
      capped = true;
    } else {
      newCloseAt = new Date(candidateMs).toISOString();
    }
    // Don't shrink the auction (compare via ms, not strings)
    if (toMs(newCloseAt) < toMs(rfq.bidCloseCurrentAt)) {
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

function toMs(iso) {
  return new Date(iso).getTime();
}
