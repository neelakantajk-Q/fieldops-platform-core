import { call } from '../api.js';
import { Card, Empty, PageHeader, Spinner, Stat, useAsync } from '../components.jsx';

function BarList({ data, tone = '#2563eb', empty = 'No data.' }) {
  const rows = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return <Empty>{empty}</Empty>;
  const max = rows[0][1] || 1;
  return (
    <ul className="legend" style={{ width: '100%' }}>
      {rows.map(([name, value]) => (
        <li key={name} style={{ alignItems: 'center' }}>
          <span className="legend-name" style={{ flex: 1, minWidth: 90 }}>{name}</span>
          <span style={{ flex: 2, height: 8, borderRadius: 99, background: '#eef2f7', overflow: 'hidden' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.max(4, Math.round(100 * value / max))}%`, background: tone }} />
          </span>
          <b style={{ minWidth: 28, textAlign: 'right' }}>{value}</b>
        </li>
      ))}
    </ul>
  );
}

export default function Performance({ session }) {
  const perf = useAsync(() => call('getAnalytics', {}), []);
  const holds = useAsync(() => call('getHoldRequests', {}), []);
  const a = (perf.data && perf.data.analytics) || {};
  const pendingHolds = ((holds.data && holds.data.pending) || []).length;
  const total = Number(a.totalTasks) || 0;
  const done = Number(a.completedTasks) || 0;

  return (
    <>
      <PageHeader title="Hub & Peer Performance"
        subtitle={`Operational comparison for ${session.role} · ${session.hub || 'all hubs'}`}
        actions={<button className="btn ghost sm" onClick={() => { perf.reload(); holds.reload(); }}>REFRESH</button>} />

      {perf.error ? <div className="hint-banner" style={{ marginBottom: 16 }}>{perf.error.message}</div> : null}

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <Stat label="Total jobs" value={total} hint="All job cards in scope" icon="TOT" />
        <Stat label="Completed" value={done} hint={`${total ? Math.round(100 * done / total) : 0}% completion rate`} tone="green" icon="DONE" />
        <Stat label="Open / delayed" value={Number(a.openTasks) || 0} hint="In progress and open" tone="blue" icon="OPEN" />
        <Stat label="Pending holds" value={pendingHolds} hint="Awaiting supervisor" tone="amber" icon="HOLD" />
      </div>

      <div className="grid cols-2">
        <Card title="Hub performance" subtitle="Job cards per hub">
          {perf.loading ? <Spinner label="Loading hub workload…" /> : null}
          {!perf.loading ? <BarList data={a.hubWorkload} tone="#0284c7" empty="No hub workload yet." /> : null}
        </Card>
        <Card title="Peer performance" subtitle="Job cards per engineer">
          {perf.loading ? <Spinner label="Loading peer productivity…" /> : null}
          {!perf.loading ? <BarList data={a.engineerProductivity} tone="#16a34a" empty="No peer productivity yet." /> : null}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="Hold reasons" subtitle="Why jobs are waiting on supervisors">
          {holds.loading ? <Spinner label="Loading holds…" /> : null}
          {!holds.loading && !Object.keys(a.holdReasons || {}).length ? <Empty>No holds recorded.</Empty> : null}
          {Object.keys(a.holdReasons || {}).length
            ? <BarList data={a.holdReasons} tone="#f59e0b" />
            : null}
        </Card>
      </div>
    </>
  );
}
