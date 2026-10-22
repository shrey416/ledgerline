import { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Check, Copy, Download, FileBarChart2, RefreshCw, X } from 'lucide-react';
import Decimal from 'decimal.js';
import { Select } from './Select';
import { money, today, type Workspace } from './domain';

async function request(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Service unavailable (${response.status}). Please retry.`);
  return response.json();
}
const currencies = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AED'];
export function CurrencyConverter({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [amount, setAmount] = useState('100');
  const [from, setFrom] = useState('INR');
  const [to, setTo] = useState('USD');
  const [result, setResult] = useState<{ converted: number; rate: number; updatedAt?: string; stale?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const node = dialog.current!;
    node.showModal();
    return () => {
      node.close();
      prior?.focus();
    };
  }, []);
  function reset() {
    setResult(null);
    setCopied(false);
    setError('');
  }
  return (
    <dialog
      ref={dialog}
      className="entry-dialog converter-dialog"
      aria-labelledby="converter-title"
      onCancel={onClose}
    >
      <div className="dialog-header">
        <div>
          <span className="eyebrow">QUICK TOOL / CURRENCY</span>
          <h2 id="converter-title">Currency converter</h2>
        </div>
        <button className="icon-button" aria-label="Close converter" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          reset();
          try {
            setResult(
              await request(
                `/api/v1/rates/convert?from=${from}&to=${to}&amount=${encodeURIComponent(amount)}`,
              ),
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Conversion failed.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-body">
          <label className="field">
            <span>Amount</span>
            <input
              autoFocus
              required
              type="number"
              min="0"
              max="1000000000000"
              step="any"
              value={amount}
              disabled={busy}
              onChange={(e) => {
                setAmount(e.target.value);
                reset();
              }}
            />
          </label>
          <div className="converter-pair">
            <label className="field">
              <span>From</span>
              <Select
                aria-label="From currency"
                disabled={busy}
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  reset();
                }}
              >
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </label>
            <button
              type="button"
              className="icon-button"
              disabled={busy}
              aria-label="Swap currencies"
              onClick={() => {
                setFrom(to);
                setTo(from);
                reset();
              }}
            >
              <ArrowLeftRight size={20} />
            </button>
            <label className="field">
              <span>To</span>
              <Select
                aria-label="To currency"
                disabled={busy}
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  reset();
                }}
              >
                {currencies.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </label>
          </div>
          <div className="conversion-result" aria-live="polite">
            {result ? (
              <>
                <span className="eyebrow">CONVERTED AMOUNT</span>
                <strong>
                  {new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(
                    result.converted,
                  )}{' '}
                  <small>{to}</small>
                </strong>
                <p>
                  1 {from} ={' '}
                  {new Intl.NumberFormat('en-IN', { maximumFractionDigits: 6 }).format(result.rate)}{' '}
                  {to}
                </p>
                <button
                  type="button"
                  className="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(
                        `${result.converted} ${to} (1 ${from} = ${result.rate} ${to})`,
                      );
                      setCopied(true);
                    } catch {
                      setError('Clipboard unavailable. Select and copy the rate above.');
                    }
                  }}
                >
                  {copied ? <Check size={16} /> : <Copy size={16} />}{' '}
                  {copied ? 'Copied' : 'Copy amount & rate'}
                </button>
              </>
            ) : (
              <p>Convert an amount and copy the exchange rate into your notes.</p>
            )}
          </div>
          <p className="muted">
            <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">Rates By Exchange Rate API</a> · Daily updates
            {result?.updatedAt && <> · Updated {new Date(result.updatedAt).toLocaleString()}</>}
            {result?.stale && <> · Offline: using last available rates</>}
          </p>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <button type="button" className="button" onClick={onClose}>
            Close
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Converting…' : 'Convert amount'}
          </button>
        </div>
      </form>
    </dialog>
  );
}

type ReportRow = { category: string; kind: string; count: string | number; total: string };
export function Reports({ workspace }: { workspace: Workspace }) {
  const [start, setStart] = useState('');
  const [end, setEnd] = useState(today());
  const [report, setReport] = useState<{
    rows: ReportRow[];
    label: string;
    generated: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const expenses =
    report?.rows
      .filter((r) => r.kind === 'expense')
      .reduce((n, r) => n.plus(r.total), new Decimal(0)) || new Decimal(0);
  const income =
    report?.rows
      .filter((r) => r.kind === 'income')
      .reduce((n, r) => n.plus(r.total), new Decimal(0)) || new Decimal(0);
  function exportReport() {
    if (!report) return;
    const cell = (v: unknown) => {
      const value = String(v);
      return `"${(/^[=+@\-]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
    };
    const csv = [
      ['Category', 'Type', 'Entries', 'Total INR'],
      ...report.rows.map((r) => [r.category, r.kind, r.count, r.total]),
    ]
      .map((row) => row.map(cell).join(','))
      .join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledgerline-report-${today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="reports-page" aria-label="Workspace reports">
      <div className="card report-intro">
        <div className="report-mark">
          <FileBarChart2 size={26} />
        </div>
        <div>
          <span className="eyebrow">YOUR WORKSPACE / IN FOCUS</span>
          <h2>Turn your records into clarity.</h2>
          <p>
            Generate a category breakdown for {workspace.name}. Income, spending and transfers stay
            separate.
          </p>
        </div>
      </div>
      <form
        className="card report-controls"
        onSubmit={async (e) => {
          e.preventDefault();
          if (start && end && start > end) {
            setError('The end date must be on or after the start date.');
            return;
          }
          setBusy(true);
          setError('');
          try {
            const entries = workspace.transactions.filter(
              (t) => (!start || t.date >= start) && (!end || t.date <= end),
            );
            const response = await request('/api/v1/analytics/report', {
              entries: entries.map((t) => ({
                category: t.category,
                kind: t.kind,
                amount: t.amount,
              })),
            });
            setReport({
              rows: response.data,
              label: `${start || 'First entry'} → ${end || 'Latest entry'}`,
              generated: new Date().toLocaleTimeString(),
            });
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Report generation failed.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          <span>From date</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          <span>Through date</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <button className="button primary" disabled={busy}>
          <RefreshCw size={16} className={busy ? 'report-spinning' : ''} />
          {busy ? 'Generating…' : 'Generate report'}
        </button>
      </form>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {report ? (
        <>
          <div className="report-summary">
            <div className="card">
              <span className="eyebrow">TOTAL SPENDING</span>
              <strong>{money(expenses)}</strong>
            </div>
            <div className="card">
              <span className="eyebrow">TOTAL INCOME</span>
              <strong>{money(income)}</strong>
            </div>
            <div className="card">
              <span className="eyebrow">NET INCOME LESS SPENDING</span>
              <strong>{money(income.minus(expenses))}</strong>
            </div>
          </div>
          <div className="card report-results">
            <div className="report-results-header">
              <div>
                <h2>Category breakdown</h2>
                <p>
                  {report.label} · INR · Generated {report.generated}
                </p>
              </div>
              <button className="button" onClick={exportReport}>
                <Download size={16} />
                Export CSV
              </button>
            </div>
            <div className="report-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Category</th>
                    <th>Type</th>
                    <th>Entries</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((r) => (
                    <tr key={r.category + r.kind}>
                      <td>{r.category}</td>
                      <td>
                        <span className={`report-type report-type-${r.kind}`}>{r.kind}</span>
                      </td>
                      <td>{r.count}</td>
                      <td>{money(r.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.rows.length && (
              <p className="report-empty">
                No transactions in this date range. Try another period or record an entry.
              </p>
            )}
            <p className="report-footnote">
              Transfers move money between your accounts and do not count as income or spending.
              Reports are snapshots; regenerate after editing transactions.
            </p>
          </div>
        </>
      ) : (
        <div className="card report-empty">
          <FileBarChart2 size={36} />
          <h3>Your next insight starts here.</h3>
          <p>Choose a period and generate your first report.</p>
        </div>
      )}
    </section>
  );
}
