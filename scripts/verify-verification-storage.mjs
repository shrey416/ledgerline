// Run inside the notifications image: node --input-type=module < this file.
// Synthetic partitions only; no email is sent and all fixture rows are removed.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import cassandra from 'cassandra-driver';
import { verificationStore } from '/app/src/verification.js';

const db = new cassandra.Client({
  contactPoints: (process.env.CASSANDRA_HOSTS || 'cassandra').split(','),
  localDataCenter: process.env.CASSANDRA_DC || 'datacenter1',
});
const owner = `verification-regression-${randomUUID()}`;
const workspace = 'personal';
const q = (sql, args = []) => db.execute(sql, args, { prepare: true });
try {
  // An UPDATE creates a live Cassandra row with all other columns null.
  await q('UPDATE notifications.verification SET attempts=? WHERE owner=? AND workspace=?', [1, owner, workspace]);
  const row = (await q('SELECT expires FROM notifications.verification WHERE owner=? AND workspace=?', [owner, workspace])).first();
  assert.equal(row.expires, null);
  const store = verificationStore(q);
  const { code } = await store.issue(owner, workspace, 'storage@example.test');
  await store.confirm(owner, workspace, 'storage@example.test', code);
  await store.confirm(owner, workspace, 'storage@example.test', code);
  console.log('PASS: real Cassandra null-expiry legacy row permits fresh issue, confirmation and retry.');
} finally {
  try {
    for (const table of ['verification', 'verification_sessions']) {
      await q(`DELETE FROM notifications.${table} WHERE owner=? AND workspace=?`, [owner, workspace]);
    }
  } finally { await db.shutdown(); }
}
