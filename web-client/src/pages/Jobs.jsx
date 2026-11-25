import { useEffect, useMemo, useState } from 'react';
import { call } from '../api.js';
import {
  Btn, Card, Empty, Field, Modal, PageHeader, Spinner, Table, useAsync, useToast,
  VoiceTextInput, VoiceTextarea, SmartFillButton
} from '../components.jsx';
import { clientRequestId } from '../lib/utils.js';

const STATUSES = ['InProgress', 'Completed', 'Delayed', 'Interrupted', 'Cancelled'];
const HOLD_CATEGORIES = ['Spare Parts', 'Customer Unavailable', 'Access Issue', 'Vehicle Breakdown', 'Weather', 'Other'];
const JOB_FIELDS_SCHEMA = [
  { key: "client", label: "Client", type: "text" },
  { key: "vehicleNo", label: "Vehicle number", type: "text" },
  { key: "delayReason", label: "Delay reason", type: "text" },
  { key: "rootCause", label: "Root cause", type: "text" },
  { key: "checklist", label: "Checklist", type: "text" },
  { key: "partsUsed", label: "Parts used", type: "text" },
  { key: "serviceNotes", label: "Service notes", type: "text" },
  { key: "resolutionNotes", label: "Resolution notes", type: "text" }
];

function elapsed(task, now) {
  if (!task) return '—';
  const clock = now || Date.now();
  const parse = (v) => new Date(v).getTime();
  if (task.turnaroundMinutes && task.endTime) {
    const m = Number(task.turnaroundMinutes);
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  if (task.startTime) {
    const m = Math.round((clock - parse(task.startTime)) / 60000);
    if (!isFinite(m) || m < 0) return '—';
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  }
  return '—';
}

function holdElapsed(task, now) {
  if (!task || task.status !== 'OnHold' || !task.holdStartedAt) return '—';
  const m = Math.round(((now || Date.now()) - new Date(task.holdStartedAt).getTime()) / 60000);
  if (!isFinite(m) || m < 0) return '—';
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function statusTone(status) {
  if (status === 'Completed') return 'ok';
  if (status === 'InProgress') return 'primary';
  if (status === 'OnHold' || status === 'HoldRequested') return 'bad';
  return 'warn';
}

function fmtMinutes(m) {
  const n = Number(m) || 0;
  if (!n) return '—';
  return `${Math.floor(n / 60)}h ${n % 60}m`;
}

function fmtAt(v) {
  if (!v) return '—';
  const d = new Date(String(v).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(v);
  return d.toLocaleString();
}

function Odo({ value, unit }) {
  if (value === null || value === undefined || value === '') return <span className="muted">—</span>;
  return <span className="mono">{Number(value).toLocaleString()} {unit || 'km'}</span>;
}

function ProofThumb({ url, label }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title={label}>
      <img src={url} alt={label} style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--line)' }} />
    </a>
  );
}

function ProofRow({ task }) {
  if (!task.startProof && !task.endProof) return <span className="muted">—</span>;
  return (
    <div className="row" style={{ gap: 6 }}>
      <ProofThumb url={task.startProof} label="Start proof" />
      <ProofThumb url={task.endProof} label="Stop proof" />
    </div>
  );
}

export default function Jobs({ session, checkedIn }) {
  const toast = useToast();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState({ status: '', search: '' });
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [viewing, setViewing] = useState(null);
  const [type, setType] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const { data, loading, error, reload } = useAsync(
    () => call('getTasks', { status: query.status, query: query.search, page: 1, pageSize: 200 }),
    [query.status, query.search]
  );

  const rows = ((data && data.tasks) || []).filter((r) => !type || (r.jobType || 'FIELD_SERVICE') === type);

  async function requestHold(task) {
    const category = window.prompt(`Hold category for ${task.jobId}:`, HOLD_CATEGORIES[0]);
    if (!category) return;
    const reason = window.prompt('Hold reason (visible to supervisor):', '');
    if (reason === null) return;
    try {
      await call('jobHoldRequest', {
        jobId: task.jobId,
        holdCategory: category,
        holdReason: reason,
        holdSource: 'Manual',
        clientRequestId: clientRequestId(),
        mock: false
      });
      toast.push('Hold requested.', 'ok');
      reload();
    } catch (err) {
      toast.push(err.message, 'bad');
    }
  }

  const columns = useMemo(() => [
    {
      key: 'jobId', label: 'Job card',
      render: (r) => (
        <button type="button" className="link-btn" onClick={() => setViewing(r)} title="Open job details">
          <strong>{r.jobId}</strong>
        </button>
      )
    },
    { key: 'jobType', label: 'Type', render: (r) => <span className={`badge ${r.jobType === 'HUB_REPAIR' ? 'warn' : 'neutral'}`}>{r.jobType === 'HUB_REPAIR' ? 'Repair' : 'Field'}</span> },
    { key: 'complaintNo', label: 'Complaint', render: (r) => <span className="mono small">{r.complaintNo || '�?"'}</span> },
    { key: 'docketNo', label: 'Docket', render: (r) => <span className="mono small">{r.docketNo || '�?"'}</span> },
    { key: 'vehicleNo', label: 'Vehicle', render: (r) => r.vehicleNo || '�?"' },
    { key: 'client', label: 'Client', render: (r) => r.client || '�?"' },
    { key: 'assignedUserId', label: 'Assigned' },
    { key: 'odo', label: 'Start odo', render: (r) => <Odo value={r.startOdometer} unit={r.odometerUnit} /> },
    { key: 'proof', label: 'Start/stop proof', render: (r) => <ProofRow task={r} /> },
    { key: 'downtime', label: 'Downtime', render: (r) => fmtMinutes(r.downtimeMinutes) },
    {
      key: 'status', label: 'Status',
      render: (r) => (
        <span className="row" style={{ gap: 6 }}>
          <span className={`badge ${statusTone(r.status)}`}>{r.status}</span>
          {r.status === 'HoldRequested' ? <span className="badge warn">Held: {r.holdCategory || 'pending'}</span> : null}
          {r.status === 'OnHold' ? <span className="badge bad">Approved {r.holdApprovedBy ? `· ${r.holdApprovedBy}` : ''}</span> : null}
        </span>
      )
    },
    { key: 'elapsed', label: 'Elapsed', render: (r) => elapsed(r, now) },
    {
      key: 'holdElapsed', label: 'On hold',
      render: (r) => {
        const h = holdElapsed(r, now);
        if (h === '—') return <span className="muted">—</span>;
        const over = r.holdToStopMinutes && Math.round((now - new Date(r.holdStartedAt).getTime()) / 60000) > r.holdToStopMinutes;
        return <span className={`badge ${over ? 'bad' : 'warn'}`}>{h}{over ? ' · over TAT' : ''}</span>;
      }
    },
    {
      key: 'parts', label: 'Parts',
      render: (r) => {
        const s = r.partsExtractStatus || 'NONE';
        const tone = s === 'PENDING' ? 'warn' : s === 'DONE' ? 'ok' : 'neutral';
        return <span className={`badge ${tone}`}>{s}</span>;
      }
    },
    { key: 'plateSource', label: 'Plate src', render: (r) => r.plateSource || '—' },
    { key: 'updatedBy', label: 'Last edit', render: (r) => r.updatedByName || r.updatedBy || '—' },
    {
      key: 'actions', label: 'Actions',
      render: (r) => (
        <div className="row" style={{ gap: 6 }}>
          <Btn size="sm" variant="ghost" onClick={() => { setEditing(r); setModalOpen(true); }}>Edit</Btn>
          {checkedIn && (r.status === 'InProgress' || r.status === 'Delayed')
            ? <Btn size="sm" variant="ghost" onClick={() => requestHold(r)}>Hold</Btn> : null}
        </div>
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [checkedIn, now]);

  return (
    <>
      <PageHeader
        title="Job Cards"
        subtitle="Create, update and hold field jobs with TAT tracking"
        actions={<Btn size="sm" onClick={() => { setEditing(null); setModalOpen(true); }}>New job</Btn>}
      />

      <Card pad={false}
        actions={
          <div className="row">
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 150 }}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={type} onChange={(e) => setType(e.target.value)} style={{ width: 140 }}>
              <option value="">All types</option>
              <option value="FIELD_SERVICE">Field service</option>
              <option value="HUB_REPAIR">Hub repair</option>
            </select>
            <input placeholder="Search job / vehicle / client" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 220 }} />
            <Btn size="sm" variant="ghost" onClick={() => setQuery({ status, search: search.trim() })}>Apply</Btn>
          </div>
        }>
        {error ? <div className="hint-banner" style={{ margin: 16 }}>{error.message}</div> : null}
        {loading ? <Spinner label="Loading job cards…" /> : (
          <div style={{ padding: 16 }}>
            <Table columns={columns} rows={rows} empty="No job cards." rowKey={(r) => r.jobId} />
          </div>
        )}
      </Card>

      <JobModal
        open={modalOpen}
        task={editing}
        session={session}
        checkedIn={checkedIn}
        onClose={() => setModalOpen(false)}
        onSaved={() => { setModalOpen(false); reload(); }}
      />
    </>
  );
}

