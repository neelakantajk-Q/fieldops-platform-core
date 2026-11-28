import { useState } from 'react';
import { Btn, Card, Field, Modal, PageHeader, Spinner, Table, Tabs, useAsync, useToast } from '../components.jsx';
import { fieldopsPost, listRecords } from '../lib/fieldops.js';

const FLOW = {
  INTAKE: ['DIAGNOSIS', 'CANCELLED'],
  DIAGNOSIS: ['APPROVAL', 'IN_REPAIR', 'CANCELLED'],
  APPROVAL: ['IN_REPAIR', 'CANCELLED'],
  IN_REPAIR: ['QA', 'CANCELLED'],
  QA: ['RELEASED', 'IN_REPAIR', 'CANCELLED'],
  RELEASED: [],
  CANCELLED: []
};
const PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'CRITICAL'];
const ACTIVE = ['INTAKE', 'DIAGNOSIS', 'APPROVAL', 'IN_REPAIR', 'QA'];

export default function Repairs({ jobCardId }) {
  const toast = useToast();
  const [tab, setTab] = useState('active');
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);
  const list = useAsync(() => fieldopsPost('/api/fieldops/repair/list', jobCardId ? { jobCardId } : {}), []);

  const items = (list.data && list.data.items) || [];
  const filtered = items.filter((r) => {
    if (tab === 'active') return ACTIVE.indexOf(r.stage) >= 0;
    if (tab === 'released') return r.stage === 'RELEASED';
    if (tab === 'cancelled') return r.stage === 'CANCELLED';
    return true;
  });

  return (
    <PageHeader title="Repairs" subtitle="Repair pipeline for assets: intake → diagnosis → approval → in-repair → QA → release"
      actions={<Btn onClick={() => setCreating(true)}>New repair order</Btn>}>
      <Tabs
        tabs={[{ id: 'active', label: 'Active' }, { id: 'released', label: 'Released' }, { id: 'cancelled', label: 'Cancelled' }, { id: 'all', label: 'All' }]}
        active={tab}
        onChange={setTab}
      />
      {list.loading ? <Spinner label="Loading repair orders…" /> : null}
      {list.error ? <div className="hint-banner">{list.error.message}</div> : null}
      {!list.loading && list.data ? (
        <Card title={`${filtered.length} repair order(s)`}>
          <Table
            columns={[
              { key: 'repairNo', label: 'Repair', render: (r) => r.repairNo || '—' },
              { key: 'plate', label: 'Vehicle', render: (r) => r.plate || '—' },
              { key: 'jobCode', label: 'Job', render: (r) => r.jobCode || '—' },
              { key: 'stage', label: 'Stage', render: (r) => <span className="badge">{r.stage}</span> },
              { key: 'priority', label: 'Priority', render: (r) => <span className={r.priority === 'CRITICAL' || r.priority === 'HIGH' ? 'badge bad' : 'badge warn'}>{r.priority || '—'}</span> },
              { key: 'reportedFault', label: 'Reported fault', render: (r) => r.reportedFault || '—' },
              { key: 'vendor', label: 'Vendor', render: (r) => r.vendor || '—' },
              { key: 'promisedAt', label: 'Promised', render: (r) => (r.promisedAt ? String(r.promisedAt).slice(0, 10) : '—') },
              { key: 'actions', label: '', render: (r) => <Btn size="sm" variant="ghost" onClick={() => setDetail(r)}>Open</Btn> }
            ]}
            rows={filtered}
            rowKey={(r) => r.id}
            empty="No repair orders in this view."
          />
        </Card>
      ) : null}

      {detail ? (
        <RepairDetail item={detail} toast={toast}
          onClose={() => setDetail(null)}
          onChanged={() => { setDetail(null); list.reload(); }} />
      ) : null}
      {creating ? (
        <RepairCreate toast={toast}
          jobCardId={jobCardId}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); list.reload(); }} />
      ) : null}
    </PageHeader>
  );
}

