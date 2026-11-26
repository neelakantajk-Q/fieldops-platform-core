import { useEffect, useMemo, useState } from 'react';
import { call } from '../api.js';
import { fieldopsPost } from '../lib/fieldops.js';
import { modulesFor } from './tree.js';
import { Icon } from './Icon.jsx';
import { OdoSheet } from './OdoSheet.jsx';
import { go, initials, humanDuration, timeAgo, nativeCall, nativeAvailable } from './util.js';

const CACHE_KEY = 'fieldops_m_home_v2';
const CACHE_MS = 90 * 1000;

function greet() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function readCache() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(CACHE_KEY) || 'null');
    if (raw && Date.now() - Number(raw.at || 0) < CACHE_MS) return raw.data;
  } catch (_) { /* ignore */ }
  return null;
}

export async function loadHome(session) {
  const results = await Promise.allSettled([
    call('getTasks', { status: '', query: '', page: 1, pageSize: 200 }),
    call('getAttendance', {}),
    call('vehicleList', { query: '' }),
    call('getUsers', {}),
    call('getHoldRequests', {}),
    call('getAuditLogs', { limit: 6 }),
    fieldopsPost('/api/fieldops/capa/list', {}),
    fieldopsPost('/api/fieldops/billing/list', {}),
    call('homeSummary', {}),
    call('getAnalytics', {})
  ]);
  const pick = (i, key) => {
    const r = results[i];
    if (!r || r.status !== 'fulfilled' || !r.value) return [];
    const v = r.value;
    if (Array.isArray(v)) return v;
    return Array.isArray(v[key]) ? v[key] : (Array.isArray(v.items) ? v.items : []);
  };
  const tasks = pick(0, 'tasks');
  const daily = pick(1, 'daily');
  const vehicles = pick(2, 'vehicles');
  const users = pick(3, 'users');
  const holds = pick(4, 'pending');
  const audit = pick(5, 'logs');
  const capa = pick(6, 'items');
  const billing = pick(7, 'items');
  const summaryResult = results[8];
  const summary = summaryResult && summaryResult.status === 'fulfilled' && summaryResult.value && summaryResult.value.success
    ? summaryResult.value
    : null;

  const analyticsResult = results[9];
  const analytics = analyticsResult && analyticsResult.status === 'fulfilled' && analyticsResult.value
    ? (analyticsResult.value.analytics || analyticsResult.value)
    : {};

  const mine = (t) => String(t.assignedUserId || '') === String(session.username || '');
  const openJobs = tasks.filter((t) => t.status === 'InProgress' || t.status === 'Delayed' || t.status === 'OnHold');
  const activeJob = openJobs.find(mine) || openJobs[0] || null;
  const attendance = daily.find((d) => String(d.userId) === String(session.username || '') && d.checkIn && !d.checkOut);

  return {
    tasks,
    openJobs,
    activeJob: activeJob ? {
      jobId: activeJob.jobId,
      vehicleNo: activeJob.vehicleNo,
      client: activeJob.client,
      status: activeJob.status,
      startTime: activeJob.startTime,
      complaintNo: activeJob.complaintNo
    } : null,
    checkedIn: Boolean(attendance),
    summary,
    perf: {
      total: Number(analytics.totalTasks) || tasks.length,
      completed: Number(analytics.completedTasks) || tasks.filter((t) => t.status === 'Completed').length,
      open: Number(analytics.openTasks) || openJobs.length,
      pendingHolds: holds.length,
      hubWorkload: analytics.hubWorkload || {},
      engineerProductivity: analytics.engineerProductivity || {}
    },
    counts: {
      jobs: openJobs.length,
      attendance: daily.filter((d) => d.checkIn && !d.checkOut).length,
      vehicles: vehicles.length,
      team: users.length,
      pending: holds.length,
      capa: capa.length,
      billing: billing.filter((b) => b.status === 'DRAFT').length
    },
    audit: audit.slice(0, 5)
  };
}

