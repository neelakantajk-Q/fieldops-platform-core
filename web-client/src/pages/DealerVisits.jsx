import { useEffect, useMemo, useState } from 'react';
import { call } from '../api.js';
import {
  Btn, Card, Field, Modal, PageHeader, Spinner, Table, useAsync, useToast
} from '../components.jsx';
import { getPosition, preparePhoto, todayISO } from '../lib/utils.js';

const MODES = [
  { id: 'APP_CODE', label: 'App code (6-digit)' },
  { id: 'APP_QR', label: 'App QR scan' },
  { id: 'WEB_CODE', label: 'Web link code' },
  { id: 'WEB_QR', label: 'Web link QR' },
  { id: 'STATIC_QR', label: 'Location QR (static)' },
  { id: 'MANUAL', label: 'Manual (needs approval)' }
];

const MODE_LABEL = MODES.reduce((m, x) => { m[x.id] = x.label; return m; }, {});

export default function DealerVisits({ session }) {
  const toast = useToast();
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [query, setQuery] = useState({ from: todayISO(), to: todayISO() });
  const [logOpen, setLogOpen] = useState(false);
  const [completing, setCompleting] = useState(null);
  const [codeInfo, setCodeInfo] = useState(null);

  const { data, loading, error, reload } = useAsync(
    () => call('dealerVisitsList', { from: query.from, to: query.to }),
    [query.from, query.to]
  );

  const rows = (data && data.visits) || [];

  const columns = [
    { key: 'visitNo', label: 'Visit', render: (r) => <strong>{r.visitNo || '—'}</strong> },
    { key: 'dealerName', label: 'Dealer', render: (r) => r.dealerName || r.dealerId },
    { key: 'mode', label: 'Mode', render: (r) => <span className="badge neutral">{MODE_LABEL[r.mode] || r.mode || '—'}</span> },
    { key: 'checkInAt', label: 'Check-in', render: (r) => shortTime(r.checkInAt) },
    { key: 'checkOutAt', label: 'Check-out', render: (r) => shortTime(r.checkOutAt) },
    { key: 'durationMinutes', label: 'Duration', render: (r) => (r.durationMinutes ? `${r.durationMinutes}m` : '—') },
    {
      key: 'status', label: 'Status',
      render: (r) => (
        <span className="row" style={{ gap: 6 }}>
          <span className={`badge ${r.status === 'COMPLETED' ? 'ok' : 'warn'}`}>{r.status || '—'}</span>
          {r.outsideGeofence ? <span className="badge bad">Outside</span> : null}
          {r.pendingApproval ? <span className="badge warn">Approval</span> : null}
        </span>
      )
    },
    {
      key: 'actions', label: '',
      render: (r) => (r.status === 'IN_PROGRESS'
        ? <Btn size="sm" variant="ghost" onClick={() => setCompleting(r)}>Complete</Btn>
        : <span className="muted">—</span>)
    }
  ];

  return (
    <>
      <PageHeader
        title="Dealer Visits"
        subtitle="Manager dealer visits with code / QR / manual verification and geofence proof"
        actions={
          <div className="row">
            <Btn size="sm" variant="ghost" onClick={async () => {
              const id = window.prompt('Dealer id to issue a code for (dealer-linked users only):', '');
              if (!id) return;
              try {
                const res = await call('issueDealerCode', { dealerId: id.trim() });
                setCodeInfo(res);
              } catch (err) { toast.push(err.message, 'bad'); }
            }}>Issue dealer code</Btn>
            <Btn size="sm" onClick={() => setLogOpen(true)}>Log visit</Btn>
          </div>
        }
      />

      {codeInfo ? (
        <div className="hint-banner" style={{ marginBottom: 12 }}>
          Dealer code for <b>{codeInfo.dealerName}</b>: <strong className="mono">{codeInfo.code}</strong>
          {' · expires '}{shortTime(codeInfo.expiresAt)}
          <Btn size="sm" variant="ghost" style={{ marginLeft: 8 }} onClick={() => setCodeInfo(null)}>Dismiss</Btn>
        </div>
      ) : null}

      <Card pad={false} title="Visits"
        actions={
          <div className="row">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 145 }} />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 145 }} />
            <Btn size="sm" variant="ghost" onClick={() => setQuery({ from, to })}>Apply</Btn>
          </div>
        }>
        {error ? <div className="hint-banner" style={{ margin: 16 }}>{error.message}</div> : null}
        {loading ? <Spinner label="Loading dealer visits…" /> : (
          <div style={{ padding: 16 }}>
            <Table columns={columns} rows={rows} empty="No dealer visits in this range." rowKey={(r) => r.id} />
          </div>
        )}
      </Card>

      <LogVisitModal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        onDone={() => { setLogOpen(false); reload(); }}
      />

      <CompleteVisitModal
        visit={completing}
        onClose={() => setCompleting(null)}
        onDone={() => { setCompleting(null); reload(); }}
      />
    </>
  );
}

