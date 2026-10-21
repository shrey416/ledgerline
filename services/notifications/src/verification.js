import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

const lifetime = 600000;
const fail = (statusCode, message, retryAfter) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (retryAfter) error.retryAfter = retryAfter;
  return error;
};
export function normalizeCode(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(/[\s\u200b-\u200d\ufeff-]/g, '');
}
const digest = (owner, workspace, email, code) =>
  createHash('sha256').update(JSON.stringify([owner, workspace, email, code])).digest('hex');
const equal = (a, b) => /^[a-f0-9]{64}$/.test(a || '') && timingSafeEqual(Buffer.from(a), Buffer.from(b));

// One bounded, expiring partition per account/workspace. CAS protects cooldowns,
// attempt counts and concurrent resends across multiple service replicas.
export function verificationStore(q, now = Date.now, generate = () => String(randomInt(100000, 1000000))) {
  const read = async (owner, workspace) => {
    const row = (await q('SELECT document,version FROM notifications.verification_sessions WHERE owner=? AND workspace=?', [owner, workspace])).first();
    if (row) return { data: JSON.parse(row.document), version: row.version };
    // Preserve an unexpired code issued immediately before this deployment.
    const legacy = (await q('SELECT * FROM notifications.verification WHERE owner=? AND workspace=?', [owner, workspace])).first();
    const data = { email: '', challenges: [], attempts: 0, sentAt: 0 };
    // Cassandra can retain a row after its expiring cells disappear, or after
    // an older UPDATE wrote only attempts. Such a row is not a challenge.
    const expires = legacy?.expires instanceof Date ? legacy.expires.getTime() : NaN;
    if (Number.isFinite(expires) && expires > now() &&
        typeof legacy.email === 'string' && legacy.email.length > 0 &&
        /^[a-f0-9]{64}$/.test(legacy.code_hash || '')) {
      data.email = legacy.email;
      data.attempts = legacy.attempts || 0;
      data.sentAt = expires - lifetime;
      data.challenges.push({ hash: legacy.code_hash, expires, legacy: true });
    }
    return { data, version: null };
  };
  const write = async (owner, workspace, state) => {
    const ttl = Math.max(1, Math.ceil((Math.max(...state.data.challenges.map(c => c.expires), now() + 60000) - now()) / 1000));
    const args = [JSON.stringify(state.data), randomUUID(), owner, workspace];
    const result = state.version
      ? await q('UPDATE notifications.verification_sessions USING TTL ? SET document=?,version=? WHERE owner=? AND workspace=? IF version=?', [ttl, ...args, state.version])
      : await q('INSERT INTO notifications.verification_sessions(document,version,owner,workspace) VALUES(?,?,?,?) IF NOT EXISTS USING TTL ?', [...args, ttl]);
    return result.wasApplied();
  };
  const mutate = async (owner, workspace, change) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = await read(owner, workspace);
      const result = change(state.data);
      if (await write(owner, workspace, state)) return result;
    }
    throw fail(409, 'Verification changed in another session. Retry your code.');
  };
  return {
    async issue(owner, workspace, email) {
      const code = generate();
      const hash = digest(owner, workspace, email, code);
      await mutate(owner, workspace, data => {
        const active = data.email === email ? data.challenges.filter(c => c.expires > now()) : [];
        if (active.length && data.sentAt + 60000 > now())
          throw fail(429, 'Wait one minute before requesting another code.', Math.ceil((data.sentAt + 60000 - now()) / 1000));
        if (active.length && data.attempts >= 5)
          throw fail(429, 'Too many incorrect attempts. Wait for the current codes to expire before requesting another.', Math.ceil((Math.max(...active.map(c => c.expires)) - now()) / 1000));
        data.attempts = active.length ? data.attempts : 0;
        data.email = email;
        data.sentAt = now();
        data.challenges = [...active, { hash, expires: now() + lifetime }].slice(-3);
      });
      return { code, hash };
    },
    async cancel(owner, workspace, hash) {
      await mutate(owner, workspace, data => {
        data.challenges = data.challenges.filter(c => c.hash !== hash);
        if (!data.challenges.length) data.sentAt = 0;
      });
    },
    async confirm(owner, workspace, email, value) {
      const code = normalizeCode(value);
      if (!/^\d{6}$/.test(code)) throw fail(400, 'Enter all six digits of your verification code.');
      const result = await mutate(owner, workspace, data => {
        if (data.email !== email) throw fail(400, 'The recipient address changed. Send a code to the saved address.');
        const active = data.challenges.filter(c => c.expires > now());
        if (!active.length) throw fail(400, 'Your verification code has expired. Request a new code.');
        if (data.attempts >= 5) throw fail(429, 'Too many incorrect attempts. Wait for the codes to expire, then request a new code.');
        const hash = digest(owner, workspace, email, code);
        const legacyHash = createHash('sha256').update(`${owner}:${code}`).digest('hex');
        const valid = active.some(c => equal(c.hash, c.legacy ? legacyHash : hash));
        // A correct code does not spend an attempt. Keep its hash until expiry so
        // retries after a lost HTTP response can finish without a false rejection.
        if (!valid) data.attempts++;
        return valid;
      });
      if (!result) throw fail(400, 'That code does not match this workspace and recipient. Check the email address and six digits.');
      return true;
    },
  };
}
