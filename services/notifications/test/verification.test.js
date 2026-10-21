import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verificationStore } from '../src/verification.js';

function fixture(legacy = null) {
  let clock = 1000000, sequence = 123450;
  const rows = new Map();
  const q = async (sql, args) => {
    let row, applied;
    if (sql.includes('SELECT')) {
      row = sql.includes('verification_sessions') ? rows.get(args.join(':')) : legacy;
      return { first: () => row ? structuredClone(row) : null };
    }
    const insert = sql.startsWith('INSERT');
    const [document, version, owner, workspace] = insert ? args : args.slice(1);
    const key = `${owner}:${workspace}`;
    row = rows.get(key);
    applied = insert ? !row : row?.version === args[5];
    if (applied) rows.set(key, { document, version });
    return { wasApplied: () => applied };
  };
  return {
    store: verificationStore(q, () => clock, () => String(sequence++)),
    advance: ms => { clock += ms; },
    rows,
  };
}
const owner = 'account-a', workspace = 'personal', email = 'a@example.test';
test('resend preserves earlier unexpired codes, including formatted paste and retry after success', async () => {
  const f = fixture();
  const first = await f.store.issue(owner, workspace, email);
  f.advance(61000);
  const second = await f.store.issue(owner, workspace, email);
  await f.store.confirm(owner, workspace, email, `${first.code.slice(0, 3)} ${first.code.slice(3)}`);
  await f.store.confirm(owner, workspace, email, first.code);
  await f.store.confirm(owner, workspace, email, second.code);
  f.advance(540000);
  await assert.rejects(f.store.confirm(owner, workspace, email, first.code), /does not match/);
  await f.store.confirm(owner, workspace, email, second.code);
});
test('wrong codes, changed recipients, workspaces and accounts never verify', async () => {
  const f = fixture();
  const challenge = await f.store.issue(owner, workspace, email);
  await assert.rejects(f.store.confirm(owner, workspace, email, '000000'), /does not match/);
  await assert.rejects(f.store.confirm(owner, workspace, 'b@example.test', challenge.code), /address changed/);
  await assert.rejects(f.store.confirm(owner, 'business', email, challenge.code));
  await assert.rejects(f.store.confirm('other', workspace, email, challenge.code));
  await f.store.confirm(owner, workspace, email, challenge.code);
  f.advance(600001);
  await assert.rejects(f.store.confirm(owner, workspace, email, challenge.code), /expired/);
});
test('concurrent resends reserve one cooldown and concurrent wrong attempts retain the limit', async () => {
  const f = fixture();
  const issued = await Promise.allSettled([f.store.issue(owner, workspace, email), f.store.issue(owner, workspace, email)]);
  assert.equal(issued.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(issued.find(r => r.status === 'rejected').reason.statusCode, 429);
  await Promise.allSettled(Array.from({ length: 3 }, () => f.store.confirm(owner, workspace, email, '000000')));
  await assert.rejects(f.store.confirm(owner, workspace, email, '000000'));
  await assert.rejects(f.store.confirm(owner, workspace, email, '000000'));
  const data = JSON.parse(f.rows.get(`${owner}:${workspace}`).document);
  assert.equal(data.attempts, 5);
  f.advance(61000);
  await assert.rejects(f.store.issue(owner, workspace, email), /Too many/);
});
test('failed resend removes only its own hash, not a previous delivered code', async () => {
  const f = fixture();
  const first = await f.store.issue(owner, workspace, email);
  f.advance(61000);
  const second = await f.store.issue(owner, workspace, email);
  await f.store.cancel(owner, workspace, second.hash);
  await f.store.confirm(owner, workspace, email, first.code);
  await assert.rejects(f.store.confirm(owner, workspace, email, second.code));
});
test('codes issued by the previous deployment remain valid until their original expiry', async () => {
  const code = '654321';
  const f = fixture({ email, code_hash: createHash('sha256').update(`${owner}:${code}`).digest('hex'), attempts: 1, expires: new Date(1100000) });
  await f.store.confirm(owner, workspace, email, code);
});

test('incomplete or expired legacy rows cannot block a fresh verification or verify an old code', async () => {
  const code_hash = createHash('sha256').update(`${owner}:654321`).digest('hex');
  for (const legacy of [
    { attempts: 1, expires: null },
    { email, code_hash },
    { email, code_hash, expires: new Date(NaN) },
    { email, code_hash, expires: new Date(999999) },
    { email, code_hash: null, expires: new Date(1100000) },
    { email: null, code_hash, expires: new Date(1100000) },
  ]) {
    const f = fixture(legacy);
    await assert.rejects(f.store.confirm(owner, workspace, email, '654321'), { statusCode: 400 });
    const challenge = await f.store.issue(owner, workspace, email);
    await f.store.confirm(owner, workspace, email, challenge.code);
    await f.store.confirm(owner, workspace, email, challenge.code);
  }
});
