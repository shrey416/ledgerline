import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, X } from 'lucide-react';
import { Select } from './Select';
import { markPaid, money, nextCycle, today, type Commitment, type Workspace } from './domain';

export function PaymentDialog({
  item,
  workspace,
  onSave,
  onClose,
}: {
  item: Commitment;
  workspace: Workspace;
  onSave: (next: Workspace) => Promise<boolean>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [account, setAccount] = useState('Main account');
  const [date, setDate] = useState(today());
  const [advance, setAdvance] = useState(item.cadence !== 'Once');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const dialog = ref.current!;
    const prior = document.activeElement as HTMLElement;
    dialog.showModal();
    return () => {
      dialog.close();
      prior?.focus();
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    if (await onSave(markPaid(workspace, item.id, { account, date, advance }))) onClose();
    else {
      setBusy(false);
      setError('Payment was not saved. Check the page error and retry after refreshing.');
    }
  }
  return (
    <dialog ref={ref} className="entry-dialog" onCancel={onClose} aria-labelledby="payment-title">
      <div className="dialog-header">
        <div>
          <span className="eyebrow">RECORD A PAYMENT</span>
          <h2 id="payment-title">{item.name}</h2>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close payment">
          <X size={20} />
        </button>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <div className="form-body">
          <h3>{money(item.amount)}</h3>
          <p className="platform-help">
            Record a payment you already made. This creates one linked expense and updates the
            recorded account balance.
          </p>
          <div className="form-grid">
            <label className="field">
              <span>Paid from</span>
              <Select value={account} onChange={(event) => setAccount(event.target.value)}>
                {Object.keys(workspace.opening).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </Select>
            </label>
            <label className="field">
              <span>Payment date</span>
              <input
                required
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
          </div>
          {item.cadence !== 'Once' && (
            <label className="notification-check">
              <input
                type="checkbox"
                checked={advance}
                onChange={(event) => setAdvance(event.target.checked)}
              />
              Track the next cycle, due {nextCycle(item).due}
            </label>
          )}
          <p className="form-note">
            The paid cycle remains in history. Ledgerline does not initiate a bank payment or charge
            your card.
          </p>
          {error && (
            <p className="error-banner" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="dialog-footer">
          <button className="button" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={busy}>
            <Check size={16} />
            {busy ? 'Saving…' : 'Confirm payment'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
