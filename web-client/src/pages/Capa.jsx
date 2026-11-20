import { useState } from 'react';
import { Btn, Card, Field, Modal, PageHeader, Spinner, Table, Tabs, useAsync, useToast } from '../components.jsx';
import { fieldopsPost, listRecords } from '../lib/fieldops.js';

const FLOW = {
  OPEN: ['INVESTIGATING'],
  INVESTIGATING: ['ACTION_PLANNED'],
  ACTION_PLANNED: ['VERIFIED'],
  VERIFIED: ['CLOSED'],
  RESOLVED: ['CLOSED'],
  CLOSED: []
};
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const CATEGORIES = ['MAN_POWER', 'MACHINE', 'MATERIAL', 'METHOD', 'MEASUREMENT', 'ENVIRONMENT', 'PROCESS', 'OTHER'];
const OPEN_STATES = ['OPEN', 'INVESTIGATING', 'ACTION_PLANNED'];

export default function Capa() {
  const toast = useToast();
  const [tab, setTab] = useState('open');
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);
  const list = useAsync(() => fieldopsPost('/api/fieldops/capa/list', {}), []);

  const items = (list.data && list.data.items) || [];
  const filtered = items.filter((r) => {
    if (tab === 'open') return OPEN_STATES.indexOf(r.status) >= 0;
    if (tab === 'verified') return r.status === 'VERIFIED';
    if (tab === 'closed') return r.status === 'CLOSED' || r.status === 'RESOLVED';
    return true;
  });

  const exportCsv = async () => {
    try {
      const res = await fieldopsPost('/api/fieldops/capa/export', {});
      const blob = new Blob([res.csv || ''], { type: 'text/csv' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = res.filename || 'capa.csv';
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { toast.push(e.message, 'bad'); }
  };

  return (
    <PageHeader title="CAPA" subtitle="Corrective & preventive actions across job holds, repairs and downtime"
      actions={<div className="row" style={{ gap: 8 }}>
        <Btn variant="ghost" onClick={exportCsv}>Export CSV</Btn>
        <Btn onClick={() => setCreating(true)}>New CAPA</Btn>
      </div>}>
      <Tabs
        tabs={[{ id: 'open', label: 'Open' }, { id: 'verified', label: 'Verified' }, { id: 'closed', label: 'Closed' }, { id: 'all', label: 'All' }]}
        active={tab}
        onChange={setTab}
      />
      {list.loading ? <Spinner label="Loading CAPA…" /> : null}
      {list.error ? <div className="hint-banner">{list.error.message}</div> : null}
      {!list.loading && list.data ? (
        <Card title={`${filtered.length} CAPA record(s)`} subtitle="OPEN → INVESTIGATING → ACTION_PLANNED → VERIFIED → CLOSED">
          <Table
            columns={[
              { key: 'capaNo', label: 'CAPA', render: (r) => r.capaNo || '—' },
              { key: 'jobCode', label: 'Job', render: (r) => r.jobCode || '—' },
              { key: 'plate', label: 'Vehicle', render: (r) => r.plate || '—' },
              { key: 'technician', label: 'Technician', render: (r) => r.technician || '—' },
              { key: 'severity', label: 'Severity', render: (r) => <span className={r.severity === 'HIGH' || r.severity === 'CRITICAL' ? 'badge bad' : 'badge warn'}>{r.severity || '—'}</span> },
              { key: 'status', label: 'Status', render: (r) => <span className="badge">{r.status}</span> },
              { key: 'rootCauseCategory', label: 'Category', render: (r) => r.rootCauseCategory || '—' },
              { key: 'dueDate', label: 'Due', render: (r) => (r.dueDate ? String(r.dueDate).slice(0, 10) : '—') },
              { key: 'actions', label: '', render: (r) => <Btn size="sm" variant="ghost" onClick={() => setDetail(r)}>Open</Btn> }
            ]}
            rows={filtered}
            rowKey={(r) => r.id}
            empty="No CAPA records in this view."
          />
        </Card>
      ) : null}

      {detail ? (
        <CapaDetail item={detail} toast={toast}
          onClose={() => setDetail(null)}
          onChanged={() => { setDetail(null); list.reload(); }} />
      ) : null}
      {creating ? (
        <CapaCreate toast={toast}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); list.reload(); }} />
      ) : null}
    </PageHeader>
  );
}

