import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { customFetch, setAuthTokenGetter, setBaseUrl, cloudEnabled, cloudSignOut, onCloudChange, refreshCloud } from '@workspace/api-client-react';
import { QRCodeSVG } from 'qrcode.react';
import { categoryColor } from '@/lib/category-colors';
import { useReceiptColumns } from '@/hooks/use-receipt-columns';
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
  LayoutDashboard,
  PanelLeftClose,
  PanelLeftOpen,
  ListChecks,
  PieChart,
  Plus,
  ReceiptText,
  Target,
  UsersRound,
  X,
  PiggyBank,
  Settings2,
  UserRound,
  LogOut,
  Trash2,
  Camera,
  Smartphone,
  Moon,
  Sun,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart as RechartsPieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();
function useCloudRevision() {
  const [revision,setRevision]=useState(0);
  useEffect(()=>{if(!cloudEnabled()) return; return onCloudChange(()=>setRevision(value=>value+1));},[]);
  return revision;
}
function invitationLink(token:string) {
  const link=new URL(window.location.pathname,window.location.origin);link.searchParams.set('invite',token);
  if(!cloudEnabled()) link.searchParams.set('api',localStorage.getItem('gt-host')??'http://localhost:3000');
  return link.toString();
}

type ModalKind = 'receipt' | 'budget' | 'goal' | null;
type ReceiptItem = { name: string; variant?: string; quantity: number; packCount?: number; measureAmount?: number; measureUnit?: string; price: number; category: string };
type Receipt = { id?: string; spaceId?: string; store: string; amount: number; date: string; time?: string | null; timezone?: string | null; purchaseInstant?: string | null; items: ReceiptItem[]; imageUrl?: string };
type LocalSpace = { id: string; name: string; kind: 'private' | 'household'; timezone: string; role?: string };
type SessionValue = { token: string; email: string; displayName: string; profileImage: string; darkMode: boolean; setDarkMode: (value: boolean) => void; space: LocalSpace | null; spaces: LocalSpace[]; setSpace: (space: LocalSpace) => void; removeSpace: (id: string) => void; setDisplayName: (name: string) => void; setProfileImage: (image: string) => void; signOut: () => void };
const SessionContext = createContext<SessionValue | null>(null);
const useSession = () => { const value = useContext(SessionContext); if (!value) throw new Error('Missing local session'); return value; };

function readReceiptPhoto(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Could not decode image'));
      image.onload = () => {
        const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas'); canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
        const context = canvas.getContext('2d'); if (!context) { reject(new Error('Image compression is not supported')); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height); resolve(canvas.toDataURL('image/jpeg', 0.78));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
function readFileDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read image'));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}
function readProfileImage(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return Promise.reject(new Error('Choose a JPG, PNG, or WebP image.'));
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read profile photo.'));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error('Could not decode profile photo.'));
      image.onload = () => {
        const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d'); if (!context) { reject(new Error('Photo resizing is not supported.')); return; }
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL('image/jpeg', 0.82);
        if (result.length > 1_350_000) { reject(new Error('Choose a smaller profile photo.')); return; }
        resolve(result);
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}
function todayInTimezone(timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function LocalAccess({ children }: { children: ReactNode }) {
  const cloudRevision=useCloudRevision();
  useEffect(()=>{if(!cloudEnabled())return;const refresh=()=>{if(document.visibilityState==='visible')refreshCloud();};window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[]);
  const [host, setHost] = useState(() => new URLSearchParams(window.location.search).get('api') ?? localStorage.getItem('gt-host') ?? import.meta.env.VITE_API_URL ?? 'http://localhost:3000');
  const [token, setToken] = useState(() => localStorage.getItem('gt-token') ?? '');
  const [accountEmail, setAccountEmail] = useState(() => localStorage.getItem('gt-email') ?? '');
  const [accountDisplayName, setAccountDisplayName] = useState(() => localStorage.getItem('gt-display-name') ?? '');
  const [accountProfileImage, setAccountProfileImage] = useState(() => localStorage.getItem('gt-profile-image') ?? '');
  const [profileLoaded, setProfileLoaded] = useState(() => localStorage.getItem('gt-profile-image') !== null);
  const [darkMode, setDarkMode] = useState(() => {
    const query = new URLSearchParams(window.location.search);
    return query.has('mobileUpload') ? query.get('theme') === 'dark' : localStorage.getItem('gt-dark-mode') === 'true';
  });
  const [spaces, setSpaces] = useState<LocalSpace[]>([]);
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem('gt-space') ?? '');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [household, setHousehold] = useState('My household');
  const [register, setRegister] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setBaseUrl(host.replace(/\/$/, '')); localStorage.setItem('gt-host', host); setAuthTokenGetter(() => token || null); }, [host, token]);
  useEffect(() => { document.documentElement.classList.toggle('dark', darkMode); localStorage.setItem('gt-dark-mode', String(darkMode)); }, [darkMode]);
  useEffect(() => {
    if (!token) return;
    customFetch<LocalSpace[]>('/api/spaces').then((value) => { setSpaces(value); if (!value.some((space) => space.id === selectedId)) { const householdSpace = value.find((space) => space.kind === 'household') ?? value[0]; if (householdSpace) { setSelectedId(householdSpace.id); localStorage.setItem('gt-space', householdSpace.id); } } }).catch((cause) => { setError(cause instanceof Error ? cause.message : 'Could not sync your household.'); if (cause?.status===401) { localStorage.removeItem('gt-token'); setToken(''); } });
  }, [token, cloudRevision]);
  useEffect(() => {
    const hasValidDisplayName = Boolean(accountDisplayName.trim()) && !['undefined', 'null'].includes(accountDisplayName.trim().toLowerCase());
    if (!token || (!cloudEnabled() && accountEmail && hasValidDisplayName && profileLoaded)) return;
    customFetch<{ email: string; displayName: string; profileImage?: string }>('/api/auth/me').then((account) => { setAccountEmail(account.email); setAccountDisplayName(account.displayName); setAccountProfileImage(account.profileImage ?? ''); setProfileLoaded(true); localStorage.setItem('gt-email', account.email); localStorage.setItem('gt-display-name', account.displayName); localStorage.setItem('gt-profile-image', account.profileImage ?? ''); }).catch(() => undefined);
  }, [token, accountEmail, accountDisplayName, profileLoaded, cloudRevision]);
  const authenticate = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await customFetch<{ token: string; spaces: LocalSpace[]; user: { email: string; displayName: string; profileImage?: string } }>('/api/auth/' + (register ? 'register' : 'login'), { method: 'POST', body: JSON.stringify({ email, password, name: household, displayName: displayName.trim() }) });
      let nextSpaces = result.spaces;
      const invite = new URLSearchParams(window.location.search).get('invite');
      if (invite) { nextSpaces = await customFetch<LocalSpace[]>(`/api/invitations/${encodeURIComponent(invite)}/accept`, { method: 'POST', headers: { authorization: `Bearer ${result.token}` } }); window.history.replaceState({}, '', window.location.pathname); }
      const rememberedSpaceId = localStorage.getItem('gt-space');
      const rememberedSpace = nextSpaces.find((entry) => entry.id === rememberedSpaceId);
      const defaultSpace = nextSpaces.find((entry) => entry.kind === 'household') ?? nextSpaces[0];
      const preferredSpace = invite ? (nextSpaces[0] ?? defaultSpace) : (rememberedSpace ?? defaultSpace);
      localStorage.setItem('gt-token', result.token); localStorage.setItem('gt-email', result.user.email); localStorage.setItem('gt-display-name', result.user.displayName); localStorage.setItem('gt-profile-image', result.user.profileImage ?? ''); setAccountEmail(result.user.email); setAccountDisplayName(result.user.displayName); setAccountProfileImage(result.user.profileImage ?? ''); setProfileLoaded(true); setToken(result.token); setSpaces(nextSpaces); if (preferredSpace) { setSelectedId(preferredSpace.id); localStorage.setItem('gt-space', preferredSpace.id); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not sign in to this host.'); } finally { setBusy(false); }
  };
  const signOut = () => { if(cloudEnabled()) void cloudSignOut(); localStorage.removeItem('gt-token'); localStorage.removeItem('gt-email'); localStorage.removeItem('gt-display-name'); localStorage.removeItem('gt-profile-icon'); localStorage.removeItem('gt-profile-image'); setToken(''); setAccountEmail(''); setAccountDisplayName(''); setAccountProfileImage(''); setProfileLoaded(false); setSpaces([]); };
  const updateDisplayName = (name: string) => { setAccountDisplayName(name); localStorage.setItem('gt-display-name', name); };
  const updateProfileImage = (image: string) => { setAccountProfileImage(image); localStorage.setItem('gt-profile-image', image); };
  const removeSpace = (id: string) => {
    const remaining = spaces.filter((entry) => entry.id !== id);
    setSpaces(remaining);
    if (selectedId === id) {
      const next = remaining.find((entry) => entry.kind === 'household') ?? remaining[0];
      setSelectedId(next?.id ?? '');
      if (next) localStorage.setItem('gt-space', next.id); else localStorage.removeItem('gt-space');
    }
  };
  const space = spaces.find((entry) => entry.id === selectedId) ?? spaces.find((entry) => entry.kind === 'household') ?? null;
  const mobileUploadToken = new URLSearchParams(window.location.search).get('mobileUpload');
  if (mobileUploadToken) return <PhoneReceiptUpload token={mobileUploadToken}/>;
  if (!token) return <main className="local-access"><form className="local-access-card" onSubmit={authenticate}><div className="brand"><span className="brand-mark">G</span><span>GroceriesTracker</span></div><h1>{register ? 'Create your household' : 'Welcome to Grocery Tracker'}</h1><p>{cloudEnabled() ? 'Your groceries, shared with your household and synced across devices.' : 'Connect to your household server.'}</p>{!cloudEnabled() && <label>Server address<input className="field-input" value={host} onChange={(e) => setHost(e.target.value)} placeholder="http://192.168.1.20:3000" /></label>}{register && <label>Your name<input className="field-input" required maxLength={60} value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="How your household knows you" /></label>}<label>Email<input className="field-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Password<input className="field-input" type="password" required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 10 characters" /></label>{register && <label>Household name<input className="field-input" value={household} onChange={(e) => setHousehold(e.target.value)} /></label>}{error && <p className="local-error">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Connecting…' : register ? 'Create account' : 'Sign in'}</button><button type="button" className="text-button" onClick={() => { setRegister(!register); setError(''); }}>{register ? 'I already have an account' : 'First time? Create the household owner account'}</button></form></main>;
  const safeDisplayName = accountDisplayName.trim() && !['undefined', 'null'].includes(accountDisplayName.trim().toLowerCase()) ? accountDisplayName : accountEmail.split('@')[0] || 'Grocery member';
  return <SessionContext.Provider value={{ token, email: accountEmail, displayName: safeDisplayName, profileImage: accountProfileImage, darkMode, setDarkMode, space, spaces, setSpace: (next) => { setSelectedId(next.id); setSpaces((current) => current.some((entry) => entry.id === next.id) ? current.map((entry) => entry.id === next.id ? { ...entry, ...next } : entry) : [...current, next]); localStorage.setItem('gt-space', next.id); }, removeSpace, setDisplayName: updateDisplayName, setProfileImage: updateProfileImage, signOut }}>{children}</SessionContext.Provider>;
}

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Receipts', icon: ReceiptText },
  { label: 'Summary', icon: BarChart3 },
  { label: 'Grocery Lists', icon: ListChecks },
  { label: 'Group Profile', icon: UsersRound },
  { label: 'Settings', icon: Settings2 },
];

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
  email,
  displayName,
  profileImage,
  onAddSpace,
  onAddReceipt,
  onEditAccount,
  onSignOut,
  spaces,
  activeSpace,
  onSelectSpace,
}: {
  activeSection: string;
  setActiveSection: (value: string) => void;
  workspaceOpen: boolean;
  setWorkspaceOpen: (value: boolean) => void;
  profileOpen: boolean;
  setProfileOpen: (value: boolean) => void;
  onToast: (message: string) => void;
  email: string;
  displayName: string;
  profileImage: string;
  onAddSpace: () => void;
  onAddReceipt: () => void;
  onEditAccount: () => void;
  onSignOut: () => void;
  spaces: LocalSpace[];
  activeSpace: LocalSpace | null;
  onSelectSpace: (space: LocalSpace) => void;
}) {
  return (
    <>
    <header className="mobile-app-header" aria-label="App navigation">
      <div className="mobile-app-header-top">
        <div className="mobile-workspace-wrap">
          <button className="mobile-workspace-button" onClick={() => { setWorkspaceOpen(!workspaceOpen); setProfileOpen(false); }} data-testid="button-workspace-selector-mobile" aria-expanded={workspaceOpen}>
            <span className="mobile-workspace-name">{activeSpace?.name ?? 'Local space'}</span><ChevronDown size={18} strokeWidth={2.2}/>
          </button>
          {workspaceOpen && <div className="workspace-menu mobile-workspace-menu" data-testid="menu-workspace-mobile">
            {spaces.map((space) => <button className="workspace-menu-item" key={space.id} onClick={() => { onSelectSpace(space); setWorkspaceOpen(false); onToast(`${space.name} selected`); }}><span>{space.name}</span><small className={`workspace-kind ${space.kind}`}>{space.kind === 'household' ? 'Household' : 'Personal'}</small></button>)}
            <div className="workspace-menu-divider"/>
            <button className="workspace-menu-create" onClick={() => { setWorkspaceOpen(false); onAddSpace(); }} data-testid="button-add-space-mobile"><Plus size={15}/><span>Add new workspace</span></button>
          </div>}
        </div>
        <div className="mobile-header-actions">
          <div className="mobile-account-wrap">
            <button className="mobile-header-icon" aria-label="Account settings" aria-expanded={profileOpen} data-testid="button-user-menu-mobile" onClick={() => { setProfileOpen(!profileOpen); setWorkspaceOpen(false); }}>
              {profileImage ? <img className="mobile-account-photo" src={profileImage} alt=""/> : <UserRound size={21} strokeWidth={2.2}/>}
            </button>
            {profileOpen && <div className="profile-menu mobile-profile-menu" data-testid="menu-user-mobile">
              <button className="menu-item" onClick={() => { setProfileOpen(false); onSignOut(); }} data-testid="menu-switch-account-mobile"><UserRound size={14} style={{ verticalAlign: 'middle', marginRight: 7 }}/> Switch account</button>
              <button className="menu-item" onClick={() => { setProfileOpen(false); onEditAccount(); }} data-testid="menu-edit-account-mobile"><Settings2 size={14} style={{ verticalAlign: 'middle', marginRight: 7 }}/> Edit account</button>
              <div className="profile-menu-divider"/>
              <button className="menu-item" onClick={() => { setProfileOpen(false); onSignOut(); }} data-testid="menu-sign-out-mobile"><LogOut size={14} style={{ verticalAlign: 'middle', marginRight: 7 }}/> Sign out</button>
            </div>}
          </div>
          <button className={`mobile-header-icon ${activeSection === 'Settings' ? 'active' : ''}`} aria-label="General settings" title="General settings" data-testid="button-general-settings-mobile" onClick={() => { setActiveSection('Settings'); onToast('Settings view selected'); }}><Settings2 size={21} strokeWidth={2.2}/></button>
          <button className="mobile-header-icon mobile-add-receipt" aria-label="Add receipt" title="Add receipt" data-testid="button-add-receipt-mobile" onClick={onAddReceipt}><Plus size={22} strokeWidth={2.5}/></button>
        </div>
      </div>
      <nav className="mobile-section-nav" aria-label="Main sections">
        {navItems.map(({ label, icon: Icon }) => <button className={`mobile-section-button ${activeSection === label ? 'active' : ''}`} key={label} onClick={() => { setActiveSection(label); onToast(label === 'Dashboard' ? 'Dashboard selected' : `${label} view selected`); }} data-testid={`button-mobile-nav-${label.toLowerCase().replaceAll(' ', '-')}`} aria-current={activeSection === label ? 'page' : undefined}>
          <Icon size={19} strokeWidth={1.9}/><span>{label}</span>
        </button>)}
      </nav>
    </header>
    <aside id="primary-navigation" className="sidebar" aria-label="Primary navigation">
      <Brand />
      <div className="workspace-row">
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
          <span className="workspace-info-row">
            <span className="workspace-name">{activeSpace?.name ?? 'Local space'}</span>
            <span className={`workspace-kind ${activeSpace?.kind === 'household' ? 'household' : 'personal'}`}>{activeSpace?.kind === 'household' ? 'Household' : 'Personal'}</span>
            <ChevronDown className="workspace-chevron" size={13} strokeWidth={1.8} />
          </span>
        </button>
      </div>
      {workspaceOpen && (
        <div className="workspace-menu" data-testid="menu-workspace">
          {spaces.map((space) => <button className="workspace-menu-item" key={space.id} onClick={() => { onSelectSpace(space); setWorkspaceOpen(false); onToast(`${space.name} selected`); }}><span>{space.name}</span><small className={`workspace-kind ${space.kind}`}>{space.kind === 'household' ? 'Household' : 'Personal'}</small></button>)}
          <div className="workspace-menu-divider"/>
          <button className="workspace-menu-create" onClick={() => { setWorkspaceOpen(false); onAddSpace(); }} data-testid="button-add-space"><Plus size={15}/><span>Add new workspace</span></button>
        </div>
      )}
      <button className="sidebar-add-receipt" onClick={onAddReceipt} data-testid="button-sidebar-add-receipt"><ReceiptText size={16}/><span>Add receipt</span></button>
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
        <button
          className="profile-button"
          onClick={() => { setProfileOpen(!profileOpen); setWorkspaceOpen(false); }}
          data-testid="button-user-menu"
          aria-expanded={profileOpen}
        >
          <span className={`avatar ${profileImage ? 'has-profile-image' : ''}`}>{profileImage ? <img src={profileImage} alt=""/> : displayName.trim().charAt(0).toUpperCase() || 'G'}</span>
          <span className="profile-copy">
            <span className="profile-name">{displayName || email.split('@')[0] || 'Grocery member'}</span>
            <span className="profile-email">{email || 'Local account'}</span>
          </span>
          <ChevronDown size={10} color="hsl(var(--muted-foreground))" />
        </button>
        {profileOpen && (
          <div className="profile-menu" data-testid="menu-user">
            <button className="menu-item" onClick={() => { setProfileOpen(false); onSignOut(); }} data-testid="menu-switch-account">
              <UserRound size={14} style={{ verticalAlign: 'middle', marginRight: 7 }} /> Switch account
            </button>
            <button className="menu-item" onClick={() => { setProfileOpen(false); onEditAccount(); }} data-testid="menu-edit-account">
              <Settings2 size={14} style={{ verticalAlign: 'middle', marginRight: 7 }} /> Edit account
            </button>
            <div className="profile-menu-divider" />
            <button className="menu-item" onClick={() => { setProfileOpen(false); onSignOut(); }} data-testid="menu-sign-out">
              <LogOut size={14} style={{ verticalAlign: 'middle', marginRight: 7 }} /> Sign out
            </button>
          </div>
        )}
      </div>
    </aside>
    </>
  );
}

