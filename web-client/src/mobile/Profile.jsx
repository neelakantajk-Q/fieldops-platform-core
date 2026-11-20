import { useState } from 'react';
import { call, clearSession } from '../api.js';
import { Icon } from './Icon.jsx';
import { go, initials, nativeCall, nativeAvailable } from './util.js';
import { allowed, ROLE_RANK } from '../nav.js';

export function Profile({ session, onAuthChange }) {
  const [busy, setBusy] = useState(false);
  const rank = ROLE_RANK[session.role] || 1;

  async function logout() {
    if (busy) return;
    setBusy(true);
    if (nativeCall('logout')) return;
    try { await call('logout', {}); } catch (_) { /* best effort */ }
    clearSession();
    onAuthChange();
  }

  return (
    <div className="m-page">
      <header className="m-page-head plain">
        <button type="button" className="m-icon-btn" onClick={() => go('home')} aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <div className="m-page-title"><h1>Profile</h1><span>Account &amp; app</span></div>
      </header>
      <div className="m-scroll">
        <section className="m-profile-card">
          <span className="m-avatar xl">{initials(session.fullName || session.username)}</span>
          <div>
            <h2>{session.fullName || session.username}</h2>
            <p>{session.role} · {session.scope || 'SELF'}</p>
          </div>
          <span className={`m-chip ${rank >= 4 ? 'primary' : 'ok'}`}>{session.hub || 'All hubs'}</span>
        </section>

        <section className="m-section">
          <div className="m-section-head"><h3>Session</h3></div>
          <div className="m-facts card">
            <div className="m-fact"><span>Username</span><strong>{session.username}</strong></div>
            <div className="m-fact"><span>Role</span><strong>{session.role}</strong></div>
            <div className="m-fact"><span>Scope</span><strong>{session.scope || 'SELF'}</strong></div>
            <div className="m-fact"><span>Hub</span><strong>{session.hub || 'All hubs'}</strong></div>
          </div>
        </section>

        <section className="m-section">
          <div className="m-section-head"><h3>Field tools</h3></div>
          <div className="m-menu">
            <button type="button" className="m-menu-row" onClick={() => nativeCall('startAttendance')} disabled={!nativeAvailable()}>
              <span className="m-menu-ico"><Icon name="scan" size={17} /></span>
              <span className="m-menu-text"><strong>Check in / out</strong><span>Attendance proof camera</span></span>
              <Icon name="chevron" size={17} />
            </button>
            <button type="button" className="m-menu-row" onClick={() => nativeCall('openScanner')} disabled={!nativeAvailable()}>
              <span className="m-menu-ico"><Icon name="scan" size={17} /></span>
              <span className="m-menu-text"><strong>Scan number plate</strong><span>Camera OCR capture with proof</span></span>
              <Icon name="chevron" size={17} />
            </button>
            <button type="button" className="m-menu-row" onClick={() => nativeCall('toggleBubble')} disabled={!nativeAvailable()}>
              <span className="m-menu-ico"><Icon name="route" size={17} /></span>
              <span className="m-menu-text"><strong>Field bubble</strong><span>Toggle the floating action bubble</span></span>
              <Icon name="chevron" size={17} />
            </button>
          </div>
          {!nativeAvailable() ? <p className="m-hint">Native tools are available inside the FieldOps Android app.</p> : null}
        </section>

        <section className="m-section">
          <div className="m-section-head"><h3>Workspace</h3></div>
          <div className="m-menu">
            <button type="button" className="m-menu-row" onClick={() => go('notifications')}>
              <span className="m-menu-ico"><Icon name="bell" size={17} /></span>
              <span className="m-menu-text"><strong>Alerts</strong><span>Notifications and activity</span></span>
              <Icon name="chevron" size={17} />
            </button>
            <button type="button" className="m-menu-row" onClick={() => go('view', 'reports')}>
              <span className="m-menu-ico"><Icon name="chart" size={17} /></span>
              <span className="m-menu-text"><strong>Reports &amp; MIS</strong><span>Hub performance and audit trail</span></span>
              <Icon name="chevron" size={17} />
            </button>
            {allowed({ id: 'admin', min: 4 }, session) ? (
              <button type="button" className="m-menu-row" onClick={() => go('view', 'admin')}>
                <span className="m-menu-ico"><Icon name="shield" size={17} /></span>
                <span className="m-menu-text"><strong>Admin panel</strong><span>Users, geofences, settings</span></span>
                <Icon name="chevron" size={17} />
              </button>
            ) : null}
          </div>
        </section>

        <button type="button" className="m-btn danger block" onClick={logout} disabled={busy}>
          <Icon name="logout" size={16} /> {busy ? 'Signing out…' : 'Sign out'}
        </button>
        <p className="m-version">FieldOps · Field Operations &amp; HRMS · v2.1.0</p>
      </div>
    </div>
  );
}
