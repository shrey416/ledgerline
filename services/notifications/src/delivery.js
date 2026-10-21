import rateLimit from '@fastify/rate-limit';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import nodemailer from 'nodemailer';
import { randomUUID } from 'node:crypto';
import client from 'prom-client';
import { defaults, preferences, commitments, deliveryAt, jobId, message } from './reminders.js';
import { verificationStore } from './verification.js';

export async function installNotifications(server, db) {
  const jwtKeys = createRemoteJWKSet(
    new URL(
      process.env.OIDC_JWKS ||
        'http://keycloak:8080/realms/ledgerline/protocol/openid-connect/certs',
    ),
  );
  const local = process.env.SMTP_LOCAL_ONLY !== 'false';
  const host = process.env.SMTP_HOST || 'mailpit';
  if (local && !['mailpit', 'localhost', '127.0.0.1', '::1'].includes(host))
    throw new Error(
      'Local-only email must use Mailpit or a loopback SMTP capture. Explicitly disable SMTP_LOCAL_ONLY for live delivery.',
    );
  const smtp = nodemailer.createTransport({
    // Reuse authenticated TLS connections instead of repeating Gmail handshakes.
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
    host,
    port: Number(process.env.SMTP_PORT || 1025),
    secure: process.env.SMTP_SECURE === 'true',
    requireTLS: !local || process.env.SMTP_REQUIRE_TLS === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  const sent = new client.Counter({
    name: 'ledgerline_notification_delivery_total',
    help: 'Reminder delivery attempts',
    labelNames: ['outcome'],
  });
  const transportUp = new client.Gauge({
    name: 'ledgerline_notification_email_transport_up',
    help: 'Last SMTP connection/authentication check succeeded; does not confirm inbox delivery',
  });
  const smtpDuration = new client.Histogram({
    name: 'ledgerline_notification_smtp_duration_seconds',
    help: 'SMTP provider acceptance time, including failed attempts',
    labelNames: ['outcome'],
    buckets: [0.5, 1, 2, 5, 10, 20, 40, 60],
  });
  let transportReady = false;
  const checkTransport = async () => {
    try {
      await smtp.verify();
      transportReady = true;
      transportUp.set(1);
    } catch {
      transportReady = false;
      transportUp.set(0);
    }
  };
  void checkTransport();
  const transportTimer = setInterval(() => void checkTransport(), 600000);
  transportTimer.unref();
  const running = new client.Gauge({
    name: 'ledgerline_notification_worker_up',
    help: 'Durable reminder scheduler initialized',
  });
  await server.register(rateLimit, { global: false, hook: 'preHandler', keyGenerator: (req) => req.owner || req.ip });
  const q = (sql, args = []) => db.execute(sql, args, { prepare: true });
  const verification = verificationStore(q);
  let initialized = false,
    closing = false,
    busy = false;
  const key = (req) => [req.owner, req.params.workspace];
  const auth = async (req, reply) => {
    try {
      if (!/^Bearer /.test(req.headers.authorization || '')) throw new Error();
      const { payload } = await jwtVerify(req.headers.authorization.slice(7), jwtKeys, {
        issuer: process.env.OIDC_ISSUER || 'http://localhost:8180/realms/ledgerline',
        audience: 'ledgerline',
        algorithms: ['RS256'],
      });
      if (typeof payload.sub !== 'string') throw new Error();
      req.owner = payload.sub;
    } catch (error) {
      if (error.code === 'ERR_JWKS_TIMEOUT' || error instanceof TypeError)
        return reply
          .code(503)
          .send({ message: 'Account verification is temporarily unavailable. Retry shortly.' });
      return reply.code(401).send({ message: 'Sign in to manage your reminders.' });
    }
    // Each notification workspace is a private, user-owned projection of account data.
    // No shared business tenant access is inferred from these demo workspace names.
    if (!['personal', 'business'].includes(req.params.workspace))
      return reply.code(400).send({ message: 'Unknown workspace.' });
    if (!initialized)
      return reply
        .code(503)
        .send({ message: 'Notification storage is starting. Try again shortly.' });
  };
  const read = async (owner, workspace) => {
    const row = (
      await q(
        'SELECT document, version FROM notifications.preferences WHERE owner=? AND workspace=?',
        [owner, workspace],
      )
    ).first();
    return row
      ? { data: JSON.parse(row.document), version: row.version }
      : { data: { preferences: { ...defaults }, verifiedEmail: '', items: [] }, version: null };
  };
  const save = async (owner, workspace, state) => {
    const queueDays = {};
    if (state.data.preferences.enabled && state.data.verifiedEmail === state.data.preferences.email)
      for (const item of state.data.items) {
        const id = jobId(owner, workspace, item, state.data.preferences);
        queueDays[id] =
          state.data.queueDays?.[id] ||
          new Date(
            Math.max(
              Date.now(),
              deliveryAt(
                item.due,
                state.data.preferences.leadDays,
                state.data.preferences.timezone,
              ).getTime(),
            ),
          )
            .toISOString()
            .slice(0, 10);
      }
    state.data.queueDays = queueDays;
    const args = [JSON.stringify(state.data), randomUUID(), owner, workspace];
    const result = state.version
      ? await q(
          'UPDATE notifications.preferences SET document=?,version=? WHERE owner=? AND workspace=? IF version=?',
          [...args, state.version],
        )
      : await q(
          'INSERT INTO notifications.preferences(document,version,owner,workspace) VALUES(?,?,?,?) IF NOT EXISTS',
          args,
        );
    if (!result.wasApplied()) {
      const e = new Error('Preferences changed in another session. Refresh and retry.');
      e.statusCode = 409;
      throw e;
    }
  };
  const enqueue = async (owner, workspace, state) => {
    const prefs = state.preferences;
    if (!prefs.enabled || state.verifiedEmail !== prefs.email) return;
    for (const item of state.items.filter((i) => i.state === 'open')) {
      const at = deliveryAt(item.due, prefs.leadDays, prefs.timezone);
      // Skip already-overdue cycles. Due-today reminders catch up immediately.
      if (Date.parse(item.due + 'T23:59:59Z') < Date.now()) continue;
      const schedule = new Date(Math.max(Date.now(), at.getTime()));
      const id = jobId(owner, workspace, item, prefs),
        day = state.queueDays[id],
        shard = parseInt(id[0], 16) % 4;
      // Annual subscriptions must not expire from the queue before their due date.
      const ttl = Math.min(
        315360000,
        7776000 + Math.max(0, Math.ceil((schedule.getTime() - Date.now()) / 1000)),
      );
      const inserted = await q(
        'INSERT INTO notifications.jobs(day,shard,id,owner,workspace,item,due_at,state,attempts) VALUES(?,?,?,?,?,?,?,?,?) IF NOT EXISTS USING TTL ?',
        [day, shard, id, owner, workspace, JSON.stringify(item), schedule, 'pending', 0, ttl],
      );
      // Existing active/sent jobs need no second Paxos transaction on every sync.
      if (!inserted.wasApplied() && inserted.first()?.state === 'canceled')
        await q(
          'UPDATE notifications.jobs SET state=?,attempts=?,lease_until=? WHERE day=? AND shard=? AND id=? IF state=?',
          ['pending', 0, null, day, shard, id, 'canceled'],
        );
    }
  };
  const send = async (email, content, id) => {
    const started = performance.now();
    try {
      const result = await smtp.sendMail({
      from: process.env.SMTP_FROM || 'Ledgerline <reminders@ledgerline.local>',
      to: email,
      ...content,
      ...(id ? { messageId: `<${id}@ledgerline.local>` } : {}),
    });
    if (!result.accepted?.length || result.rejected?.length)
      throw new Error('Recipient was rejected by the email provider.');
      smtpDuration.observe({ outcome: 'accepted' }, (performance.now() - started) / 1000);
      transportReady = true;
      transportUp.set(1);
      return result;
    } catch (error) {
      smtpDuration.observe({ outcome: 'failed' }, (performance.now() - started) / 1000);
      // Do not log recipients, message content, codes, credentials or SMTP response text.
      server.log.warn({ service: 'notifications', smtp_code: error.code || 'REJECTED', smtp_command: error.command || 'send' }, 'SMTP provider did not accept message');
      throw error;
    }
  };
  const prefix = '/api/v1/notifications/workspaces/:workspace';
  const options = { preHandler: auth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  server.get(prefix, options, async (req) => {
    const state = await read(...key(req));
    const rows = await q(
      'SELECT id,document,is_read FROM notifications.inbox WHERE owner=? AND workspace=? LIMIT 100',
      key(req),
    );
    return {
      transportReady,
      preferences: state.data.preferences,
      verified:
        state.data.verifiedEmail === state.data.preferences.email && !!state.data.verifiedEmail,
      emailMode: local ? 'local-inbox' : 'smtp',
      syncedCount: state.data.items.length,
      inbox: rows.rows
        .map((r) => ({ ...JSON.parse(r.document), id: r.id, read: r.is_read }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  });
  server.put(prefix + '/preferences', options, async (req) => {
    let prefs;
    try {
      prefs = preferences(req.body);
    } catch (e) {
      e.statusCode = 400;
      throw e;
    }
    const state = await read(...key(req));
    if (JSON.stringify(state.data.preferences) === JSON.stringify(prefs)) {
      await enqueue(...key(req), state.data);
      return { saved: true, verified: state.data.verifiedEmail === prefs.email };
    }
    state.data.preferences = prefs;
    await save(...key(req), state);
    await enqueue(...key(req), state.data);
    return { saved: true, verified: state.data.verifiedEmail === prefs.email };
  });
  server.put(prefix + '/commitments', options, async (req) => {
    let items;
    try {
      items = commitments(req.body?.items);
    } catch (e) {
      e.statusCode = 400;
      throw e;
    }
    const state = await read(...key(req));
    if (JSON.stringify(state.data.items) === JSON.stringify(items)) {
      await enqueue(...key(req), state.data);
      return { synced: items.length };
    }
    state.data.items = items;
    await save(...key(req), state);
    await enqueue(...key(req), state.data);
    return { synced: items.length };
  });
  server.post(
    prefix + '/verification',
    { ...options, config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const state = await read(...key(req));
      const email = state.data.preferences.email;
      if (!email) return reply.code(400).send({ message: 'Save your recipient address first.' });
      let challenge;
      try { challenge = await verification.issue(...key(req), email); }
      catch (error) {
        if (error.retryAfter) reply.header('Retry-After', String(error.retryAfter));
        throw error;
      }
      try {
        await send(email, {
          subject: 'Verify your Ledgerline reminder email',
          text: `Your Ledgerline verification code is ${challenge.code}.\nWorkspace: ${req.params.workspace}. Recipient: ${email}.\nExpires in 10 minutes. The most recent three codes for this recipient remain valid until their own expiry. If you did not request this, ignore it.`,
        });
      } catch {
        await verification.cancel(...key(req), challenge.hash);
        sent.inc({ outcome: 'verification_failed' });
        return reply
          .code(503)
          .send({
            message:
              'The email provider could not accept your verification message. Check the recipient address and SMTP settings, then retry.',
          });
      }
      sent.inc({ outcome: 'verification_sent' });
      return { sent: true };
    },
  );
  server.post(prefix + '/verification/confirm', options, async (req, reply) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const state = await read(...key(req));
      const email = state.data.preferences.email;
      if (req.body?.email !== undefined && req.body.email !== email)
        return reply.code(400).send({ message: 'The recipient address changed. Save it and request a code for that address.' });
      await verification.confirm(...key(req), email, req.body?.code);
      if (state.data.verifiedEmail !== email) {
        state.data.verifiedEmail = email;
        try { await save(...key(req), state); }
        catch (error) {
          if (error.statusCode === 409 && attempt < 3) continue;
          throw error;
        }
      }
      await enqueue(...key(req), state.data);
      return { verified: true };
    }
  });
  server.post(
    prefix + '/test',
    { ...options, config: { rateLimit: { max: 3, timeWindow: '1 hour' } } },
    async (req, reply) => {
      const { data } = await read(...key(req));
      if (!data.preferences.email || data.verifiedEmail !== data.preferences.email)
        return reply.code(409).send({ message: 'Verify your email before sending a test.' });
      try {
        await send(data.preferences.email, {
          subject: 'Ledgerline reminders are connected',
          text: 'Your email delivery is working. Scheduled reminders follow your saved lead time and timezone. No financial account is charged.',
        });
        return { sent: true };
      } catch {
        return reply
          .code(503)
          .send({ message: 'Email delivery failed. Check your SMTP settings.' });
      }
    },
  );
  server.patch(prefix + '/inbox/:id', options, async (req, reply) => {
    if (!/^[a-f0-9]{64}$/.test(req.params.id))
      return reply.code(400).send({ message: 'Invalid notification.' });
    const result = await q(
      'UPDATE notifications.inbox SET is_read=true WHERE owner=? AND workspace=? AND id=? IF EXISTS',
      [...key(req), req.params.id],
    );
    return { updated: result.wasApplied() };
  });
  let catchUpAt = 0;
  const tick = async () => {
    if (!initialized || busy || closing) return;
    busy = true;
    try {
      // Check today frequently; scan seven older partitions at startup and every five minutes.
      // An idle account no longer causes 32 partition reads every 15 seconds.
      const catchUp = Date.now() >= catchUpAt;
      for (let age = 0; age < (catchUp ? 8 : 1); age++)
        for (let shard = 0; shard < 4; shard++) {
          const day = new Date(Date.now() - age * 86400000).toISOString().slice(0, 10);
          const rows = await q(
            'SELECT * FROM notifications.jobs WHERE day=? AND shard=? LIMIT 1000',
            [day, shard],
          );
          let processed = 0;
          for (const job of rows.rows) {
            if (processed >= 50) break;
            if (
              job.due_at.getTime() > Date.now() ||
              !['pending', 'sending'].includes(job.state) ||
              (job.lease_until && job.lease_until.getTime() > Date.now())
            )
              continue;
            processed++;
            const where = [job.day, job.shard, job.id];
            const claim = await q(
              'UPDATE notifications.jobs SET state=?,lease_until=?,attempts=? WHERE day=? AND shard=? AND id=? IF state=? AND attempts=?',
              [
                'sending',
                new Date(Date.now() + 120000),
                (job.attempts || 0) + 1,
                ...where,
                job.state,
                job.attempts || 0,
              ],
            );
            if (!claim.wasApplied()) continue;
            const { data } = await read(job.owner, job.workspace);
            const current = data.items.find((i) => i.id === JSON.parse(job.item).id);
            if (
              !current ||
              current.state !== 'open' ||
              jobId(job.owner, job.workspace, current, data.preferences) !== job.id ||
              !data.preferences.enabled ||
              !data.preferences.email ||
              data.preferences.email !== data.verifiedEmail ||
              Date.parse(current.due + 'T23:59:59Z') < Date.now()
            ) {
              await q('UPDATE notifications.jobs SET state=? WHERE day=? AND shard=? AND id=?', [
                'canceled',
                ...where,
              ]);
              continue;
            }
            const content = message(current, job.workspace),
              createdAt = new Date().toISOString();
            // A global cycle claim also deduplicates jobs moved to a new catch-up day.
            await q(
              'INSERT INTO notifications.delivery_claims(id,state,lease_until) VALUES(?,?,?) IF NOT EXISTS USING TTL 7776000',
              [job.id, 'pending', new Date(0)],
            );
            const receipt = (
              await q('SELECT state,lease_until FROM notifications.delivery_claims WHERE id=?', [
                job.id,
              ])
            ).first();
            if (receipt.state === 'sent') {
              await q('UPDATE notifications.jobs SET state=? WHERE day=? AND shard=? AND id=?', [
                'sent',
                ...where,
              ]);
              continue;
            }
            if (receipt.lease_until && receipt.lease_until.getTime() > Date.now()) continue;
            const globalClaim = await q(
              'UPDATE notifications.delivery_claims SET state=?,lease_until=? WHERE id=? IF state=? AND lease_until=?',
              [
                'sending',
                new Date(Date.now() + 120000),
                job.id,
                receipt.state,
                receipt.lease_until,
              ],
            );
            if (!globalClaim.wasApplied()) continue;
            const inbox = { ...content, createdAt, delivery: 'pending', commitmentId: current.id };
            await q(
              'INSERT INTO notifications.inbox(owner,workspace,id,document,is_read) VALUES(?,?,?,?,?) USING TTL 7776000',
              [job.owner, job.workspace, job.id, JSON.stringify(inbox), false],
            );
            try {
              await send(data.preferences.email, content, job.id);
              await q('UPDATE notifications.delivery_claims SET state=? WHERE id=?', [
                'sent',
                job.id,
              ]);
              await q('UPDATE notifications.jobs SET state=? WHERE day=? AND shard=? AND id=?', [
                'sent',
                ...where,
              ]);
              inbox.delivery = 'sent';
              sent.inc({ outcome: 'sent' });
            } catch {
              await q('UPDATE notifications.delivery_claims SET state=?,lease_until=? WHERE id=?', [
                'pending',
                new Date(0),
                job.id,
              ]);
              const final = (job.attempts || 0) >= 4;
              inbox.delivery = final ? 'failed' : 'retrying';
              sent.inc({ outcome: inbox.delivery });
              await q(
                'UPDATE notifications.jobs SET state=?,lease_until=? WHERE day=? AND shard=? AND id=?',
                [
                  final ? 'failed' : 'pending',
                  new Date(Date.now() + Math.min(3600000, 30000 * 2 ** (job.attempts || 0))),
                  ...where,
                ],
              );
              server.log.warn(
                { service: 'notifications', job_id: job.id },
                'Reminder transport failed; durable retry recorded',
              );
            }
            await q(
              'UPDATE notifications.inbox USING TTL 7776000 SET document=? WHERE owner=? AND workspace=? AND id=?',
              [JSON.stringify(inbox), job.owner, job.workspace, job.id],
            );
          }
        }
      if (catchUp) catchUpAt = Date.now() + 300000;
    } catch {
      server.log.warn(
        { service: 'notifications' },
        'Reminder scheduler will retry after storage failure',
      );
    } finally {
      busy = false;
    }
  };
  const init = async () => {
    if (initialized || closing) return;
    try {
      await db.execute(
        "CREATE KEYSPACE IF NOT EXISTS notifications WITH replication = {'class':'NetworkTopologyStrategy','datacenter1':1}",
      );
      for (const sql of [
        'CREATE TABLE IF NOT EXISTS notifications.preferences(owner text,workspace text,document text,version text,PRIMARY KEY(owner,workspace))',
        'CREATE TABLE IF NOT EXISTS notifications.verification(owner text,workspace text,email text,code_hash text,attempts int,expires timestamp,PRIMARY KEY(owner,workspace))',
        'CREATE TABLE IF NOT EXISTS notifications.verification_sessions(owner text,workspace text,document text,version text,PRIMARY KEY(owner,workspace))',
        'CREATE TABLE IF NOT EXISTS notifications.jobs(day text,shard int,id text,owner text,workspace text,item text,due_at timestamp,state text,attempts int,lease_until timestamp,PRIMARY KEY((day,shard),id))',
        'CREATE TABLE IF NOT EXISTS notifications.delivery_claims(id text,state text,lease_until timestamp,PRIMARY KEY(id))',
        'CREATE TABLE IF NOT EXISTS notifications.inbox(owner text,workspace text,id text,document text,is_read boolean,PRIMARY KEY((owner,workspace),id))',
      ])
        await db.execute(sql);
      initialized = true;
      running.set(1);
      server.log.info({ service: 'notifications' }, 'Reminder storage and worker ready');
    } catch {
      server.log.warn({ service: 'notifications' }, 'Waiting for Cassandra notification schema');
    }
  };
  void init();
  const timer = setInterval(() => {
    void init().then(tick);
  }, 15000);
  timer.unref();
  server.addHook('onClose', async () => {
    closing = true;
    clearInterval(timer);
    while (busy) await new Promise((resolve) => setTimeout(resolve, 50));
    clearInterval(transportTimer);
    smtp.close();
  });
  return { ready: () => initialized };
}
