export function makeBidRepo(db) {
  const insertStmt = db.prepare(`
    INSERT INTO bids (
      rfq_id, supplier_id, carrier_name,
      freight_charges, origin_charges, destination_charges, total_price,
      transit_time_days, quote_validity_days, created_at
    ) VALUES (
      @rfqId, @supplierId, @carrierName,
      @freightCharges, @originCharges, @destinationCharges, @totalPrice,
      @transitTimeDays, @quoteValidityDays, @createdAt
    )
  `);

  const latestPerSupplierStmt = db.prepare(`
    SELECT b.*
    FROM bids b
    INNER JOIN (
      SELECT supplier_id, MAX(created_at) AS max_created
      FROM bids
      WHERE rfq_id = ?
      GROUP BY supplier_id
    ) m ON m.supplier_id = b.supplier_id AND m.max_created = b.created_at
    WHERE b.rfq_id = ?
  `);

  const latestForSupplierStmt = db.prepare(`
    SELECT * FROM bids
    WHERE rfq_id = ? AND supplier_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `);

  return {
    insert(data) {
      const info = insertStmt.run(data);
      return info.lastInsertRowid;
    },
    latestPerSupplier(rfqId) {
      return latestPerSupplierStmt.all(rfqId, rfqId).map(rowToBid);
    },
    latestForSupplier(rfqId, supplierId) {
      const row = latestForSupplierStmt.get(rfqId, supplierId);
      return row ? rowToBid(row) : null;
    }
  };
}

export function rowToBid(row) {
  return {
    id: row.id,
    rfqId: row.rfq_id,
    supplierId: row.supplier_id,
    carrierName: row.carrier_name,
    freightCharges: row.freight_charges,
    originCharges: row.origin_charges,
    destinationCharges: row.destination_charges,
    totalPrice: row.total_price,
    transitTimeDays: row.transit_time_days,
    quoteValidityDays: row.quote_validity_days,
    createdAt: row.created_at
  };
}