function CreateSpaceModal({ defaultKind, onClose, onCreate }: { defaultKind: 'private' | 'household'; onClose: () => void; onCreate: (name: string, kind: 'private' | 'household') => Promise<void> }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'private' | 'household'>(defaultKind);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { setError('Enter a name for this space.'); return; }
    setBusy(true); setError('');
    try { await onCreate(name.trim(), kind); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create this space.'); } finally { setBusy(false); }
  };
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal create-space-modal" role="dialog" aria-modal="true" aria-labelledby="create-space-title"><div className="modal-head"><div><div className="modal-title" id="create-space-title">Create a space</div><div className="modal-sub">Keep another grocery group organized on this server.</div></div><button className="close-button" aria-label="Close" onClick={onClose}><X size={16}/></button></div><form className="form-stack" onSubmit={submit}><label className="field-label">Space name<input className="field-input" required maxLength={60} autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder={kind === 'household' ? 'e.g. Apartment household' : 'e.g. Personal groceries'}/></label><fieldset className="space-kind-options"><legend>Space type</legend><label className={kind === 'private' ? 'selected' : ''}><input type="radio" name="space-kind" value="private" checked={kind === 'private'} onChange={() => setKind('private')}/><UserRound size={17}/><span><strong>Personal</strong><small>Only you can access it</small></span></label><label className={kind === 'household' ? 'selected' : ''}><input type="radio" name="space-kind" value="household" checked={kind === 'household'} onChange={() => setKind('household')}/><UsersRound size={17}/><span><strong>Household</strong><small>Invite other members</small></span></label></fieldset>{error && <p className="local-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Creating…' : 'Create space'}</button></div></form></section></div>;
}

