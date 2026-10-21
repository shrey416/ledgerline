import { Select } from './Select';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import Decimal from 'decimal.js';
import {
  categories,
  validateAmount,
  type Transaction,
  type Commitment,
  type Workspace,
} from './domain';

export function RecordEditor({
  transaction,
  commitment,
  workspace,
  onSave,
  onClose,
}: {
  transaction?: Transaction;
  commitment?: Commitment;
  workspace: Workspace;
  onSave: (next: Workspace) => Promise<boolean>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(transaction?.merchant || commitment?.name || '');
  const [amount, setAmount] = useState(transaction?.amount || commitment?.amount || '');
  const [date, setDate] = useState(transaction?.date || commitment?.due || '');
  const [category, setCategory] = useState(
    transaction?.category || commitment?.category || 'Other',
  );
  const [account, setAccount] = useState(transaction?.account || 'Main account');
  const [destination, setDestination] = useState(transaction?.destination || '');
  const [note, setNote] = useState(transaction?.note || '');
  const [cadence, setCadence] = useState<Commitment['cadence']>(commitment?.cadence || 'Once');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const linked = Boolean(
    transaction && workspace.commitments.some((item) => item.paidTransactionId === transaction.id),
  );
  useEffect(() => {
    const element = ref.current!;
    const previous = document.activeElement as HTMLElement;
    element.showModal();
    element.querySelector('input')?.focus();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !validateAmount(amount) || !date) {
      setError('Enter a description, valid amount and calendar date.');
      return;
    }
    if (transaction?.kind === 'transfer' && account === destination) {
      setError('Choose two different accounts.');
      return;
    }
    setBusy(true);
    const next = transaction
      ? {
          ...workspace,
          transactions: workspace.transactions.map((item) =>
            item.id === transaction.id
              ? {
                  ...item,
                  merchant: name.trim(),
                  amount: new Decimal(amount).toFixed(2),
                  date,
                  category,
                  account,
                  destination: item.kind === 'transfer' ? destination : undefined,
                  note,
                }
              : item,
          ),
        }
      : {
          ...workspace,
          commitments: workspace.commitments.map((item) =>
            item.id === commitment?.id
              ? {
                  ...item,
                  name: name.trim(),
                  amount: new Decimal(amount).toFixed(2),
                  due: date,
                  category,
                  cadence,
                  ...(date !== item.due ? { billingDay: Number(date.slice(-2)) } : {}),
                }
              : item,
          ),
        };
    if (await onSave(next)) onClose();
    else {
      setError('The change was not confirmed. Check the page error before retrying.');
      setBusy(false);
    }
  }
  return (
    <dialog ref={ref} className="entry-dialog" onCancel={onClose} aria-labelledby="record-title">
      <div className="dialog-header">
        <div>
          <span className="eyebrow">LEDGERLINE / EDIT RECORD</span>
          <h2 id="record-title">{transaction ? 'Edit transaction' : 'Edit commitment'}</h2>
        </div>
        <button className="icon-button" aria-label="Close edit dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <form onSubmit={(e) => void submit(e)}>
        <div className="form-body">
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {linked && (
            <p className="form-note">
              This expense is linked to a paid commitment. Its amount and account are retained; you
              can update its description, category and note.
            </p>
          )}
          <div className="form-grid">
            <label className="field full">
              <span>Description</span>
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Amount · INR</span>
              <input
                required
                disabled={linked}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </label>
            <label className="field">
              <span>{transaction ? 'Date' : 'Next due date'}</span>
              <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Category</span>
              <button type="button" disabled={busy || !name.trim()} onClick={async () => {
                setBusy(true); setError('');
                try {
                  const response = await fetch('/api/v1/capture/suggest', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({description:name}), signal:AbortSignal.timeout(10000)});
                  if(!response.ok) throw new Error('Category suggestion unavailable. Choose manually.');
                  const result=await response.json();
                  if(categories.includes(result.category)) setCategory(result.category);
                } catch(e) {setError(e instanceof Error?e.message:'Suggestion failed');}
                finally {setBusy(false);}
              }}>Suggest category</button>
              <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </Select>
            </label>
            {transaction && (
              <label className="field">
                <span>Account</span>
                <Select
                  value={account}
                  disabled={linked}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  {Object.keys(workspace.opening).map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </Select>
              </label>
            )}
            {transaction?.kind === 'transfer' && (
              <label className="field">
                <span>Destination</span>
                <Select value={destination} onChange={(e) => setDestination(e.target.value)}>
                  {Object.keys(workspace.opening).map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </Select>
              </label>
            )}
            {commitment && (
              <label className="field">
                <span>Billing interval</span>
                <Select
                  value={cadence}
                  onChange={(e) => setCadence(e.target.value as Commitment['cadence'])}
                >
                  <option>Once</option>
                  <option>Monthly</option>
                  <option>Yearly</option>
                </Select>
              </label>
            )}
            {transaction && (
              <label className="field full">
                <span>Note</span>
                <textarea maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
              </label>
            )}
          </div>
          <p className="platform-help">
            This updates your finance tracker and records a saved revision. It does not modify the
            separate immutable accounting journal or initiate a payment.
          </p>
        </div>
        <div className="dialog-footer">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
