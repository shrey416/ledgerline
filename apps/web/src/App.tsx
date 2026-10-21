import { CurrencyConverter, Reports } from './FinanceTools';
import { useConfirmation } from './Confirmation';
import { PaymentDialog } from './PaymentDialog';
import { Select } from './Select';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeftRight,
  Calculator,
  FileBarChart2,
  ArrowUpRight,
  Bell,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Download,
  FileText,
  Layers3,
  LayoutDashboard,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Trash2,
  Wallet,
  X,
  Repeat2,
  Building2,
  ArrowRight,
  Info,
  Moon,
} from 'lucide-react';
import gsap from 'gsap';
import Decimal from 'decimal.js';
import { PlatformStatus } from './PlatformStatus';
import { NotificationCenter, useReminderSync } from './NotificationCenter';
import { identity, accountRequest } from './auth';
import type { User } from 'oidc-client-ts';
import type { Workbench } from './AccountShell';
import { AccountSettings, FundingAccountDialog } from './AccountSettings';
import { RecordEditor } from './RecordEditor';
import {
  financialSummary,
  categories,
  nextCycle,
  money,
  offsetDate,
  sumAmounts,
  today,
  validateAmount,
  type Commitment,
  type Transaction,
  type Workspace,
} from './domain';

type Page =
  | 'reports'
  | 'overview'
  | 'activity'
  | 'bills'
  | 'subscriptions'
  | 'budgets'
  | 'accounts'
  | 'platform'
  | 'notifications'
  | 'settings';
