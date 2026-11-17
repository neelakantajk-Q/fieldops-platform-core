import { useEffect, useRef, useState } from 'react';
import { call, clearSession, currentSession, isAuthenticated, post, saveSession } from './api.js';
import { clientRequestId } from './lib/utils.js';
import { BRAND } from './config.js';
import { ToastProvider, useToast } from './components.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Attendance from './pages/Attendance.jsx';
import Jobs from './pages/Jobs.jsx';
import Pending from './pages/Pending.jsx';
import Team from './pages/Team.jsx';
import Notifications from './pages/Notifications.jsx';
import Uptime from './pages/Uptime.jsx';
import Vehicles from './pages/Vehicles.jsx';
import Reports from './pages/Reports.jsx';
import Masters from './pages/Masters.jsx';
import Workflows from './pages/Workflows.jsx';
import Admin from './pages/Admin.jsx';
import Platform from './pages/Platform.jsx';
import logo from './assets/quantum-logo.png';

const ROLE_RANK = { Technician: 1, Supervisor: 2, Moderator: 3, Administrator: 4, Platform: 99 };

const NAV = [
  { section: 'Workspace', items: [
    { id: 'overview', label: 'Overview', min: 1, view: Overview },
    { id: 'attendance', label: 'Attendance', min: 1, view: Attendance },
    { id: 'jobs', label: 'Job Cards', min: 1, view: Jobs },
    { id: 'pending', label: 'Pending Jobs', min: 1, view: Pending }
  ]},
  { section: 'Field', items: [
    { id: 'team', label: 'Team', min: 1, view: Team },
    { id: 'notifications', label: 'Notifications', min: 1, view: Notifications }
  ]},
  { section: 'Reporting', items: [
    { id: 'uptime', label: 'Vehicle Uptime', min: 2, view: Uptime },
    { id: 'reports', label: 'Reports & MIS', min: 2, view: Reports }
  ]},
  { section: 'Fleet', items: [
    { id: 'vehicles', label: 'Vehicles & OCR', min: 2, view: Vehicles },
    { id: 'masters', label: 'Master Data', min: 2, view: Masters }
  ]},
  { section: 'Administration', items: [
    { id: 'workflows', label: 'Workflows', min: 2, view: Workflows },
    { id: 'admin', label: 'Admin Panel', min: 4, view: Admin },
    { id: 'platform', label: 'Platform Console', min: 4, view: Platform }
  ]}
];

const MODULE_ALIASES = {
  tasks: ['jobs', 'pending'],
  jobs: ['jobs', 'pending'],
  attendance: ['attendance'],
  team: ['team'],
  vehicles: ['vehicles', 'uptime'],
  uptime: ['uptime', 'vehicles'],
  reports: ['reports'],
  notifications: ['notifications'],
  masters: ['masters'],
  workflows: ['workflows'],
  admin: ['admin'],
  platform: ['platform']
};

const MODULE_NAMES = ['tasks', 'attendance', 'vehicles', 'team', 'reports', 'notifications', 'masters', 'workflows', 'admin', 'platform'];

function normalizeModule(value) {
  const raw = String(value || '').toLowerCase().replace(/^module[-_]?/, '').replace(/[-_]?view$/, '').trim();
  const hit = MODULE_NAMES.find((m) => raw === m || raw.includes(m));
  return hit || raw;
}

function grantedModules(moduleRights) {
  const mr = moduleRights;
  if (Array.isArray(mr)) return mr.map(normalizeModule).filter(Boolean);
  if (typeof mr === 'string') return mr.split(',').map(normalizeModule).filter(Boolean);
  if (mr && typeof mr === 'object') {
    return Object.entries(mr).filter(([, v]) => v === true || v === 'true').map(([k]) => normalizeModule(k));
  }
  return [];
}

function allowed(item, session) {
  const rank = ROLE_RANK[session.role] || 1;
  if (rank < item.min) return false;
  if (rank >= 4) return true;
  if (item.id === 'overview' || item.id === 'notifications') return true;
  const granted = grantedModules(session.moduleRights);
  if (!granted.length) return true;
  const expanded = new Set();
  granted.forEach((g) => (MODULE_ALIASES[g] || [g]).forEach((id) => expanded.add(id)));
  return expanded.has(item.id);
}

function App() {
  const [authed, setAuthed] = useState(isAuthenticated());
  return (
    <ToastProvider>
      {authed ? <Shell session={currentSession()} onAuthChange={() => setAuthed(!!isAuthenticated())} /> : (
        <Login onLogin={() => setAuthed(true)} />
      )}
    </ToastProvider>
  );
}

