import { describe, expect, it } from 'vitest';
import { notificationResponse } from './notificationResponse';

describe('notification proxy responses', () => {
  it('turns the reported Envoy timeout into an actionable message', async () => {
    await expect(
      notificationResponse(new Response('upstream request timeout', { status: 504 })),
    ).rejects.toThrow('Check your inbox before requesting another code');
  });
  it('preserves validation messages and successful JSON', async () => {
    await expect(
      notificationResponse(
        Response.json(
          { message: 'Wait one minute before requesting another code.' },
          { status: 429 },
        ),
      ),
    ).rejects.toThrow('Wait one minute');
    await expect(notificationResponse(Response.json({ sent: true }))).resolves.toEqual({
      sent: true,
    });
  });
  it('does not expose non-JSON proxy bodies or accept an invalid successful response', async () => {
    await expect(
      notificationResponse(new Response('internal upstream details', { status: 502 })),
    ).rejects.toThrow('reconnecting');
    await expect(notificationResponse(new Response('<html>proxy page</html>'))).rejects.toThrow(
      'incomplete response',
    );
  });
});
