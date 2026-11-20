import { useState } from 'react';
import { Btn, Card, Field, Modal, PageHeader, Spinner, Table, Tabs, useAsync, useToast } from '../components.jsx';
import { fieldopsPost, listRecords } from '../lib/fieldops.js';

const TYPES = ['ISSUE', 'HANDOVER', 'RETURN', 'GATE_PASS', 'RELEASE'];
const FLOW = {
  OPEN: ['ACKNOWLEDGED', 'DISPUTED', 'CLOSED'],
  ACKNOWLEDGED: ['CLOSED'],
  DISPUTED: ['ACKNOWLEDGED', 'CLOSED'],
  CLOSED: []
};

export default function Custody() {
  const toast = useToast();
  const [tab, setTab] = useState('chain');
  const [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false);
  const [vehicleId, setVehicleId] = useState('');
  const vehicles = useAsync(() => listRecords('vehicles'), []);
  const list = useAsync(() => fieldopsPost('/api/fieldops/custody/list', {}), []);
  const current = useAsync(
    () => (vehicleId ? fieldopsPost('/api/fieldops/custody/current', { vehicleId }) : Promise.resolve(null)),
    [vehicleId]
  );

  const items = (list.data && list.data.items) || [];
  const activeItems = items.filter((r) => r.status !== 'CLOSED');
  const rows = vehicles.data || [];

  return (
    <PageHeader title="Asset Custody" subtitle="Chain of custody for vehicles: issue, handover, return, gate pass and release"
      actions={<Btn onClick={() => setCreating(true)}>New custody event</Btn>}>
      <Tabs
        tabs={[{ id: 'chain', label: 'Chain' }, { id: 'active', label: 'Open / disputed' }, { id: 'current', label: 'Current custodian' }]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'current' ? (
        <Card title="Current custodian" subtitle="Latest custody event for the selected vehicle">
          <Field label="Vehicle">
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">Select a vehicle…</option>
              {rows.map((v) => <option key={v.id} value={v.id}>{v.plate_no || v.vin || v.id}</option>)}
            </select>
          </Field>
          {current.loading ? <Spinner label="Checking custody…" /> : null}
          {current.error ? <div className="hint-banner">{current.error.message}</div> : null}
          {vehicleId && current.data && !current.loading ? (
            current.data.custodian ? (
              <div className="hint-banner" style={{ borderColor: 'var(--ok,#22c55e)' }}>
                <b>{current.data.custodian.label}</b> holds custody ({current.data.custodian.type}) ·
                {' '}last event {current.data.item.custodyType} on {String(current.data.item.occurredAt || '').slice(0, 16).replace('T', ' ')}
              </div>
            ) : (
              <div className="hint-banner">No custody event recorded for this vehicle.</div>
            )
          ) : null}
        </Card>
      ) : (
        <>
          {list.loading ? <Spinner label="Loading custody chain…" /> : null}
          {list.error ? <div className="hint-banner">{list.error.message}</div> : null}
          {!list.loading && list.data ? (
            <Card title={`${(tab === 'active' ? activeItems : items).length} custody event(s)`}>
              <Table
                columns={[
                  { key: 'occurredAt', label: 'When', render: (r) => (r.occurredAt ? String(r.occurredAt).slice(0, 16).replace('T', ' ') : '—') },
                  { key: 'plate', label: 'Vehicle', render: (r) => r.plate || '—' },
                  { key: 'custodyType', label: 'Type', render: (r) => <span className="badge">{r.custodyType}</span> },
                  { key: 'from', label: 'From', render: (r) => r.fromUser || r.fromHub || '—' },
                  { key: 'to', label: 'To', render: (r) => r.toUser || r.toHub || '—' },
                  { key: 'jobCode', label: 'Job', render: (r) => r.jobCode || '—' },
                  { key: 'odometer', label: 'Odometer', render: (r) => r.odometer || '—' },
                  { key: 'status', label: 'Status', render: (r) => <span className={r.status === 'DISPUTED' ? 'badge bad' : 'badge'}>{r.status}</span> },
                  { key: 'actions', label: '', render: (r) => <Btn size="sm" variant="ghost" onClick={() => setDetail(r)}>Open</Btn> }
                ]}
                rows={tab === 'active' ? activeItems : items}
                rowKey={(r) => r.id}
                empty="No custody events yet."
              />
            </Card>
          ) : null}
        </>
      )}

      {detail ? (
        <CustodyDetail item={detail} toast={toast}
          onClose={() => setDetail(null)}
          onChanged={() => { setDetail(null); list.reload(); }} />
      ) : null}
      {creating ? (
        <CustodyCreate toast={toast} vehicles={rows}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); list.reload(); }} />
      ) : null}
    </PageHeader>
  );
}

