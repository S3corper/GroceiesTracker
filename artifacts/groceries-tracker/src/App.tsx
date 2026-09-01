import { type ReactNode, useEffect, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  BarChart3,
  ChevronDown,
  CircleDashed,
  ClipboardList,
  FileText,
  Gift,
  LayoutDashboard,
  ListChecks,
  PieChart,
  Plus,
  ReceiptText,
  Target,
  UsersRound,
  X,
  PiggyBank,
  Settings2,
} from 'lucide-react';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

type ModalKind = 'receipt' | 'budget' | 'goal' | 'upgrade' | null;
type Receipt = { store: string; amount: number; date: string };

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Receipts', icon: ReceiptText },
  { label: 'Summary', icon: BarChart3 },
  { label: 'Grocery Lists', icon: ListChecks },
  { label: 'Group Profile', icon: UsersRound },
];

const months = ['July 2026', 'August 2026', 'September 2026'];

function Brand() {
  return (
    <div className="brand" data-testid="brand-groceries-tracker">
      <span className="brand-mark">G</span>
      <span>GroceriesTracker</span>
    </div>
  );
}

function Sidebar({
  activeSection,
  setActiveSection,
  workspaceOpen,
  setWorkspaceOpen,
  profileOpen,
  setProfileOpen,
  onToast,
  onUpgrade,
}: {
  activeSection: string;
  setActiveSection: (value: string) => void;
  workspaceOpen: boolean;
  setWorkspaceOpen: (value: boolean) => void;
  profileOpen: boolean;
  setProfileOpen: (value: boolean) => void;
  onToast: (message: string) => void;
  onUpgrade: () => void;
}) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <Brand />
      <button
        className="workspace"
        onClick={() => {
          setWorkspaceOpen(!workspaceOpen);
          setProfileOpen(false);
        }}
        data-testid="button-workspace-selector"
        aria-expanded={workspaceOpen}
      >
        <span className="workspace-label">Workspace</span>
        <span className="workspace-name">
          Personal
          <span className="workspace-count">
            1 member <ChevronDown size={11} strokeWidth={1.8} />
          </span>
        </span>
      </button>
      {workspaceOpen && (
        <div className="workspace-menu" data-testid="menu-workspace">
          <button className="menu-item" onClick={() => { setWorkspaceOpen(false); onToast('Personal workspace selected'); }} data-testid="menu-personal-workspace">
            Personal <span style={{ color: 'hsl(var(--muted-foreground))' }}>· current</span>
          </button>
          <button className="menu-item" onClick={() => { setWorkspaceOpen(false); onToast('Shared workspaces are available on Plus'); }} data-testid="menu-shared-workspace">
            Add a workspace
          </button>
        </div>
      )}
      <nav className="nav">
        {navItems.map(({ label, icon: Icon }) => (
          <button
            className={`nav-button ${activeSection === label ? 'active' : ''}`}
            key={label}
            onClick={() => {
              setActiveSection(label);
              onToast(label === 'Dashboard' ? 'Dashboard selected' : `${label} view selected`);
            }}
            data-testid={`button-nav-${label.toLowerCase().replaceAll(' ', '-')}`}
          >
            <Icon size={12} strokeWidth={1.8} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-bottom">
        <div className="trial-card" data-testid="card-free-trial">
          <div className="trial-title">Free Trial</div>
          <div className="trial-copy">0 of 13 receipts</div>
          <button className="upgrade-button" onClick={onUpgrade} data-testid="button-upgrade">
            Upgrade
          </button>
        </div>
        <button className="refer-button" onClick={() => onToast('Referral link copied — thank you for sharing')} data-testid="button-refer-friend">
          <span><Gift size={10} style={{ verticalAlign: 'middle', display: 'inline', marginRight: 5 }} />Refer a friend</span>
          <span className="refer-reward">$5</span>
        </button>
        <button
          className="profile-button"
          onClick={() => { setProfileOpen(!profileOpen); setWorkspaceOpen(false); }}
          data-testid="button-user-menu"
          aria-expanded={profileOpen}
        >
          <span className="avatar">S</span>
          <span className="profile-copy">
            <span className="profile-name">Scorper</span>
            <span className="profile-email">stupidscorpion025@gmail.com</span>
          </span>
          <ChevronDown size={10} color="hsl(var(--muted-foreground))" />
        </button>
        {profileOpen && (
          <div className="profile-menu" data-testid="menu-user">
            <button className="menu-item" onClick={() => onToast('Settings are ready when you are')} data-testid="menu-settings">
              <Settings2 size={11} style={{ verticalAlign: 'middle', marginRight: 6 }} /> Settings
            </button>
            <button className="menu-item" onClick={() => { setProfileOpen(false); onToast('Signed out of this demo'); }} data-testid="menu-sign-out">
              Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function Modal({
  kind,
  onClose,
  onReceipt,
  onBudget,
  onGoal,
}: {
  kind: ModalKind;
  onClose: () => void;
  onReceipt: (receipt: Receipt) => void;
  onBudget: (amount: number) => void;
  onGoal: (goal: { name: string; amount: number }) => void;
}) {
  const [store, setStore] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('2026-08-15');
  const [goalName, setGoalName] = useState('');

  if (!kind) return null;
  const isReceipt = kind === 'receipt';
  const isBudget = kind === 'budget';
  const isGoal = kind === 'goal';
  const title = isReceipt ? 'Add a receipt' : isBudget ? 'Set your grocery budget' : isGoal ? 'Start a savings goal' : 'Make grocery spending feel lighter';
  const subtitle = isReceipt
    ? 'A quick note now makes your month easier to understand later.'
    : isBudget
      ? 'Pick a monthly number and we’ll keep it in view without the pressure.'
      : isGoal
        ? 'Give your next good thing a name and a little room in the budget.'
        : 'Upgrade for unlimited receipts, custom categories, and shared workspaces.';

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isReceipt && store.trim() && Number(amount) > 0) {
      onReceipt({ store: store.trim(), amount: Number(amount), date });
      return;
    }
    if (isBudget && Number(amount) > 0) {
      onBudget(Number(amount));
      return;
    }
    if (isGoal && goalName.trim() && Number(amount) > 0) {
      onGoal({ name: goalName.trim(), amount: Number(amount) });
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-testid={`modal-${kind}`}>
        <div className="modal-head">
          <div>
            <div className="modal-title" id="modal-title">{title}</div>
            <div className="modal-sub">{subtitle}</div>
          </div>
          <button className="close-button" onClick={onClose} data-testid="button-close-modal" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        {kind === 'upgrade' ? (
          <>
            <div className="form-stack">
              <div className="receipt-row"><span>Unlimited receipt history</span><span className="refer-reward">Included</span></div>
              <div className="receipt-row"><span>Shared household workspace</span><span className="refer-reward">Included</span></div>
              <div className="receipt-row"><span>Category insights</span><span className="refer-reward">Included</span></div>
            </div>
            <div className="modal-actions">
              <button className="secondary-button" onClick={onClose} data-testid="button-cancel-upgrade">Maybe later</button>
              <button className="primary-button" onClick={() => { onClose(); }} data-testid="button-start-upgrade">Continue to upgrade</button>
            </div>
          </>
        ) : (
          <form className="form-stack" onSubmit={submit}>
            {isReceipt && (
              <>
                <label className="field-label">Store
                  <input className="field-input" value={store} onChange={(event) => setStore(event.target.value)} placeholder="e.g. Market Street Co-op" data-testid="input-receipt-store" autoFocus />
                </label>
                <label className="field-label">Total
                  <input className="field-input" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" type="number" min="0.01" step="0.01" data-testid="input-receipt-amount" />
                </label>
                <label className="field-label">Date
                  <input className="field-input" value={date} onChange={(event) => setDate(event.target.value)} type="date" data-testid="input-receipt-date" />
                </label>
              </>
            )}
            {isBudget && (
              <label className="field-label">Monthly budget
                <input className="field-input" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="450.00" type="number" min="1" step="1" data-testid="input-budget-amount" autoFocus />
              </label>
            )}
            {isGoal && (
              <>
                <label className="field-label">What are you saving for?
                  <input className="field-input" value={goalName} onChange={(event) => setGoalName(event.target.value)} placeholder="A Sunday dinner out" data-testid="input-goal-name" autoFocus />
                </label>
                <label className="field-label">Target amount
                  <input className="field-input" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="120.00" type="number" min="1" step="1" data-testid="input-goal-amount" />
                </label>
              </>
            )}
            <div className="modal-actions">
              <button type="button" className="secondary-button" onClick={onClose} data-testid="button-cancel-modal">Cancel</button>
              <button type="submit" className="primary-button" data-testid={`button-save-${kind}`}>
                {isReceipt ? 'Add receipt' : isBudget ? 'Save budget' : 'Set goal'}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

function Dashboard() {
  const [activeSection, setActiveSection] = useState('Dashboard');
  const [month, setMonth] = useState('August 2026');
  const [monthOpen, setMonthOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [goal, setGoal] = useState<{ name: string; amount: number } | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [showAll, setShowAll] = useState(false);
  const [toast, setToast] = useState('');

  const monthName = month.split(' ')[0];
  const showToast = (message: string) => setToast(message);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const addReceipt = (receipt: Receipt) => {
    setReceipts((current) => [receipt, ...current]);
    setModal(null);
    showToast('Receipt added to your month');
  };

  const saveBudget = (amount: number) => {
    setBudget(amount);
    setModal(null);
    showToast(`Budget set to $${amount.toFixed(0)} for ${monthName}`);
  };

  const saveGoal = (newGoal: { name: string; amount: number }) => {
    setGoal(newGoal);
    setModal(null);
    showToast('Your first goal is ready');
  };

  const total = receipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  const visibleReceipts = showAll ? receipts : receipts.slice(0, 3);

  return (
    <div className="app-shell">
      <Sidebar
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        workspaceOpen={workspaceOpen}
        setWorkspaceOpen={setWorkspaceOpen}
        profileOpen={profileOpen}
        setProfileOpen={setProfileOpen}
        onToast={showToast}
        onUpgrade={() => setModal('upgrade')}
      />
      <main className="main">
        <div className="content-wrap">
          <header className="topbar">
            <div className="page-title">
              <span data-testid="text-page-title">{activeSection}</span>
              <div style={{ position: 'relative' }}>
                <button className="month-select" onClick={() => setMonthOpen(!monthOpen)} data-testid="button-month-selector" aria-expanded={monthOpen}>
                  {monthName} <ChevronDown size={11} strokeWidth={2} />
                </button>
                {monthOpen && (
                  <div className="workspace-menu" style={{ top: 32, left: 0 }} data-testid="menu-months">
                    {months.map((option) => (
                      <button className="menu-item" key={option} onClick={() => { setMonth(option); setMonthOpen(false); showToast(`${option} selected`); }} data-testid={`button-month-${option.split(' ')[0].toLowerCase()}`}>
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button className="primary-button" onClick={() => setModal('receipt')} data-testid="button-add-receipt-header">
              <Plus size={12} strokeWidth={2.5} /> Add Receipt
            </button>
          </header>

          <section className="budget-banner" data-testid="card-budget-prompt">
            <div className="budget-intro">
              <div className="budget-icon"><Target size={13} /></div>
              <div>
                <div className="budget-heading">{budget ? `${monthName} grocery budget` : 'Set a grocery budget'}</div>
                <div className="budget-sub">{budget ? `$${total.toFixed(2)} of $${budget.toFixed(2)} spent` : 'Track your grocery spending against a goal and see where you stand.'}</div>
              </div>
            </div>
            {budget ? (
              <div className="budget-status">
                <span className="budget-amount">${budget.toFixed(0)}</span>
                <div className="budget-track"><div className="budget-fill" style={{ width: `${Math.min((total / budget) * 100, 100)}%` }} /></div>
                <button className="secondary-button" onClick={() => setModal('budget')} data-testid="button-edit-budget">Edit</button>
              </div>
            ) : (
              <button className="secondary-button" onClick={() => setModal('budget')} data-testid="button-set-budget">Set budget</button>
            )}
          </section>

          <section className="summary-grid" aria-label="Monthly summary">
            <article className="panel summary-panel" data-testid="card-spending-by-trip">
              <div className="panel-heading">Spending by Trip</div>
              <div className="empty-center">
                <div className="empty-icon">{receipts.length ? <BarChart3 size={13} /> : <ClipboardList size={13} />}</div>
                <div className="empty-copy">{receipts.length ? `${receipts.length} trip${receipts.length === 1 ? '' : 's'} in ${monthName}` : `No trips in ${monthName} yet`}</div>
              </div>
            </article>
            <article className="panel summary-panel" data-testid="card-category-breakdown">
              <div className="panel-heading">Category Breakdown</div>
              <div className="empty-center">
                <div className="empty-icon">{receipts.length ? <PieChart size={13} /> : <CircleDashed size={13} />}</div>
                <div className="empty-copy">{receipts.length ? 'Add categories to see the mix' : `No categories in ${monthName} yet`}</div>
              </div>
            </article>
          </section>

          <section className="lower-grid">
            <article className="panel receipts-panel" data-testid="card-receipts">
              <div className="panel-heading-row">
                <div className="panel-heading">{month} Receipts</div>
                {receipts.length > 0 && (
                  <button className="text-button" onClick={() => setShowAll(!showAll)} data-testid="button-view-all-receipts">
                    {showAll ? 'Show less' : 'View all'} <span aria-hidden="true">›</span>
                  </button>
                )}
                {!receipts.length && <button className="text-button" onClick={() => showToast('Your receipt list will appear here')} data-testid="button-view-all-empty">View all <span aria-hidden="true">›</span></button>}
              </div>
              {!receipts.length ? (
                <div className="receipt-empty">
                  <div className="empty-icon"><FileText size={13} /></div>
                  <div className="empty-copy">No receipts in {monthName} yet</div>
                  <button className="primary-button" onClick={() => setModal('receipt')} data-testid="button-add-receipt-empty">
                    <Plus size={11} strokeWidth={2.5} /> Add Receipt
                  </button>
                </div>
              ) : (
                <div className="receipt-list">
                  {visibleReceipts.map((receipt, index) => (
                    <div className="receipt-row" key={`${receipt.store}-${receipt.date}-${index}`} data-testid={`row-receipt-${index}`}>
                      <div><div className="receipt-store">{receipt.store}</div><div className="receipt-date">{receipt.date}</div></div>
                      <div className="receipt-total">${receipt.amount.toFixed(2)}</div>
                    </div>
                  ))}
                </div>
              )}
            </article>
            <article className="panel goal-panel" data-testid="card-savings-goals">
              <div className="panel-heading"><PiggyBank size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />Savings Goals</div>
              {goal ? (
                <div className="goal-content">
                  <div className="goal-title">{goal.name}</div>
                  <div className="goal-copy">Your goal is set at ${goal.amount.toFixed(0)}. Keep making small, useful choices.</div>
                  <div className="goal-hint">$0 of ${goal.amount.toFixed(0)} saved</div>
                  <button className="goal-button" onClick={() => showToast('Goal contributions are coming along')} data-testid="button-goal-update">Update goal</button>
                </div>
              ) : (
                <div className="goal-content">
                  <PiggyBank className="pig" size={56} strokeWidth={1.25} />
                  <div className="goal-title">Save up for something good.</div>
                  <div className="goal-copy">When you spend less than holds like yours, the difference goes toward your goal instead of slipping away. Watch penny fill up.</div>
                  <button className="goal-button" onClick={() => setModal('goal')} data-testid="button-set-first-goal">Set your first goal</button>
                </div>
              )}
            </article>
          </section>
        </div>
      </main>
      <Modal
        kind={modal}
        onClose={() => setModal(null)}
        onReceipt={addReceipt}
        onBudget={saveBudget}
        onGoal={saveGoal}
      />
      {toast && <div className="toast-note" role="status" data-testid="status-toast">{toast}</div>}
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;