import { expect, it } from 'vitest';
import { accountBalance, financialSummary, seedWorkspace, spendFor, sumAmounts } from './domain';

it('single-pass summaries preserve exact category and account totals including transfers and future entries', () => {
  const workspace = seedWorkspace('personal', 'personal');
  workspace.transactions.push(
    {
      id: 'transfer',
      kind: 'transfer',
      merchant: 'Transfer',
      amount: '12.34',
      date: '2020-01-01',
      account: 'Cash',
      destination: 'Main account',
      category: 'Transfer',
      note: '',
      reviewed: true,
    },
    {
      id: 'future',
      kind: 'expense',
      merchant: 'Future',
      amount: '100.01',
      date: '2099-01-01',
      account: 'Cash',
      category: 'Other',
      note: '',
      reviewed: true,
    },
  );
  const month = workspace.transactions[0].date.slice(0, 7);
  const summary = financialSummary(workspace, month);
  expect(summary.spend.toString()).toBe(spendFor(workspace, undefined, month).toString());
  for (const category of new Set(workspace.transactions.map((t) => t.category)))
    expect(summary.categories.get(category)?.toString() || '0').toBe(
      spendFor(workspace, category, month).toString(),
    );
  for (const account of Object.keys(workspace.opening))
    expect(summary.balances.get(account)!.toString()).toBe(
      accountBalance(workspace, account).toString(),
    );
  expect(summary.liquid.toString()).toBe(
    sumAmounts(
      Object.keys(workspace.opening).map((account) =>
        accountBalance(workspace, account).toString(),
      ),
    ).toString(),
  );
});
