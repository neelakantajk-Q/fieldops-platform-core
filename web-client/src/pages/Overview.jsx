import { call } from '../api.js';
import { Card, Donut, Empty, PageHeader, Spinner, Stat, formatWhen } from '../components.jsx';
import { useAsync } from '../components.jsx';

const TONES = ['', 'blue', 'amber', 'red', 'emerald'];

function RankList({ obj, suffix = '', tone = '' }) {
  const entries = Object.entries(obj || {})
    .map(([k, v]) => [k, Number(v) || 0])
    .sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <Empty>No data.</Empty>;
  const total = entries.reduce((sum, [, v]) => sum + v, 0) || 1;
  const max = Math.max(...entries.map(([, v]) => v), 1);
  return (
    <div className="bars">
      {entries.map(([k, v], i) => (
        <div className="bar-row" key={k}>
          <span className="bar-name" title={k}>{k}</span>
          <div className="bar-track">
            <div className={`bar-fill ${tone || TONES[i % TONES.length]}`} style={{ width: `${(v / max) * 100}%` }} />
          </div>
          <span className="bar-val">{v}{suffix}<br /><span className="muted">{Math.round((v / total) * 100)}%</span></span>
        </div>
      ))}
    </div>
  );
}

export default function Overview({ session, onNavigate }) {
  const { data, loading, error, reload } = useAsync(() => call('getAnalytics', {}), []);
  const audit = useAsync(() => call('getAuditLogs', { limit: 8 }), []);
  const a = (data && data.analytics) || {};

  const total = Number(a.totalTasks) || 0;
  const completed = Number(a.completedTasks) || 0;
  const open = Number(a.openTasks) || 0;
  const holds = Number(a.pendingHolds) || 0;
  const other = Math.max(0, total - completed - open - holds);
  const rate = total ? Math.round((completed * 100) / total) : 0;

  const mix = [
    { label: 'Completed', value: completed, color: '#22c55e' },
    { label: 'Open / in progress', value: open, color: '#0ea5e9' },
    { label: 'On hold', value: holds, color: '#f59e0b' },
    { label: 'Other', value: other, color: '#94a3b8' }
  ];

  return (
    <>
      <PageHeader
        title="Overview & Analytics"
        subtitle={`${session.fullName || session.username} · ${session.role} · ${session.hub || 'All hubs'}`}
        actions={(
          <>
            {onNavigate ? <button className="btn ghost sm" onClick={() => onNavigate('uptime')}>Vehicle Uptime</button> : null}
            {onNavigate ? <button className="btn ghost sm" onClick={() => onNavigate('reports')}>Reports &amp; MIS</button> : null}
            <button className="btn ghost sm" onClick={reload}>Refresh</button>
          </>
        )}
      />
      {error ? <div className="hint-banner" style={{ marginBottom: 16 }}>{error.message}</div> : null}
      {loading ? <Spinner label="Loading analytics…" /> : (
        <>
          <div className="kpi-grid">
            <Stat label="Total jobs" value={total} hint="All job cards in scope" icon="TOT" />
            <Stat label="Completed" value={completed} tone="ok" hint={`${rate}% completion rate`} icon="DONE" />
            <Stat label="Open / delayed" value={open} tone="info" hint="In progress and open" icon="OPEN" />
            <Stat label="Pending holds" value={holds} tone="warn" hint="Awaiting supervisor" icon="HOLD" />
            <Stat label="Mock GPS flags" value={a.mockLocationFlags || 0} tone={a.mockLocationFlags ? 'bad' : 'neutral'} hint="Location integrity" icon="GPS" />
          </div>

          <div className="viz-split">
            <Card title="Job status mix" subtitle="Share of all job cards">
              <Donut segments={mix} label={`${rate}%`} sub="completed" ariaLabel="Job status distribution" />
              <p className="mini-note">Completion rate is completed jobs over all jobs in your scope.</p>
            </Card>

            <Card title="Hold reasons" subtitle="Awaiting supervisor decisions">
              <RankList obj={a.holdReasons} tone="amber" />
            </Card>
          </div>

          <div className="grid cols-2">
            <Card title="Hub workload" subtitle="Jobs per hub">
              <RankList obj={a.hubWorkload} suffix=" jobs" tone="blue" />
            </Card>
            <Card title="Engineer productivity" subtitle="Completed jobs per engineer">
              <RankList obj={a.engineerProductivity} suffix=" done" tone="emerald" />
            </Card>
          </div>

          <Card title="Recent audit" subtitle="Latest activity recorded by the backend">
            {audit.loading ? <Spinner label="Loading audit trail…" /> : null}
            {audit.error ? <Empty>{audit.error.message}</Empty> : null}
            {!audit.loading && !audit.error ? (
              (audit.data && (audit.data.logs || []).length) ? (
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr><th>Time</th><th>User</th><th>Activity</th><th>Details</th></tr>
                    </thead>
                    <tbody>
                      {(audit.data.logs || []).slice(0, 8).map((row, i) => (
                        <tr key={i}>
                          <td className="small muted">{formatWhen(row.at)}</td>
                          <td>{row.actor || '—'}</td>
                          <td>{row.action || '—'}</td>
                          <td className="small">{row.detail || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <Empty>No audit entries yet.</Empty>
            ) : null}
          </Card>

          <Card title="Session" subtitle="Current access context">
            <div className="grid cols-4">
              <div><span className="muted small">Role</span><div><strong>{session.role}</strong></div></div>
              <div><span className="muted small">Scope</span><div><strong>{session.scope || 'SELF'}</strong></div></div>
              <div><span className="muted small">Hub</span><div><strong>{session.hub || '—'}</strong></div></div>
              <div><span className="muted small">Session expires</span><div><strong>{formatWhen(session.expiresAt)}</strong></div></div>
            </div>
          </Card>
        </>
      )}
    </>
  );
}
