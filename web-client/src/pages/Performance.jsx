import { call } from '../api.js';
import { Card, Empty, PageHeader, Spinner, Stat, Table, useAsync } from '../components.jsx';

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
  const tasks = useAsync(() => call('getTasks', { page: 1, pageSize: 500 }), []);
  const mis = useAsync(() => call('getMisReport', {}), []);
  const a = (perf.data && perf.data.analytics) || {};
  const pendingHolds = ((holds.data && holds.data.pending) || []).length;
  const total = Number(a.totalTasks) || 0;
  const done = Number(a.completedTasks) || 0;

  const userRows = {};
  (tasks.data && tasks.data.tasks || []).forEach((t) => {
    const name = t.assignedUserId || 'Unassigned';
    const row = userRows[name] || (userRows[name] = { user: name, jobs: 0, completed: 0, open: 0, holds: 0, tat: 0, _tat: 0 });
    row.jobs += 1;
    if (t.status === 'Completed') { row.completed += 1; row._tat += Number(t.turnaroundMinutes) || 0; }
    else if (t.status === 'OnHold') row.holds += 1;
    else row.open += 1;
  });
  const users = Object.values(userRows)
    .map((r) => ({ ...r, rate: r.jobs ? Math.round(100 * r.completed / r.jobs) : 0, avgTat: r.completed ? Math.round(r._tat / r.completed) : 0 }))
    .sort((x, y) => y.completed - x.completed || y.jobs - x.jobs);

  const hubRows = (mis.data && mis.data.rows) || [];

  return (
    <>
      <PageHeader title="Hub & Peer Performance"
        subtitle={`Operational comparison for ${session.role} · ${session.hub || 'all hubs'}`}
        actions={<button className="btn ghost sm" onClick={() => { perf.reload(); holds.reload(); tasks.reload(); mis.reload(); }}>REFRESH</button>} />

      {perf.error ? <div className="hint-banner" style={{ marginBottom: 16 }}>{perf.error.message}</div> : null}

      <div className="kpi-grid" style={{ marginBottom: 16 }}>
        <Stat label="Total jobs" value={total} hint="All job cards in scope" tone="info" icon="TOT" />
        <Stat label="Completed" value={done} hint={`${total ? Math.round(100 * done / total) : 0}% completion rate`} tone="ok" icon="DONE" />
        <Stat label="Open / delayed" value={Number(a.openTasks) || 0} hint="In progress and open" tone="warn" icon="OPEN" />
        <Stat label="Pending holds" value={pendingHolds} hint="Awaiting supervisor" tone="bad" icon="HOLD" />
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
        <Card title="User-wise performance" subtitle="Job cards per engineer with completion rate and TAT">
          {tasks.loading ? <Spinner label="Loading user performance…" /> : null}
          {tasks.error ? <div className="hint-banner">{tasks.error.message}</div> : null}
          {!tasks.loading && !tasks.error ? (
            <Table
              rows={users}
              rowKey={(r) => r.user}
              empty="No assigned jobs yet."
              columns={[
                { key: 'user', label: 'Engineer' },
                { key: 'jobs', label: 'Jobs' },
                { key: 'completed', label: 'Completed' },
                { key: 'open', label: 'Open' },
                { key: 'holds', label: 'Holds' },
                { key: 'rate', label: 'Completion', render: (r) => `${r.rate}%` },
                { key: 'avgTat', label: 'Avg TAT', render: (r) => (r.avgTat ? `${r.avgTat} min` : '-') }
              ]}
            />
          ) : null}
        </Card>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="Hub-wise performance" subtitle="Job cards per hub with completion rate and TAT">
          {mis.loading ? <Spinner label="Loading hub performance…" /> : null}
          {mis.error ? <div className="hint-banner">{mis.error.message}</div> : null}
          {!mis.loading && !mis.error ? (
            <Table
              rows={hubRows}
              rowKey={(r) => r.hubName}
              empty="No hub jobs yet."
              columns={[
                { key: 'hubName', label: 'Hub' },
                { key: 'jobs', label: 'Jobs' },
                { key: 'completed', label: 'Completed' },
                { key: 'holds', label: 'Holds' },
                { key: 'rate', label: 'Completion', render: (r) => `${r.jobs ? Math.round(100 * r.completed / r.jobs) : 0}%` },
                { key: 'avgTatMinutes', label: 'Avg TAT', render: (r) => (r.avgTatMinutes ? `${r.avgTatMinutes} min` : '-') }
              ]}
            />
          ) : null}
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
