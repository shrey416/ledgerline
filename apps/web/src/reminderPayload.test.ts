import { describe, expect, it } from 'vitest';
import { codeDigits, reminderPayload } from './reminderPayload';
import { seedWorkspace } from './domain';

describe('recipient verification and reminder sync', () => {
  it('accepts pasted separators and fullwidth digits before limiting to six digits', () => {
    expect(codeDigits('１２３ ４５６')).toBe('123456');
    expect(codeDigits('123-456\n')).toBe('123456');
    expect(codeDigits('001234')).toBe('001234');
  });
  it('does not resync reminders when unrelated finance data changes', () => {
    const workspace = seedWorkspace('personal', 'personal');
    const before = reminderPayload(workspace);
    expect(reminderPayload({ ...workspace, transactions: [], budgets: [] })).toBe(before);
    expect(
      reminderPayload({
        ...workspace,
        commitments: workspace.commitments.map((item) => ({ ...item, state: 'paid' })),
      }),
    ).not.toBe(before);
  });
});
