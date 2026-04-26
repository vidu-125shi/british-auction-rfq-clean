export function makeRfqRepo(db) {
  const insertStmt = db.prepare(`
    INSERT INTO rfqs (
      reference_id, name, pickup_date,
      bid_start_at, bid_close_initial_at, bid_close_current_at, forced_bid_close_at,
      trigger_type, trigger_window_minutes, extension_minutes,
      created_by
    ) VALUES (
      @referenceId, @name, @pickupDate,
      @bidStartAt, @bidCloseAt, @bidCloseAt, @forcedBidCloseAt,
      @triggerType, @triggerWindowMinutes, @extensionMinutes,
      @createdBy
    )
  `);
  const getByIdStmt = db.prepare(`SELECT * FROM rfqs WHERE id = ?`);
  const listStmt    = db.prepare(`SELECT * FROM rfqs ORDER BY id DESC`);
  const updateCloseStmt = db.prepare(`UPDATE rfqs SET bid_close_current_at = ? WHERE id = ?`);

  return {
    create(data) {
      const info = insertStmt.run(data);
      return getByIdStmt.get(info.lastInsertRowid);
    },
    getById(id) {
      return getByIdStmt.get(id);
    },
    list() {
      return listStmt.all();
    },
    updateCurrentClose(id, isoTime) {
      updateCloseStmt.run(isoTime, id);
    }
  };
}

export function rfqRowToApi(row) {
  if (!row) return null;
  return {
    id: row.id,
    referenceId: row.reference_id,
    name: row.name,
    pickupDate: row.pickup_date,
    bidStartAt: row.bid_start_at,
    bidCloseInitialAt: row.bid_close_initial_at,
    bidCloseCurrentAt: row.bid_close_current_at,
    forcedBidCloseAt: row.forced_bid_close_at,
    triggerType: row.trigger_type,
    triggerWindowMinutes: row.trigger_window_minutes,
    extensionMinutes: row.extension_minutes,
    createdBy: row.created_by,
    createdAt: row.created_at
  };
}
