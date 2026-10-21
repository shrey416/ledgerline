import { useConfirmation } from './Confirmation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { User } from 'oidc-client-ts';
import { Download, KeyRound, LogOut, RefreshCw, Save, UserRound, X } from 'lucide-react';
import Decimal from 'decimal.js';
import { accountRequest, identity } from './auth';
import type { Workspace } from './domain';

export function AccountSettings({
  user,
  workspaces,
  workspace,
  onSave,
  onRefresh,
  savedAt,
}: {
  user: User;
  workspaces: Workspace[];
  workspace: Workspace;
  onSave: (next: Workspace) => Promise<boolean>;
  onRefresh: () => Promise<void>;
  savedAt: string;
}) {
  const [name, setName] = useState(workspace.name);
  const [history, setHistory] = useState<{ revision: number; created_at: string }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    setName(workspace.name);
  }, [workspace.id, workspace.name]);
  useEffect(() => {
    void accountRequest('/history')
      .then(setHistory)
      .catch(() => setError('Revision history is temporarily unavailable.'));
  }, [savedAt]);
  const action = async (kind: string) => {
    try {
      await identity.signinRedirect({ extraQueryParams: { kc_action: kind } });
    } catch {
      setError('Account management is unavailable. Try again shortly.');
    }
  };
  function download() {
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), workspaces }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ledgerline-account.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div className="account-settings">
      <section className="panel">
        <div className="panel-header">
          <h2>
            <UserRound size={18} /> Your profile
          </h2>
        </div>
        <dl className="detail-list">
          <div>
            <dt>Name</dt>
            <dd>{user.profile.name || user.profile.preferred_username}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{user.profile.email || 'Add an email in your profile'}</dd>
          </div>
          <div>
            <dt>Data storage</dt>
            <dd>Private PostgreSQL account · last saved {new Date(savedAt).toLocaleString()}</dd>
          </div>
        </dl>
        <div className="account-actions">
          <button className="button" onClick={() => void action('UPDATE_PROFILE')}>
            <UserRound size={16} /> Edit profile
          </button>
          <button className="button" onClick={() => void action('UPDATE_PASSWORD')}>
            <KeyRound size={16} /> Change password
          </button>
          <button className="button" onClick={() => void identity.signoutRedirect()}>
            <LogOut size={16} /> Sign out
          </button>
        </div>
        <p className="platform-help">
          Personal and business workspaces belong to this account. Shared company access is not
          enabled.
        </p>
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>Workspace preferences</h2>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void onSave({ ...workspace, name: name.trim() });
          }}
        >
          <label className="field">
            <span>Workspace name</span>
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="platform-help">
            INR is the supported recording currency. Opening balances and account names can be
            managed on Accounts.
          </p>
          <button className="button primary" type="submit">
            <Save size={16} /> Save workspace
          </button>
        </form>
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>Your data, in your control</h2>
        </div>
        <p className="platform-help">
          Export both workspaces as JSON, or export the current workspace's transactions as CSV from
          the header. Refresh before editing if another tab has made changes.
        </p>
        <div className="account-actions">
          <button className="button" onClick={download}>
            <Download size={16} /> Export account data
          </button>
          <button className="button" onClick={() => void onRefresh()}>
            <RefreshCw size={16} /> Refresh data
          </button>
        </div>
        <div className="account-history">
          <h3>Recent saved revisions</h3>
          {!history.length && (
            <p className="platform-help">Your first saved change will appear here.</p>
          )}
          {history.map((item) => (
            <div key={item.revision}>
              <strong>Revision {item.revision}</strong>
              <span>{new Date(item.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

export function FundingAccountDialog({
  account,
  workspace,
  onClose,
  onSave,
}: {
  account: string;
  workspace: Workspace;
  onClose: () => void;
  onSave: (next: Workspace) => Promise<boolean>;
}) {
  const [ask, confirmation] = useConfirmation();
  const ref = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(account),
    [opening, setOpening] = useState(workspace.opening[account] || '0'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
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
    const key = name.trim();
    if (
      !key ||
      key.length > 80 ||
      ['__proto__', 'constructor', 'prototype'].includes(key) ||
      (key !== account && Object.hasOwn(workspace.opening, key))
    ) {
      setError('Choose a unique account name, up to 80 characters.');
      return;
    }
    if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(opening) || new Decimal(opening).abs().gt('999999999.99')) {
      setError('Enter a valid signed opening balance with at most two decimal places.');
      return;
    }
    if (account === 'Main account' && key !== account) {
      setError('Keep the default payment account named Main account.');
      return;
    }
    const nextOpening = { ...workspace.opening };
    if (account) delete nextOpening[account];
    nextOpening[key] = new Decimal(opening).toFixed(2);
    setBusy(true);
    if (
      await onSave({
        ...workspace,
        opening: nextOpening,
        transactions: workspace.transactions.map((item) => ({
          ...item,
          account: item.account === account ? key : item.account,
          ...(item.destination === account ? { destination: key } : {}),
        })),
      })
    ) {
      onClose();
    } else {
      setError('Account was not saved. Review the error on the page and retry.');
      setBusy(false);
    }
  }
  async function remove() {
    if (
      account === 'Main account' ||
      Object.keys(workspace.opening).length <= 1 ||
      workspace.transactions.some(
        (item) => item.account === account || item.destination === account,
      )
    ) {
      setError(
        'Accounts with recorded activity cannot be removed. The default payment account must be retained.',
      );
      return;
    }
    if (!(await ask(`Remove ${account}?`))) return;
    const next = { ...workspace.opening };
    delete next[account];
    setBusy(true);
    if (await onSave({ ...workspace, opening: next })) onClose();
    else setBusy(false);
  }
  return (
    <dialog ref={ref} className="entry-dialog" onCancel={onClose} aria-labelledby="funding-title">
      {confirmation}
      <div className="dialog-header">
        <div>
          <span className="eyebrow">LEDGERLINE / ACCOUNTS</span>
          <h2 id="funding-title">{account ? 'Edit account' : 'Add an account'}</h2>
        </div>
        <button className="icon-button" aria-label="Close account dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <div className="form-body">
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          <label className="field">
            <span>Account name</span>
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Opening balance · INR</span>
            <input
              required
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
          </label>
          <p className="platform-help">
            Use a negative balance for credit card debt. This is a recorded account; no bank
            connection or funds transfer is initiated.
          </p>
        </div>
        <div className="dialog-footer">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          {account && (
            <button type="button" className="button" disabled={busy} onClick={() => void remove()}>
              Remove unused account
            </button>
          )}
          <button className="button primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save account'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
