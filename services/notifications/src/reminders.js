import { createHash } from 'node:crypto';

export const defaults = { email: '', enabled: false, leadDays: 3, timezone: 'Asia/Kolkata' };
export function preferences(value) {
  if (value && typeof value.email === 'string')
    value = { ...value, email: value.email.trim().toLowerCase() };
  if (
    !value ||
    typeof value.enabled !== 'boolean' ||
    !Number.isInteger(value.leadDays) ||
    value.leadDays < 0 ||
    value.leadDays > 30 ||
    typeof value.email !== 'string' ||
    value.email.length > 254 ||
    (value.email && !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value.email))
  )
    throw new Error('Provide a valid email, reminder window (0–30 days), and timezone.');
  if (typeof value.timezone !== 'string' || !value.timezone || value.timezone.length > 64)
    throw new Error('Choose a valid IANA timezone.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.timezone }).format();
  } catch {
    throw new Error('Choose a valid IANA timezone.');
  }
  return {
    email: value.email.trim().toLowerCase(),
    enabled: value.enabled,
    leadDays: value.leadDays,
    timezone: value.timezone,
  };
}
export function commitments(value) {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Sync at most 100 commitments.');
  const seen = new Set();
  return value.map((c) => {
    if (
      !c ||
      typeof c.id !== 'string' ||
      !/^[\w-]{1,100}$/.test(c.id) ||
      seen.has(c.id) ||
      typeof c.name !== 'string' ||
      !c.name.trim() ||
      c.name.length > 120 ||
      !['bill', 'subscription'].includes(c.kind) ||
      !['open', 'paid', 'canceled'].includes(c.state) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(c.due) ||
      Number.isNaN(Date.parse(c.due)) ||
      new Date(c.due).toISOString().slice(0, 10) !== c.due ||
      !/^\d{1,9}(\.\d{1,2})?$/.test(c.amount) ||
      Number(c.amount) <= 0
    )
      throw new Error('Invalid commitment.');
    seen.add(c.id);
    return {
      id: c.id,
      name: c.name.trim(),
      kind: c.kind,
      state: c.state,
      amount: c.amount,
      due: c.due,
    };
  });
}
// Delivery at 09:00 in the chosen zone. Iterate zone offset to handle DST.
const zoneFormatters = new Map();
export function deliveryAt(due, leadDays, timezone) {
  const target = new Date(`${due}T09:00:00Z`).getTime() - leadDays * 86400000;
  let formatter = zoneFormatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
    // Bound the cache even when accounts choose many different valid zones.
    if (zoneFormatters.size >= 64) zoneFormatters.delete(zoneFormatters.keys().next().value);
    zoneFormatters.set(timezone, formatter);
  }
  let result = target;
  for (let i = 0; i < 3; i++) {
    const parts = Object.fromEntries(
      formatter
        .formatToParts(result)
        .filter((p) => p.type !== 'literal')
        .map((p) => [p.type, p.value]),
    );
    const wall = Date.UTC(
      +parts.year,
      +parts.month - 1,
      +parts.day,
      +parts.hour,
      +parts.minute,
      +parts.second,
    );
    result += target - wall;
  }
  return new Date(result);
}
export function jobId(owner, workspace, item, prefs) {
  return createHash('sha256')
    .update(JSON.stringify([owner, workspace, item.id, item.due, prefs.leadDays, prefs.timezone]))
    .digest('hex');
}
export function message(item, workspace) {
  return {
    subject: `${item.kind === 'bill' ? 'Bill due' : 'Subscription renewal'}: ${item.name}`,
    text: `${item.name}\nINR ${item.amount} · due ${item.due}\nWorkspace: ${workspace}\n\nThis is a reminder only. Ledgerline will not charge your account or pay this bill.\nManage reminders or turn off email in Ledgerline → Notifications.`,
  };
}
