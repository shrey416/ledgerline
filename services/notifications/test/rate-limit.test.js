import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';

test('verification throttling runs after auth and does not share limits between accounts behind a gateway', async () => {
  const app = Fastify();
  await app.register(rateLimit, { global: false, hook: 'preHandler', keyGenerator: request => request.owner || request.ip });
  app.post('/verify', {
    preHandler: async request => { request.owner = request.headers.authorization; },
    config: { rateLimit: { max: 1, timeWindow: '1 hour' } },
  }, async () => ({ sent: true }));
  try {
    assert.equal((await app.inject({ method: 'POST', url: '/verify', headers: { authorization: 'account-a' } })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/verify', headers: { authorization: 'account-a' } })).statusCode, 429);
    assert.equal((await app.inject({ method: 'POST', url: '/verify', headers: { authorization: 'account-b' } })).statusCode, 200);
  } finally { await app.close(); }
});
