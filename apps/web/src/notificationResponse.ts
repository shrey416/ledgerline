/** Gateways can return plain text. Never show upstream bodies or JSON parser errors. */
export async function notificationResponse(response: Response) {
  const text = await response.text();
  let value: Record<string, unknown> | undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
      value = parsed as Record<string, unknown>;
  } catch {
    /* Use a stable product message for proxy failures. */
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Your session expired. Sign in again.');
    if (response.status === 504 || response.status === 408)
      throw new Error(
        'Email delivery is taking longer than expected. Check your inbox before requesting another code; wait one minute, then retry.',
      );
    if (response.status === 502 || response.status === 503)
      throw new Error(
        typeof value?.message === 'string'
          ? value.message
          : 'The notification service is reconnecting. Your entries are saved. Retry shortly.',
      );
    throw new Error(
      typeof value?.message === 'string'
        ? value.message
        : 'The notification request could not complete. Retry shortly.',
    );
  }
  if (!value)
    throw new Error(
      'The notification service returned an incomplete response. Refresh and try again.',
    );
  return value;
}