function countText(id, counts, soon) {
  if (soon) return 'Coming soon';
  const n = counts ? counts[id] : undefined;
  if (n === undefined || n === null) return 'Open';
  if (id === 'attendance') return n ? `${n} active` : 'No active';
  if (id === 'billing') return n ? `${n} drafts` : 'No drafts';
  return `${n} ${n === 1 ? 'item' : 'items'}`;
}

export function Home({ session, unread }) {
  const [data, setData] = useState(() => readCache());
  const [loading, setLoading] = useState(!data);
  const [query, setQuery] = useState('');
  const [now, setNow] = useState(Date.now());
  const [nonce, setNonce] = useState(0);
  const [odoOpen, setOdoOpen] = useState(false);

  useEffect(() => {
    let live = true;
    setLoading(!data);
    loadHome(session)
      .then((next) => {
        if (!live) return;
        setData(next);
        setLoading(false);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: next })); } catch (_) { /* ignore */ }
      })
      .catch(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  // Native camera / check-out completions land here and refresh the cards.
  useEffect(() => {
    window.__fieldopsNativeResult = (type, ok) => {
      if (ok) setNonce((n) => n + 1);
    };
    return () => { window.__fieldopsNativeResult = null; };
  }, []);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const modules = useMemo(() => modulesFor(session), [session]);
  const canPerf = modules.some((m) => m.id === 'performance');
  const q = query.trim().toLowerCase();
  const recommended = (data && data.openJobs ? data.openJobs : [])
    .filter((t) => !q || `${t.jobId} ${t.vehicleNo} ${t.client}`.toLowerCase().includes(q))
    .slice(0, 5);
  const active = data && data.activeJob;
  const timer = active && active.startTime ? humanDuration(now - new Date(active.startTime).getTime()) : '';

  const summary = data && data.summary;
  const breach = summary && summary.breach;
  const pendingProof = summary && summary.attendance && summary.attendance.pendingProof;
  const kpi = summary && summary.kpi;
  const perf = (data && data.perf) || null;
  const lastOut = summary && summary.attendance && summary.attendance.lastCheckOut;
  const checkedIn = summary
    ? Boolean(summary.attendance && summary.attendance.checkedIn)
    : Boolean(data && data.checkedIn);
  const breachLeft = breach && breach.remainingSec != null
    ? humanDuration(Math.max(0, breach.remainingSec) * 1000)
    : '';

  async function startCheckIn() {
    if (nativeAvailable()) { nativeCall('startAttendance'); return; }
    try {
      await call('attendanceCheckIn', { hubName: session.hub });
      setNonce((n) => n + 1);
    } catch (_) { go('attendance'); }
  }

  async function doCheckOut() {
    if (nativeAvailable()) { nativeCall('checkOut'); return; }
    try {
      await call('attendanceCheckOut', {});
      setNonce((n) => n + 1);
    } catch (_) { go('attendance'); }
  }

  function openOdo() { setOdoOpen(true); }

  function confirmOdo(odo) {
    setOdoOpen(false);
    if (nativeAvailable()) { nativeCall('startJob', odo); return; }
    go('jobs', 'all');
  }

  return (
    <div className="m-page">
      <header className="m-header">
        <div className="m-header-top">
          <div className="m-hello">
            <span className="m-avatar">{initials(session.fullName || session.username)}</span>
            <div>
              <p className="m-eyebrow">{greet()}</p>
              <h1>{session.fullName || session.username}</h1>
            </div>
          </div>
          <button type="button" className="m-bell" onClick={() => go('notifications')} aria-label="Alerts">
            <Icon name="bell" size={21} />
            {unread ? <span className="m-bell-dot">{unread > 9 ? '9+' : unread}</span> : null}
          </button>
        </div>
        <div className="m-loc">
          <Icon name="pin" size={14} />
          <span>{session.hub || 'All hubs'}</span>
          <span className="m-dot">·</span>
          <span>{session.role || 'Member'}</span>
        </div>
        <label className="m-search">
          <Icon name="search" size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search jobs and vehicles"
            aria-label="Search"
          />
          {query ? <button type="button" className="m-search-clear" onClick={() => setQuery('')} aria-label="Clear">×</button> : null}
        </label>
      </header>

      <div className="m-scroll">
        <section className="m-hero">
          <div className="m-hero-top">
            <div>
              <p className="m-hero-eyebrow">Today</p>
              <h2>{active ? active.jobId : (loading ? 'Loading your day…' : 'No active job')}</h2>
            </div>
            <span className={`m-chip ${checkedIn ? 'ok' : 'warn'}`}>
              <Icon name="clock" size={13} />
              {checkedIn ? 'Checked in' : 'Not checked in'}
            </span>
          </div>
          {active ? (
            <>
              <p className="m-hero-sub">
                {[active.vehicleNo, active.client].filter(Boolean).join(' · ') || 'Field job in progress'}
              </p>
              <div className="m-hero-stats">
                <div><span>Status</span><strong>{active.status || '—'}</strong></div>
                <div><span>On job</span><strong>{timer || '—'}</strong></div>
                <div><span>Complaint</span><strong>{active.complaintNo || '—'}</strong></div>
              </div>
              <div className="m-hero-actions">
                <button type="button" className="m-btn primary" onClick={checkedIn ? doCheckOut : startCheckIn}>
                  <Icon name={checkedIn ? 'logout' : 'scan'} size={16} /> {checkedIn ? 'Check out' : 'Check in'}
                </button>
                <button type="button" className="m-btn ghost" onClick={() => go('jobs', 'all', active.jobId)}>
                  <Icon name="briefcase" size={16} /> Open job
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="m-hero-sub">
                {checkedIn ? 'You are on duty. Start a job card from the list.' : 'Check in to start your field day.'}
              </p>
              <div className="m-hero-actions">
                <button type="button" className="m-btn primary" onClick={checkedIn ? doCheckOut : startCheckIn}>
                  <Icon name={checkedIn ? 'logout' : 'scan'} size={16} /> {checkedIn ? 'Check out' : 'Check in'}
                </button>
                <button type="button" className="m-btn ghost" onClick={openOdo}>
                  <Icon name="briefcase" size={16} /> Start job
                </button>
              </div>
            </>
          )}
        </section>

        {breach && breach.active ? (
          <div style={{ margin: '0 16px 12px', padding: '10px 14px', borderRadius: 14, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)' }}>
            <strong style={{ display: 'block', color: '#ef4444' }}>Outside geofence</strong>
            <span className="small">Auto check-out in {breachLeft || '—'}. Return to the hub or start a valid job.</span>
          </div>
        ) : null}

        {pendingProof ? (
          <div style={{ margin: '0 16px 12px', padding: '10px 14px', borderRadius: 14, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)' }}>
            <strong style={{ display: 'block', color: '#f59e0b' }}>Checkout photo pending</strong>
            <span className="small">Your auto check-out needs a photo proof.</span>
            <button type="button" className="m-btn ghost" style={{ marginTop: 8 }} onClick={() => go('attendance')}>Complete photo</button>
          </div>
        ) : null}

        {kpi ? (
          <section className="m-section" aria-label="Today">
            <div className="m-section-head">
              <h3>Today at a glance</h3>
            </div>
            <div className="m-stats">
              <div className="m-stat blue"><span>Jobs today</span><strong>{kpi.jobsToday || 0}</strong></div>
              <div className="m-stat green"><span>Closed</span><strong>{kpi.closedToday || 0}</strong></div>
              <div className="m-stat orange"><span>Unbilled parts</span><strong>{kpi.unbilledParts || 0}</strong></div>
              <div className="m-stat rose"><span>Alerts</span><strong>{kpi.unreadAlerts || 0}</strong></div>
            </div>
          </section>
        ) : null}

        {lastOut && lastOut.timestamp ? (
          <div style={{ margin: '0 16px 12px', padding: '10px 14px', borderRadius: 14, background: 'var(--m-card, rgba(255,255,255,0.06))' }}>
            <strong style={{ display: 'block' }}>Last shift</strong>
            <span className="small">
              {lastOut.auto ? 'Auto check-out' : 'Checked out'} · shift {humanDuration((lastOut.shiftMinutes || 0) * 60000)}
              {' · '}{lastOut.cardsClosed || 0} closed · {lastOut.cardsHeld || 0} held
            </span>
          </div>
        ) : null}

        <section className="m-quick-row" aria-label="Quick actions">
          <button type="button" className="m-quick" onClick={checkedIn ? doCheckOut : startCheckIn}>
            <span className="m-quick-ico q-green"><Icon name={checkedIn ? 'logout' : 'check'} size={18} /></span>
            {checkedIn ? 'Check out' : 'Check in'}
          </button>
          <button type="button" className="m-quick" onClick={() => { if (!nativeCall('openScanner')) go('partextract'); }}>
            <span className="m-quick-ico q-blue"><Icon name="scan" size={18} /></span>
            Scan
          </button>
          <button type="button" className="m-quick" onClick={() => nativeCall('toggleBubble')}>
            <span className="m-quick-ico q-violet"><Icon name="route" size={18} /></span>
            Bubble
          </button>
        </section>

        <section className="m-section">
          <div className="m-section-head">
            <h3>Performance</h3>
            {canPerf ? <button type="button" className="m-link" onClick={() => go('performance')}>Full report</button> : null}
          </div>
          <div className="m-stats">
            <div className="m-stat blue"><span>Total jobs</span><strong>{perf ? perf.total : '—'}</strong></div>
            <div className="m-stat green"><span>Completed</span><strong>{perf ? perf.completed : '—'}</strong></div>
            <div className="m-stat orange"><span>Open / delayed</span><strong>{perf ? perf.open : '—'}</strong></div>
            <div className="m-stat rose"><span>Pending holds</span><strong>{perf ? perf.pendingHolds : '—'}</strong></div>
          </div>
          <div className="m-perf-cols">
            <div className="m-card-block">
              <h4>Hub load</h4>
              <MiniBars data={perf && perf.hubWorkload} tone="#0284c7" empty="No hub workload yet." />
            </div>
            <div className="m-card-block">
              <h4>Peer productivity</h4>
              <MiniBars data={perf && perf.engineerProductivity} tone="#16a34a" empty="No peer data yet." />
            </div>
          </div>
        </section>

        <section className="m-section">
          <div className="m-section-head">
            <h3>Recommended</h3>
            <button type="button" className="m-link" onClick={() => go('jobs', 'all')}>See all</button>
          </div>
          {loading ? (
            <div className="m-rail">
              {[0, 1].map((i) => <div key={i} className="m-skel m-job-card" />)}
            </div>
          ) : recommended.length ? (
            <div className="m-rail">
              {recommended.map((t) => (
                <button key={t.jobId} type="button" className="m-job-card" onClick={() => go('jobs', 'all', t.jobId)}>
                  <span className="m-job-top">
                    <span className="m-job-ico"><Icon name="briefcase" size={16} /></span>
                    <span className="m-job-code">{t.jobId}</span>
                  </span>
                  <span className="m-job-vehicle">{t.vehicleNo || 'Unassigned vehicle'}</span>
                  <span className="m-job-client">{t.client || 'No client'}</span>
                  <span className="m-job-foot">
                    <span className="m-job-badge">{t.status || '—'}</span>
                    <Icon name="chevron" size={15} />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="m-empty">No open jobs right now.</div>
          )}
        </section>

        <section className="m-section">
          <div className="m-section-head">
            <h3>Recent activity</h3>
            <button type="button" className="m-link" onClick={() => go('view', 'reports')}>Reports</button>
          </div>
          {data && data.audit && data.audit.length ? (
            <div className="m-activity">
              {data.audit.map((row, i) => (
                <div className="m-act-row" key={i}>
                  <span className="m-act-ico"><Icon name="clock" size={15} /></span>
                  <div className="m-act-body">
                    <strong>{row.action || 'Activity'}</strong>
                    <span>{row.detail || row.actor || 'Recorded by the backend'}</span>
                  </div>
                  <span className="m-act-time">{timeAgo(row.at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="m-empty">No recent activity yet.</div>
          )}
        </section>

        {!nativeAvailable() ? (
          <p className="m-hint">Running in the web console — native field tools appear inside the FieldOps app.</p>
        ) : null}
      </div>

      <OdoSheet open={odoOpen} onClose={() => setOdoOpen(false)} onConfirm={confirmOdo} />
    </div>
  );
}

function MiniBars({ data, tone, empty }) {
  const rows = Object.entries(data || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
  if (!rows.length) return <div className="m-empty" style={{ margin: 0 }}>{empty}</div>;
  const max = rows[0][1] || 1;
  return (
    <div className="m-barlist">
      {rows.map(([name, value]) => (
        <div className="m-bar-row" key={name}>
          <span className="m-bar-name">{name}</span>
          <span className="m-bar-track">
            <span className="m-bar-fill" style={{ width: `${Math.max(6, Math.round(100 * value / max))}%`, background: tone }} />
          </span>
          <b className="m-bar-val">{value}</b>
        </div>
      ))}
    </div>
  );
}

export function Explore({ session }) {
  const [data, setData] = useState(() => readCache());
  const [loading, setLoading] = useState(!data);
  const [query, setQuery] = useState('');
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let live = true;
    setLoading(!data);
    loadHome(session)
      .then((next) => {
        if (!live) return;
        setData(next);
        setLoading(false);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: next })); } catch (_) { /* ignore */ }
      })
      .catch(() => live && setLoading(false));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const modules = useMemo(() => modulesFor(session), [session]);
  const q = query.trim().toLowerCase();
  const list = q ? modules.filter((m) => `${m.label} ${m.id}`.toLowerCase().includes(q)) : modules;

  return (
    <div className="m-page">
      <header className="m-page-head">
        <div className="m-page-title">
          <h1>Explore</h1>
          <span>{modules.length} modules · all your field tools</span>
        </div>
        <button type="button" className="m-icon-btn" onClick={() => setNonce((n) => n + 1)} aria-label="Refresh">
          <Icon name="refresh" size={18} />
        </button>
      </header>

      <label className="m-search compact">
        <Icon name="search" size={17} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search modules" aria-label="Search modules" />
        {query ? <button type="button" className="m-search-clear" onClick={() => setQuery('')} aria-label="Clear">×</button> : null}
      </label>

      <div className="m-scroll list">
        {loading && !data ? (
          <div className="m-tiles" style={{ padding: '10px 14px 0' }}>
            {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="m-skel" style={{ height: 104, borderRadius: 16 }} />)}
          </div>
        ) : list.length ? (
          <div className="m-tiles" style={{ padding: '10px 14px 0' }}>
            {list.map((m) => (
              <button key={m.id} type="button" className={`m-tile t-${m.tone}`} onClick={() => go(m.id)}>
                <span className="m-tile-top">
                  <span className="m-tile-ico"><Icon name={m.icon} size={20} /></span>
                  {m.soon ? <span className="m-soon">Soon</span> : null}
                </span>
                <span className="m-tile-label">{m.label}</span>
                <span className={`m-tile-count c-${m.tone}`}>{countText(m.id, data && data.counts, m.soon)}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="m-empty" style={{ margin: '10px 14px 0' }}>No modules match “{query}”.</div>
        )}
      </div>
    </div>
  );
}