function RepairDetail({ item, toast, onClose, onChanged }) {
  const [form, setForm] = useState({
    priority: item.priority || 'NORMAL',
    diagnosis: item.diagnosis || '',
    workDone: item.workDone || '',
    vendor: item.vendor || '',
    estimatedCost: item.estimatedCost || 0,
    actualCost: item.actualCost || 0,
    promisedAt: item.promisedAt ? String(item.promisedAt).slice(0, 10) : '',
    notes: item.notes || ''
  });
  const [busy, setBusy] = useState(false);
  const upd = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));
  const locked = item.stage === 'RELEASED' || item.stage === 'CANCELLED';

  const save = async () => {
    setBusy(true);
    try {
      await fieldopsPost('/api/fieldops/repair/update', Object.assign({ id: item.id }, form));
      toast.push('Repair order updated', 'ok');
      onChanged();
    } catch (e) { toast.push(e.message, 'bad'); }
    finally { setBusy(false); }
  };

  const move = async (to) => {
    setBusy(true);
    try {
      await fieldopsPost('/api/fieldops/repair/transition', { id: item.id, to });
      toast.push(`Repair moved to ${to}`, 'ok');
      onChanged();
    } catch (e) { toast.push(e.message, 'bad'); }
    finally { setBusy(false); }
  };

  const nexts = FLOW[item.stage] || [];
  return (
    <Modal open wide title={`${item.repairNo || 'Repair'} · ${item.stage}`} onClose={onClose}
      footer={<div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
        {nexts.map((n) => <Btn key={n} variant={n === 'CANCELLED' ? 'ghost' : 'primary'} onClick={() => move(n)} disabled={busy}>{n}</Btn>)}
        {!locked ? <Btn variant="ghost" onClick={save} disabled={busy}>Save</Btn> : null}
      </div>}>
      <div className="grid two">
        <Field label="Vehicle"><div>{item.plate || '—'} {item.vin ? `· ${item.vin}` : ''}</div></Field>
        <Field label="Job"><div>{item.jobCode || '—'}</div></Field>
        <Field label="Technician"><div>{item.technician || '—'}</div></Field>
        <Field label="Created"><div>{item.created ? String(item.created).slice(0, 10) : '—'}</div></Field>
      </div>
      <Field label="Reported fault"><div>{item.reportedFault || '—'}</div></Field>
      <div className="grid two">
        <Field label="Priority">
          <select value={form.priority} onChange={(e) => upd('priority', e.target.value)} disabled={locked}>
            {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Promised date"><input type="date" value={form.promisedAt} onChange={(e) => upd('promisedAt', e.target.value)} disabled={locked} /></Field>
      </div>
      <Field label="Diagnosis"><textarea rows={2} value={form.diagnosis} onChange={(e) => upd('diagnosis', e.target.value)} disabled={locked} /></Field>
      <Field label="Work done"><textarea rows={2} value={form.workDone} onChange={(e) => upd('workDone', e.target.value)} disabled={locked} /></Field>
      <div className="grid two">
        <Field label="Vendor"><input value={form.vendor} onChange={(e) => upd('vendor', e.target.value)} disabled={locked} /></Field>
        <Field label="Estimated cost"><input type="number" value={form.estimatedCost} onChange={(e) => upd('estimatedCost', e.target.value)} disabled={locked} /></Field>
      </div>
      <div className="grid two">
        <Field label="Actual cost"><input type="number" value={form.actualCost} onChange={(e) => upd('actualCost', e.target.value)} disabled={locked} /></Field>
        <Field label="Notes"><textarea rows={2} value={form.notes} onChange={(e) => upd('notes', e.target.value)} disabled={locked} /></Field>
      </div>
    </Modal>
  );
}

export function RepairCreate({ toast, onClose, onCreated, jobCardId }) {
  const vehicles = useAsync(() => listRecords('vehicles'), []);
  const [form, setForm] = useState({ vehicleId: '', reportedFault: '', priority: 'NORMAL', vendor: '', promisedAt: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const upd = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));
  const rows = vehicles.data || [];

  const submit = async () => {
    if (!form.reportedFault.trim()) { toast.push('Describe the reported fault.', 'bad'); return; }
    if (!form.vehicleId && !jobCardId) { toast.push('Select a vehicle first.', 'bad'); return; }
    setBusy(true);
    try {
      await fieldopsPost('/api/fieldops/repair/create', Object.assign({}, form, jobCardId ? { jobCardId: String(jobCardId) } : {}));
      toast.push('Repair order created', 'ok');
      onCreated();
    } catch (e) { toast.push(e.message, 'bad'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open wide title="New repair order" onClose={onClose}
      footer={<div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={submit} disabled={busy}>Create</Btn>
      </div>}>
      <Field label="Vehicle">
        <select value={form.vehicleId} onChange={(e) => upd('vehicleId', e.target.value)}>
          <option value="">Select a vehicle…</option>
          {rows.map((v) => <option key={v.id} value={v.id}>{v.plate_no || v.vin || v.id}</option>)}
        </select>
      </Field>
      {jobCardId ? <Field label="Job"><div>Linked repair order for job {jobCardId}</div></Field> : null}
      <Field label="Reported fault"><textarea rows={2} value={form.reportedFault} onChange={(e) => upd('reportedFault', e.target.value)} /></Field>
      <div className="grid two">
        <Field label="Priority">
          <select value={form.priority} onChange={(e) => upd('priority', e.target.value)}>
            {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Promised date"><input type="date" value={form.promisedAt} onChange={(e) => upd('promisedAt', e.target.value)} /></Field>
      </div>
      <div className="grid two">
        <Field label="Vendor"><input value={form.vendor} onChange={(e) => upd('vendor', e.target.value)} /></Field>
        <Field label="Notes"><textarea rows={2} value={form.notes} onChange={(e) => upd('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