function JobModal({ open, task, session, checkedIn, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(task && task.jobId);
  const [form, setForm] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const value = (k) => (form[k] !== undefined ? form[k] : (task?.[k] ?? ''));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const targetStatus = value('status') || 'InProgress';
    if (targetStatus === 'InProgress' && !checkedIn && !editing) {
      setMsg('Complete photo check-in before starting a job.');
      return;
    }
    setBusy(true); setMsg('');
    const payload = {
      client: value('client'),
      hub: value('hub') || session.hub || '',
      assignedUserId: value('assignedUserId'),
      vehicleNo: value('vehicleNo'),
      status: targetStatus,
      delayCategory: value('delayCategory'),
      delayReason: value('delayReason'),
      checklist: value('checklist'),
      partsUsed: value('partsUsed'),
      serviceNotes: value('serviceNotes'),
      rootCause: value('rootCause'),
      resolutionNotes: value('resolutionNotes')
    };
    try {
      if (editing) {
        payload.jobId = task.jobId;
        payload.expectedVersion = task.version || task.expectedVersion || 1;
        await call('updateTaskStatus', payload);
        toast.push('Job updated.', 'ok');
      } else {
        await call('saveTask', payload);
        toast.push('Job created.', 'ok');
      }
      onSaved();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function applySmartFill(fields) {
    if (!fields || typeof fields !== "object") return;
    setForm((f) => ({ ...f, ...fields }));
    toast.push("Fields filled from voice.", "ok");
  }

  return (
    <Modal open={open} wide title={editing ? `Edit ${task.jobId}` : 'New job card'} onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><SmartFillButton schema={JOB_FIELDS_SCHEMA} onFields={applySmartFill} disabled={busy} /><Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save job'}</Btn></>}>
      <div className="form-grid">
        <Field label="Client"><input value={value('client')} onChange={set('client')} /></Field>
        <Field label="Hub"><input value={value('hub')} onChange={set('hub')} placeholder={session.hub || 'HUB'} /></Field>
        <Field label="Assigned user id"><input value={value('assignedUserId')} onChange={set('assignedUserId')} /></Field>
        <Field label="Vehicle no"><input value={value('vehicleNo')} onChange={set('vehicleNo')} /></Field>
        <Field label="Status">
          <select value={value('status') || 'InProgress'} onChange={set('status')}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Delay category">
          <select value={value('delayCategory')} onChange={set('delayCategory')}>
            <option value="">— none —</option>
            {HOLD_CATEGORIES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Delay reason"><VoiceTextInput value={value('delayReason')} onChange={set('delayReason')} /></Field>
        <Field label="Root cause"><VoiceTextInput value={value('rootCause')} onChange={set('rootCause')} /></Field>
        <Field label="Checklist"><input value={value('checklist')} onChange={set('checklist')} placeholder="Comma separated" /></Field>
        <Field label="Parts used"><input value={value('partsUsed')} onChange={set('partsUsed')} /></Field>
        <Field label="Service notes"><VoiceTextarea value={value('serviceNotes')} onChange={set('serviceNotes')} rows="2" /></Field>
        <Field label="Resolution notes"><VoiceTextarea value={value('resolutionNotes')} onChange={set('resolutionNotes')} rows="2" /></Field>
      </div>
      {msg ? <div className="login-msg">{msg}</div> : null}
    </Modal>
  );
}
