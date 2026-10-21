import Decimal from 'decimal.js';

export type EntryKind = 'expense' | 'income' | 'transfer';
export type Transaction = {
  id: string;
  kind: EntryKind;
  merchant: string;
  amount: string;
  date: string;
  account: string;
  destination?: string;
  category: string;
  note: string;
  reviewed: boolean;
};
export type Commitment = {
  id: string;
  name: string;
  amount: string;
  due: string;
  category: string;
  kind: 'bill' | 'subscription';
  cadence: 'Once' | 'Monthly' | 'Yearly';
  state: 'open' | 'paid' | 'canceled';
  paidTransactionId?: string;
  seriesId?: string;
  billingDay?: number;
};
export type Budget = { category: string; amount: string };
export type Workspace = {
  id: string;
  name: string;
  type: 'personal' | 'business';
  currency: 'INR';
  transactions: Transaction[];
  commitments: Commitment[];
  budgets: Budget[];
  opening: Record<string, string>;
};
export const categories = [
  'Groceries',
  'Dining',
  'Transport',
  'Shopping',
  'Utilities',
  'Software',
  'Health',
  'Travel',
  'Income',
  'Transfer',
  'Other',
];
export const accounts = ['Main account', 'Credit card', 'Cash'];
export function today() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function offsetDate(days: number) {
  const d = new Date(`${today()}T12:00:00`);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const currencyFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 2,
});
export const money = (value: Decimal.Value) =>
  currencyFormatter.format(new Decimal(value).toNumber());