function CapaDetail({ item, toast, onClose, onChanged }) {
  const [form, setForm] = useState({
    severity: item.severity || 'MEDIUM',
    rootCauseCategory: item.rootCauseCategory || 'OTHER',
    rootCause: item.rootCause || '',
    containmentAction: item.containmentAction || '',
    correctiveAction: item.correctiveAction || '',
    preventiveAction: item.preventiveAction || '',
    dueDate: item.dueDate ? String(item.dueDate).slice(0, 10) : '',
    effectivenessNotes: item.effectivenessNotes || '',
    notes: item.notes || ''
  });
  const [busy, setBusy] = useState(false);
  const upd = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));

  const save = async () => {
    setBusy(true);
    try {
      await fieldopsPost('/api/fieldops/capa/update', Object.assign({ id: item.id }, form));
      toast.push('CAPA updated', 'ok');
      onChanged();
    } catch (e) { toast.push(e.message, 'bad'); }
    finally { setBusy(false); }
  };

  const move = async (to) => {
    setBusy(true);
    try {
      await fieldopsPost('/api/fieldops/capa/transition', { id: item.id, to });
      toast.push(`CAPA moved to ${to}`, 'ok');
      onChanged();
    } catch (e) { toast.push(e.message, 'bad'); }
    finally { setBusy(false); }
  };

  const nexts = FLOW[item.status] || [];
  return (
    <Modal open wide title={`${item.capaNo || 'CAPA'} · ${item.status}`} onClose={onClose}
      footer={<div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        {nexts.map((n) => <Btn key={n} onClick={() => move(n)} disabled={busy}>Move to {n}</Btn>)}
        {item.status !== 'CLOSED' ? <Btn variant="ghost" onClick={save} disabled={busy}>Save</Btn> : null}
      </div>}>
      <div className="grid two">
        <Field label="Job"><div>{item.jobCode || '—'}</div></Field>
        <Field label="Vehicle"><div>{item.plate || '—'}</div></Field>
        <Field label="Technician"><div>{item.technician || '—'}</div></Field>
        <Field label="Opened"><div>{item.openedAt ? String(item.openedAt).slice(0, 10) : '—'}</div></Field>
      </div>
      <div className="grid two">
        <Field label="Severity">
          <select value={form.severity} onChange={(e) => upd('severity', e.target.value)} disabled={item.status === 'CLOSED'}>
            {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Root cause category">
          <select value={form.rootCauseCategory} onChange={(e) => upd('rootCauseCategory', e.target.value)} disabled={item.status === 'CLOSED'}>
            {CATEGORIES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Root cause"><textarea rows={2} value={form.rootCause} onChange={(e) => upd('rootCause', e.target.value)} disabled={item.status === 'CLOSED'} /></Field>
      <Field label="Containment action"><textarea rows={2} value={form.containmentAction} onChange={(e) => upd('containmentAction', e.target.value)} disabled={item.status === 'CLOSED'} /></Field>
      <Field label="Corrective action"><textarea rows={2} value={form.correctiveAction} onChange={(e) => upd('correctiveAction', e.target.value)} disabled={item.status === 'CLOSED'} /></Field>
      <Field label="Preventive action"><textarea rows={2} value={form.preventiveAction} onChange={(e) => upd('preventiveAction', e.target.value)} disabled={item.status === 'CLOSED'} /></Field>
      <div className="grid two">
        <Field label="Due date"><input type="date" value={form.dueDate} onChange={(e) => upd('dueDate', e.target.value)} disabled={item.status === 'CLOSED'} /></Field>
        <Field label="Effectiveness"><textarea rows={2} value={form.effectivenessNotes} onChange={(e) => upd('effectivenessNotes', e.target.value)} disabled={item.status === 'CLOSED'} /></Field>
      </div>
      <Field label="Notes / history"><textarea rows={3} value={form.notes} onChange={(e) => upd('notes', e.target.value)} disabled={item.status === 'CLOSED'} /></Field>
    </Modal>
  );
}

function CapaCreate({ toast, onClose, onCreated }) {
  const jobs = useAsync(() => listRecords('job_cards'), []);
  const [form, setForm] = useState({
    jobCardId: '', severity: 'MEDIUM', rootCauseCategory: 'OTHER',
    rootCause: '', containmentAction: '', correctiveAction: '', preventiveAction: '',
    dueDate: '', notes: ''
  });
  const [busy, setBusy] = useState(false);
  const upd = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));

  const rows = (jobs.data || []).filter((j) => ['OPEN', 'IN_PROGRESS', 'ON_HOLD'].indexOf(j.status) >= 0);

  const submit = async () => {
    if (!form.jobCardId) { toast.push('Select a job card first.', 'bad'); return; }
    setBusy(true);
    try {
      await fieldopsPost('/api/fieldops/capa/create', form);
      toast.push('CAPA opened', 'ok');
      onCreated();
    } catch (e) { toast.push(e.message, 'bad'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open wide title="Open a CAPA" onClose={onClose}
      footer={<div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={submit} disabled={busy}>Open CAPA</Btn>
      </div>}>
      <Field label="Job card">
        <select value={form.jobCardId} onChange={(e) => upd('jobCardId', e.target.value)}>
          <option value="">Select an open job…</option>
          {rows.map((j) => <option key={j.id} value={j.id}>{j.job_code || j.id} · {j.status}</option>)}
        </select>
      </Field>
      <div className="grid two">
        <Field label="Severity">
          <select value={form.severity} onChange={(e) => upd('severity', e.target.value)}>
            {SEVERITIES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Root cause category">
          <select value={form.rootCauseCategory} onChange={(e) => upd('rootCauseCategory', e.target.value)}>
            {CATEGORIES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Root cause"><textarea rows={2} value={form.rootCause} onChange={(e) => upd('rootCause', e.target.value)} /></Field>
      <Field label="Containment action"><textarea rows={2} value={form.containmentAction} onChange={(e) => upd('containmentAction', e.target.value)} /></Field>
      <Field label="Corrective action"><textarea rows={2} value={form.correctiveAction} onChange={(e) => upd('correctiveAction', e.target.value)} /></Field>
      <Field label="Preventive action"><textarea rows={2} value={form.preventiveAction} onChange={(e) => upd('preventiveAction', e.target.value)} /></Field>
      <div className="grid two">
        <Field label="Due date"><input type="date" value={form.dueDate} onChange={(e) => upd('dueDate', e.target.value)} /></Field>
        <Field label="Notes"><textarea rows={2} value={form.notes} onChange={(e) => upd('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
