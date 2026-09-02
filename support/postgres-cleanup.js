export async function guardedHistoryCleanup(pool, siteId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL app.archiving = 'on'");
    await client.query('DELETE FROM outbox_events WHERE site_id=$1', [siteId]);
    await client.query('DELETE FROM event_history_archive WHERE site_id=$1', [siteId]);
    await client.query('DELETE FROM audit_events WHERE site_id=$1', [siteId]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
