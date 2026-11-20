import { useEffect, useRef, useState } from 'react';
import { call, clearSession, currentSession, isAuthenticated, post, saveSession } from './api.js';
import { clientRequestId } from './lib/utils.js';
import { BRAND } from './config.js';
import { ToastProvider, useToast } from './components.jsx';
import Login from './pages/Login.jsx';
import { sectionsFor } from './nav.js';
import { MobileShell } from './mobile/MobileShell.jsx';
import { useIsMobile } from './hooks/useIsMobile.js';
import logo from './assets/quantum-logo.png';

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

function viewFromHash() {
  if (typeof window === 'undefined') return '';
  return String(window.location.hash || '').replace(/^#\/?/, '').trim();
}

function Shell({ session, onAuthChange }) {
  const toast = useToast();
  const [view, setView] = useState(viewFromHash() || 'overview');
  const isMobile = useIsMobile();
  const [navOpen, setNavOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);

  useEffect(() => {
    const onHash = () => {
      const next = viewFromHash();
      if (next) setView(next);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    try { window.history.replaceState(null, '', '#' + view); } catch (_) { /* file:// */ }
  }, [view]);

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

  const mobileRoute = /^m(\/|$)/.test(String(view || ''));
  if (isMobile || mobileRoute) {
    return <MobileShell session={session} onAuthChange={onAuthChange} unread={unread} online={online} />;
  }

  const sections = sectionsFor(session);
  if (!sections.some((s) => s.items.some((it) => it.id === view))) {
    const first = sections[0] && sections[0].items[0];
    if (first && view !== first.id) { setView(first.id); }
  }
  const activeItem = sections.flatMap((s) => s.items).find((it) => it.id === view);
  const Active = activeItem ? activeItem.view : null;

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
          {Active ? <Active {...sessionProps}
            checkedIn={checkedIn}
            count={unread}
            onNavigate={(id) => setView(id)}
            onSession={(next) => { saveSession({ ...(currentSession() || {}), ...next }); }}
            onAuthChange={onAuthChange}
          /> : null}
        </main>
      </div>
    </div>
  );
}

export default App;