function CustodyDetail({ item, toast, onClose, onChanged }) {
  const [busy, setBusy] = useState(false);
  const move = async (to) => {
    setBusy(true);
    try {
      await fieldopsPost('/api/fieldops/custody/transition', { id: item.id, to });
      toast.push(`Custody event ${to.toLowerCase()}`, 'ok');
      onChanged();
    } catch (e) { toast.push(e.message, 'bad'); }
    finally { setBusy(false); }
  };
  const nexts = FLOW[item.status] || [];
  return (
    <Modal open wide title={`${item.custodyType} · ${item.plate || item.vehicleId}`} onClose={onClose}
      footer={<div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        {nexts.map((n) => <Btn key={n} variant={n === 'DISPUTED' ? 'ghost' : 'primary'} onClick={() => move(n)} disabled={busy}>{n}</Btn>)}
      </div>}>
      <div className="grid two">
        <Field label="When"><div>{item.occurredAt ? String(item.occurredAt).slice(0, 16).replace('T', ' ') : '—'}</div></Field>
        <Field label="Status"><div>{item.status}</div></Field>
        <Field label="From"><div>{item.fromUser || '—'} {item.fromHub ? `· ${item.fromHub}` : ''}</div></Field>
        <Field label="To"><div>{item.toUser || '—'} {item.toHub ? `· ${item.toHub}` : ''}</div></Field>
        <Field label="Odometer"><div>{item.odometer || '—'}</div></Field>
        <Field label="Fuel"><div>{item.fuelLevel || '—'}</div></Field>
        <Field label="Job"><div>{item.jobCode || '—'}</div></Field>
        <Field label="Repair order"><div>{item.repairOrderId || '—'}</div></Field>
      </div>
      <Field label="Condition notes"><div>{item.conditionNotes || '—'}</div></Field>
      <Field label="Notes / history"><div style={{ whiteSpace: 'pre-wrap' }}>{item.notes || '—'}</div></Field>
    </Modal>
  );
}

function CustodyCreate({ toast, vehicles, onClose, onCreated }) {
  const directory = useAsync(() => fieldopsPost('/api/fieldops/directory', {}), []);
  const [form, setForm] = useState({
    vehicleId: '', custodyType: 'ISSUE', toUserId: '', toHubId: '',
    odometer: '', fuelLevel: '', conditionNotes: '', signature: '', notes: ''
  });
  const [busy, setBusy] = useState(false);
  const upd = (k, v) => setForm((f) => Object.assign({}, f, { [k]: v }));
  const users = (directory.data && directory.data.users) || [];
  const hubs = (directory.data && directory.data.hubs) || [];

  const submit = async () => {
    if (!form.vehicleId) { toast.push('Select a vehicle first.', 'bad'); return; }
    setBusy(true);
    try {
      await fieldopsPost('/api/fieldops/custody/create', form);
      toast.push('Custody event recorded', 'ok');
      onCreated();
    } catch (e) { toast.push(e.message, 'bad'); }
    finally { setBusy(false); }
  };

  return (
    <Modal open wide title="New custody event" onClose={onClose}
      footer={<div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <Btn variant="ghost" onClick={onClose}>Cancel</Btn>
        <Btn onClick={submit} disabled={busy}>Record</Btn>
      </div>}>
      <div className="grid two">
        <Field label="Vehicle">
          <select value={form.vehicleId} onChange={(e) => upd('vehicleId', e.target.value)}>
            <option value="">Select a vehicle…</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.plate_no || v.vin || v.id}</option>)}
          </select>
        </Field>
        <Field label="Event type">
          <select value={form.custodyType} onChange={(e) => upd('custodyType', e.target.value)}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid two">
        <Field label="To user (custodian)">
          <select value={form.toUserId} onChange={(e) => upd('toUserId', e.target.value)}>
            <option value="">—</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.username || u.userCode || u.id}</option>)}
          </select>
        </Field>
        <Field label="To hub (yard)">
          <select value={form.toHubId} onChange={(e) => upd('toHubId', e.target.value)}>
            <option value="">—</option>
            {hubs.map((h) => <option key={h.id} value={h.id}>{h.hub_code || h.name || h.id}</option>)}
          </select>
        </Field>
      </div>
      <div className="grid two">
        <Field label="Odometer (km)"><input type="number" value={form.odometer} onChange={(e) => upd('odometer', e.target.value)} /></Field>
        <Field label="Fuel level (%)"><input type="number" value={form.fuelLevel} onChange={(e) => upd('fuelLevel', e.target.value)} /></Field>
      </div>
      <Field label="Condition notes"><textarea rows={2} value={form.conditionNotes} onChange={(e) => upd('conditionNotes', e.target.value)} /></Field>
      <div className="grid two">
        <Field label="Signature / acknowledgement"><input value={form.signature} onChange={(e) => upd('signature', e.target.value)} placeholder="Name or signed reference" /></Field>
        <Field label="Notes"><textarea rows={2} value={form.notes} onChange={(e) => upd('notes', e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
