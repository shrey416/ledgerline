import { describe, it, expect } from 'vitest';
import { accountBalance, markPaid, nextCycle, seedWorkspace, spendFor, today, validateAmount } from './domain';
describe('finance tracking semantics', () => {
  it('retains the monthly billing day across February',()=>{
    const item={...seedWorkspace('test','personal').commitments[0],due:'2026-01-31',cadence:'Monthly' as const};
    const february=nextCycle(item);
    expect(february.due).toBe('2026-02-28');
    expect(nextCycle(february).due).toBe('2026-03-31');
  });
  it('restores leap-day yearly billing when the next leap year arrives',()=>{
    const item={...seedWorkspace('test','personal').commitments[0],due:'2024-02-29',cadence:'Yearly' as const};
    let next=nextCycle(item);
    expect(next.due).toBe('2025-02-28');
    for(let year=2026;year<=2028;year++)next=nextCycle(next);
    expect(next.due).toBe('2028-02-29');
  });
  it('validates exact supported money input', () => {
    expect(validateAmount('10.25')).toBe(true);
    for (const value of ['0', '-5', '1.234', 'NaN', '1e3', '9999999999'])
      expect(validateAmount(value)).toBe(false);
  });
  it('excludes transfer principal from spending and moves both balances', () => {
    const w = seedWorkspace('test', 'personal');
    w.transactions = [];
    w.transactions.push({
      id: 'a',
      kind: 'transfer',
      merchant: 'Transfer',
      amount: '123.45',
      date: today(),
      account: 'Main account',
      destination: 'Cash',
      category: 'Transfer',
      note: '',
      reviewed: true,
    });
    expect(spendFor(w).toString()).toBe('0');
    expect(accountBalance(w, 'Main account').toString()).toBe('32326.55');
    expect(accountBalance(w, 'Cash').toString()).toBe('2623.45');
  });
  it('records a bill payment once without counting predicted spend', () => {
    const w = seedWorkspace('test', 'personal');
    const before = spendFor(w);
    const next = markPaid(w, w.commitments[0].id);
    expect(spendFor(next).minus(before).toString()).toBe('18000');
    expect(markPaid(next, w.commitments[0].id)).toBe(next);
    expect(next.commitments[0].paidTransactionId).toBe(next.transactions[0].id);
  });
  it('records a selected account/date and one next renewal cycle atomically',()=>{
    const w=seedWorkspace('test','personal');
    const item={...w.commitments[0],due:'2026-01-31',cadence:'Monthly' as const};
    w.commitments=[item];
    const next=markPaid(w,item.id,{account:'Cash',date:'2026-01-30',advance:true});
    expect(next.transactions[0].account).toBe('Cash');
    expect(next.transactions[0].date).toBe('2026-01-30');
    expect(next.commitments).toHaveLength(2);
    expect(next.commitments[1].due).toBe('2026-02-28');
    expect(next.commitments[1].state).toBe('open');
    expect(markPaid(next,item.id,{account:'Cash',date:'2026-01-30',advance:true})).toBe(next);
  });
  it('adds decimal entries exactly', () => {
    const w = seedWorkspace('test', 'personal');
    w.transactions = w.transactions
      .slice(0, 2)
      .map((t, i) => ({ ...t, amount: i ? '0.20' : '0.10', date: today() }));
    expect(spendFor(w).toString()).toBe('0.3');
  });
});
