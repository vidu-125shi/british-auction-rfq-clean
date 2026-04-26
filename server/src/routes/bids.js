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
