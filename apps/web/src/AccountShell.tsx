import { lazy, Suspense, useEffect, useState } from 'react';
import type { User } from 'oidc-client-ts';
import { ArrowRight, Check, Layers3, LockKeyhole, RefreshCw, Wallet } from 'lucide-react';
import { identity, currentUser, accountRequest, registerAccount } from './auth';
const loadApp = () => import('./App');
const App = lazy(loadApp);
let pendingWorkbench: { token: string; promise: Promise<Workbench> } | undefined;
function loadWorkbench(token: string) {
  if (pendingWorkbench?.token === token) return pendingWorkbench.promise;
  const promise = accountRequest('/workbench');
  pendingWorkbench = { token, promise };
  void promise
    .finally(() => {
      if (pendingWorkbench?.promise === promise) pendingWorkbench = undefined;
    })
    .catch(() => {});
  return promise;
}

import type { Workspace } from './domain';

export type Workbench = { workspaces: Workspace[]; revision: number; updatedAt: string };
export default function AccountShell() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [data, setData] = useState<Workbench | null>(null);
  const [dataOwner, setDataOwner] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const loaded = (value: User) => {
      if (alive) setUser(value);
    };
    const unloaded = () => {
      if (alive) {
        setUser(null);
        setData(null);
      }
    };
    identity.events.addUserLoaded(loaded);
    identity.events.addUserUnloaded(unloaded);
    identity.events.addAccessTokenExpired(unloaded);
    void currentUser()
      .then((value) => {
        if (alive) {
          setUser(value);
          if (!value && ['/login', '/signup'].includes(location.pathname))
            void authenticate(location.pathname === '/signup');
        }
      })
      .catch(() => {
        if (alive) setError('We could not complete sign-in. Please try again.');
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
      identity.events.removeUserLoaded(loaded);
      identity.events.removeUserUnloaded(unloaded);
      identity.events.removeAccessTokenExpired(unloaded);
    };
  }, []);
  useEffect(() => {
    if (!user) return;
    void loadApp();
    let alive = true;
    setError('');
    void loadWorkbench(user.access_token)
      .then((value) => {
        if (alive) {
          setData(value);
          setDataOwner(user.profile.sub);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [user?.profile.sub]);
  async function authenticate(register = false) {
    setBusy(true);
    setError('');
    try {
      if (register) await registerAccount();
      else await identity.signinRedirect();
    } catch {
      setBusy(false);
      setError('Sign-in is unavailable. Check that the identity service is running.');
    }
  }
  if (user && data && dataOwner === user.profile.sub)
    return (
      <Suspense
        fallback={
          <div className="auth-shell" role="status">
            <p className="auth-trust">Opening your workbench...</p>
          </div>
        }
      >
        <App key={user.profile.sub} user={user} initialData={data} />
      </Suspense>
    );
  return (
    <div className="auth-shell">
      <a className="auth-brand" href="/" aria-label="Ledgerline home">
        <Layers3 size={26} strokeWidth={1.8} /> LEDGERLINE<span>PERSONAL + BUSINESS</span>
      </a>
      <main className="auth-grid">
        <section className="auth-story">
          <span className="eyebrow">YOUR MONEY. ONE WORKBENCH.</span>
          <h1>
            Make room
            <br />
            for what
            <br />
            <em>matters.</em>
          </h1>
          <p>
            A clear view of spending, bills and subscriptions. Built for everyday life and the
            business you’re growing.
          </p>
          <div className="auth-benefits">
            {[
              'Keep personal and business finances separate',
              'Plan budgets and record every payment',
              'Get reminders before bills and renewals',
            ].map((value) => (
              <div key={value}>
                <Check size={16} />
                {value}
              </div>
            ))}
          </div>
          <div className="auth-stamp">
            <Wallet size={24} />
            <span>
              LESS MONEY ADMIN.
              <br />
              <strong>MORE PEACE OF MIND.</strong>
            </span>
          </div>
        </section>
        <section className="auth-card" aria-labelledby="auth-title">
          <span className="eyebrow">LEDGERLINE / YOUR ACCOUNT</span>
          <h2 id="auth-title">{user ? 'Opening your workbench' : 'Welcome to clearer money.'}</h2>
          <p>
            {user
              ? 'Loading your saved accounts, transactions and plans.'
              : 'Create your account to start fresh, or sign in to pick up where you left off.'}
          </p>
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
          {user ? (
            <>
              <button
                className="button primary"
                onClick={() =>
                  void accountRequest('/workbench')
                    .then((value) => {
                      setData(value);
                      setDataOwner(user.profile.sub);
                    })
                    .catch((e) => setError(e.message))
                }
              >
                <RefreshCw size={17} /> Retry loading data
              </button>
              <button className="button" onClick={() => void identity.signoutRedirect()}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <button
                className="button primary"
                disabled={!ready || busy}
                onClick={() => void authenticate()}
              >
                {ready ? 'Sign in' : 'Checking your session'}
                <ArrowRight size={17} />
              </button>
              <button
                className="button"
                disabled={!ready || busy}
                onClick={() => void authenticate(true)}
              >
                Create an account
                <ArrowRight size={17} />
              </button>
            </>
          )}
          <div className="auth-trust">
            <LockKeyhole size={17} />
            <span>
              Secure sign-in. Your finance data belongs to your account, with separate personal and
              business workspaces.
            </span>
          </div>
          <small>Ledgerline tracks your money. It never charges or transfers funds.</small>
        </section>
      </main>
      <footer className="auth-footer">
        LEDGERLINE / A WORKBENCH FOR EVERYDAY MONEY<span>SHARP. SIMPLE. IN YOUR CONTROL.</span>
      </footer>
    </div>
  );
}
