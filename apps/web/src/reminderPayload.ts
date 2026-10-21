import type { Workspace } from './domain';

// Only fields owned by the reminder service belong in its sync projection.
export function reminderPayload(workspace: Workspace) {
  return JSON.stringify({
    items: workspace.commitments
      .filter((item) => item.state === 'open')
      .map(({ id, name, amount, due, kind, state }) => ({ id, name, amount, due, kind, state })),
  });
}

export function codeDigits(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\s\u200b-\u200d\ufeff-]/g, '')
    .replace(/[^0-9]/g, '')
    .slice(0, 6);
}
