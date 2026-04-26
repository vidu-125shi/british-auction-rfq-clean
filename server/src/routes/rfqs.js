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