function Shell({ session, onAuthChange }) {
  const toast = useToast();
  const [view, setView] = useState('overview');
  const [navOpen, setNavOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const data = await call('getNotifications', { unreadOnly: true, limit: 50 });
        if (!stopped) setUnread(Number(data.unread) || (data.notifications || []).length);
      } catch (_) { /* best effort */ }
    }
    poll();
    const t = setInterval(poll, 60000);
    return () => { stopped = true; clearInterval(t); };
  }, []);

  async function doLogout() {
    setBusy(true);
    try {
      try {
        const tasks = await call('getTasks', { status: 'InProgress', query: '', page: 1, pageSize: 20 });
        const mine = (tasks.tasks || []).filter((t) =>
          t.status === 'InProgress' || t.status === 'Delayed') ;
        const active = mine.find((t) => t.assignedUserId === session.userId || t.assignedUserId === session.username) || mine[0];
        if (active) {
          await call('jobHoldRequest', {
            jobId: active.jobId,
            holdCategory: 'Auto-hold on logout',
            holdReason: 'Job left running; auto-held on logout.',
            holdSource: 'AutoLogout',
            clientRequestId: clientRequestId(),
            mock: false
          });
          toast.push('Active job auto-held before logout.', 'info');
        }
      } catch (_) { /* proceed to logout even if the hold fails */ }
      try { await post('logout', {}); } catch (_) {}
    } finally {
      clearSession();
      onAuthChange();
    }
  }

  const sections = NAV
    .map((s) => ({ ...s, items: s.items.filter((it) => allowed(it, session)) }))
    .filter((s) => s.items.length);
  if (!sections.some((s) => s.items.some((it) => it.id === view))) {
    const first = sections[0] && sections[0].items[0];
    if (first && view !== first.id) { setView(first.id); }
  }
  const activeItem = sections.flatMap((s) => s.items).find((it) => it.id === view);
  const Active = activeItem ? activeItem.view : Overview;

  const sessionProps = { session };
  const checkedIn = Boolean(session.checkedIn);

  return (
    <div className="app">
      <aside className={`sidebar ${navOpen ? 'open' : ''}`}>
        <div className="brand">
          <img className="brand-logo" src={logo} alt="Quantum EV" />
          <div>
            <div className="brand-name">Quantum</div>
            <div className="brand-sub">Field Operations</div>
          </div>
        </div>
        <nav className="nav" onClick={() => setNavOpen(false)}>
          {sections.map((s) => (
            <div key={s.section}>
              <div className="nav-sep">{s.section}</div>
              {s.items.map((it) => (
                <button key={it.id} className={`nav-item ${view === it.id ? 'active' : ''}`} onClick={() => setView(it.id)}>
                  <span className="dot" />{it.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="main">
        <div className={`status-strip ${online ? '' : 'offline'}`}>
          <strong><span className="net-dot" />{online ? 'Cloud connected' : 'Working offline'}</strong>
          <span className="small strip-detail">
            {online ? `${session.role} · ${session.hub || 'All hubs'}` : 'Changes may be delayed until the connection returns'}
          </span>
          <span className="spacer" />
          {unread ? <span className="chip bad">{unread} unread</span> : <span className="chip ok">All caught up</span>}
          <span className="chip bar-hide-sm">{BRAND.product} · Field Operations &amp; HRMS</span>
        </div>
        <header className="appbar">
          <button className="btn ghost sm hamburger" onClick={() => setNavOpen(true)} aria-label="Menu">☰</button>
          <h1>{activeItem ? activeItem.label : BRAND.product}</h1>
          {!checkedIn ? <span className="chip warn bar-hide-sm">Not checked in</span> : <span className="chip ok bar-hide-sm">Checked in</span>}
          <div className="bar-actions">
            <button className="btn ghost sm" onClick={() => setView('notifications')}>
              Notifications{unread ? <span className="badge bad">{unread}</span> : null}
            </button>
            <span className="chip bar-hide-sm">{session.hub || 'All hubs'} · {session.scope || 'SELF'}</span>
            <span className="user-chip">
              <span className="avatar">{(session.fullName || session.username || '?').charAt(0).toUpperCase()}</span>
              {session.fullName || session.username}
            </span>
            <button className="btn danger sm" onClick={doLogout} disabled={busy}>{busy ? 'Signing out…' : 'Logout'}</button>
          </div>
        </header>
        <main className="content">
          <Active {...sessionProps}
            checkedIn={checkedIn}
            count={unread}
            onNavigate={(id) => setView(id)}
            onSession={(next) => { saveSession({ ...(currentSession() || {}), ...next }); }}
            onAuthChange={onAuthChange}
          />
        </main>
      </div>
    </div>
  );
}

export default App;
