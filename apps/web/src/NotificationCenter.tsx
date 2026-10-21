import { Select } from './Select';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type User } from 'oidc-client-ts';
import { identity as manager, currentUser } from './auth';
import { Bell, Check, LogIn, LogOut, Mail, RefreshCw, Send } from 'lucide-react';
import type { Workspace } from './domain';
import { notificationResponse } from './notificationResponse';
import { codeDigits, reminderPayload } from './reminderPayload';

let syncChain = Promise.resolve();
export function useReminderSync(
  workspaces: Workspace[],
  onError: (message: string) => void,
  owner: string,
) {
  const projection = useMemo(
    () =>
      JSON.stringify(
        workspaces.map((workspace) => ({ id: workspace.id, body: reminderPayload(workspace) })),
      ),
    [workspaces],
  );
  const lastSynced = useRef(new Map<string, { body: string; at: number }>());
  useEffect(() => {
    let disposed = false;
    const sync = () => {
      if (document.hidden || !navigator.onLine) return;
      syncChain = syncChain
        .catch(() => {})
        .then(async () => {
          const user = await manager.getUser();
          if (!user || user.profile.sub !== owner || user.expired || disposed) return;
          for (const workspace of JSON.parse(projection) as { id: string; body: string }[]) {
            if (disposed) return;
            const previous = lastSynced.current.get(`${owner}:${workspace.id}`);
            if (previous?.body === workspace.body && Date.now() - previous.at < 300000) continue;
            const response = await fetch(
              `/api/v1/notifications/workspaces/${workspace.id}/commitments`,
              {
                signal: AbortSignal.timeout(20000),
                method: 'PUT',
                headers: {
                  Authorization: `Bearer ${user.access_token}`,
                  'Content-Type': 'application/json',
                },
                body: workspace.body,
              },
            );
            if (!response.ok) throw new Error('Reminder sync failed');
            lastSynced.current.set(`${owner}:${workspace.id}`, {
              body: workspace.body,
              at: Date.now(),
            });
          }
        })
        .catch(() => {
          if (!disposed)
            onError(
              'Your finance entries are saved to your account, but email reminders could not sync. Open Notifications and refresh after the service reconnects.',
            );
        });
    };
    sync();
    manager.events.addUserLoaded(sync);
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('online', sync);
    const timer = setInterval(sync, 60000);
    return () => {
      disposed = true;
      clearInterval(timer);
      manager.events.removeUserLoaded(sync);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('online', sync);
    };
  }, [projection, onError, owner]);
}
type Prefs = { email: string; enabled: boolean; leadDays: number; timezone: string };
type Notice = {
  id: string;
  subject: string;
  text: string;
  createdAt: string;
  delivery: string;
  read: boolean;
};
type Snapshot = {
  transportReady?: boolean;
  preferences: Prefs;
  verified: boolean;
  emailMode: string;
  syncedCount: number;
  inbox: Notice[];
};
export function NotificationCenter({ workspace }: { workspace: Workspace }) {
  const [user, setUser] = useState<User | null>(null),
    [authReady, setAuthReady] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [prefs, setPrefs] = useState<Prefs>({
      email: '',
      enabled: false,
      leadDays: 3,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  const [code, setCode] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const base = `/api/v1/notifications/workspaces/${workspace.id}`;
  const activeContext = useRef('');
  activeContext.current = `${base}:${user?.profile.sub || ''}`;
  const refreshing = useRef(new Map<string, Promise<void>>());
  const loadedContext = useRef('');
  useEffect(() => {
    let mounted = true;
    const changed = (next: User) => setUser(next),
      expired = () => setUser(null);
    manager.events.addUserLoaded(changed);
    manager.events.addAccessTokenExpired(expired);
    void (async () => {
      try {
        const next = await currentUser();
        if (mounted) setUser(next && !next.expired ? next : null);
      } catch {
        if (mounted) setError('Sign-in failed. Try signing in again.');
      } finally {
        if (mounted) setAuthReady(true);
      }
    })();
    return () => {
      mounted = false;
      manager.events.removeUserLoaded(changed);
      manager.events.removeAccessTokenExpired(expired);
    };
  }, []);
  async function api(path = '', method = 'GET', body?: unknown) {
    const response = await fetch(base + path, {
      signal: AbortSignal.timeout(65000),
      method,
      headers: {
        Authorization: `Bearer ${user?.access_token}`,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return notificationResponse(response);
  }
  async function refresh(replace = false) {
    const context = activeContext.current;
    // Explicit refreshes after writes wait for the previous read, then fetch the
    // new state. Background polling skips rather than overlaps an active read.
    const previous = refreshing.current.get(context);
    const request = (previous ? previous.catch(() => {}) : Promise.resolve()).then(async () => {
      if (context !== activeContext.current) return;
      const next = (await api()) as Snapshot;
      if (context !== activeContext.current) return;
      setSnapshot(next);
      if (replace || loadedContext.current !== context) setPrefs(next.preferences);
      loadedContext.current = context;
    });
    refreshing.current.set(context, request);
    try {
      await request;
    } finally {
      if (refreshing.current.get(context) === request) refreshing.current.delete(context);
    }
  }
  useEffect(() => {
    setError('');
    setNotice('');
    if (!user) return;
    const context = `${base}:${user.profile.sub}`;
    const firstLoad = loadedContext.current !== context;
    if (firstLoad) {
      setSnapshot(null);
      setCode('');
    }
    let disposed = false;
    void refresh(firstLoad).catch((e) => {
      if (!disposed) setError(e.message);
    });
    return () => {
      disposed = true;
    };
    // Confirmed finance changes are synced to the reminder service.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.access_token, workspace.id]);
  useEffect(() => {
    if (!user) return;
    const poll = () => {
      if (
        !document.hidden &&
        navigator.onLine &&
        !busy &&
        !refreshing.current.has(activeContext.current)
      )
        void refresh(loadedContext.current !== activeContext.current).catch(() => {});
    };
    const timer = setInterval(poll, 15000);
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('online', poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
      window.removeEventListener('online', poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.access_token, workspace.id, busy]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="notifications-layout">
      <section className="panel">
        <div className="panel-header">
          <h2>
            <Bell size={18} /> Reminder delivery
          </h2>
          {user && (
            <button
              className="button small"
              disabled={busy || !snapshot}
              onClick={() =>
                void run(async () => {
                  await api('/preferences', 'PUT', { ...prefs, enabled: false });
                  setPrefs({ ...prefs, enabled: false });
                  await refresh();
                  setNotice('Email reminders paused.');
                })
              }
            >
              <LogOut size={15} /> Pause reminders
            </button>
          )}
        </div>
        <p className="platform-help">
          Keep bills and renewals on your radar. Reminders and finance entries are private to your
          signed-in account. Saved open commitments sync automatically while you use the app.
        </p>
        {!user ? (
          <div className="notification-connect">
            <Mail size={32} />
            <h3>A quieter way to stay on top of due dates</h3>
            <p>Sign in, verify your recipient address and choose when reminders arrive.</p>
            <button
              className="button primary"
              disabled={!authReady || busy}
              onClick={() =>
                void run(async () => {
                  await manager.signinRedirect();
                })
              }
            >
              <LogIn size={16} /> Sign in to connect reminders
            </button>
            <small>Local account: demo · password: local-demo-only</small>
          </div>
        ) : (
          <form
            className="notification-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                await api('/preferences', 'PUT', prefs);
                await refresh();
                setNotice(
                  snapshot?.verified &&
                    prefs.email.trim().toLowerCase() === snapshot.preferences.email
                    ? 'Reminder preferences saved.'
                    : 'Preferences saved. Verify your email to activate delivery.',
                );
              });
            }}
          >
            <div className="notification-mode">
              <span className="eyebrow">
                {snapshot?.emailMode === 'smtp' ? 'SMTP delivery' : 'Local email inbox'}
              </span>
              <span>
                {snapshot?.verified &&
                prefs.email.trim().toLowerCase() === snapshot.preferences.email
                  ? 'Recipient verified'
                  : 'Verification required'}
              </span>
            </div>
            <label>
              Recipient email
              <input
                type="email"
                required
                maxLength={254}
                value={prefs.email}
                onChange={(e) => {
                  setPrefs({ ...prefs, email: e.target.value });
                  setCode('');
                }}
                placeholder="you@example.com"
              />
            </label>
            <div className="notification-fields">
              <label>
                Remind me before the due date
                <Select
                  value={prefs.leadDays}
                  onChange={(e) => setPrefs({ ...prefs, leadDays: Number(e.target.value) })}
                >
                  {[0, 1, 2, 3, 7, 14, 30].map((day) => (
                    <option key={day} value={day}>
                      {day === 0 ? 'On the due date' : `${day} days before`}
                    </option>
                  ))}
                </Select>
              </label>
              <label>
                Timezone
                <input
                  required
                  value={prefs.timezone}
                  onChange={(e) => setPrefs({ ...prefs, timezone: e.target.value })}
                  placeholder="Asia/Kolkata"
                />
              </label>
            </div>
            <p className="platform-help">
              Scheduled for 09:00 in your timezone. New reminders whose lead time has passed arrive
              shortly after sync. Paid or canceled commitments stop future reminders.
            </p>
            <label className="notification-check">
              <input
                type="checkbox"
                checked={prefs.enabled}
                onChange={(e) => setPrefs({ ...prefs, enabled: e.target.checked })}
              />{' '}
              Email bill and subscription reminders
            </label>
            <button className="button primary" disabled={busy || !snapshot}>
              <Check size={16} /> Save preferences
            </button>
          </form>
        )}
        {snapshot?.transportReady === false && (
          <p className="error-banner" role="status">
            Email delivery is temporarily unavailable. Your settings are saved. Try again shortly.
          </p>
        )}
        {error && (
          <p className="error-banner" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notification-success" role="status">
            {notice}
          </p>
        )}
        {user && snapshot && (
          <div className="notification-verification">
            {!(
              snapshot.verified && prefs.email.trim().toLowerCase() === snapshot.preferences.email
            ) ? (
              <>
                <h3>Verify your recipient</h3>
                <p className="platform-help">
                  Send a code to the address above, then enter its six digits. Codes are specific to
                  this workspace and recipient and expire after 10 minutes. The most recent three
                  codes remain valid until their own expiry when you resend.
                </p>
                <button
                  className="button"
                  disabled={busy || !prefs.email.trim()}
                  onClick={() =>
                    void run(async () => {
                      await api('/preferences', 'PUT', prefs);
                      await refresh(true);
                      await api('/verification', 'POST', {});
                      setCode('');
                      setNotice(
                        snapshot.emailMode === 'local-inbox'
                          ? 'Code sent. Open the local email inbox below.'
                          : 'Code sent. Check your email.',
                      );
                    })
                  }
                >
                  <Send size={15} /> Send verification code
                </button>
                <div className="notification-code">
                  <label>
                    Verification code
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      value={code}
                      onChange={(e) => setCode(codeDigits(e.target.value))}
                    />
                  </label>
                  <button
                    className="button"
                    disabled={busy || code.length !== 6}
                    onClick={() =>
                      void run(async () => {
                        if (prefs.email.trim().toLowerCase() !== snapshot.preferences.email)
                          throw new Error(
                            'Save this recipient and send a code to it before verifying.',
                          );
                        await api('/verification/confirm', 'POST', {
                          code,
                          email: snapshot.preferences.email,
                        });
                        setCode('');
                        await refresh();
                        setNotice('Email verified. Your saved reminder preference is now active.');
                      })
                    }
                  >
                    <Check size={15} /> Verify email
                  </button>
                </div>
              </>
            ) : (
              <button
                className="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await api('/test', 'POST', {});
                    setNotice('Test email sent.');
                  })
                }
              >
                <Send size={15} /> Send a test email
              </button>
            )}
            {snapshot.emailMode === 'local-inbox' && (
              <p>
                <a
                  className="text-button"
                  href="http://localhost:8025"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open local email inbox
                </a>
              </p>
            )}
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2>
            <Mail size={18} /> Notification inbox
          </h2>
          <button
            className="icon-button"
            aria-label="Refresh notifications"
            disabled={!user || busy}
            onClick={() => void run(() => refresh())}
          >
            <RefreshCw size={17} />
          </button>
        </div>
        <p className="platform-help">
          {snapshot
            ? `${snapshot.syncedCount} commitments synced · delivery history retained for 90 days`
            : 'Connect reminders to see delivery history.'}
        </p>
        {!snapshot?.inbox.length ? (
          <div className="notification-empty">
            <Bell size={28} />
            <h3>All clear for now</h3>
            <p>Scheduled reminders will appear here with their delivery status.</p>
          </div>
        ) : (
          <div className="notification-inbox">
            {snapshot.inbox.map((item) => (
              <article key={item.id} className={item.read ? 'read' : ''}>
                <div>
                  <strong>{item.subject}</strong>
                  <span className="status-badge">{item.delivery}</span>
                </div>
                <p>{item.text.split('\n').slice(0, 3).join(' · ')}</p>
                <small>{new Date(item.createdAt).toLocaleString()}</small>
                {!item.read && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/inbox/${item.id}`, 'PATCH', {});
                        await refresh();
                      })
                    }
                  >
                    <Check size={14} /> Mark read
                  </button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