type FormKind = 'expense' | 'income' | 'transfer' | 'bill' | 'subscription' | 'budget';
const pageNames: Record<Page, string> = {
  reports: 'Reports',
  overview: 'Overview',
  activity: 'Activity',
  bills: 'Bills',
  subscriptions: 'Subscriptions',
  budgets: 'Budget plan',
  accounts: 'Accounts',
  platform: 'Platform health',
  notifications: 'Notifications',
  settings: 'Your account',
};
const nav = [
  { id: 'overview' as Page, label: 'Overview', icon: LayoutDashboard },
  { id: 'activity' as Page, label: 'Activity', icon: ArrowLeftRight },
  { id: 'accounts' as Page, label: 'Accounts', icon: Wallet },
  { id: 'budgets' as Page, label: 'Budget plan', icon: Layers3 },
  { id: 'bills' as Page, label: 'Bills', icon: FileText },
  { id: 'subscriptions' as Page, label: 'Subscriptions', icon: Repeat2 },
  { id: 'reports' as Page, label: 'Reports', icon: FileBarChart2 },
  { id: 'notifications' as Page, label: 'Notifications', icon: Bell },
  { id: 'settings' as Page, label: 'Your account', icon: SlidersHorizontal },
  { id: 'platform' as Page, label: 'Platform health', icon: ShieldCheck },
];
const dateFormatter = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short' });
const dateLabel = (date: string) => dateFormatter.format(new Date(`${date}T12:00:00`));
function exportCsv(workspace: Workspace) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = [
    [
      'Date',
      'Type',
      'Merchant',
      'Amount',
      'Currency',
      'Account',
      'Destination',
      'Category',
      'Note',
    ],
    ...workspace.transactions.map((t) =>
      [
        t.date,
        t.kind,
        t.merchant,
        t.amount,
        'INR',
        t.account,
        t.destination || '',
        t.category,
        t.note,
      ].map((v) => (/^[=+@\-]/.test(v) ? `'${v}` : v)),
    ),
  ];
  const blob = new Blob(['\uFEFF' + rows.map((row) => row.map(escape).join(',')).join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ledgerline-${workspace.id}-${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function App({ user, initialData }: { user: User; initialData: Workbench }) {
  const [ask, confirmation] = useConfirmation();
  const [workspaces, setWorkspaces] = useState(initialData.workspaces);
  const revision = useRef(initialData.revision);
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState(initialData.updatedAt);
  const [fundingAccount, setFundingAccount] = useState<string | null>(null);
  const [editTransaction, setEditTransaction] = useState<Transaction | null>(null);
  const [payment, setPayment] = useState<Commitment | null>(null);
  const [editCommitment, setEditCommitment] = useState<Commitment | null>(null);
  const [workspaceId, setWorkspaceId] = useState('personal');
  const [page, setPage] = useState<Page>(() =>
    new URLSearchParams(location.search).has('code')
      ? 'notifications'
      : nav.some((n) => n.id === location.hash.slice(1))
        ? (location.hash.slice(1) as Page)
        : 'overview',
  );
  const [error, setError] = useState('');
  useReminderSync(workspaces, setError, user.profile.sub);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All categories');
  const [activityPage, setActivityPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [form, setForm] = useState<FormKind | null>(null);
  const [detail, setDetail] = useState<Transaction | null>(null);
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [converterOpen, setConverterOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(
    () => localStorage.getItem('ledgerline.navigation.collapsed') === 'true',
  );
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    localStorage.setItem('ledgerline.navigation.collapsed', String(navCollapsed));
  }, [navCollapsed]);
  useEffect(() => {
    const viewport = matchMedia('(max-width: 767px)');
    const closeDrawer = () => {
      if (!viewport.matches) setMobileNav(false);
    };
    viewport.addEventListener('change', closeDrawer);
    return () => viewport.removeEventListener('change', closeDrawer);
  }, []);
  useEffect(() => {
    if (!mobileNav) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    navRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const buttons = [
        ...(navRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [tabindex="0"]',
        ) || []),
      ].filter((element) => element.getClientRects().length);
      const first = buttons[0],
        last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', trap);
      menuRef.current?.focus();
    };
  }, [mobileNav]);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [dark, setDark] = useState(
    () => localStorage.getItem(`ledgerline.theme.${user.profile.sub}`) === 'dark',
  );
  useEffect(() => {
    localStorage.setItem(`ledgerline.theme.${user.profile.sub}`, dark ? 'dark' : 'light');
  }, [dark, user.profile.sub]);
  const [month, setMonth] = useState(today().slice(0, 7));
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const w = workspaces.find((w) => w.id === workspaceId)!;
  const localDay = today();
  const summary = useMemo(() => financialSummary(w, month, localDay), [w, month, localDay]);
  const spend = summary.spend;
  const [budgetTab, setBudgetTab] = useState<'overall' | 'categories'>('overall');
  const overallBudget = w.budgets.find((b) => b.category === 'All spending');
  const categoryBudgets = w.budgets.filter((b) => b.category !== 'All spending');
  const totalBudget = overallBudget
    ? new Decimal(overallBudget.amount)
    : sumAmounts(categoryBudgets.map((b) => b.amount));
  const open = useMemo(
    () =>
      w.commitments.filter((c) => c.state === 'open').sort((a, b) => a.due.localeCompare(b.due)),
    [w.commitments],
  );
  const dueSoon = open.filter((c) => c.due <= offsetDate(7));
  const liquid = summary.liquid;
  const filtered = useMemo(
    () =>
      w.transactions
        .filter(
          (t) =>
            (!query ||
              `${t.merchant} ${t.category} ${t.note} ${t.account}`
                .toLowerCase()
                .includes(query.toLowerCase())) &&
            (category === 'All categories' || t.category === category) &&
            t.date.startsWith(month),
        )
        .sort((a, b) => b.date.localeCompare(a.date)),
    [w.transactions, query, category, month],
  );
  const filteredExpense = useMemo(
    () => sumAmounts(filtered.filter((t) => t.kind === 'expense').map((t) => t.amount)),
    [filtered],
  );
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visiblePage = Math.min(activityPage, pageCount - 1);
  const visibleActivity = filtered.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize);
  useEffect(() => setActivityPage(0), [workspaceId, query, category, month, pageSize]);
  const update = async (next: Workspace) => {
    if (saving.current) return false;
    saving.current = true;
    setBusy(true);
    setError('');
    const values = workspaces.map((item) => (item.id === next.id ? next : item));
    try {
      const saved: Workbench = await accountRequest('/workbench', 'PUT', {
        revision: revision.current,
        requestId: crypto.randomUUID(),
        workspaces: values,
      });
      revision.current = saved.revision;
      setSavedAt(saved.updatedAt);
      setWorkspaces(saved.workspaces);
      setError('');
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your change could not be saved. Please retry.');
      return false;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const refreshData = async () => {
    if (saving.current) return;
    setBusy(true);
    try {
      const next: Workbench = await accountRequest('/workbench');
      revision.current = next.revision;
      setWorkspaces(next.workspaces);
      setSavedAt(next.updatedAt);
      setError('');
      notify('Account data refreshed.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed.');
    } finally {
      setBusy(false);
    }
  };
  const notify = (message: string) => setToast(message);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const change = () => {
      const id = location.hash.slice(1);
      if (nav.some((n) => n.id === id)) setPage(id as Page);
    };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let observer: IntersectionObserver;
    const ctx = gsap.context(() => {
      gsap.fromTo(
        '.page-heading > *',
        { y: 16, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.55, stagger: 0.07, ease: 'power3.out', clearProps: 'all' },
      );
      const cards = [
        ...(mainRef.current?.querySelectorAll<HTMLElement>(
          '.kpi, .page-content .panel, .budget-empty, .account-card',
        ) || []),
      ];
      const entered = new WeakSet<Element>();
      observer = new IntersectionObserver(
        (entries) => {
          const visible = entries.filter((entry) => entry.isIntersecting);
          visible.forEach((entry, index) => {
            gsap.to(entry.target, {
              y: 0,
              opacity: 1,
              duration: entered.has(entry.target) ? 0.32 : 0.6,
              delay: Math.min(index * 0.055, 0.22),
              ease: 'power3.out',
              overwrite: true,
            });
            entered.add(entry.target);
          });
          entries
            .filter((entry) => !entry.isIntersecting)
            .forEach((entry) => {
              // Only fade after the whole card leaves the viewport, never while it is being read.
              gsap.set(entry.target, { y: 14, opacity: 0 });
            });
        },
        { threshold: 0, rootMargin: '0px 0px -16px 0px' },
      );
      cards.forEach((card) => observer.observe(card));
    }, mainRef);
    return () => {
      observer?.disconnect();
      mainRef.current
        ?.querySelectorAll('.kpi, .page-content .panel, .budget-empty, .account-card')
        .forEach((card) => {
          gsap.killTweensOf(card);
          gsap.set(card, { clearProps: 'opacity,transform' });
        });
      ctx.revert();
    };
  }, [page, workspaceId]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        go('activity');
        searchRef.current?.focus();
      }
      if (e.key === 'Escape') {
        setMobileNav(false);
        setNotificationOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });
  const go = (next: Page) => {
    setPage(next);
    location.hash = next;
    setMobileNav(false);
    setQuery('');
    setCategory('All categories');
  };
  const pay = (item: Commitment) => setPayment(item);
  const reviewed = async (t: Transaction) => {
    if (
      await update({
        ...w,
        transactions: w.transactions.map((item) =>
          item.id === t.id ? { ...item, reviewed: !item.reviewed } : item,
        ),
      })
    )
      notify(t.reviewed ? 'Marked as needing review.' : 'Transaction reviewed.');
  };
  const openForm = (kind: FormKind) => {
    setForm(kind);
    setNotificationOpen(false);
  };

  const transactionTable = (items: Transaction[], compact = false) => (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Merchant / description</th>
            <th>Category</th>
            {!compact && <th>Account</th>}
            <th>Date</th>
            <th className="numeric">Amount</th>
            <th>
              <span className="sr-only">Review status</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <tr key={t.id}>
              <td>
                <button className="record-button" onClick={() => setDetail(t)}>
                  <span className={`merchant-icon ${t.kind}`}>
                    <span>{t.merchant.slice(0, 1)}</span>
                  </span>
                  <span>
                    <strong>{t.merchant}</strong>
                    <small>
                      {t.kind === 'transfer'
                        ? `To ${t.destination}`
                        : t.note.startsWith('Payment')
                          ? 'Linked payment'
                          : t.kind === 'income'
                            ? 'Income received'
                            : 'Recorded expense'}
                    </small>
                  </span>
                </button>
              </td>
              <td>
                <span className={`category-chip cat-${t.category.toLowerCase()}`}>
                  {t.category}
                </span>
              </td>
              {!compact && <td className="muted">{t.account}</td>}
              <td className="muted">{dateLabel(t.date)}</td>
              <td className={`numeric amount ${t.kind === 'income' ? 'positive' : ''}`}>
                {t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}
                {money(t.amount)}
              </td>
              <td>
                <button
                  className={`review-button ${t.reviewed ? 'is-reviewed' : ''}`}
                  title={t.reviewed ? 'Mark as needing review' : 'Mark reviewed'}
                  aria-label={`${t.reviewed ? 'Mark as needing review' : 'Mark reviewed'}: ${t.merchant}`}
                  onClick={() => reviewed(t)}
                >
                  {t.reviewed ? <CheckCheck size={16} /> : <span className="review-dot" />}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!items.length && (
        <Empty
          title="No activity here yet"
          text={
            query || category !== 'All categories'
              ? 'Try another search or clear your filters.'
              : 'Record an expense or choose another month to get started.'
          }
          action={() =>
            query || category !== 'All categories'
              ? (setQuery(''), setCategory('All categories'))
              : openForm('expense')
          }
          label={query || category !== 'All categories' ? 'Clear filters' : 'Add an expense'}
        />
      )}
    </div>
  );

  const commitmentList = (items: Commitment[], compact = false) => (
    <div className="commitment-list">
      {items.map((c) => (
        <div className="commitment-row" key={c.id}>
          <div className={`date-box ${c.due < today() && c.state === 'open' ? 'overdue' : ''}`}>
            <span>
              {new Date(`${c.due}T12:00:00`).toLocaleDateString('en-IN', { month: 'short' })}
            </span>
            <strong>{c.due.slice(-2)}</strong>
          </div>
          <div className="commitment-description">
            <strong>{c.name}</strong>
            <small>
              {c.kind === 'subscription'
                ? c.cadence + ' subscription'
                : c.cadence === 'Once'
                  ? 'One-off bill'
                  : c.cadence + ' bill'}
              {c.state === 'open' && c.due < today() ? ' · Overdue' : ''}
            </small>
          </div>
          <div className="commitment-amount">
            <strong>{money(c.amount)}</strong>
            <small>
              {c.state === 'paid' ? 'Paid' : c.state === 'canceled' ? 'Canceled' : 'Payment due'}
            </small>
          </div>
          {!compact && c.state === 'open' && (
            <div className="row-actions">
              <button className="button small" onClick={() => setEditCommitment(c)}>
                Edit
              </button>
              <button className="button small" onClick={() => pay(c)}>
                Record paid
              </button>
              {c.kind === 'subscription' && (
                <button
                  className="icon-button"
                  aria-label={`Cancel ${c.name}`}
                  onClick={async () => {
                    if (
                      (await ask(
                        `Mark ${c.name} canceled? You still need to cancel with the provider.`,
                      )) &&
                      (await update({
                        ...w,
                        commitments: w.commitments.map((item) =>
                          item.id === c.id ? { ...item, state: 'canceled' } : item,
                        ),
                      }))
                    )
                      notify('Canceled in tracker. Confirm cancellation with your provider.');
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          )}
          {!compact && c.state === 'paid' && c.cadence !== 'Once' && (
            <button
              className="button small"
              onClick={async () => {
                const next = nextCycle(c);
                if (
                  w.commitments.some(
                    (item) =>
                      (item.seriesId || item.id) === (c.seriesId || c.id) && item.due === next.due,
                  )
                ) {
                  notify('The next cycle is already recorded.');
                  return;
                }
                if (await update({ ...w, commitments: [...w.commitments, next] }))
                  notify('Next cycle added. The previous payment is retained.');
              }}
            >
              Track next cycle
            </button>
          )}
          {!compact && c.state === 'canceled' && (
            <button
              className="button small"
              onClick={async () => {
                if (
                  await update({
                    ...w,
                    commitments: w.commitments.map((item) =>
                      item.id === c.id ? { ...item, state: 'open' } : item,
                    ),
                  })
                )
                  notify('Commitment reopened.');
              }}
            >
              Reopen
            </button>
          )}
          {compact && <ChevronRight size={16} className="muted" />}
        </div>
      ))}
      {!items.length && (
        <Empty
          title="Nothing scheduled"
          text="Add a bill or subscription to keep its next due date in view."
          label="Add a commitment"
          action={() => openForm('bill')}
        />
      )}
    </div>
  );

  const navigationItem = (n: (typeof nav)[number]) => (
    <button
      key={n.id}
      type="button"
      aria-label={n.label}
      title={n.label}
      aria-current={page === n.id ? 'page' : undefined}
      className={`nav-item ${page === n.id ? 'active' : ''}`}
      onClick={() => go(n.id)}
    >
      <n.icon size={19} />
      <span className="nav-text">{n.label}</span>
      {n.id === 'bills' && (
        <span className="nav-count">{open.filter((c) => c.kind === 'bill').length}</span>
      )}
    </button>
  );

  return (
    <div className={`app ${dark ? 'dark' : ''} ${navCollapsed ? 'navigation-collapsed' : ''}`}>
      {converterOpen && <CurrencyConverter onClose={() => setConverterOpen(false)} />}
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      {mobileNav && (
        <button
          className="mobile-scrim"
          onClick={() => setMobileNav(false)}
          aria-label="Close navigation"
        />
      )}
      <aside
        id="workbench-navigation"
        ref={navRef}
        className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}
        aria-label="Workbench sidebar"
      >
        <div className="sidebar-brand-row">
          <button
            className="brand"
            type="button"
            aria-label="Ledgerline overview"
            onClick={() => go('overview')}
          >
            <span className="brand-mark">
              <span />
              <span />
              <span />
            </span>
            <span className="brand-word">
              ledgerline<span className="brand-period">.</span>
            </span>
          </button>
          <button
            type="button"
            className="icon-button collapse-navigation"
            aria-label={navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!navCollapsed}
            aria-controls="workbench-navigation"
            onClick={() => setNavCollapsed(!navCollapsed)}
          >
            {navCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
          <button
            className="icon-button drawer-close"
            aria-label="Close sidebar"
            onClick={() => setMobileNav(false)}
          >
            <X size={19} />
          </button>
        </div>
        <div className="workspace-select">
          <button
            type="button"
            className="workspace-avatar"
            aria-label={`Expand ${w.name} workspace selector`}
            title={w.name}
            onClick={() => setNavCollapsed(false)}
          >
            {w.type === 'business' ? <Building2 size={18} /> : <Wallet size={18} />}
          </button>
          <div className="workspace-copy">
            <span className="eyebrow">YOUR WORKSPACE</span>
            <Select
              aria-label="Switch workspace"
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value);
                setQuery('');
                setCategory('All categories');
                setMobileNav(false);
              }}
            >
              <option value="personal">
                {workspaces.find((item) => item.id === 'personal')!.name}
              </option>
              <option value="business">
                {workspaces.find((item) => item.id === 'business')!.name}
              </option>
            </Select>
          </div>
          <ChevronDown size={14} />
        </div>
        <button
          className="button primary sidebar-add"
          title="Add an entry"
          aria-label="Add an entry"
          onClick={() => {
            setMobileNav(false);
            openForm('expense');
          }}
        >
          <Plus size={17} />
          <span className="nav-text">Add an entry</span>
        </button>
        <div className="nav-label">YOUR WORKBENCH</div>
        <nav aria-label="Main navigation">
          <div className="navigation-primary">
            {nav.filter((n) => !['platform', 'settings'].includes(n.id)).map(navigationItem)}
            <button
              className="nav-item"
              title="Currency converter"
              aria-label="Currency converter"
              aria-haspopup="dialog"
              onClick={() => {
                setConverterOpen(true);
                setMobileNav(false);
              }}
            >
              <Calculator size={19} />
              <span className="nav-text">Currency converter</span>
            </button>
          </div>
          <div className="navigation-utilities">
            <span className="nav-label">ACCOUNT & SYSTEM</span>
            {nav.filter((n) => ['settings', 'platform'].includes(n.id)).map(navigationItem)}
          </div>
        </nav>
        <div className="sidebar-footer">
          <div className="user-avatar">
            {(user.profile.name || user.profile.preferred_username || 'U')
              .slice(0, 1)
              .toUpperCase()}
          </div>
          <div className="sidebar-user-copy">
            <strong>{user.profile.name || user.profile.preferred_username}</strong>
            <small>Private account</small>
          </div>
          <button className="icon-button" aria-label="Toggle theme" onClick={() => setDark(!dark)}>
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </aside>
      <div className="main-shell" inert={mobileNav ? true : undefined}>
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button menu-button"
              ref={menuRef}
              aria-label="Open navigation"
              aria-expanded={mobileNav}
              aria-controls="workbench-navigation"
              onClick={() => setMobileNav(true)}
            >
              <Menu size={20} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={14} />
            <strong>{pageNames[page]}</strong>
          </div>
          <div className="topbar-actions">
            <span className="demo-indicator">
              <span />
              Account connected
            </span>
            <button
              className="search-command"
              onClick={() => {
                go('activity');
                setTimeout(() => searchRef.current?.focus(), 0);
              }}
            >
              <Search size={15} />
              <span>Find a transaction</span>
              <kbd>⌘ K</kbd>
            </button>
            <button
              className="icon-button notification-button"
              aria-label="View upcoming reminders"
              aria-expanded={notificationOpen}
              onClick={() => setNotificationOpen(!notificationOpen)}
            >
              <Bell size={19} />
              {dueSoon.length > 0 && <span className="notification-dot" />}
            </button>
            {notificationOpen && (
              <div className="notification-panel">
                <div className="panel-header">
                  <h3>Coming up</h3>
                  <button
                    className="icon-button"
                    aria-label="Close reminders"
                    onClick={() => setNotificationOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                <p className="notification-help">
                  Upcoming commitments from your account. Configure email in Notifications.
                </p>
                {commitmentList(dueSoon, true)}
                <button
                  className="text-button"
                  onClick={() => {
                    go('notifications');
                    setNotificationOpen(false);
                  }}
                >
                  Manage notifications <ArrowRight size={14} />
                </button>
              </div>
            )}
          </div>
        </header>
        <main id="main" ref={mainRef} tabIndex={-1}>
          <div className="demo-banner">
            <Info size={14} />
            <span>
              Your private workbench · Saved to your account. Separate personal and business
              records.
            </span>
            <button
              onClick={() => {
                exportCsv(w);
                notify('Your transactions were exported.');
              }}
            >
              Export data <Download size={12} />
            </button>
          </div>
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button className="button small" onClick={() => void refreshData()}>
                Refresh account data
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {w.type === 'business' ? 'STUDIO FINANCES' : 'YOUR MONEY, IN FOCUS'}
              </span>
              <h1>
                {page === 'overview' ? 'A clearer view of your money.' : pageNames[page]}
                {page === 'overview' && <span className="title-square" />}
              </h1>
              <p>
                {page === 'overview'
                  ? 'The everyday details. The bigger picture. All in one place.'
                  : page === 'reports'
                    ? 'Explore your spending, income and category totals for any period.'
                    : page === 'activity'
                      ? 'Every expense, income and transfer — without the guesswork.'
                      : page === 'bills'
                        ? 'Know what’s due. Record what’s paid. Stay one step ahead.'
                        : page === 'subscriptions'
                          ? 'Make recurring charges a conscious choice.'
                          : page === 'budgets'
                            ? 'Give your spending a plan that works in real life.'
                            : page === 'platform'
                              ? 'Service health, metrics, logs and traces from the running stack.'
                              : page === 'notifications'
                                ? 'The right reminder. At the right time. In one place.'
                                : 'A precise view of where your money lives.'}
              </p>
            </div>
            <div className="heading-actions">
              {['overview', 'activity', 'budgets'].includes(page) && (
                <label className="month-picker">
                  <CalendarDays size={16} />
                  <input
                    type="month"
                    aria-label="Reporting month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value || today().slice(0, 7))}
                  />
                </label>
              )}
              {page !== 'overview' &&
                page !== 'accounts' &&
                page !== 'platform' &&
                page !== 'notifications' &&
                page !== 'reports' &&
                page !== 'settings' && (
                  <button
                    className="button primary"
                    onClick={() =>
                      openForm(
                        page === 'bills'
                          ? 'bill'
                          : page === 'subscriptions'
                            ? 'subscription'
                            : page === 'budgets'
                              ? 'budget'
                              : 'expense',
                      )
                    }
                  >
                    <Plus size={16} />
                    Add{' '}
                    {page === 'subscriptions'
                      ? 'subscription'
                      : page === 'bills'
                        ? 'bill'
                        : page === 'budgets'
                          ? 'budget'
                          : 'entry'}
                  </button>
                )}
            </div>
          </div>
          <div className="page-content">
            {page === 'platform' && <PlatformStatus />}
            {page === 'reports' && <Reports key={w.id} workspace={w} />}
            {page === 'notifications' && <NotificationCenter workspace={w} />}
            {page === 'overview' && (
              <>
                <div className="kpi-grid">
                  <Kpi
                    label="SPENT THIS MONTH"
                    value={money(spend)}
                    detail="Posted expenses only"
                    icon={<ArrowUpRight size={18} />}
                    tone="expense"
                  />
                  <Kpi
                    label="BUDGET REMAINING"
                    value={money(totalBudget.minus(spend))}
                    detail={`Of ${money(totalBudget)} planned`}
                    icon={<Layers3 size={18} />}
                    tone="budget"
                  />
                  <Kpi
                    label="DUE IN 7 DAYS"
                    value={money(sumAmounts(dueSoon.map((c) => c.amount)))}
                    detail={`${dueSoon.length} upcoming commitments`}
                    icon={<CalendarDays size={18} />}
                    tone="due"
                  />
                  <Kpi
                    label="NET RECORDED BALANCE"
                    value={money(liquid)}
                    detail="All recorded accounts · signed balances"
                    icon={<Wallet size={18} />}
                    tone="balance"
                  />
                </div>
                <div className="overview-grid">
                  <section className="panel spend-panel">
                    <div className="panel-header">
                      <div>
                        <span className="eyebrow">THE MONTH SO FAR</span>
                        <h2>Where your money goes</h2>
                      </div>
                      <button className="text-button" onClick={() => go('budgets')}>
                        View budget <ArrowUpRight size={15} />
                      </button>
                    </div>
                    <div className="spend-summary">
                      <strong className="big-amount">{money(spend)}</strong>
                      <span>
                        across{' '}
                        {
                          w.transactions.filter(
                            (t) => t.kind === 'expense' && t.date.startsWith(month),
                          ).length
                        }{' '}
                        expenses
                      </span>
                    </div>
                    <div className="category-bars">
                      {categoryBudgets.slice(0, 5).map((b, i) => {
                        const amount =
                          b.category === 'All spending'
                            ? summary.spend
                            : summary.categories.get(b.category) || new Decimal(0);
                        const percentage = Math.min(
                          100,
                          totalBudget.gt(0) ? amount.div(totalBudget).times(100).toNumber() : 0,
                        );
                        return (
                          <div className="category-bar-row" key={b.category}>
                            <div>
                              <span className={`bar-dot dot-${i}`} />
                              {b.category}
                              <strong>{money(amount)}</strong>
                            </div>
                            <div className="bar-track">
                              <div
                                className={`bar-fill fill-${i}`}
                                style={{ width: `${percentage}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div className="panel-footnote">
                      <ShieldCheck size={14} />
                      Transfers are excluded from spending. Figures use your selected month.
                    </div>
                  </section>
                  <section className="panel upcoming-panel">
                    <div className="panel-header">
                      <div>
                        <span className="eyebrow">ON THE HORIZON</span>
                        <h2>Upcoming payments</h2>
                      </div>
                      <span className="count-badge">{open.length}</span>
                    </div>
                    {commitmentList(open.slice(0, 4), true)}
                    <button className="panel-footer-button" onClick={() => go('bills')}>
                      Manage your bills <ArrowRight size={16} />
                    </button>
                  </section>
                </div>
                <div className="review-strip">
                  <span className="review-strip-icon">
                    <CheckCheck size={21} />
                  </span>
                  <div>
                    <strong>A little review goes a long way.</strong>
                    <p>
                      {w.transactions.filter((t) => !t.reviewed).length} transactions need a quick
                      look. Keep your records working for you.
                    </p>
                  </div>
                  <button className="button" onClick={() => go('activity')}>
                    Review activity <ArrowRight size={15} />
                  </button>
                </div>
                <section className="panel">
                  <div className="panel-header">
                    <div>
                      <span className="eyebrow">YOUR FINANCIAL TRAIL</span>
                      <h2>Recent activity</h2>
                    </div>
                    <button className="text-button" onClick={() => go('activity')}>
                      All activity <ArrowUpRight size={15} />
                    </button>
                  </div>
                  {transactionTable(filtered.slice(0, 5), true)}
                </section>
              </>
            )}
            {page === 'activity' && (
              <section className="panel">
                <div className="filter-toolbar">
                  <label className="search-field">
                    <Search size={17} />
                    <input
                      ref={searchRef}
                      placeholder="Search merchant, category, account…"
                      aria-label="Search activity"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <label className="filter-select">
                    <SlidersHorizontal size={15} />
                    <Select
                      aria-label="Filter category"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option>All categories</option>
                      {categories.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </Select>
                  </label>
                  <button className="button" onClick={() => exportCsv(w)}>
                    <Download size={15} />
                    Export CSV
                  </button>
                </div>
                <div className="list-summary">
                  <span>{filtered.length} records</span>
                  <span>
                    Expense total <strong>{money(filteredExpense)}</strong>
                  </span>
                </div>
                {transactionTable(visibleActivity)}
                {!!filtered.length && (
                  <div className="activity-pagination" aria-label="Activity pagination">
                    <span role="status">
                      {visiblePage * pageSize + 1}–
                      {Math.min((visiblePage + 1) * pageSize, filtered.length)} of {filtered.length}{' '}
                      records
                    </span>
                    <label>
                      Rows per page
                      <Select
                        value={pageSize}
                        onChange={(event) => setPageSize(Number(event.target.value))}
                      >
                        {[50, 100, 250].map((size) => (
                          <option value={size} key={size}>
                            {size}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <div>
                      <button
                        className="button small"
                        disabled={visiblePage === 0}
                        onClick={() => setActivityPage(visiblePage - 1)}
                        aria-label="Previous activity page"
                      >
                        <ChevronLeft size={16} /> Previous
                      </button>
                      <span>
                        Page {visiblePage + 1} of {pageCount}
                      </span>
                      <button
                        className="button small"
                        disabled={visiblePage + 1 >= pageCount}
                        onClick={() => setActivityPage(visiblePage + 1)}
                        aria-label="Next activity page"
                      >
                        Next <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </section>
            )}
            {(page === 'bills' || page === 'subscriptions') && (
              <>
                <div className="compact-kpis">
                  <Kpi
                    label={page === 'bills' ? 'OUTSTANDING BILLS' : 'MONTHLY EQUIVALENT'}
                    value={money(
                      sumAmounts(
                        w.commitments
                          .filter(
                            (c) =>
                              c.kind === (page === 'bills' ? 'bill' : 'subscription') &&
                              c.state === 'open',
                          )
                          .map((c) =>
                            page === 'subscriptions' && c.cadence === 'Yearly'
                              ? new Decimal(c.amount).div(12).toString()
                              : c.amount,
                          ),
                      ),
                    )}
                    detail={
                      page === 'bills' ? 'Unpaid tracked commitments' : 'Active plans · estimate'
                    }
                    tone="due"
                  />
                  <Kpi
                    label="NEXT 7 DAYS"
                    value={money(
                      sumAmounts(
                        dueSoon
                          .filter((c) => c.kind === (page === 'bills' ? 'bill' : 'subscription'))
                          .map((c) => c.amount),
                      ),
                    )}
                    detail="Confirmed schedule · not posted spend"
                    tone="budget"
                  />
                </div>
                <section className="panel">
                  <div className="panel-header">
                    <h2>{page === 'bills' ? 'Your bills' : 'Your subscriptions'}</h2>
                    <span className="status-label">
                      <span /> Manual tracking
                    </span>
                  </div>
                  {commitmentList(
                    w.commitments.filter(
                      (c) => c.kind === (page === 'bills' ? 'bill' : 'subscription'),
                    ),
                  )}
                  <div className="panel-footnote">
                    <Info size={14} />
                    {page === 'bills'
                      ? 'Recording paid creates a linked expense. It does not initiate a bank payment.'
                      : 'Canceling here updates your tracker. Cancel directly with the provider too.'}
                  </div>
                </section>
              </>
            )}
            {page === 'budgets' && (
              <>
                <div className="compact-kpis">
                  <Kpi
                    label="MONTHLY PLAN"
                    value={money(totalBudget)}
                    detail={overallBudget ? 'Overall spending limit' : 'Sum of category limits'}
                    tone="budget"
                  />
                  <Kpi
                    label="ACTUAL SPENDING"
                    value={money(spend)}
                    detail={dateLabel(`${month}-01`)}
                    tone="expense"
                  />
                </div>
                <section className="panel">
                  <div className="panel-header">
                    <h2>
                      {budgetTab === 'overall' ? 'Overall monthly budget' : 'Category limits'}
                    </h2>
                    <span className="muted">Actual spend / planned amount</span>
                  </div>
                  <div className="budget-tabs" role="tablist" aria-label="Budget scope">
                    <button
                      role="tab"
                      aria-selected={budgetTab === 'overall'}
                      onClick={() => setBudgetTab('overall')}
                    >
                      Overall budget
                    </button>
                    <button
                      role="tab"
                      aria-selected={budgetTab === 'categories'}
                      onClick={() => setBudgetTab('categories')}
                    >
                      Category limits
                    </button>
                  </div>
                  {((budgetTab === 'overall' && !overallBudget) ||
                    (budgetTab === 'categories' && !categoryBudgets.length)) && (
                    <div className="budget-empty">
                      <span className="budget-empty-icon">
                        <Layers3 size={24} />
                      </span>
                      <span className="eyebrow">
                        {budgetTab === 'overall' ? 'YOUR MONTH, ONE PLAN' : 'A LITTLE MORE CONTROL'}
                      </span>
                      <h3>
                        {budgetTab === 'overall'
                          ? 'One limit for your whole month'
                          : 'Keep individual categories on track'}
                      </h3>
                      <p>
                        {budgetTab === 'overall'
                          ? 'Set a monthly spending ceiling across all your expenses. Income and transfers are excluded. Category limits can sit underneath it without increasing your overall plan.'
                          : 'Add limits for groceries, dining or other categories. These track separately from your overall budget.'}
                      </p>
                      <button className="button primary" onClick={() => openForm('budget')}>
                        <Plus size={16} />
                        Set budget
                      </button>
                    </div>
                  )}
                  <div className="budget-list">
                    {(budgetTab === 'overall'
                      ? overallBudget
                        ? [overallBudget]
                        : []
                      : categoryBudgets
                    ).map((b, i) => {
                      const actual =
                        b.category === 'All spending'
                          ? summary.spend
                          : summary.categories.get(b.category) || new Decimal(0);
                      const pct = Math.min(100, actual.div(b.amount).times(100).toNumber());
                      return (
                        <div
                          className={`budget-row ${b.category === 'All spending' ? 'overall-budget-card' : ''}`}
                          key={b.category}
                        >
                          <div className="budget-title">
                            {b.category === 'All spending' ? (
                              <span className="budget-emblem">
                                <Layers3 size={22} />
                              </span>
                            ) : (
                              <span className={`bar-dot dot-${i % 5}`} />
                            )}
                            <strong>
                              {b.category === 'All spending'
                                ? 'Your monthly spending plan'
                                : b.category}
                            </strong>
                            {b.category === 'All spending' && (
                              <button
                                className="button small budget-adjust"
                                onClick={() => openForm('budget')}
                              >
                                Adjust limit <SlidersHorizontal size={14} />
                              </button>
                            )}
                            <button
                              className="icon-button"
                              aria-label={`Remove ${b.category} budget`}
                              onClick={async () => {
                                if (
                                  (await ask(
                                    `Remove the ${b.category} budget? Expenses will be retained.`,
                                  )) &&
                                  (await update({
                                    ...w,
                                    budgets: w.budgets.filter(
                                      (item) => item.category !== b.category,
                                    ),
                                  }))
                                )
                                  notify('Budget removed. Your expenses are unchanged.');
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                          <div className="budget-progress">
                            <div
                              className="bar-track"
                              role="progressbar"
                              aria-label={`${b.category} budget used`}
                              aria-valuenow={Math.round(pct)}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuetext={`${money(actual)} spent of ${money(b.amount)}`}
                            >
                              <div
                                className={
                                  actual.gt(b.amount)
                                    ? 'bar-fill overspent'
                                    : `bar-fill fill-${i % 5}`
                                }
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span>
                              {actual.gt(b.amount) ? 'Over budget' : `${Math.round(pct)}% used`}
                            </span>
                          </div>
                          <div className="budget-amount">
                            {b.category === 'All spending' && (
                              <span className="eyebrow">SPENT THIS MONTH</span>
                            )}
                            <strong>
                              {money(actual)}{' '}
                              <span>
                                {b.category === 'All spending' ? 'of' : '/'} {money(b.amount)}
                                {b.category === 'All spending' ? ' planned' : ''}
                              </span>
                            </strong>
                            <small className={actual.gt(b.amount) ? 'danger' : 'muted'}>
                              {money(new Decimal(b.amount).minus(actual).abs().toString())}{' '}
                              {actual.gt(b.amount) ? 'over your limit' : 'left to spend'}
                            </small>
                          </div>
                          {b.category === 'All spending' && (
                            <p className="overall-budget-note">
                              One ceiling across all expense categories. Income and transfers stay
                              outside this plan.
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="panel-footnote">
                    <Info size={14} />
                    Overall and category limits repeat monthly. Category limits are never added to
                    the overall budget. Only expenses in the selected month count.
                  </div>
                </section>
              </>
            )}
            {page === 'accounts' && (
              <div className="account-grid">
                <button className="button primary" onClick={() => setFundingAccount('')}>
                  Add an account <Plus size={16} />
                </button>
                {Object.keys(w.opening).map((account, i) => (
                  <section className="panel account-card" key={account}>
                    <div className="account-top">
                      <span className="account-icon">
                        {i === 1 ? <CreditCard size={24} /> : <Wallet size={24} />}
                      </span>
                      <span className="status-label">Manual · INR</span>
                    </div>
                    <h2>{account}</h2>
                    <strong className="account-value">
                      {money(summary.balances.get(account) || '0')}
                    </strong>
                    <p>
                      {i === 1
                        ? 'Signed balance · negative indicates recorded debt'
                        : 'Opening balance + recorded activity'}
                    </p>
                    <div className="account-divider" />
                    <button
                      className="text-button"
                      onClick={() => {
                        go('activity');
                        setQuery(account);
                      }}
                    >
                      View activity <ArrowRight size={15} />
                    </button>
                    <div className="account-actions">
                      <button className="text-button" onClick={() => setFundingAccount(account)}>
                        Edit account
                      </button>
                    </div>
                  </section>
                ))}
              </div>
            )}
            {page === 'settings' && (
              <AccountSettings
                user={user}
                workspace={w}
                workspaces={workspaces}
                onSave={update}
                onRefresh={refreshData}
                savedAt={savedAt}
              />
            )}
            <footer className="page-footer">
              <span>
                LEDGERLINE <span className="footer-dot">/</span> A workbench for everyday money
              </span>
              <span>
                <ShieldCheck size={12} />
                Private account · INR
              </span>
            </footer>
          </div>
        </main>
      </div>
      {confirmation}
      {payment && (
        <PaymentDialog
          item={payment}
          workspace={w}
          onSave={async (next) => {
            const saved = await update(next);
            if (saved) notify('Payment recorded. Future reminders updated.');
            return saved;
          }}
          onClose={() => setPayment(null)}
        />
      )}
      {form && (
        <EntryDialog
          kind={form}
          initialBudgetScope={page === 'budgets' ? budgetTab : 'overall'}
          saveError={error}
          workspace={w}
          onClose={() => setForm(null)}
          onSave={async (next) => {
            if (await update(next)) {
              setForm(null);
              notify(
                form === 'budget'
                  ? 'Budget allocation saved.'
                  : form === 'bill' || form === 'subscription'
                    ? 'Commitment added to your tracker.'
                    : 'Entry saved to your account.',
              );
            }
          }}
          onKind={setForm}
        />
      )}
      {fundingAccount !== null && (
        <FundingAccountDialog
          account={fundingAccount}
          workspace={w}
          onClose={() => setFundingAccount(null)}
          onSave={update}
        />
      )}
      {busy && (
        <div className="save-overlay" role="status" aria-live="polite">
          <span>Saving to your account…</span>
        </div>
      )}
      {detail && (
        <Modal title="Transaction detail" onClose={() => setDetail(null)}>
          <div className="detail-amount">
            {money(detail.amount)}
            <span>{detail.kind} · INR</span>
          </div>
          <dl className="detail-list">
            {[
              ['Merchant', detail.merchant],
              ['Date', dateLabel(detail.date)],
              ['Account', detail.account],
              ['Category', detail.category],
              ['Review', detail.reviewed ? 'Reviewed' : 'Needs review'],
              ['Note', detail.note || 'No note'],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="form-note">
            <Info size={16} />
            Account-owned record. Changes are saved with a revision history. Ledgerline does not
            move money.
          </div>
          <div className="account-actions">
            <button
              className="button"
              onClick={() => {
                setEditTransaction(detail);
                setDetail(null);
              }}
            >
              Edit transaction
            </button>
            <button
              className="button"
              onClick={async () => {
                if (w.commitments.some((item) => item.paidTransactionId === detail.id)) {
                  notify('This payment is linked to a commitment and cannot be deleted.');
                  return;
                }
                if (
                  (await ask(
                    'Delete this transaction from your tracker? A prior revision remains in history.',
                  )) &&
                  (await update({
                    ...w,
                    transactions: w.transactions.filter((item) => item.id !== detail.id),
                  }))
                ) {
                  setDetail(null);
                  notify('Transaction deleted from tracker.');
                }
              }}
            >
              Delete transaction
            </button>
          </div>
        </Modal>
      )}
      {(editTransaction || editCommitment) && (
        <RecordEditor
          transaction={editTransaction || undefined}
          commitment={editCommitment || undefined}
          workspace={w}
          onSave={update}
          onClose={() => {
            setEditTransaction(null);
            setEditCommitment(null);
          }}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button aria-label="Dismiss notification" onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

// Exact decimal arithmetic; presentation must not introduce floating-point subtraction.

function Kpi({
  label,
  value,
  detail,
  icon,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  icon?: React.ReactNode;
  tone: string;
}) {
  return (
    <div className={`kpi kpi-${tone}`}>
      <div className="kpi-label">
        {label}
        {icon}
      </div>
      <strong>{value}</strong>
      <span>{detail}</span>
    </div>
  );
}
function Empty({
  title,
  text,
  label,
  action,
}: {
  title: string;
  text: string;
  label: string;
  action: () => void;
}) {
  return (
    <div className="empty-state">
      <FileText size={28} />
      <h3>{title}</h3>
      <p>{text}</p>
      <button className="button" onClick={action}>
        {label}
      </button>
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [returnFocus] = useState(() => document.activeElement as HTMLElement | null);
  useEffect(() => {
    const element = ref.current!;
    element.showModal();
    element.querySelector<HTMLInputElement>('input')?.focus();
    return () => {
      element.close();
      returnFocus?.focus();
    };
  }, [returnFocus]);
  return (
    <dialog ref={ref} className="entry-dialog" onCancel={onClose} aria-labelledby="dialog-title">
      <div className="dialog-header">
        <div>
          <span className="eyebrow">LEDGERLINE / MANUAL ENTRY</span>
          <h2 id="dialog-title">{title}</h2>
        </div>
        <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function EntryDialog({
  kind,
  initialBudgetScope,
  saveError,
  workspace,
  onClose,
  onSave,
  onKind,
}: {
  kind: FormKind;
  initialBudgetScope: 'overall' | 'categories';
  saveError: string;
  workspace: Workspace;
  onClose: () => void;
  onSave: (w: Workspace) => Promise<void>;
  onKind: (k: FormKind) => void;
}) {
  const [amount, setAmount] = useState(() =>
    kind === 'budget' && initialBudgetScope === 'overall'
      ? workspace.budgets.find((b) => b.category === 'All spending')?.amount || ''
      : '',
  );
  const [merchant, setMerchant] = useState('');
  const [date, setDate] = useState(today());
  const accounts = Object.keys(workspace.opening);
  const [account, setAccount] = useState(accounts[0]);
  const [destination, setDestination] = useState(accounts[1] || accounts[0]);
  const [category, setCategory] = useState('Groceries');
  const [budgetScope, setBudgetScope] = useState<'overall' | 'categories'>(initialBudgetScope);
  const [note, setNote] = useState('');
  const [cadence, setCadence] = useState<Commitment['cadence']>(
    kind === 'bill' ? 'Once' : 'Monthly',
  );
  const [error, setError] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!validateAmount(amount)) {
      setError('Enter an amount between ₹0.01 and ₹999,999,999.99 with up to two decimal places.');
      return;
    }
    if (kind !== 'budget' && kind !== 'transfer' && !merchant.trim()) {
      setError('Enter a merchant or a name for this entry.');
      return;
    }
    if (kind === 'transfer' && account === destination) {
      setError('Choose two different accounts for a transfer.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('Choose a valid date.');
      return;
    }
    const exact = new Decimal(amount).toFixed(2);
    const id = crypto.randomUUID();
    if (kind === 'budget') {
      const budgetCategory = budgetScope === 'overall' ? 'All spending' : category;
      onSave({
        ...workspace,
        budgets: [
          ...workspace.budgets.filter((b) => b.category !== budgetCategory),
          { category: budgetCategory, amount: exact },
        ],
      });
    } else if (kind === 'bill' || kind === 'subscription') {
      onSave({
        ...workspace,
        commitments: [
          ...workspace.commitments,
          {
            id,
            name: merchant.trim(),
            amount: exact,
            due: date,
            category,
            kind,
            cadence,
            state: 'open',
          },
        ],
      });
    } else {
      onSave({
        ...workspace,
        transactions: [
          {
            id,
            kind,
            merchant: kind === 'transfer' ? `${account} → ${destination}` : merchant.trim(),
            amount: exact,
            date,
            account,
            destination: kind === 'transfer' ? destination : undefined,
            category: kind === 'transfer' ? 'Transfer' : kind === 'income' ? 'Income' : category,
            note,
            reviewed: true,
          },
          ...workspace.transactions,
        ],
      });
    }
  };
  return (
    <Modal
      title={
        kind === 'budget'
          ? 'Set a monthly budget'
          : kind === 'subscription'
            ? 'Add a subscription'
            : kind === 'bill'
              ? 'Add a bill'
              : kind === 'transfer'
                ? 'Record a transfer'
                : kind === 'income'
                  ? 'Record income'
                  : 'Record an expense'
      }
      onClose={onClose}
    >
      <form onSubmit={submit}>
        <div className="entry-tabs" aria-label="Entry type">
          {(['expense', 'income', 'transfer', 'bill', 'subscription', 'budget'] as FormKind[]).map(
            (k) => (
              <button
                type="button"
                key={k}
                className={k === kind ? 'selected' : ''}
                onClick={() => {
                  onKind(k);
                  setError('');
                }}
              >
                {k.charAt(0).toUpperCase() + k.slice(1)}
              </button>
            ),
          )}
        </div>
        <div className="form-body">
          {(error || saveError) && (
            <div className="error-banner" role="alert">
              {error || saveError}
            </div>
          )}
          <label className="field amount-field">
            <span>
              {kind === 'budget' ? 'Monthly allocation' : 'Amount'} <small>INR</small>
            </span>
            <div className="amount-input">
              <span>₹</span>
              <input
                autoFocus
                inputMode="decimal"
                placeholder="0.00"
                aria-label="Amount in INR"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>
          </label>
          <div className="form-grid">
            {kind === 'budget' && (
              <div className="field full">
                <span>Budget scope</span>
                <div className="budget-tabs" role="tablist" aria-label="Budget scope">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={budgetScope === 'overall'}
                    onClick={() => setBudgetScope('overall')}
                  >
                    Overall budget
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={budgetScope === 'categories'}
                    onClick={() => setBudgetScope('categories')}
                  >
                    Category limit
                  </button>
                </div>
                <p className="platform-help">
                  {budgetScope === 'overall'
                    ? 'A single monthly limit for all your spending.'
                    : 'A separate ceiling for one category, inside your overall plan.'}
                </p>
              </div>
            )}
            {kind !== 'budget' && kind !== 'transfer' && (
              <label className="field full">
                <span>
                  {kind === 'bill'
                    ? 'Payee / bill name'
                    : kind === 'subscription'
                      ? 'Provider / plan'
                      : 'Merchant / description'}
                </span>
                <input
                  maxLength={120}
                  placeholder={kind === 'subscription' ? 'e.g. Spotify Premium' : 'e.g. Freshmart'}
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  required
                />
              </label>
            )}
            {kind !== 'budget' && (
              <label className="field">
                <span>
                  {kind === 'bill' || kind === 'subscription'
                    ? 'Next due date'
                    : 'Transaction date'}
                </span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                />
              </label>
            )}
            {!['budget', 'bill', 'subscription'].includes(kind) && (
              <label className="field">
                <span>{kind === 'transfer' ? 'From account' : 'Account'}</span>
                <Select value={account} onChange={(e) => setAccount(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </Select>
              </label>
            )}
            {kind === 'transfer' ? (
              <label className="field">
                <span>To account</span>
                <Select value={destination} onChange={(e) => setDestination(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a}>{a}</option>
                  ))}
                </Select>
              </label>
            ) : (
              kind !== 'income' &&
              (kind !== 'budget' || budgetScope === 'categories') && (
                <label className="field">
                  <span>Category</span>
                  <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                    {categories
                      .filter((c) => !['Income', 'Transfer'].includes(c))
                      .map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                  </Select>
                </label>
              )
            )}
            {(kind === 'subscription' || kind === 'bill') && (
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
            {!['budget', 'bill', 'subscription'].includes(kind) && (
              <label className="field full">
                <span>
                  Note <small>Not required</small>
                </span>
                <textarea
                  rows={3}
                  maxLength={1000}
                  placeholder="Anything you’d like to remember"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            )}
          </div>
          <div className="form-note">
            <ShieldCheck size={16} />
            <span>
              {kind === 'bill' || kind === 'subscription'
                ? 'Track the next due date without posting spend. Record a payment, then advance recurring commitments to their next cycle.'
                : kind === 'transfer'
                  ? 'A transfer moves your recorded balance between accounts. It is excluded from spending.'
                  : kind === 'budget'
                    ? 'Sets a recurring monthly spending limit. Category limits track separately without adding to your overall budget.'
                    : 'Saves a reviewed entry to your private account. No bank payment is initiated.'}
            </span>
          </div>
        </div>
        <div className="dialog-footer">
          <button type="button" className="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" type="submit">
            <Check size={16} />
            Save{' '}
            {kind === 'budget'
              ? 'budget'
              : kind === 'bill' || kind === 'subscription'
                ? 'commitment'
                : 'entry'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