type SpaceMember = { id: string; displayName: string; profileImage?: string; email: string; role: string };
function GroupProfileSection({ space, email, onToast }: { space: LocalSpace | null; email: string; onToast: (message: string) => void }) {
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const cloudRevision=useCloudRevision();
  useEffect(() => {
    if (!space) { setMembers([]); return; }
    let active = true; setLoading(true);
    customFetch<{ members: SpaceMember[] }>(`/api/spaces/${encodeURIComponent(space.id)}/members`).then((result) => { if (active) setMembers(result.members); }).catch(() => { if (active) onToast('Could not load members for this space'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [space?.id, refreshKey, cloudRevision]);
  const createInvite = async () => {
    if (!space) return;
    try {
      const invitation = await customFetch<{ token: string }>(`/api/spaces/${space.id}/invitations`, { method: 'POST', body: JSON.stringify({}) });
      const apiHost = localStorage.getItem('gt-host') ?? `http://${window.location.hostname}:3000`;
      const link = invitationLink(invitation.token);
      setInviteLink(link); await navigator.clipboard?.writeText(link).catch(() => undefined); onToast('Household invitation link copied');
    } catch (cause) { onToast(cause instanceof Error ? cause.message : 'Only a household owner can invite members'); }
  };
  if (!space) return <section className="section-view"><div className="receipt-empty">Choose a space to see its members.</div></section>;
  return <section className="section-view group-profile-view"><div className="section-view-head"><div><div className="section-kicker">SPACE MEMBERS</div><h2>{space.kind === 'household' ? 'Group Profile' : 'Personal Profile'}</h2><p>{space.name} · {space.kind === 'household' ? 'Shared household' : 'Private personal space'}</p></div><div className="member-count-chip"><UsersRound size={17}/><strong>{members.length}</strong><span>{members.length === 1 ? 'member' : 'members'}</span></div></div><article className="panel section-panel members-panel"><div className="panel-heading-row"><div><div className="panel-heading">{space.kind === 'household' ? 'Household members' : 'Space owner'}</div><p className="panel-subtitle">{loading ? 'Loading member information…' : `${members.length} accepted ${members.length === 1 ? 'member' : 'members'}`}</p></div><div className="member-panel-actions">{space.kind === 'household' && space.role === 'owner' && <button className="primary-button" onClick={createInvite}><Plus size={15}/> Invite member</button>}<button className="secondary-button" onClick={() => setRefreshKey((key) => key + 1)}>Refresh</button></div></div>{members.length ? <div className="member-list">{members.map((member) => <div className="member-card" key={member.id}><span className="member-avatar">{member.profileImage ? <img src={member.profileImage} alt=""/> : member.displayName.trim().charAt(0).toUpperCase() || member.email.charAt(0).toUpperCase()}</span><div className="member-identity"><strong>{member.displayName}</strong><span>{member.email}</span></div><span className={`member-role ${member.role === 'owner' ? 'owner' : ''}`}>{member.role === 'owner' ? 'Owner' : 'Member'}</span>{member.email.toLowerCase() === email.toLowerCase() && <span className="you-badge">You</span>}</div>)}</div> : <div className="receipt-empty"><div className="empty-copy">{loading ? ' ' : 'No members found in this space.'}</div></div>}</article>{inviteLink && <article className="panel invite-member-panel"><QRCodeSVG value={inviteLink} size={116} includeMargin/><div><strong>Invitation ready</strong><p>Share this link or QR code with someone you want to add to {space.name}. Invitations expire after 7 days.</p><input readOnly className="field-input" value={inviteLink}/><button className="text-button" onClick={() => navigator.clipboard?.writeText(inviteLink).then(() => onToast('Invitation link copied'))}>Copy invitation link</button></div></article>}</section>;
}

const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function receiptDateInTimezone(receipt: Receipt, timezone: string) {
  if (!receipt.purchaseInstant) return receipt.date;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(receipt.purchaseInstant));
    const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${fields.year}-${fields.month}-${fields.day}`;
  } catch { return receipt.date; }
}
function monthKey(label: string) {
  const [name, year] = label.split(' ');
  const month = monthNames.indexOf(name) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}
function DashboardCharts({ receipts, month, timezone }: { receipts: Receipt[]; month: string; timezone: string }) {
  const key = month === 'All time' ? null : monthKey(month);
  const trips = receipts.filter((receipt) => !key || receiptDateInTimezone(receipt, timezone).slice(0, 7) === key).map((receipt, index) => {
    const date = receiptDateInTimezone(receipt, timezone);
    return { label: date.slice(5), merchant: receipt.store, date, total: receipt.amount, items: receipt.items, key: receipt.id ?? `${receipt.store}-${date}-${index}` };
  }).sort((a, b) => a.date.localeCompare(b.date));
  const monthTotal = trips.reduce((sum, trip) => sum + trip.total, 0);
  const categories = trips.reduce((totals, trip) => {
    for (const item of trip.items) {
      const category = item.category.trim() || 'Other';
      totals[category] = (totals[category] ?? 0) + Math.max(0, item.price);
    }
    return totals;
  }, {} as Record<string, number>);
  const categoryData = Object.entries(categories).map(([name, value]) => ({ name, value })).filter(({ value }) => value > 0).sort((a, b) => b.value - a.value);
  const categoryTotal = categoryData.reduce((sum, category) => sum + category.value, 0);
  return <section className="summary-grid dashboard-chart-grid" aria-label={`${month} spending charts`}><article className="panel summary-panel chart-panel" data-testid="card-spending-by-trip"><div className="panel-heading">Spending by Trip</div><p className="chart-caption">Each receipt {month === 'All time' ? 'across all dates' : `in ${month}`}</p>{trips.length ? <><div className="trip-chart-wrap"><ResponsiveContainer width="100%" height="100%"><BarChart data={trips} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}><CartesianGrid strokeDasharray="3 4" vertical={false} stroke="#ececee"/><XAxis dataKey="label" tick={{ fontSize: 11, fill: '#85868d' }} tickLine={false} axisLine={false}/><YAxis width={52} tickFormatter={(value) => `$${value}`} tick={{ fontSize: 10, fill: '#85868d' }} tickLine={false} axisLine={false}/><RechartsTooltip cursor={false} formatter={(value) => [`$${Number(value).toFixed(2)}`, 'Trip total']} labelFormatter={(label) => `Purchase date · ${label}`} contentStyle={{ backgroundColor: '#fff', border: '1px solid #d8d8dd', borderRadius: '12px', boxShadow: '0 8px 24px rgba(25, 25, 30, .16)' }} labelStyle={{ color: '#202127', fontWeight: 700 }} itemStyle={{ color: '#202127' }}/><Bar dataKey="total" name="Trip total" fill="#cf2738" activeBar={{ fill: '#e34a59', stroke: '#a51d2c', strokeWidth: 1 }} radius={[7, 7, 0, 0]} maxBarSize={72}/></BarChart></ResponsiveContainer></div><div className="trip-list">{trips.map((trip) => <div key={trip.key}><span className="trip-dot"/><span className="trip-merchant">{trip.merchant}</span><span className="trip-date">{trip.date}</span><strong>${trip.total.toFixed(2)}</strong></div>)}</div></> : <div className="chart-empty"><div className="empty-icon"><ClipboardList size={19}/></div><span>No trips {month === 'All time' ? 'across all dates' : `in ${month}`} yet</span></div>}</article><article className="panel summary-panel chart-panel" data-testid="card-category-breakdown"><div className="panel-heading">Category Breakdown</div><p className="chart-caption">Grocery item spending {month === 'All time' ? 'across all dates' : `in ${month}`}</p>{categoryData.length ? <><div className="category-chart-wrap"><ResponsiveContainer width="100%" height="100%"><RechartsPieChart><Pie data={categoryData} dataKey="value" nameKey="name" innerRadius="61%" outerRadius="88%" paddingAngle={2} stroke="#fff" strokeWidth={2}>{categoryData.map((entry) => <Cell key={entry.name} fill={categoryColor(entry.name)}/>)}</Pie><RechartsTooltip formatter={(value, name) => [`$${Number(value).toFixed(2)}`, name]}/></RechartsPieChart></ResponsiveContainer><div className="donut-center"><strong>${monthTotal.toFixed(0)}</strong><span>total spent</span></div></div><div className="category-chart-legend">{categoryData.map((category) => <div key={category.name}><span className="category-legend-name"><i style={{ background: categoryColor(category.name) }}/>{category.name}</span><strong>{categoryTotal ? Math.round(category.value / categoryTotal * 100) : 0}% <small>${category.value.toFixed(2)}</small></strong></div>)}</div></> : <div className="chart-empty"><div className="empty-icon"><PieChart size={19}/></div><span>{trips.length ? 'Add item categories to see the breakdown' : `No categories ${month === 'All time' ? 'across all dates' : `in ${month}`} yet`}</span></div>}</article></section>;
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
  const title = isReceipt ? 'Add a receipt' : isBudget ? 'Set your grocery budget' : 'Start a savings goal';
  const subtitle = isReceipt
    ? 'A quick note now makes your month easier to understand later.'
    : isBudget
      ? 'Pick a monthly number and we’ll keep it in view without the pressure.'
      : 'Give your next good thing a name and a little room in the budget.';

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isReceipt && store.trim() && Number(amount) > 0) {
      onReceipt({ store: store.trim(), amount: Number(amount), date, items: [] });
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
      </section>
    </div>
  );
}

function ReceiptsSection({ receipts, timezone, onAdd, onUpdate, onDelete }: { receipts: Receipt[]; timezone: string; onAdd: () => void; onUpdate: (receipt: Receipt) => Promise<boolean>; onDelete: (receipt: Receipt) => Promise<boolean> }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const groupedReceipts = [...receipts].sort((a, b) => receiptDateInTimezone(b, timezone).localeCompare(receiptDateInTimezone(a, timezone))).reduce<Array<{ key: string; title: string; receipts: Receipt[] }>>((groups, receipt) => {
    const date = receiptDateInTimezone(receipt, timezone);
    const key = /^\d{4}-\d{2}/.test(date) ? date.slice(0, 7) : 'unknown';
    let group = groups.find((candidate) => candidate.key === key);
    if (!group) {
      const [year, month] = key.split('-').map(Number);
      const title = key === 'unknown' ? 'Date unknown' : `${monthNames[month - 1]} ${year}`;
      group = { key, title, receipts: [] };
      groups.push(group);
    }
    group.receipts.push(receipt);
    return groups;
  }, []);
  return (
    <section className="section-view">
      <div className="section-view-head"><div><div className="section-kicker">CAPTURE & ORGANIZE</div><h2>Receipt history</h2><p>All receipts, grouped by month and year · {receipts.length} total</p></div><button className="primary-button" onClick={onAdd}><Plus size={15} /> Add receipt</button></div>
      <article className="panel section-panel">
        <div className="panel-heading-row"><div className="panel-heading">Recognized receipts</div><span className="panel-meta">Newest first</span></div>
        {!receipts.length ? <div className="receipt-empty"><div className="empty-icon"><FileText size={13} /></div><div className="empty-copy">No receipts yet. Use Scan Receipt above to begin.</div></div> : <div className="receipt-history-groups">{groupedReceipts.map((group) => <section className="receipt-month-group" key={group.key}><div className="receipt-month-heading"><h3>{group.title}</h3><span>{group.receipts.length} {group.receipts.length === 1 ? 'receipt' : 'receipts'}</span></div><div className="receipt-list">{group.receipts.map((receipt, index) => <div className="receipt-edit-row" key={receipt.id ?? `${receipt.store}-${receipt.date}-${index}`}><div className="receipt-row"><div><div className="receipt-store">{receipt.store}</div><div className="receipt-date">{receiptDateInTimezone(receipt, timezone) || 'Date unknown'} · {receipt.items.length} items</div></div><div className="receipt-total">${receipt.amount.toFixed(2)}</div></div>{receipt.id && <><button className="text-button receipt-item-edit-toggle" onClick={() => setEditingId(editingId === receipt.id ? null : receipt.id!)}>{editingId === receipt.id ? 'Close receipt editor' : 'Edit receipt details and items'}</button>{editingId === receipt.id && <SavedReceiptEditor receipt={receipt} onClose={() => setEditingId(null)} onSave={async (updated) => { if (await onUpdate(updated)) setEditingId(null); }} onDelete={async (target) => { const deleted = await onDelete(target); if (deleted) setEditingId(null); return deleted; }} />}</>}</div>)}</div></section>)}</div>}
      </article>
      {receipts.some((receipt) => receipt.items.length > 0) && <article className="panel section-panel recognition-note"><Target size={15} /><div><strong>Recognition is on</strong><p>New scanned line items automatically appear in Summary, grouped by category.</p></div></article>}
    </section>
  );
}

function SummarySection({ receipts }: { receipts: Receipt[] }) {
  const categoryTotals = receipts.flatMap((receipt) => receipt.items).reduce<Record<string, number>>((totals, item) => {
    totals[item.category] = (totals[item.category] ?? 0) + item.price;
    return totals;
  }, {});
  const categories = Object.entries(categoryTotals).sort(([, a], [, b]) => b - a);
  const items = receipts.flatMap((receipt) => receipt.items);
  const itemsByCategory = new Map<string, ReceiptItem[]>();
  for (const item of items) {
    const category = item.category?.trim() || 'Other';
    const categoryItems = itemsByCategory.get(category) ?? [];
    categoryItems.push(item);
    itemsByCategory.set(category, categoryItems);
  }
  const groupedItems = [...itemsByCategory.entries()]
    .sort(([categoryA, itemsA], [categoryB, itemsB]) => {
      const totalA = itemsA.reduce((sum, item) => sum + item.price, 0);
      const totalB = itemsB.reduce((sum, item) => sum + item.price, 0);
      return totalB - totalA || categoryA.localeCompare(categoryB);
    })
    .map(([category, categoryItems]) => [category, [...categoryItems].sort((a, b) => b.price - a.price || a.name.localeCompare(b.name))] as const);
  const total = receipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  return (
    <section className="section-view">
      <div className="section-view-head"><div><div className="section-kicker">A CLEARER MONTH</div><h2>Summary</h2><p>Recognized line items, organized automatically · {receipts.length} receipts across all dates.</p></div><div className="summary-total"><span>Total spent</span><strong>${total.toFixed(2)}</strong></div></div>
      <div className="summary-detail-grid">
        <article className="panel section-panel"><div className="panel-heading">Category breakdown</div>{categories.length ? <div className="category-list">{categories.map(([category, value]) => <div className="category-row" key={category}><div><span className="category-dot" style={{ backgroundColor: categoryColor(category) }} />{category}</div><strong>${value.toFixed(2)}</strong></div>)}</div> : <div className="receipt-empty"><div className="empty-icon"><PieChart size={13} /></div><div className="empty-copy">Scan a receipt to see category spending.</div></div>}</article>
        <article className="panel section-panel"><div className="panel-heading">Recognized items <span className="panel-meta">{items.length} total · highest price first</span></div>{groupedItems.length ? <div className="summary-item-groups">{groupedItems.map(([category, categoryItems]) => <section className="summary-item-group" key={category}><div className="summary-item-group-heading"><span><i className="category-dot" style={{ backgroundColor: categoryColor(category) }} />{category}</span><strong>${categoryItems.reduce((sum, item) => sum + item.price, 0).toFixed(2)}</strong></div><div className="item-list">{categoryItems.map((item, index) => <div className="item-row" key={`${item.name}-${item.variant ?? ''}-${index}`}><span>{item.name}{item.variant ? <small className="item-variant">{item.variant}</small> : null}</span><strong>${item.price.toFixed(2)}</strong></div>)}</div></section>)}</div> : <div className="receipt-empty"><div className="empty-icon"><ClipboardList size={13} /></div><div className="empty-copy">Your receipt items will appear here.</div></div>}</article>
      </div>
      <SpendingPeriods />
      <ItemHistorySection receipts={receipts} />
    </section>
  );
}

function SavedReceiptEditor({ receipt, onSave, onClose, onDelete }: { receipt: Receipt; onSave: (receipt: Receipt) => Promise<void | boolean>; onClose: () => void; onDelete: (receipt: Receipt) => Promise<boolean> }) {
  const [draft, setDraft] = useState(receipt);
  const update = (index: number, changes: Partial<ReceiptItem>) => setDraft((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item) }));
  return <div className="saved-item-editor">
    <div className="saved-editor-heading"><div className="panel-subtitle">Edit the receipt date and grocery details. Price history and spending totals update when saved.</div><button type="button" className="icon-close" aria-label="Close receipt editor" title="Close" onClick={onClose}><X size={15}/></button></div>
    <div className="saved-receipt-fields">
      <label>Store<input value={draft.store} onChange={(event) => setDraft({ ...draft, store: event.target.value })}/></label>
      <label>Purchase date<input type="date" value={draft.date} onChange={(event) => setDraft({ ...draft, date: event.target.value })}/></label>
      <label>Time, optional<input type="time" value={draft.time ?? ''} onChange={(event) => setDraft({ ...draft, time: event.target.value || null })}/></label>
      <label>Receipt total<input type="number" min="0" step="0.01" value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: Number(event.target.value) || 0 })}/></label>
    </div>
    {draft.items.map((item, index) => <div className="saved-item-line" key={index}>
      <input aria-label="Grocery name" value={item.name} onChange={(event) => update(index, { name: event.target.value })} placeholder="Grocery name"/>
      <input aria-label="Product variant" placeholder="variant" value={item.variant ?? ''} onChange={(event) => update(index, { variant: event.target.value })}/>
      <input aria-label="Category" placeholder="category" value={item.category} onChange={(event) => update(index, { category: event.target.value })}/>
      <input aria-label="Packs purchased" type="number" min="1" value={item.quantity} onChange={(event) => update(index, { quantity: Number(event.target.value) || 1 })}/>
      <input aria-label="Units per pack" type="number" min="1" value={item.packCount ?? ''} onChange={(event) => update(index, { packCount: Number(event.target.value) || undefined })}/>
      <input aria-label="Weight or volume" type="number" min="0" step="any" placeholder="amount" value={item.measureAmount ?? ''} onChange={(event) => update(index, { measureAmount: Number(event.target.value) || undefined })}/>
      <input aria-label="Weight or volume unit" placeholder="unit" value={item.measureUnit ?? ''} onChange={(event) => update(index, { measureUnit: event.target.value })}/>
      <input aria-label="Line price" type="number" min="0" step="0.01" value={item.price} onChange={(event) => update(index, { price: Number(event.target.value) || 0 })}/>
      <button className="icon-text-button" aria-label="Remove item" onClick={() => setDraft((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}><X size={12} /></button>
    </div>)}
    <div className="saved-editor-actions">
      <button className="secondary-button" onClick={() => setDraft((current) => ({ ...current, items: [...current.items, { name: '', variant: '', category: 'Other', quantity: 1, price: 0 }] }))}><Plus size={13}/> Add item</button>
      <div className="saved-editor-action-group"><button className="danger-button" onClick={() => void onDelete(draft)}><Trash2 size={13}/>Delete receipt</button><button className="primary-button" disabled={!draft.store.trim() || !draft.date} onClick={() => onSave(draft)}>Save receipt edits</button></div>
    </div>
  </div>;
}

function ItemHistorySection({ receipts }: { receipts: Receipt[] }) {
  const { space } = useSession();
  const products = [...new Map(receipts.flatMap((receipt) => receipt.items.map((item) => [`${item.name}\u0000${item.variant ?? ''}`, { name: item.name, variant: item.variant ?? '' }] as const))).values()];
  const [productKey, setProductKey] = useState('');
  const [name, variant] = productKey.split('\u0000');
  const [points, setPoints] = useState<Array<{ date: string; unitPrice: number; unit: string; merchant: string }>>([]);
  useEffect(() => { if (!name || !space) { setPoints([]); return; } customFetch<typeof points>(`/api/items/history?spaceId=${encodeURIComponent(space.id)}&name=${encodeURIComponent(name)}&variant=${encodeURIComponent(variant ?? '')}`).then(setPoints).catch(() => setPoints([])); }, [name, variant, space?.id, receipts]);
  const values = points.map((point) => point.unitPrice);
  const min = Math.min(...values, 0), max = Math.max(...values, 1);
  const coords = points.map((point, index) => `${points.length < 2 ? 200 : 18 + index * (364 / (points.length - 1))},${126 - ((point.unitPrice - min) / Math.max(max - min, 0.01)) * 100}`).join(' ');
  return <article className="panel history-panel"><div className="panel-heading-row"><div><div className="panel-heading">Item price history</div><p className="panel-subtitle">Comparable prices by receipt date. Eggs normalize to price per egg when carton size is known.</p></div><select className="history-select" value={productKey} onChange={(e) => setProductKey(e.target.value)}><option value="">Choose an item</option>{products.map((item) => <option key={`${item.name}-${item.variant}`} value={`${item.name}\u0000${item.variant}`}>{item.name}{item.variant ? ` · ${item.variant}` : ''}</option>)}</select></div>{name && points.length ? <><svg viewBox="0 0 400 150" role="img" aria-label={`${name} unit price history`} className="history-chart"><line x1="18" y1="130" x2="382" y2="130" stroke="currentColor" opacity=".14"/><polyline points={coords} fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>{points.map((point, index) => <circle key={`${point.date}-${index}`} cx={points.length < 2 ? 200 : 18 + index * (364 / (points.length - 1))} cy={126 - ((point.unitPrice - min) / Math.max(max - min, 0.01)) * 100} r="4" fill="hsl(var(--primary))"><title>{point.date}: ${point.unitPrice.toFixed(3)} / {point.unit}</title></circle>)}</svg><div className="history-points">{points.map((point, index) => <div key={`${point.date}-${index}`}><span>{point.date} · {point.merchant}</span><strong>${point.unitPrice.toFixed(3)} / {point.unit}</strong></div>)}</div></> : <div className="receipt-empty"><div className="empty-copy">{name ? 'No comparable unit prices yet. Add a known pack count or measured weight to a receipt.' : 'Choose an item to compare its price across receipts.'}</div></div>}</article>;
}

function SpendingPeriods() {
  const { space } = useSession();
  const [period, setPeriod] = useState<'week' | 'month'>('month');
  const [rows, setRows] = useState<Array<{ periodStart: string; total: number }>>([]);
  useEffect(() => { if (space) customFetch<Array<{ periodStart: string; total: number }>>(`/api/summaries?spaceId=${encodeURIComponent(space.id)}&period=${period}`).then(setRows).catch(() => setRows([])); }, [space?.id, period]);
  const labelPeriod = (value: string) => {
    const start = new Date(`${value}T12:00:00.000Z`);
    if (period === 'month') return new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(start);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
    const monthDay = (date: Date) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
    const year = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'UTC' }).format(end);
    return `${monthDay(start)} – ${monthDay(end)}, ${year}`;
  };
  return <article className="panel period-panel"><div className="panel-heading-row"><div><div className="panel-heading">Spending by period</div><p className="chart-caption">Receipt totals · {space?.timezone ?? 'local timezone'}</p></div><div className="period-switch"><button className={period === 'week' ? 'selected' : ''} onClick={() => setPeriod('week')}>Weekly</button><button className={period === 'month' ? 'selected' : ''} onClick={() => setPeriod('month')}>Monthly</button></div></div>{rows.length ? <div className="period-rows">{rows.slice(-8).reverse().map((row) => <div key={row.periodStart}><span>{labelPeriod(row.periodStart)}</span><strong>${row.total.toFixed(2)}</strong></div>)}</div> : <div className="period-empty">Receipt totals will appear here after you save a receipt.</div>}<p className="panel-subtitle">Weeks start on Sunday and all dates follow the selected space timezone.</p></article>;
}

function ReceiptTaxBreakdown({ total, subtotal }: { total: number; subtotal: number }) {
  // Compare displayed currency amounts in cents to avoid phantom rounding differences.
  const difference = Math.round((total + Number.EPSILON) * 100) - Math.round((subtotal + Number.EPSILON) * 100);
  if (!Number.isFinite(difference) || difference === 0) return null;
  return <section className="receipt-tax-breakdown" aria-label="Receipt total breakdown" aria-live="polite">
    <dl>
      <div><dt>Items subtotal</dt><dd>${subtotal.toFixed(2)}</dd></div>
      <div><dt>{difference > 0 ? 'Tax' : 'Discount / adjustment'}</dt><dd>{difference < 0 ? '−' : ''}${(Math.abs(difference) / 100).toFixed(2)}</dd></div>
    </dl>
    <p>{difference > 0 ? 'Tax is calculated from the difference between the receipt total and items subtotal.' : 'The receipt total is lower than the items subtotal.'}</p>
  </section>;
}

function ReceiptReview({ draft, timezone, workspaceName, onSave, onCancel }: { draft: Receipt; timezone: string; workspaceName: string; onSave: (receipt: Receipt) => void; onCancel: () => void }) {
  const [receipt, setReceipt] = useState(draft);
  const tableRef = useReceiptColumns(receipt.items);
  const updateItem = (index: number, patch: Partial<ReceiptItem>) => setReceipt((current) => ({ ...current, items: current.items.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  const categoryTotals = receipt.items.reduce<Record<string, number>>((totals, item) => { const category = item.category || 'Other'; totals[category] = (totals[category] ?? 0) + item.price; return totals; }, {});
  const categories = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
  const sum = receipt.items.reduce((total, item) => total + item.price, 0);
  const addItem = () => setReceipt((current) => ({ ...current, items: [...current.items, { name: '', variant: '', quantity: 1, price: 0, category: 'Other' }] }));
  return <section className="receipt-review-page" role="region" aria-label="Review scanned receipt"><div className="receipt-review-heading"><button className="back-link" onClick={onCancel}>‹ Receipts</button><div className="review-heading-row"><div><div className="section-kicker">RECEIPT REVIEW · {workspaceName}</div><h1>Check your grocery record</h1><p>We read these details from your receipt. Correct anything before saving.</p></div><button className="icon-close" onClick={onCancel} aria-label="Close receipt review"><X size={18}/></button></div></div><div className="receipt-review-fields"><label>Store<input value={receipt.store} onChange={(e) => setReceipt({ ...receipt, store: e.target.value })} placeholder="Store name" /></label><label>Purchase date<input type="date" value={receipt.date} onChange={(e) => setReceipt({ ...receipt, date: e.target.value })} /></label><label>Time <span>optional</span><input type="time" value={receipt.time ?? ''} onChange={(e) => setReceipt({ ...receipt, time: e.target.value || null, timezone: e.target.value ? timezone : null })} /></label><label>Receipt total<input type="number" min="0" step="0.01" value={receipt.amount} onChange={(e) => setReceipt({ ...receipt, amount: Number(e.target.value) })} /></label></div><div className="receipt-review-layout"><article className="receipt-review-table-card"><div className="review-table-title"><div><h2>Items from this receipt</h2><p>{receipt.items.length} items · all fields can be edited</p></div><button className="secondary-button" onClick={addItem}><Plus size={14}/> Add item</button></div><div className="review-table-scroll" ref={tableRef}><div className="review-table-head"><span>Grocery</span><span>Category</span><span>Qty</span><span>Pack size</span><span>Weight / unit</span><span>Price</span><span></span></div>{receipt.items.map((item, index) => (
  <div className="review-table-row" key={index}>
    <div className="review-product">
      <span className="review-cell-label" aria-hidden="true">Grocery</span>
      <input aria-label="Grocery name" value={item.name} onChange={(e) => updateItem(index, { name: e.target.value })} placeholder="Grocery name"/>
    </div>
    <div className="review-category">
      <span className="review-cell-label" aria-hidden="true">Category</span>
      <input aria-label="Grocery category" value={item.category} onChange={(e) => updateItem(index, { category: e.target.value })} placeholder="Category"/>
    </div>
    <div className="review-quantity">
      <span className="review-cell-label" aria-hidden="true">Qty</span>
      <input aria-label="Quantity" type="number" min="1" value={item.quantity} onChange={(e) => updateItem(index, { quantity: Number(e.target.value) || 1 })}/>
    </div>
    <div className="review-pack">
      <span className="review-cell-label" aria-hidden="true">Pack size</span>
      <input aria-label="Units per pack" type="number" min="1" value={item.packCount ?? ''} onChange={(e) => updateItem(index, { packCount: Number(e.target.value) || undefined })}/>
    </div>
    <div className="review-weight">
      <span className="review-cell-label" aria-hidden="true">Weight / unit</span>
      <div className="review-measure">
        <input aria-label="Weight or volume" type="number" min="0" step="any" placeholder="—" value={item.measureAmount ?? ''} onChange={(e) => updateItem(index, { measureAmount: Number(e.target.value) || undefined })}/>
        <input aria-label="Weight or volume unit" placeholder="unit" value={item.measureUnit ?? ''} onChange={(e) => updateItem(index, { measureUnit: e.target.value })}/>
      </div>
    </div>
    <div className="review-cost">
      <span className="review-cell-label" aria-hidden="true">Price</span>
      <div className="review-price">
        <span>$</span>
        <input aria-label="Line price" type="number" min="0" step="0.01" value={item.price} onChange={(e) => updateItem(index, { price: Number(e.target.value) || 0 })}/>
      </div>
    </div>
    <button className="icon-close" onClick={() => setReceipt((current) => ({ ...current, items: current.items.filter((_, i) => i !== index) }))} aria-label={`Remove ${item.name || 'item'}`}><X size={15}/></button>
  </div>
))}</div><div className="review-table-foot"><button className="text-button" onClick={addItem}><Plus size={14}/> Add another grocery item</button><div>Items subtotal <strong>${sum.toFixed(2)}</strong></div></div></article><aside className="receipt-breakdown-card"><div className="receipt-saved-status"><span className="status-dot"/>Ready to save</div><div className="receipt-breakdown-total"><span>Receipt total</span><strong>${Number(receipt.amount || 0).toFixed(2)}</strong></div><div className="receipt-breakdown-stats"><div><strong>{receipt.items.length}</strong><span>Items</span></div><div><strong>{categories.length}</strong><span>Categories</span></div></div><h3>Spending by category</h3>{categories.length ? <><div className="category-stack">{categories.map(([category, value]) => <span key={category} style={{ width: `${sum ? value / sum * 100 : 0}%`, background: categoryColor(category) }} title={`${category} ${sum ? Math.round(value / sum * 100) : 0}%`}/>)}</div><div className="receipt-category-list">{categories.map(([category, value]) => <div key={category}><span className="receipt-category-name"><i style={{ background: categoryColor(category) }}/>{category || 'Other'}</span><strong>{sum ? Math.round(value / sum * 100) : 0}% <small>${value.toFixed(2)}</small></strong></div>)}</div></> : <p className="category-empty">Categories appear here as items are recognized.</p>}<ReceiptTaxBreakdown total={receipt.amount} subtotal={sum}/><div className="receipt-total-rule"><span>Save this receipt</span><strong>${Number(receipt.amount || 0).toFixed(2)}</strong></div><button className="primary-button review-save-button" disabled={!receipt.store.trim() || receipt.amount < 0} onClick={() => onSave(receipt)}>Save receipt</button><p className="review-save-note">You can edit the date and grocery details later.</p></aside></div></section>;
}

const PHONE_LINK_EXPIRED = 'The link no longer works. Please try again with a new QR Code.';

function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read that photo. Please try again.'));
    reader.readAsDataURL(file);
  });
}

function PhoneReceiptUpload({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState('');
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  useEffect(() => { customFetch<{ status: string }>(`/api/receipts/phone-upload-sessions/${encodeURIComponent(token)}`).then((result) => { if (result.status === 'uploaded') setUploaded(true); }).catch((cause) => setError(cause instanceof Error ? cause.message : PHONE_LINK_EXPIRED)); }, [token]);
  const upload = async (file?: File) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) { setError('Choose a JPG, PNG, or WebP receipt photo under 4 MB.'); return; }
    setBusy(true); setError('');
    try {
      const imageBase64 = await fileAsBase64(file);
      await customFetch(`/api/receipts/phone-upload-sessions/${encodeURIComponent(token)}/upload`, { method: 'POST', body: JSON.stringify({ mimeType: file.type, imageBase64 }) });
      setUploaded(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not upload that receipt. Please try again.'); }
    finally { setBusy(false); }
  };
  return <main className="phone-receipt-page"><header className="phone-receipt-brand"><span className="phone-brand-mark">•</span><div><strong>Groceries Tracker</strong><span>Add a receipt from your phone</span></div></header><section className="phone-receipt-card">{uploaded ? <><h1>Receipt sent</h1><p>Your photo is on its way to Grocery Tracker. You can close this page.</p></> : error ? <><h1>Link unavailable</h1><p role="alert">{error.includes('no longer works') ? PHONE_LINK_EXPIRED : error}</p></> : <><h1>Take a photo of your receipt</h1><p>Lay it flat in good light. It goes straight to your account.</p><button className="phone-primary-button" disabled={busy} onClick={() => cameraRef.current?.click()}>{busy ? 'Uploading…' : 'Take a photo'}</button><button className="phone-secondary-button" disabled={busy} onClick={() => galleryRef.current?.click()}>Choose a photo</button><small>JPG, PNG, or WebP up to 4 MB. This link works for one receipt.</small>{error && <p className="phone-upload-error" role="alert">{error}</p>}<input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }}/><input ref={galleryRef} hidden type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void upload(file); }}/></>}</section></main>;
}

function ReceiptUploadPage({ isScanning, onFile, onManual, onClose, provider, setProvider, hasGeminiKey, spaceId }: { isScanning: boolean; onFile: (file: File) => void; onManual: () => void; onClose: () => void; provider: 'local' | 'gemini'; setProvider: (provider: 'local' | 'gemini') => void; hasGeminiKey: boolean; spaceId: string }) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [phoneSession, setPhoneSession] = useState<{ token: string; expiresAt: string } | null>(null);
  const [phoneError, setPhoneError] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [creatingPhoneSession, setCreatingPhoneSession] = useState(false);
  const nativeCameraAvailable = typeof window !== 'undefined' && 'GroceryNative' in window;
  const phoneLink = phoneSession ? (() => { const url = new URL(window.location.href); url.search = ''; url.searchParams.set('mobileUpload', phoneSession.token); url.searchParams.set('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light'); if (!cloudEnabled()) url.searchParams.set('api', localStorage.getItem('gt-host') ?? 'http://localhost:3000'); return url.toString(); })() : '';
  const showPhoneQr = async () => {
    setCreatingPhoneSession(true); setPhoneError('');
    try { const result = await customFetch<{ token: string; expiresAt: string }>('/api/receipts/phone-upload-sessions', { method: 'POST', body: JSON.stringify({ spaceId }) }); setPhoneSession(result); }
    catch (cause) { setPhoneError(cause instanceof Error ? cause.message : 'Could not create a QR Code. Please try again.'); }
    finally { setCreatingPhoneSession(false); }
  };
  useEffect(() => {
    if (!phoneSession) return;
    const updateCountdown = () => setSecondsLeft(Math.max(0, Math.ceil((new Date(phoneSession.expiresAt).getTime() - Date.now()) / 1000)));
    updateCountdown(); const timer = window.setInterval(updateCountdown, 1000); return () => window.clearInterval(timer);
  }, [phoneSession]);
  useEffect(() => {
    if (!phoneSession || isScanning) return;
    let active = true, shouldPoll = true;
    const poll = async () => {
      if (!shouldPoll) return;
      try {
        const status = await customFetch<{ status: string }>(`/api/receipts/phone-upload-sessions/${encodeURIComponent(phoneSession.token)}`);
        if (status.status === 'uploaded' && active) {
          const result = await customFetch<{ mimeType: string; imageBase64: string }>(`/api/receipts/phone-upload-sessions/${encodeURIComponent(phoneSession.token)}/result`);
          if (!active) return;
          const binary = atob(result.imageBase64), bytes = new Uint8Array(binary.length);
          for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
          setPhoneSession(null); onFile(new File([bytes], `receipt.${result.mimeType.split('/')[1]}`, { type: result.mimeType }));
        }
      } catch (cause) { if (active) { shouldPoll = false; setPhoneError(cause instanceof Error ? cause.message : PHONE_LINK_EXPIRED); } }
    };
    void poll(); const timer = window.setInterval(() => void poll(), 2000); return () => { active = false; window.clearInterval(timer); };
  }, [phoneSession, isScanning]);
  const expired = Boolean(phoneSession && secondsLeft === 0);
  return <section className="receipt-upload-page"><div className="upload-page-heading"><button className="back-link" onClick={onClose}>‹ Back to receipts</button><div className="upload-heading-row"><div><div className="section-kicker">CAPTURE YOUR SHOP</div><h1>Add New Receipt</h1><p>Take a clear photo or upload a receipt image. We’ll turn it into an editable grocery record.</p></div><label className="upload-ocr-setting">Recognition<select value={provider} onChange={(event) => setProvider(event.target.value as 'local' | 'gemini')}><option value="local">Offline OCR</option>{!cloudEnabled() && <option value="gemini">Gemini · sends photo to Google</option>}</select><small>{provider === 'gemini' ? hasGeminiKey ? 'Gemini key is set for this browser.' : 'Add your key in Settings to use Gemini.' : cloudEnabled() ? 'Free recognition runs on this device.' : 'Runs on this host without sending the photo to a cloud service.'}</small></label></div></div><div className="receipt-upload-options"><div className={`receipt-dropzone ${dragging ? 'dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files[0]; if (file) onFile(file); }}><div className="upload-icon"><FileText size={28}/></div><h2>{isScanning ? 'Reading your receipt…' : 'Upload a receipt image'}</h2><p>{isScanning ? provider === 'gemini' ? 'Gemini is extracting store, date, items, and prices.' : 'Offline OCR is extracting store, date, items, and prices.' : 'Drag and drop a receipt image here, or choose how you want to add it.'}</p><div className="upload-actions"><button className="primary-button" onClick={() => cameraRef.current?.click()} disabled={isScanning}><ReceiptText size={16}/> Take a photo</button><button className="secondary-button" onClick={() => uploadRef.current?.click()} disabled={isScanning}><Plus size={16}/> Upload an image</button></div><small>JPG, PNG, or WEBP · Clear, well-lit photos work best</small><input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onFile(file); }}/><input ref={uploadRef} hidden type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onFile(file); }}/></div>{!nativeCameraAvailable && <aside className="phone-upload-card"><div className="phone-upload-icon"><Smartphone size={27}/></div><h2>Scan with your phone</h2><p>Take a photo of the receipt on your phone and it shows up here.</p>{phoneSession && !expired ? <><QRCodeSVG className="phone-upload-qr" value={phoneLink} size={184} includeMargin/><span className="phone-upload-countdown">Works once. Expires in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, '0')}.</span><span>Waiting for your phone…</span></> : expired ? <><p className="phone-upload-expired" role="status">{PHONE_LINK_EXPIRED}</p><button className="secondary-button" disabled={creatingPhoneSession || isScanning} onClick={() => void showPhoneQr()}>{creatingPhoneSession ? 'Creating…' : 'Show a new QR Code'}</button></> : <button className="secondary-button" disabled={creatingPhoneSession || isScanning} onClick={() => void showPhoneQr()}>{creatingPhoneSession ? 'Creating…' : 'Show QR code'}</button>}{phoneError && !expired && <p className="phone-upload-error" role="alert">{phoneError}</p>}</aside>}</div><div className="manual-entry-line">No receipt image? <button className="text-button" onClick={onManual}>Enter receipt manually</button></div><div className="upload-privacy-note"><span className="status-dot"/> {cloudEnabled() ? 'Recognition runs on this device. Saving a receipt syncs it privately with your household.' : 'Offline OCR keeps your receipt photo on this local server. Gemini is optional and sends the image to Google.'}</div></section>;
}

function GroceryListsSection() {
  const {space}=useSession(); const cloudRevision=useCloudRevision();
  const [item,setItem]=useState(''); const [items,setItems]=useState<Array<{id:string;name:string}>>([]);const [error,setError]=useState('');
  useEffect(()=>{setItems([]);},[space?.id]);
  useEffect(()=>{if(!cloudEnabled()||!space)return;let active=true;customFetch<Array<{id:string;name:string}>>(`/api/spaces/${space.id}/list`).then(rows=>{if(active)setItems(rows);}).catch(()=>setError('Could not sync your list.'));return()=>{active=false;};},[space?.id,cloudRevision]);
  const addItem=async()=>{const name=item.trim();if(!name||!space)return;setError('');try{if(cloudEnabled())setItems(await customFetch(`/api/spaces/${space.id}/list`,{method:'POST',body:JSON.stringify({name})}));else setItems(current=>[...current,{id:crypto.randomUUID(),name}]);setItem('');}catch{setError('Could not add item. Please retry.');}};
  const remove=async(id:string)=>{try{if(cloudEnabled()&&space)setItems(await customFetch(`/api/spaces/${space.id}/list`,{method:'DELETE',body:JSON.stringify({id})}));else setItems(current=>current.filter(entry=>entry.id!==id));}catch{setError('Could not remove item. Please retry.');}};
  return <section className="section-view"><div className="section-view-head"><div><div className="section-kicker">PLAN THE NEXT SHOP</div><h2>Grocery Lists</h2><p>Keep the next trip simple and focused.</p></div><button className="primary-button" onClick={addItem}><Plus size={12}/> Add item</button></div><article className="panel section-panel list-section-panel"><div className="list-section-title"><div className="empty-icon"><ListChecks size={14}/></div><div><div className="panel-heading">Next grocery trip</div><div className="panel-subtitle">{items.length} items</div></div></div><div className="list-input-row"><input value={item} onChange={event=>setItem(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void addItem();}} placeholder="Add an item"/><button className="primary-button" onClick={addItem}><Plus size={12}/></button></div>{error&&<p role="alert">{error}</p>}{items.length?<div className="item-list">{items.map(entry=><div className="item-row" key={entry.id}><span><CircleDashed size={13}/>{entry.name}</span><button aria-label={`Delete ${entry.name}`} className="icon-text-button" onClick={()=>void remove(entry.id)}><X size={12}/></button></div>)}</div>:<div className="list-empty"><ListChecks size={24}/><span>Your list is ready for the next shop.</span></div>}</article></section>;
}

function Dashboard() {
  const cloudRevision=useCloudRevision();
  const { token, email, displayName, profileImage, darkMode, setDarkMode, setDisplayName, setProfileImage, space, spaces, signOut, setSpace, removeSpace } = useSession();
  const [activeSection, setActiveSection] = useState('Dashboard');
  const [month, setMonth] = useState('All time');
  const [monthOpen, setMonthOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => localStorage.getItem('gt-sidebar-hidden') === 'true');
  useEffect(() => { localStorage.setItem('gt-sidebar-hidden', String(sidebarHidden)); }, [sidebarHidden]);
  const [createSpaceOpen, setCreateSpaceOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileEditOpen, setProfileEditOpen] = useState(false);
  const [profileNameEditing, setProfileNameEditing] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [modal, setModal] = useState<ModalKind>(null);
  const [budget, setBudget] = useState<number | null>(null);
  const [goal, setGoal] = useState<{ name: string; amount: number } | null>(null);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  useEffect(()=>{setReceipts([]);setBudget(null);setGoal(null);},[space?.id]);
  const [showAll, setShowAll] = useState(false);
  const [toast, setToast] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [showUploadPage, setShowUploadPage] = useState(false);
  const [scanProvider, setScanProvider] = useState<'local' | 'gemini'>('local');
  const [geminiApiKey, setGeminiApiKey] = useState(() => localStorage.getItem('gt-gemini-api-key') ?? '');
  const [geminiKeyDraft, setGeminiKeyDraft] = useState(() => localStorage.getItem('gt-gemini-api-key') ?? '');
  const [geminiKeyTesting, setGeminiKeyTesting] = useState(false);
  const [geminiKeyStatus, setGeminiKeyStatus] = useState('');
  const [draftReceipt, setDraftReceipt] = useState<Receipt | null>(() => { try { const saved = localStorage.getItem('gt-receipt-draft'); return saved ? JSON.parse(saved) as Receipt : null; } catch { return null; } });
  const [timezone, setTimezone] = useState('America/New_York');
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState(space?.name ?? '');
  const [inviteText, setInviteText] = useState('');
  const [profileNameDraft, setProfileNameDraft] = useState(displayName);
  const [profileImageDraft, setProfileImageDraft] = useState(profileImage);
  const [deleteTarget, setDeleteTarget] = useState<'workspace' | 'account' | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleting, setDeleting] = useState(false);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const profileImageInputRef = useRef<HTMLInputElement>(null);
  const retriedEmptyDraftRef = useRef<string | null>(null);

  const monthName = month === 'All time' ? month : month.split(' ')[0];
  const currentMonthDate = todayInTimezone(timezone);
  const [currentYear, currentMonth] = currentMonthDate.split('-').map(Number);
  const currentMonthName = `${monthNames[currentMonth - 1]} ${currentYear}`;
  const showToast = useCallback((message: string) => setToast(message), []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!space) return;
    setTimezone(space.timezone);
    if(!cloudEnabled()) setReceipts([]);
    let active = true;
    customFetch<any[]>(`/api/receipts?spaceId=${encodeURIComponent(space.id)}`).then((rows) => { if (active) setReceipts(rows.map((row) => ({ id: row.id, store: row.merchant, amount: row.total, date: row.purchaseDate, time: row.purchaseTime, timezone: row.timezone, purchaseInstant: row.purchaseInstant, imageUrl: row.photoUrl, items: row.items.map((item: any) => ({ name: item.name, variant: item.variant, quantity: item.quantity ?? 1, packCount: item.packCount ?? undefined, measureAmount: item.measureAmount ?? undefined, measureUnit: item.measureUnit ?? undefined, price: item.linePrice, category: item.category })) }))); }).catch(() => { if (active) showToast('Unable to load receipts from this host'); });
    return () => { active = false; };
  }, [space?.id, token, cloudRevision]);
  useEffect(()=>{if(!cloudEnabled() || !space)return;let active=true;
    customFetch<{budget:number|null;goal:{name:string;amount:number}|null}>(`/api/spaces/${space.id}/settings`).then(data=>{if(active){setBudget(data.budget);setGoal(data.goal);}}).catch(()=>showToast('Could not sync household settings'));
    return()=>{active=false;};
  },[space?.id,cloudRevision]);
  useEffect(() => setProfileNameDraft(displayName), [displayName]);
  useEffect(() => setProfileImageDraft(profileImage), [profileImage]);
  useEffect(() => setWorkspaceNameDraft(space?.name ?? ''), [space?.id, space?.name]);
  useEffect(() => {
    const invite = new URLSearchParams(window.location.search).get('invite');
    if (!invite) return;
    customFetch<LocalSpace[]>(`/api/invitations/${encodeURIComponent(invite)}/accept`, { method: 'POST' }).then((nextSpaces) => { const household = nextSpaces.find((entry) => entry.kind === 'household'); if (household) setSpace(household); window.history.replaceState({}, '', window.location.pathname); showToast('Household invitation accepted'); }).catch(() => showToast('Could not accept this invitation code'));
  }, [token]);
  useEffect(() => { try { if (draftReceipt) localStorage.setItem('gt-receipt-draft', JSON.stringify(draftReceipt)); else localStorage.removeItem('gt-receipt-draft'); } catch { /* keep this review open even if browser storage is full */ } }, [draftReceipt]);
  useEffect(() => {
    if (!draftReceipt?.imageUrl || draftReceipt.items.length > 0 || retriedEmptyDraftRef.current === draftReceipt.imageUrl) return;
    const imageUrl = draftReceipt.imageUrl;
    const comma = imageUrl.indexOf(',');
    if (comma < 0) return;
    retriedEmptyDraftRef.current = imageUrl;
    const mimeType = imageUrl.slice(0, comma).match(/^data:(image\/[^;]+)/)?.[1] ?? 'image/jpeg';
    const destination = spaces.find((entry) => entry.id === draftReceipt.spaceId) ?? space;
    customFetch<{ merchant: string; total: number; date: string; purchaseTime?: string; items: ReceiptItem[] }>('/api/receipts/scan', {
      method: 'POST', body: JSON.stringify({ imageBase64: imageUrl.slice(comma + 1), mimeType, provider: 'local' }),
    }).then((result) => {
      setDraftReceipt((current) => current?.imageUrl === imageUrl && current.items.length === 0 ? {
        ...current,
        store: result.merchant || current.store,
        amount: result.total || current.amount,
        date: result.date || current.date,
        time: result.purchaseTime ?? current.time,
        timezone: result.purchaseTime ? destination?.timezone ?? timezone : current.timezone,
        items: result.items,
      } : current);
      if (result.items.length) showToast(`${result.items.length} groceries recovered from this receipt`);
    }).catch(() => undefined);
  }, [draftReceipt?.imageUrl, draftReceipt?.items.length, spaces, space?.id, timezone, showToast]);

  const addReceipt = async (receipt: Receipt) => {
    const destination = spaces.find((entry) => entry.id === receipt.spaceId) ?? space;
    if (!destination) { showToast('Choose a workspace before saving this receipt'); return; }
    try {
      const image = receipt.imageUrl?.split(',')[1];
      const saved = await customFetch<any>('/api/receipts', { method: 'POST', body: JSON.stringify({ spaceId: destination.id, merchant: receipt.store, total: receipt.amount, purchaseDate: receipt.date, purchaseTime: receipt.time ?? null, timezone: receipt.time ? destination.timezone : null, imageBase64: image, mimeType: receipt.imageUrl?.startsWith('data:image/png') ? 'image/png' : 'image/jpeg', items: receipt.items.map((item) => ({ name: item.name, variant: item.variant, category: item.category, linePrice: item.price, quantity: item.quantity, packCount: item.packCount, measureAmount: item.measureAmount, measureUnit: item.measureUnit })) }) });
      if (space?.id !== destination.id) setSpace(destination);
      else setReceipts((current) => [{ id: saved.id, spaceId: destination.id, store: saved.merchant, amount: saved.total, date: saved.purchaseDate, time: saved.purchaseTime, timezone: saved.timezone, purchaseInstant: saved.purchaseInstant, imageUrl: receipt.imageUrl, items: saved.items.map((item: any) => ({ name: item.name, variant: item.variant, quantity: item.quantity ?? 1, packCount: item.packCount, measureAmount: item.measureAmount, measureUnit: item.measureUnit, price: item.linePrice, category: item.category })) }, ...current.filter(entry=>entry.id!==saved.id)]);
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Could not save receipt on this host'); return; }
    setModal(null);
    setDraftReceipt(null);
    setShowUploadPage(false);
    setActiveSection('Receipts');
    showToast('Receipt added to your month');
  };

  const updateReceipt = async (receipt: Receipt) => {
    if (!space || !receipt.id) return false;
    try {
      const saved = await customFetch<any>(`/api/receipts/${receipt.id}`, { method: 'PATCH', body: JSON.stringify({ merchant: receipt.store, total: receipt.amount, purchaseDate: receipt.date, purchaseTime: receipt.time ?? null, timezone: receipt.time ? timezone : null, items: receipt.items.map((item) => ({ name: item.name, variant: item.variant, category: item.category, linePrice: item.price, quantity: item.quantity, packCount: item.packCount, measureAmount: item.measureAmount, measureUnit: item.measureUnit })) }) });
      setReceipts((current) => current.map((entry) => entry.id === receipt.id ? { ...receipt, date: saved.purchaseDate, time: saved.purchaseTime, timezone: saved.timezone, purchaseInstant: saved.purchaseInstant, items: saved.items.map((item: any) => ({ name: item.name, variant: item.variant, quantity: item.quantity ?? 1, packCount: item.packCount ?? undefined, measureAmount: item.measureAmount ?? undefined, measureUnit: item.measureUnit ?? undefined, price: item.linePrice, category: item.category })) } : entry));
      showToast('Receipt updated · summaries and price history refreshed');
      return true;
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Could not update receipt'); return false; }
  };
  const deleteReceipt = async (receipt: Receipt) => {
    if (!receipt.id || !window.confirm(`Delete the ${receipt.store} receipt from ${receipt.date}? Its items and receipt photo will also be deleted.`)) return false;
    try {
      await customFetch(`/api/receipts/${receipt.id}`, { method: 'DELETE' });
      setReceipts((current) => current.filter((entry) => entry.id !== receipt.id));
      showToast('Receipt and its items deleted');
      return true;
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Could not delete receipt'); return false; }
  };

  const createSpace = async (name: string, kind: 'private' | 'household') => {
    const created = await customFetch<LocalSpace>('/api/spaces', { method: 'POST', body: JSON.stringify({ name, kind }) });
    setSpace(created);
    setCreateSpaceOpen(false);
    setActiveSection('Dashboard');
    showToast(`${created.name} created`);
  };
  const saveProfileName = async () => {
    if (profileSaving) return;
    setProfileSaving(true);
    try {
      const result = await customFetch<{ displayName: string; profileImage: string }>('/api/auth/me', { method: 'PATCH', body: JSON.stringify({ displayName: profileNameDraft, profileImage: profileImageDraft }) });
      setDisplayName(result.displayName); setProfileImage(result.profileImage); setProfileNameEditing(false); showToast('Account updated');
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Could not update your account'); }
    finally { setProfileSaving(false); }
  };
  const saveGeminiApiKey = () => {
    const key = geminiKeyDraft.trim();
    if (!key) { setGeminiApiKey(''); localStorage.removeItem('gt-gemini-api-key'); setGeminiKeyStatus('Gemini key removed from this device.'); showToast('Gemini key removed'); return; }
    if (key.length > 512) { setGeminiKeyStatus('That key is too long.'); return; }
    setGeminiApiKey(key); localStorage.setItem('gt-gemini-api-key', key); setGeminiKeyStatus('Saved in this browser.'); showToast('Gemini key saved on this device');
  };
  const testGeminiApiKey = async () => {
    const key = geminiKeyDraft.trim();
    if (!key) { setGeminiKeyStatus('Enter your Gemini API key first.'); return; }
    setGeminiKeyTesting(true); setGeminiKeyStatus('Testing key with Gemini…');
    try {
      await customFetch<{ valid: boolean }>('/api/receipts/gemini-key-test', { method: 'POST', body: JSON.stringify({ geminiApiKey: key }) });
      setGeminiKeyStatus('Key works. Google confirmed access to Gemini 3.8 Flash.'); showToast('Gemini key verified');
    } catch (cause) { setGeminiKeyStatus(cause instanceof Error ? cause.message : 'Could not verify the Gemini key.'); }
    finally { setGeminiKeyTesting(false); }
  };
  const closeProfileEditor = () => { setProfileEditOpen(false); setProfileNameEditing(false); setProfileNameDraft(displayName); setProfileImageDraft(profileImage); };
  const deleteWorkspace = async () => {
    if (!space || deleteConfirmation !== space.name) return;
    setDeleting(true);
    try {
      await customFetch(`/api/spaces/${space.id}`, { method: 'DELETE', body: JSON.stringify({ confirmation: deleteConfirmation }) });
      const nextSpace = spaces.find((entry) => entry.id !== space.id && entry.kind === 'household') ?? spaces.find((entry) => entry.id !== space.id);
      removeSpace(space.id);
      if (nextSpace) setSpace(nextSpace);
      setDeleteTarget(null); setDeleteConfirmation(''); setActiveSection('Dashboard');
      showToast('Workspace and its receipts deleted');
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Could not delete workspace'); }
    finally { setDeleting(false); }
  };
  const deleteAccount = async () => {
    if (deleteConfirmation !== 'DELETE ACCOUNT') return;
    setDeleting(true);
    try {
      await customFetch('/api/auth/me', { method: 'DELETE', body: JSON.stringify({ confirmation: deleteConfirmation }) });
      setDeleteTarget(null); setDeleteConfirmation(''); signOut();
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Could not delete account'); }
    finally { setDeleting(false); }
  };
  const saveWorkspaceName = async () => {
    if (!space || !workspaceNameDraft.trim()) { showToast('Enter a workspace name'); return; }
    if (space.role === 'member') { showToast('Only the workspace owner can rename this space'); return; }
    try {
      const updated = await customFetch<LocalSpace>(`/api/spaces/${space.id}`, { method: 'PATCH', body: JSON.stringify({ name: workspaceNameDraft.trim(), timezone: space.timezone }) });
      setSpace(updated);
      showToast('Workspace name updated');
    } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Could not update workspace name'); }
  };

  const exportBackup = async () => {
    if (!space) return;
    try { const backup = await customFetch<unknown>(`/api/backup?spaceId=${encodeURIComponent(space.id)}`); const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `groceries-${space.name.replace(/[^a-z0-9]+/gi, '-')}-backup.json`; link.click(); URL.revokeObjectURL(url); showToast('Backup downloaded'); } catch { showToast('Only the space owner can export this backup'); }
  };
  const restoreBackup = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || !space) return;
    try { const backup = JSON.parse(await file.text()); await customFetch('/api/backup/restore', { method: 'POST', body: JSON.stringify({ ...backup, spaceId: space.id }) }); const rows = await customFetch<any[]>(`/api/receipts?spaceId=${encodeURIComponent(space.id)}`); setReceipts(rows.map((row) => ({ id: row.id, store: row.merchant, amount: row.total, date: row.purchaseDate, time: row.purchaseTime, timezone: row.timezone, purchaseInstant: row.purchaseInstant, items: row.items.map((item: any) => ({ name: item.name, variant: item.variant, quantity: item.quantity ?? 1, packCount: item.packCount, measureAmount: item.measureAmount, measureUnit: item.measureUnit, price: item.linePrice, category: item.category })) }))); showToast('Backup restored to this household'); } catch { showToast('Could not restore that backup file'); }
  };

  const handleScanFile = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { showToast('Choose a receipt image such as JPG, PNG, or WEBP'); return; }
    if (file.size > 12 * 1024 * 1024) { showToast('Choose an image smaller than 12 MB'); return; }
    setIsScanning(true);
    let imageUrl = '';
    try {
      imageUrl = await readReceiptPhoto(file);
      const supportedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const originalUrl = supportedMimeTypes.includes(file.type.toLowerCase()) ? await readFileDataUrl(file) : imageUrl;
      const comma = originalUrl.indexOf(',');
      const imageBase64 = comma >= 0 ? originalUrl.slice(comma + 1) : originalUrl;
      const mimeType = originalUrl.match(/^data:(image\/[^;]+)/)?.[1] ?? 'image/jpeg';
      if (scanProvider === 'gemini' && !geminiApiKey) { showToast('Add your Gemini API key in Settings first'); setShowUploadPage(false); setActiveSection('Settings'); return; }
      if (scanProvider === 'gemini' && !window.confirm('Gemini sends this receipt photo to Google for recognition. Continue?')) return;
      const result = await customFetch<{ merchant: string; total: number; date: string; purchaseTime?: string; items: ReceiptItem[] }>('/api/receipts/scan', { method: 'POST', body: JSON.stringify({ imageBase64, mimeType, provider: scanProvider, ...(scanProvider === 'gemini' ? { geminiApiKey } : {}) }) });
      setDraftReceipt({ spaceId: space?.id, store: result.merchant, amount: result.total, date: result.date || todayInTimezone(timezone), time: result.purchaseTime ?? null, timezone: result.purchaseTime ? timezone : null, items: result.items, imageUrl });
      showToast(`${result.items.length} items found — review before saving`);
    } catch (cause) {
      if (imageUrl) {
        setDraftReceipt({ spaceId: space?.id, store: '', amount: 0, date: todayInTimezone(timezone), items: [], imageUrl });
        const status = cause && typeof cause === 'object' && 'status' in cause ? Number((cause as { status: unknown }).status) : undefined;
        if (status === 503 || status === 429) showToast('Gemini is temporarily busy — photo saved here; retry Gemini or use Offline OCR');
        else if (status === 401) showToast('Sign-in expired — photo saved here; sign in to your grocery host again');
        else if (status === undefined) showToast('Grocery host could not be reached — receipt photo saved as a draft on this device');
        else showToast('Receipt scan failed — photo saved as a draft; you can retry or use Offline OCR');
      } else showToast('Could not read that photo');
    } finally {
      setIsScanning(false);
    }
  };

  const saveBudget = async (amount: number) => {
    if(cloudEnabled() && space) try { await customFetch(`/api/spaces/${space.id}/settings`,{method:"PATCH",body:JSON.stringify({budget:amount})}); } catch { showToast("Could not save budget; please retry.");return; }
    setBudget(amount);
    setModal(null);
    showToast(`Budget set to $${amount.toFixed(0)} for ${currentMonthName}`);
  };

  const saveGoal = async (newGoal: { name: string; amount: number }) => {
    if(cloudEnabled() && space) try { await customFetch(`/api/spaces/${space.id}/settings`,{method:"PATCH",body:JSON.stringify({goal:newGoal})}); } catch { showToast("Could not save goal; please retry.");return; }
    setGoal(newGoal);
    setModal(null);
    showToast('Your first goal is ready');
  };

  const selectedMonthKey = month === 'All time' ? '' : monthKey(month);
  const monthReceipts = selectedMonthKey ? receipts.filter((receipt) => receiptDateInTimezone(receipt, timezone).slice(0, 7) === selectedMonthKey) : receipts;
  const currentMonthReceipts = receipts.filter((receipt) => receiptDateInTimezone(receipt, timezone).slice(0, 7) === currentMonthDate.slice(0, 7));
  const total = currentMonthReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  const monthOptions = ['All time', ...[...new Set([currentMonthDate.slice(0, 7), ...receipts.map((receipt) => receiptDateInTimezone(receipt, timezone).slice(0, 7))])]
    .filter((key) => /^\d{4}-\d{2}$/.test(key))
    .sort((a, b) => b.localeCompare(a))
    .map((key) => { const [year, monthNumber] = key.split('-').map(Number); return `${monthNames[monthNumber - 1]} ${year}`; })];
  const visibleReceipts = showAll ? monthReceipts : monthReceipts.slice(0, 3);

  return (
    <div className={`app-shell${sidebarHidden ? ' sidebar-hidden' : ''}`}>
      <div className="navigation-toolbar">
        <button
          className="navigation-toggle"
          aria-controls="primary-navigation"
          aria-expanded={!sidebarHidden}
          onClick={() => { setSidebarHidden((hidden) => !hidden); setWorkspaceOpen(false); setProfileOpen(false); }}
        >
          {sidebarHidden ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}
          <span>{sidebarHidden ? 'Show navigation' : 'Hide navigation'}</span>
        </button>
      </div>
      <Sidebar
        activeSection={activeSection}
        setActiveSection={(section) => { setActiveSection(section); setShowUploadPage(false); }}
        workspaceOpen={workspaceOpen}
        setWorkspaceOpen={setWorkspaceOpen}
        profileOpen={profileOpen}
        setProfileOpen={setProfileOpen}
        onToast={showToast}
        email={email}
        displayName={displayName}
        profileImage={profileImage}
        onAddSpace={() => setCreateSpaceOpen(true)}
        onAddReceipt={() => { setShowUploadPage(true); setActiveSection('Receipts'); }}
        onEditAccount={() => { setProfileNameDraft(displayName); setProfileImageDraft(profileImage); setProfileNameEditing(false); setProfileEditOpen(true); }}
        onSignOut={signOut}
        spaces={spaces}
        activeSpace={space}
        onSelectSpace={setSpace}
      />
      <main className="main">
        <div className="content-wrap">
          {draftReceipt ? <ReceiptReview draft={draftReceipt} timezone={spaces.find((entry) => entry.id === draftReceipt.spaceId)?.timezone ?? space?.timezone ?? timezone} workspaceName={spaces.find((entry) => entry.id === draftReceipt.spaceId)?.name ?? space?.name ?? 'Selected workspace'} onSave={addReceipt} onCancel={() => { setDraftReceipt(null); setShowUploadPage(true); }} /> : showUploadPage ? <ReceiptUploadPage isScanning={isScanning} onFile={handleScanFile} onManual={() => { setShowUploadPage(false); setModal('receipt'); }} onClose={() => { setShowUploadPage(false); setActiveSection('Receipts'); }} provider={scanProvider} setProvider={setScanProvider} hasGeminiKey={Boolean(geminiApiKey)} spaceId={space?.id ?? ''} /> : <>
          <header className="topbar">
            <div className="page-title">
              <span data-testid="text-page-title">{activeSection}</span>
              {activeSection === 'Dashboard' && <div style={{ position: 'relative' }}>
                <button className="month-select" onClick={() => setMonthOpen(!monthOpen)} data-testid="button-month-selector" aria-expanded={monthOpen}>
                  {monthName} <ChevronDown size={11} strokeWidth={2} />
                </button>
                {monthOpen && (
                  <div className="workspace-menu" style={{ top: 32, left: 0 }} data-testid="menu-months">
                    {monthOptions.map((option) => (
                      <button className="menu-item" key={option} onClick={() => { setMonth(option); setMonthOpen(false); showToast(`${option} selected`); }} data-testid={`button-month-${option.split(' ')[0].toLowerCase()}`}>
                        {option}
                      </button>
                    ))}
                  </div>
                )}
              </div>}
            </div>
            <button className="primary-button" onClick={() => { setShowUploadPage(true); setActiveSection('Receipts'); }} data-testid="button-scan-receipt-header">
              <ReceiptText size={15} /> Add receipt
            </button>
          </header>

          <section className="budget-banner" data-testid="card-budget-prompt">
            <div className="budget-intro">
              <div className="budget-icon"><Target size={13} /></div>
              <div>
                <div className="budget-heading">{budget ? `${currentMonthName} grocery budget` : 'Set a grocery budget'}</div>
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

          {activeSection === 'Settings' && <section className="section-view">
            <div className="section-view-head"><div><div className="section-kicker">WORKSPACE SETTINGS</div><h2>Settings</h2><p>Manage your profile and the selected workspace.</p></div></div>
            <article className="panel section-panel settings-panel">
              <div className="workspace-settings-row">
                <label className="field-label">Workspace name
                  <div className="workspace-name-control">
                    <input className="field-input" maxLength={60} value={workspaceNameDraft} onChange={(e) => setWorkspaceNameDraft(e.target.value)} aria-label="Workspace name" />
                    <span className={`workspace-kind ${space?.kind ?? 'private'}`}>{space?.kind === 'household' ? 'Household' : 'Personal'}</span>
                  </div>
                </label>
                <button className="primary-button" onClick={saveWorkspaceName} disabled={!workspaceNameDraft.trim() || workspaceNameDraft.trim() === space?.name || space?.role === 'member'}>Save workspace</button>
              </div>
              {space?.role === 'member' && <p className="panel-subtitle">Only the workspace owner can rename this space.</p>}
              <div className="settings-divider"/>
              <div className="theme-setting-row"><div><strong>Appearance</strong><p>Choose a light or dark look for this device.</p></div><button className="secondary-button theme-toggle" aria-pressed={darkMode} onClick={() => setDarkMode(!darkMode)}>{darkMode ? <Sun size={16}/> : <Moon size={16}/>} {darkMode ? 'Switch to light mode' : 'Switch to dark mode'}</button></div>
              <div className="settings-divider"/>
              {!cloudEnabled() && <div className="gemini-key-setting"><label className="field-label">Gemini API key<input className="field-input" type="password" autoComplete="new-password" spellCheck={false} value={geminiKeyDraft} onChange={(event) => { setGeminiKeyDraft(event.target.value); setGeminiKeyStatus(''); }} placeholder="Paste your Gemini API key" /></label><p>Stored only in this browser. It is sent to Google only when you select Gemini for a receipt scan.</p><div className="gemini-key-actions"><button type="button" className="secondary-button" onClick={testGeminiApiKey} disabled={!geminiKeyDraft.trim() || geminiKeyTesting}>{geminiKeyTesting ? 'Testing…' : 'Test key'}</button><button type="button" className="primary-button" onClick={saveGeminiApiKey} disabled={!geminiKeyDraft.trim() || geminiKeyDraft.trim() === geminiApiKey}>Save key</button>{geminiApiKey && <button type="button" className="text-button" onClick={() => { setGeminiApiKey(''); setGeminiKeyDraft(''); localStorage.removeItem('gt-gemini-api-key'); setGeminiKeyStatus('Gemini key removed from this device.'); }}>Remove key</button>}</div>{geminiKeyStatus && <div className={`gemini-key-status ${geminiKeyStatus.startsWith('Key works') || geminiKeyStatus.startsWith('Saved') ? 'success' : ''}`} role="status">{geminiKeyStatus}</div>}</div>}
              <div className="settings-divider"/>
              <label className="field-label">Workspace timezone<input className="field-input" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" /></label>
              <button className="primary-button" onClick={async () => { if (!space) return; try { const updated = await customFetch<LocalSpace>(`/api/spaces/${space.id}`, { method: 'PATCH', body: JSON.stringify({ timezone }) }); setSpace(updated); showToast('Workspace timezone updated'); } catch { showToast('Could not update timezone'); } }}>Save timezone</button>
              <div className="settings-divider"/>
              {space?.kind === 'household' && <><button className="secondary-button" onClick={async () => { if (!space) return; try { const invitation = await customFetch<{ token: string }>(`/api/spaces/${space.id}/invitations`, { method: 'POST', body: JSON.stringify({}) }); const apiHost = localStorage.getItem('gt-host') ?? `http://${window.location.hostname}:3000`; const link = invitationLink(invitation.token); setInviteText(link); navigator.clipboard?.writeText(link).catch(() => undefined); } catch { showToast('Could not create an invitation'); } }}>Create household invitation + pairing QR</button>{inviteText && <div className="invite-pairing"><QRCodeSVG value={inviteText} size={132} includeMargin/><p className="panel-subtitle">Scan to open the household and accept this 7-day invitation. If the QR scan is unavailable, use this link: <a href={inviteText}>{inviteText}</a></p></div>}</>}
              <div className="settings-divider"/>
              <div className="backup-actions"><button className="secondary-button" onClick={exportBackup}>Export backup</button><button className="secondary-button" onClick={() => backupInputRef.current?.click()}>Restore backup</button><input ref={backupInputRef} type="file" accept="application/json,.json" hidden onChange={restoreBackup}/></div>
              <div className="settings-divider"/>
              <div className="danger-zone"><div><strong>Danger zone</strong><p>These actions permanently remove data and cannot be undone.</p></div>
                {space?.role !== 'member' && <button className="danger-button" onClick={() => { setDeleteTarget('workspace'); setDeleteConfirmation(''); }}><Trash2 size={15}/> Delete workspace</button>}
                <button className="danger-button" onClick={() => { setDeleteTarget('account'); setDeleteConfirmation(''); }}><Trash2 size={15}/> Delete account</button>
              </div>
              <button className="text-button" onClick={signOut}>Sign out</button>
            </article>
          </section>}

          {activeSection === 'Group Profile' ? <GroupProfileSection space={space} email={email} onToast={showToast} /> : activeSection === 'Settings' ? null : activeSection === 'Receipts' ? (
            <ReceiptsSection receipts={receipts} timezone={space?.timezone ?? timezone} onAdd={() => setShowUploadPage(true)} onUpdate={updateReceipt} onDelete={deleteReceipt} />
          ) : activeSection === 'Summary' ? (
            <SummarySection receipts={receipts} />
          ) : activeSection === 'Grocery Lists' ? (
            <GroceryListsSection />
          ) : (
          <>
          <DashboardCharts receipts={receipts} month={month} timezone={space?.timezone ?? timezone}/>

          <section className="lower-grid">
            <article className="panel receipts-panel" data-testid="card-receipts">
              <div className="panel-heading-row">
                <div className="panel-heading">{month} Receipts</div>
                {monthReceipts.length > 0 && (
                  <button className="text-button" onClick={() => setShowAll(!showAll)} data-testid="button-view-all-receipts">
                    {showAll ? 'Show less' : 'View all'} <span aria-hidden="true">›</span>
                  </button>
                )}
                {!monthReceipts.length && <button className="text-button" onClick={() => showToast('Your receipt list will appear here')} data-testid="button-view-all-empty">View all <span aria-hidden="true">›</span></button>}
              </div>
              {!monthReceipts.length ? (
                <div className="receipt-empty">
                  <div className="empty-icon"><FileText size={13} /></div>
                  <div className="empty-copy">{month === 'All time' ? 'No receipts yet' : `No receipts in ${monthName} yet`}</div>
                  <button className="primary-button" onClick={() => setShowUploadPage(true)} data-testid="button-add-receipt-empty">
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
          </>
          )}
          </>}
        </div>
      </main>
      {profileEditOpen && <div className="modal-backdrop profile-editor-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !profileSaving) closeProfileEditor(); }}><section className="modal profile-editor-modal" role="dialog" aria-modal="true" aria-labelledby="profile-editor-title"><div className="modal-head"><div><div className="modal-title" id="profile-editor-title">Edit account</div><div className="modal-sub">Update your profile photo and display name.</div></div><button className="close-button" aria-label="Close" onClick={closeProfileEditor} disabled={profileSaving}><X size={16}/></button></div><div className="account-editor-content"><div className="account-photo-picker"><button type="button" className="account-photo-button" onClick={() => profileImageInputRef.current?.click()} aria-label="Upload profile picture">{profileImageDraft ? <img src={profileImageDraft} alt="Profile preview"/> : <span>{profileNameDraft.trim().charAt(0).toUpperCase() || 'G'}</span>}<span className="account-photo-camera"><Camera size={16}/></span></button><input ref={profileImageInputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { setProfileImageDraft(await readProfileImage(file)); } catch (cause) { showToast(cause instanceof Error ? cause.message : 'Could not use that profile photo'); } }}/><button className="text-button" type="button" disabled={!profileImageDraft || profileSaving} onClick={() => setProfileImageDraft('')}>Use default icon</button></div><div className="account-editor-details"><div className="account-name-row">{profileNameEditing ? <input className="field-input account-name-input" autoFocus maxLength={60} value={profileNameDraft} aria-label="Display name" onChange={(event) => setProfileNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void saveProfileName(); }}/> : <div className="account-name-value">{displayName}</div>}<div className="account-name-actions"><button type="button" className="secondary-button" disabled={profileSaving} onClick={() => { if (profileNameEditing) setProfileNameDraft(displayName); setProfileNameEditing(!profileNameEditing); }}>{profileNameEditing ? 'Cancel' : 'Edit name'}</button><button type="button" className="primary-button" disabled={!profileNameDraft.trim() || profileSaving || (profileNameDraft === displayName && profileImageDraft === profileImage)} onClick={() => void saveProfileName()}>{profileSaving ? 'Saving…' : 'Save'}</button></div></div><div className="account-email-readonly">{email}</div><p className="account-editor-hint">Click your picture to upload a new one. Photos are resized before saving.</p></div></div><div className="account-editor-footer"><button type="button" className="secondary-button" onClick={closeProfileEditor} disabled={profileSaving}>Close</button></div></section></div>}
      <Modal
        kind={modal}
        onClose={() => setModal(null)}
        onReceipt={addReceipt}
        onBudget={saveBudget}
        onGoal={saveGoal}
      />
      {createSpaceOpen && <CreateSpaceModal defaultKind={space?.kind ?? 'household'} onClose={() => setCreateSpaceOpen(false)} onCreate={createSpace}/>}
      {deleteTarget && <div className="modal-overlay danger-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) { setDeleteTarget(null); setDeleteConfirmation(''); } }}><section className="danger-modal" role="alertdialog" aria-modal="true" aria-labelledby="danger-modal-title"><div className="danger-modal-icon"><Trash2 size={20}/></div><h2 id="danger-modal-title">Delete {deleteTarget === 'account' ? 'account' : 'workspace'}?</h2><p>{deleteTarget === 'account' ? 'Your account and private workspaces will be deleted. Household workspaces with other members will remain available and transfer to another member.' : `“${space?.name ?? 'This workspace'}” and all of its receipts, grocery items, and photos will be permanently deleted for every member.`}</p><label className="field-label">Type <strong>{deleteTarget === 'account' ? 'DELETE ACCOUNT' : space?.name}</strong> to confirm<input className="field-input" autoComplete="off" value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} placeholder={deleteTarget === 'account' ? 'DELETE ACCOUNT' : space?.name ?? ''}/></label><div className="danger-modal-actions"><button className="secondary-button" disabled={deleting} onClick={() => { setDeleteTarget(null); setDeleteConfirmation(''); }}>Cancel</button><button className="danger-button" disabled={deleting || (deleteTarget === 'account' ? deleteConfirmation !== 'DELETE ACCOUNT' : deleteConfirmation !== space?.name)} onClick={deleteTarget === 'account' ? deleteAccount : deleteWorkspace}>{deleting ? 'Deleting…' : `Delete ${deleteTarget === 'account' ? 'account' : 'workspace'}`}</button></div></section></div>}
      {toast && createPortal(<div className="toast-note" role="status" data-testid="status-toast">{toast}</div>, document.body)}
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
          <LocalAccess><Router /></LocalAccess>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