function LogVisitModal({ open, onClose, onDone }) {
  const toast = useToast();
  const [dealers, setDealers] = useState([]);
  const [locations, setLocations] = useState([]);
  const [dealerId, setDealerId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [mode, setMode] = useState('MANUAL');
  const [code, setCode] = useState('');
  const [visitType, setVisitType] = useState('ROUTINE');
  const [notes, setNotes] = useState('');
  const [file, setFile] = useState(null);
  const [useGeo, setUseGeo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!open) return;
    call('dealersList', {}).then((r) => setDealers(r.dealers || [])).catch(() => setDealers([]));
  }, [open]);

  useEffect(() => {
    if (!dealerId) { setLocations([]); return; }
    call('dealerLocationsList', { dealerId }).then((r) => setLocations(r.locations || [])).catch(() => setLocations([]));
  }, [dealerId]);

  const needCode = mode === 'APP_CODE' || mode === 'APP_QR' || mode === 'WEB_CODE' || mode === 'WEB_QR';
  const needToken = mode === 'STATIC_QR';
  const selectedLocation = locations.find((l) => l.id === locationId) || null;

  async function submit() {
    if (!dealerId) { setMsg('Select a dealer first.'); return; }
    if (needCode && !code.trim()) { setMsg('Enter the 6-digit dealer code.'); return; }
    setBusy(true); setMsg('Recording visit…');
    try {
      const pos = useGeo ? await getPosition(12000).catch(() => null) : null;
      let photoBase64 = '';
      if (file) {
        const photo = await preparePhoto(file);
        photoBase64 = photo.full;
      }
      await call('dealerVisitCreate', {
        dealerId,
        dealerLocationId: locationId,
        visitType,
        verificationMode: mode,
        code: needCode ? code.trim() : '',
        qrToken: needToken ? (selectedLocation && selectedLocation.qr_token) || '' : '',
        lat: pos ? pos.lat : 0,
        lng: pos ? pos.lng : 0,
        photoBase64,
        notes
      }, { queue: false });
      toast.push('Dealer visit recorded.', 'ok');
      setDealerId(''); setLocationId(''); setCode(''); setNotes(''); setFile(null); setMsg('');
      onDone();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} wide title="Log dealer visit" onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Check in visit'}</Btn></>}>
      <div className="form-grid">
        <Field label="Dealer">
          <select value={dealerId} onChange={(e) => { setDealerId(e.target.value); setLocationId(''); }}>
            <option value="">Select dealer…</option>
            {dealers.map((d) => <option key={d.id} value={d.id}>{d.name || d.dealer_code || d.id}</option>)}
          </select>
        </Field>
        <Field label="Location (optional)">
          <select value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!locations.length}>
            <option value="">{locations.length ? 'Select location…' : 'No locations'}</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name || l.address || l.id}</option>)}
          </select>
        </Field>
        <Field label="Visit type">
          <select value={visitType} onChange={(e) => setVisitType(e.target.value)}>
            <option value="ROUTINE">Routine</option>
            <option value="FOLLOW_UP">Follow-up</option>
            <option value="ESCALATION">Escalation</option>
            <option value="AUDIT">Audit</option>
          </select>
        </Field>
        <Field label="Verification">
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </Field>
        {needCode ? (
          <Field label="Dealer code">
            <input value={code} onChange={(e) => setCode(e.target.value)} className="mono" placeholder="6-digit code" />
          </Field>
        ) : null}
        {needToken ? (
          <Field label="Location QR token" hint={selectedLocation ? `Token: ${selectedLocation.qr_token || '—'}` : 'Select a location with a QR token.'}>
            <input value={selectedLocation ? selectedLocation.qr_token || '' : ''} readOnly className="mono" />
          </Field>
        ) : null}
        <Field label="Check-in photo (optional)">
          <input type="file" accept="image/*" capture="user" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
      </div>
      <Field label="Notes">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={useGeo} onChange={(e) => setUseGeo(e.target.checked)} style={{ width: 'auto' }} />
        <span className="small">Attach GPS (geofence check against dealer location)</span>
      </label>
      {mode === 'MANUAL' ? <div className="hint-info">Manual visits need supervisor approval and are flagged pending.</div> : null}
      {msg ? <div className="login-msg">{msg}</div> : null}
    </Modal>
  );
}

function CompleteVisitModal({ visit, onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [outcome, setOutcome] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  if (!visit) return null;

  async function submit() {
    if (!file) { setMsg('A check-out photo is required to complete the visit.'); return; }
    setBusy(true); setMsg('Completing…');
    try {
      const photo = await preparePhoto(file);
      await call('dealerVisitComplete', {
        id: visit.id,
        outcome,
        notes,
        photoBase64: photo.full
      }, { queue: false });
      toast.push('Dealer visit completed.', 'ok');
      setFile(null); setOutcome(''); setNotes(''); setMsg('');
      onDone();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Complete ${visit.visitNo || 'visit'}`}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Complete visit'}</Btn></>}>
      <Field label="Outcome">
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          <option value="">Select outcome…</option>
          <option value="RESOLVED">Resolved</option>
          <option value="FOLLOW_UP">Follow-up needed</option>
          <option value="ESCALATED">Escalated</option>
          <option value="NO_ACTION">No action</option>
        </select>
      </Field>
      <Field label="Check-out photo (required)">
        <input type="file" accept="image/*" capture="user" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </Field>
      <Field label="Notes">
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      {msg ? <div className="login-msg">{msg}</div> : null}
    </Modal>
  );
}

function shortTime(value) {
  if (!value) return '—';
  const d = new Date(String(value).replace(' ', 'T'));
  if (isNaN(d.getTime())) return String(value).slice(11, 16) || '—';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}
