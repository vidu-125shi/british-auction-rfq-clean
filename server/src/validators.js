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
