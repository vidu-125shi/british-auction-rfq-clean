export function makeActivityRepo(db) {
  const insertStmt = db.prepare(`
    INSERT INTO activity_log (rfq_id, event_type, message, metadata, created_at)
    VALUES (@rfqId, @eventType, @message, @metadata, @createdAt)
  `);
  const listStmt = db.prepare(`
    SELECT * FROM activity_log WHERE rfq_id = ? ORDER BY created_at DESC, id DESC
  `);
  return {
    insert(data) {
      insertStmt.run({ ...data, metadata: data.metadata ? JSON.stringify(data.metadata) : null });
    },
    list(rfqId) {
      return listStmt.all(rfqId).map(r => ({
        id: r.id,
        eventType: r.event_type,
        message: r.message,
        metadata: r.metadata ? JSON.parse(r.metadata) : null,
        createdAt: r.created_at
      }));
    }
  };
}
