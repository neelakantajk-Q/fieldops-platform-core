import { useEffect, useState } from 'react';
import { call } from '../api.js';
import { Btn, Card, Field, PageHeader, Spinner, Stat, Table, useAsync } from '../components.jsx';

export default function Person360({ session }) {
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    call('getUsers', {}).then((r) => {
      const list = r.users || [];
      setUsers(list);
      const self = list.find((u) => u.id === session.userId) || list[0];
      if (self) setUserId(self.id);
    }).catch(() => setUsers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async (id) => {
    if (!id) return;
    setLoading(true); setError('');
    try {
      const res = await call('person360', { userId: id });
      setData(res);
    } catch (err) {
      setError(err.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (userId) load(userId); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps

  const person = data && data.person;
  const attendance = (data && data.attendance) || [];
  const jobs = (data && data.jobs) || [];
  const visits = (data && data.dealerVisits) || [];
  const holds = (data && data.holds) || [];
  const capa = (data && data.capa) || [];

  return (
    <>
      <PageHeader
        title="Person 360"
        subtitle="One person, everything: attendance, jobs, dealer visits, holds and CAPA"
        actions={
          <div className="row">
            <select value={userId} onChange={(e) => setUserId(e.target.value)} style={{ width: 220 }}>
              <option value="">Select person…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.username}{u.role ? ` · ${u.role}` : ''}</option>
              ))}
            </select>
            <Btn size="sm" variant="ghost" onClick={() => load(userId)} disabled={loading || !userId}>Refresh</Btn>
          </div>
        }
      />

      {error ? <div className="hint-banner" style={{ marginBottom: 12 }}>{error}</div> : null}
      {loading ? <Spinner label="Loading person 360…" /> : null}

      {person ? (
        <>
          <div className="grid stats" style={{ marginBottom: 12 }}>
            <Stat label="Person" value={person.username || '—'} hint={person.role || ''} />
            <Stat label="Duty" value={person.checkedIn ? 'On duty' : 'Off duty'} hint={person.lastZone || '—'} tone={person.checkedIn ? 'ok' : ''} />
            <Stat label="Jobs" value={jobs.length} hint={`${jobs.filter((j) => j.status === 'CLOSED').length} closed`} />
            <Stat label="Dealer visits" value={visits.length} hint={data.istDate || ''} />
          </div>

          <Card title="Attendance today">
            <Table
              columns={[
                { key: 'timestamp', label: 'Time', render: (r) => shortTime(r.timestamp) },
                { key: 'action', label: 'Action', render: (r) => <span className={`badge ${r.action === 'CheckIn' ? 'ok' : 'neutral'}`}>{r.action}</span> },
                { key: 'status', label: 'Status', render: (r) => r.status || '—' },
                { key: 'auto', label: 'Auto', render: (r) => (r.auto ? 'Yes' : '—') },
                { key: 'reason', label: 'Reason', render: (r) => r.reason || '—' },
                { key: 'shift', label: 'Shift', render: (r) => (r.shiftMinutes ? `${r.shiftMinutes}m` : '—') },
                { key: 'proof', label: 'Proof', render: (r) => (r.photo || r.checkoutPhoto ? <a className="btn ghost sm" href={r.checkoutPhoto || r.photo} target="_blank" rel="noreferrer">View</a> : '—') }
              ]}
              rows={attendance}
              empty="No attendance today."
              rowKey={(r) => r.id}
            />
          </Card>

          <Card title="Job cards">
            <Table
              columns={[
                { key: 'jobCode', label: 'Job', render: (r) => <strong>{r.jobCode || '—'}</strong> },
                { key: 'status', label: 'Status', render: (r) => <span className={`badge ${r.status === 'CLOSED' ? 'ok' : 'warn'}`}>{r.status || '—'}</span> },
                { key: 'startedAt', label: 'Started', render: (r) => shortTime(r.startedAt) },
                { key: 'completedAt', label: 'Completed', render: (r) => shortTime(r.completedAt) },
                { key: 'grossTat', label: 'TAT', render: (r) => (r.grossTat ? `${r.grossTat}m` : '—') },
                { key: 'holdToStop', label: 'Hold→stop', render: (r) => (r.holdToStop ? `${r.holdToStop}m` : '—') },
                { key: 'parts', label: 'Parts', render: (r) => r.partsExtractStatus || '—' }
              ]}
              rows={jobs}
              empty="No job cards."
              rowKey={(r) => r.id}
            />
          </Card>

          <Card title="Dealer visits">
            <Table
              columns={[
                { key: 'visitNo', label: 'Visit', render: (r) => r.visitNo || '—' },
                { key: 'status', label: 'Status', render: (r) => r.status || '—' },
                { key: 'mode', label: 'Mode', render: (r) => r.mode || '—' },
                { key: 'checkInAt', label: 'Check-in', render: (r) => shortTime(r.checkInAt) }
              ]}
              rows={visits}
              empty="No dealer visits."
              rowKey={(r) => r.id}
            />
          </Card>

          <Card title="Holds & CAPA">
            <Table
              columns={[
                { key: 'kind', label: 'Type', render: (r) => <span className="badge neutral">{r.kind}</span> },
                { key: 'detail', label: 'Detail', render: (r) => r.detail || '—' },
                { key: 'at', label: 'When', render: (r) => shortTime(r.at) },
                { key: 'minutes', label: 'Minutes', render: (r) => (r.minutes ? `${r.minutes}m` : '—') }
              ]}
              rows={[
                ...holds.map((h) => ({ id: `h-${h.id}`, kind: 'HOLD', detail: h.reason, at: h.heldAt, minutes: h.durationMinutes })),
                ...capa.map((c) => ({ id: `c-${c.id}`, kind: 'CAPA', detail: c.rootCause || c.corrective, at: '', minutes: 0 }))
              ]}
              empty="No holds or CAPA records."
              rowKey={(r) => r.id}
            />
          </Card>
        </>
      ) : (!loading && !error ? <Card><span className="muted">Select a person to load their 360 view.</span></Card> : null)}
    </>
  );
}

function shortTime(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(value).slice(0, 16);
  return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