// One pass for all dashboard/category/account totals; Decimal preserves cents.
export function financialSummary(workspace: Workspace, month: string, day = today()) {
  let spend = new Decimal(0);
  const categories = new Map<string, Decimal>();
  const balances = new Map(
    Object.entries(workspace.opening).map(([account, amount]) => [account, new Decimal(amount)]),
  );
  for (const t of workspace.transactions) {
    if (t.kind === 'expense' && t.date.startsWith(month)) {
      spend = spend.plus(t.amount);
      categories.set(t.category, (categories.get(t.category) || new Decimal(0)).plus(t.amount));
    }
    if (t.date > day) continue;
    if (balances.has(t.account))
      balances.set(
        t.account,
        t.kind === 'income'
          ? balances.get(t.account)!.plus(t.amount)
          : balances.get(t.account)!.minus(t.amount),
      );
    if (t.kind === 'transfer' && t.destination && balances.has(t.destination))
      balances.set(t.destination, balances.get(t.destination)!.plus(t.amount));
  }
  return {
    spend,
    categories,
    balances,
    liquid: sumAmounts([...balances.values()].map((value) => value.toString())),
  };
}
export function validateAmount(value: string) {
  return (
    /^\d+(\.\d{1,2})?$/.test(value) &&
    new Decimal(value).gt(0) &&
    new Decimal(value).lte('999999999.99')
  );
}
export function sumAmounts(values: string[]) {
  return values.reduce((sum, value) => sum.plus(value), new Decimal(0));
}
export function spendFor(workspace: Workspace, category?: string, month = today().slice(0, 7)) {
  return sumAmounts(
    workspace.transactions
      .filter(
        (t) =>
          t.kind === 'expense' &&
          t.date.startsWith(month) &&
          (!category || t.category === category),
      )
      .map((t) => t.amount),
  );
}
export function accountBalance(workspace: Workspace, account: string) {
  return workspace.transactions
    .filter((t) => t.date <= today())
    .reduce(
      (balance, t) => {
        if (t.account === account)
          balance = t.kind === 'income' ? balance.plus(t.amount) : balance.minus(t.amount);
        if (t.kind === 'transfer' && t.destination === account) balance = balance.plus(t.amount);
        return balance;
      },
      new Decimal(workspace.opening[account] || '0'),
    );
}
export function markPaid(
  workspace: Workspace,
  id: string,
  payment: { account: string; date: string; advance: boolean } = {
    account: 'Main account',
    date: today(),
    advance: false,
  },
): Workspace {
  const item = workspace.commitments.find((c) => c.id === id);
  if (!item || item.state !== 'open') return workspace;
  const tx: Transaction = {
    id: `payment-${id}`,
    kind: 'expense',
    merchant: item.name,
    amount: item.amount,
    date: payment.date,
    account: payment.account,
    category: item.category,
    note: `Payment recorded for ${item.kind}. No funds moved by Ledgerline.`,
    reviewed: true,
  };
  return {
    ...workspace,
    transactions: [tx, ...workspace.transactions],
    commitments: [
      ...workspace.commitments.map((c) =>
        c.id === id ? { ...c, state: 'paid' as const, paidTransactionId: tx.id } : c,
      ),
      ...(payment.advance &&
      item.cadence !== 'Once' &&
      !workspace.commitments.some(
        (c) => (c.seriesId || c.id) === (item.seriesId || item.id) && c.due === nextCycle(item).due,
      )
        ? [nextCycle(item)]
        : []),
    ],
  };
}
export function nextCycle(item: Commitment): Commitment {
  const original = new Date(`${item.due}T12:00:00`);
  const billingDay =
    Number.isInteger(item.billingDay) && item.billingDay! >= 1 && item.billingDay! <= 31
      ? item.billingDay!
      : original.getDate();
  const target = new Date(original);
  target.setDate(1);
  if (item.cadence === 'Yearly') target.setFullYear(target.getFullYear() + 1);
  else target.setMonth(target.getMonth() + 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(billingDay, last));
  const { paidTransactionId: _paid, ...rest } = item;
  return {
    ...rest,
    id: crypto.randomUUID(),
    seriesId: item.seriesId || item.id,
    billingDay,
    state: 'open',
    due: `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`,
  };
}
export function seedWorkspace(id: string, type: 'personal' | 'business'): Workspace {
  const business = type === 'business';
  const entries: [string, string, string, number, string][] = business
    ? [
        ['Figma Professional', '2400', 'Software', -1, 'Credit card'],
        ['Team lunch', '1850', 'Dining', -2, 'Main account'],
        ['AWS cloud services', '6200', 'Software', -3, 'Credit card'],
        ['Office supplies', '1450', 'Shopping', -4, 'Main account'],
        ['Client payment', '85000', 'Income', -6, 'Main account'],
      ]
    : [
        ['Freshmart', '1240.50', 'Groceries', -1, 'Main account'],
        ['Blue Tokai Coffee', '340', 'Dining', -1, 'Cash'],
        ['Uber', '285', 'Transport', -2, 'Main account'],
        ['Amazon', '2199', 'Shopping', -3, 'Credit card'],
        ['Salary', '65000', 'Income', -5, 'Main account'],
        ['Apollo Pharmacy', '680', 'Health', -4, 'Main account'],
        ['Weekly groceries', '1860', 'Groceries', -7, 'Main account'],
      ];
  return {
    id,
    name: business ? 'Studio workspace' : 'Personal workspace',
    type,
    currency: 'INR',
    opening: { 'Main account': business ? '120000' : '32450', 'Credit card': '0', Cash: '2500' },
    transactions: entries.map(([merchant, amount, category, days, account], i) => ({
      id: `${id}-tx-${i}`,
      kind: category === 'Income' ? 'income' : 'expense',
      merchant,
      amount,
      date: offsetDate(days),
      account,
      category,
      note: 'Sample record in your isolated demo workspace.',
      reviewed: i % 3 !== 0,
    })),
    commitments: [
      {
        id: `${id}-bill-1`,
        name: business ? 'Office rent' : 'Apartment rent',
        amount: business ? '25000' : '18000',
        due: offsetDate(3),
        category: 'Utilities',
        kind: 'bill',
        cadence: 'Monthly',
        state: 'open',
      },
      {
        id: `${id}-sub-1`,
        name: business ? 'Figma Professional' : 'Spotify Premium',
        amount: business ? '2400' : '119',
        due: offsetDate(1),
        category: 'Software',
        kind: 'subscription',
        cadence: 'Monthly',
        state: 'open',
      },
      {
        id: `${id}-bill-2`,
        name: 'Electricity',
        amount: '1650',
        due: offsetDate(6),
        category: 'Utilities',
        kind: 'bill',
        cadence: 'Once',
        state: 'open',
      },
      {
        id: `${id}-sub-2`,
        name: business ? 'Google Workspace' : 'YouTube Premium',
        amount: business ? '1360' : '149',
        due: offsetDate(12),
        category: 'Software',
        kind: 'subscription',
        cadence: 'Monthly',
        state: 'open',
      },
    ],
    budgets: business
      ? [
          { category: 'Software', amount: '15000' },
          { category: 'Dining', amount: '5000' },
          { category: 'Shopping', amount: '6000' },
          { category: 'Travel', amount: '10000' },
        ]
      : [
          { category: 'Groceries', amount: '8000' },
          { category: 'Dining', amount: '4000' },
          { category: 'Transport', amount: '3000' },
          { category: 'Shopping', amount: '6000' },
          { category: 'Health', amount: '3000' },
          { category: 'Software', amount: '1000' },
        ],
  };
}
