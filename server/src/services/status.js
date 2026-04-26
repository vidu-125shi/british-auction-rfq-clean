export function deriveStatus(rfq, nowIso) {
  if (nowIso < rfq.bidStartAt) return 'Scheduled';
  if (nowIso < rfq.bidCloseCurrentAt) return 'Active';
  if (rfq.bidCloseCurrentAt >= rfq.forcedBidCloseAt) return 'ForceClosed';
  return 'Closed';
}
