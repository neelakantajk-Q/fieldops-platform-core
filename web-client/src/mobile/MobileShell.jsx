import { useEffect, useMemo, useState } from 'react';
import { allowed, navItemById } from '../nav.js';
import { modulesFor, moduleById } from './tree.js';
import { Home, Explore } from './Home.jsx';
import { Profile } from './Profile.jsx';
import { ModuleScreen, ComingSoon } from './ModuleScreen.jsx';
import { ScreenFrame } from './ScreenFrame.jsx';
import { Icon } from './Icon.jsx';
import { parseRoute, go, nativeCall, nativeAvailable } from './util.js';
import './mobile.css';

function Tab({ id, label, icon, active, badge, onClick }) {
  return (
    <button type="button" className={`m-tab ${active ? 'active' : ''}`} onClick={onClick}>
      <span className="m-tab-ico">
        <Icon name={icon} size={21} />
        {badge ? <span className="m-tab-badge">{badge > 9 ? '9+' : badge}</span> : null}
      </span>
      <span>{label}</span>
    </button>
  );
}

export function MobileShell({ session, onAuthChange, unread, online }) {
  const [route, setRoute] = useState(() => parseRoute());
  const [scanOpen, setScanOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(parseRoute());
    window.addEventListener('hashchange', onHash);
    if (!/^#?\/?m(\/|$)/.test(String(window.location.hash || ''))) {
      try { window.history.replaceState(null, '', '#m/home'); } catch (_) { window.location.hash = 'm/home'; }
    }
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const modules = useMemo(() => modulesFor(session), [session]);
  const current = route.module === 'home' || route.module === 'profile' || route.module === 'explore' ? null : moduleById(route.module);

  let body;
  if (route.module === 'home') {
    body = <Home session={session} unread={unread} />;
  } else if (route.module === 'explore') {
    body = <Explore session={session} />;
  } else if (route.module === 'profile') {
    body = <Profile session={session} onAuthChange={onAuthChange} />;
  } else if (route.module === 'view') {
    const item = navItemById(route.child);
    if (item && allowed(item, session)) {
      body = (
        <ScreenFrame
          module={{ id: item.id, label: item.label, screen: item.view, soon: false }}
          session={session}
          checkedIn={Boolean(session.checkedIn)}
          count={unread}
          onAuthChange={onAuthChange}
        />
      );
    } else {
      body = <Denied />;
    }
  } else if (!current) {
    body = <Denied />;
  } else if (!modules.some((m) => m.id === current.id)) {
    body = <Denied />;
  } else if (current.screen) {
    body = (
      <ScreenFrame
        module={current}
        session={session}
        checkedIn={Boolean(session.checkedIn)}
        count={unread}
        onAuthChange={onAuthChange}
      />
    );
  } else {
    body = <ModuleScreen module={current} route={route} session={session} />;
  }

  const active = route.module === 'view' ? route.child : route.module;

  return (
    <div className="m-app">
      {!online ? <div className="m-offline">Working offline — changes may be delayed</div> : null}
      <div className="m-viewport">{body}</div>

      <nav className="m-tabbar" aria-label="App">
        <Tab id="home" label="Home" icon="home" active={active === 'home'} onClick={() => go('home')} badge={unread} />
        <Tab id="jobs" label="Jobs" icon="briefcase" active={active === 'jobs'} onClick={() => go('jobs')} />
        <button type="button" className="m-fab" onClick={() => setScanOpen(true)} aria-label="Scan">
          <Icon name="scan" size={25} />
        </button>
        <Tab id="explore" label="Explore" icon="grid" active={active === 'explore'} onClick={() => go('explore')} />
        <Tab id="profile" label="Profile" icon="users" active={active === 'profile'} onClick={() => go('profile')} />
      </nav>

      {scanOpen ? (
        <div className="m-sheet-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setScanOpen(false)}>
          <div className="m-sheet" role="dialog" aria-modal="true" aria-label="Scan and field actions">
            <span className="m-sheet-grip" />
            <div className="m-sheet-head">
              <div><h2>Quick actions</h2><p>Scan, capture or open field tools</p></div>
              <button type="button" className="m-icon-btn" onClick={() => setScanOpen(false)} aria-label="Close">
                <Icon name="back" size={18} />
              </button>
            </div>
            <div className="m-menu">
              <button
                type="button"
                className="m-menu-row"
                onClick={() => { setScanOpen(false); if (!nativeCall('openScanner')) go('partextract'); }}
              >
                <span className="m-menu-ico"><Icon name="scan" size={18} /></span>
                <span className="m-menu-text"><strong>Scan number plate</strong><span>Native camera OCR</span></span>
                <Icon name="chevron" size={17} />
              </button>
              <button type="button" className="m-menu-row" onClick={() => { setScanOpen(false); go('partextract'); }}>
                <span className="m-menu-ico"><Icon name="receipt" size={18} /></span>
                <span className="m-menu-text"><strong>Extract job parts</strong><span>Read a job card into part lines</span></span>
                <Icon name="chevron" size={17} />
              </button>
              <button
                type="button"
                className="m-menu-row"
                onClick={() => { setScanOpen(false); if (!nativeCall('startAttendance')) go('attendance'); }}
              >
                <span className="m-menu-ico"><Icon name="calendar" size={18} /></span>
                <span className="m-menu-text"><strong>Check in / out</strong><span>Attendance with photo proof</span></span>
                <Icon name="chevron" size={17} />
              </button>
              <button
                type="button"
                className="m-menu-row"
                onClick={() => { setScanOpen(false); nativeCall('toggleBubble'); }}
                disabled={!nativeAvailable()}
              >
                <span className="m-menu-ico"><Icon name="route" size={18} /></span>
                <span className="m-menu-text"><strong>Field bubble</strong><span>Toggle floating quick actions</span></span>
                <Icon name="chevron" size={17} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Denied() {
  return (
    <div className="m-page">
      <header className="m-page-head">
        <button type="button" className="m-icon-btn" onClick={() => go('home')} aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <div className="m-page-title"><h1>Not available</h1><span>Access</span></div>
      </header>
      <div className="m-scroll">
        <ComingSoon
          title="You do not have access to this module"
          message="Ask an administrator for module rights or switch to an account with a higher role."
        />
      </div>
    </div>
  );
}
