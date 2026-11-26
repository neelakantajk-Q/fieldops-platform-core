import { useState } from 'react';
import { call } from '../api.js';
import {
  Btn, Card, Field, Modal, PageHeader, Spinner, Table, formatWhen, useAsync, useToast
} from '../components.jsx';
import { clientRequestId, getPosition, minutesToText, preparePhoto, timeOnly, todayISO } from '../lib/utils.js';

const CHECKOUT_REASONS = [
  { id: 'MANUAL', label: 'Manual check-out' },
  { id: 'SHIFT_END', label: 'Shift complete' },
  { id: 'EARLY', label: 'Leaving early' }
];

export default function Attendance({ session, onSession }) {
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [userId, setUserId] = useState('');
  const [query, setQuery] = useState({ date: todayISO(), userId: '' });
  const [range, setRange] = useState('today');
  const [checkInOpen, setCheckInOpen] = useState(false);
  const [checkOutOpen, setCheckOutOpen] = useState(false);
  const [proofRow, setProofRow] = useState(null);

  const attendanceQuery = range === 'today'
    ? { date: query.date, userId: query.userId, page: 1, pageSize: 100 }
    : { days: Number(range), userId: query.userId, page: 1, pageSize: 500 };

  const { data, loading, error, reload } = useAsync(
    () => call('getAttendance', attendanceQuery),
    [range, query.date, query.userId]
  );

  const rows = (data && data.daily) || [];
  const pending = rows.filter((r) => r.pendingProof);

  const columns = [
    { key: 'date', label: 'Date' },
    { key: 'userId', label: 'User' },
    { key: 'hubName', label: 'Hub' },
    { key: 'checkIn', label: 'In', render: (r) => timeOnly(r.checkIn) },
    { key: 'checkOut', label: 'Out', render: (r) => timeOnly(r.checkOut) },
    { key: 'minutes', label: 'Duration', render: (r) => minutesToText(r.minutes) },
    {
      key: 'shift', label: 'Shift summary',
      render: (r) => {
        if (!r.checkOut) return <span className="muted">—</span>;
        const bits = [
          `Shift ${minutesToText(r.shiftMinutes || r.minutes)}`,
          `${r.cardsClosed || 0} closed`,
          `${r.cardsHeld || 0} held`,
          r.holdMinutes ? `Hold ${minutesToText(r.holdMinutes)}` : ''
        ].filter(Boolean);
        return <span className="small">{bits.join(' · ')}</span>;
      }
    },
    {
      key: 'status', label: 'Status',
      render: (r) => (
        <span className="row" style={{ gap: 6 }}>
          <span className={`badge ${r.status === 'Active' ? 'ok' : r.status === 'LoggedOut' ? 'neutral' : 'warn'}`}>{r.status}</span>
          {r.auto ? <span className="badge warn" title={r.checkoutReason || 'Auto check-out'}>AUTO</span> : null}
          {r.mock ? <span className="badge bad">MOCK</span> : null}
          {r.pendingProof ? <span className="badge bad">PROOF</span> : null}
        </span>
      )
    },
    {
      key: 'proof', label: 'Proof',
      render: (r) => (
        <span className="row" style={{ gap: 6 }}>
          {r.checkInPhoto ? <a className="btn ghost sm" href={r.checkInPhoto} target="_blank" rel="noreferrer">In</a> : null}
          {r.checkOutPhoto ? <a className="btn ghost sm" href={r.checkOutPhoto} target="_blank" rel="noreferrer">Out</a> : null}
          {r.pendingProof ? <Btn size="sm" variant="ghost" onClick={() => setProofRow(r)}>Complete</Btn> : null}
          {!r.checkInPhoto && !r.checkOutPhoto && !r.pendingProof ? <span className="muted">—</span> : null}
        </span>
      )
    }
  ];

  return (
    <>
      <PageHeader
        title="Attendance"
        subtitle="Geofenced photo attendance with shift summary and auto check-out proofs"
        actions={
          <div className="row">
            {session.checkedIn ? <span className="badge ok">Checked in</span> : <span className="badge warn">Not checked in</span>}
            <Btn variant="ghost" size="sm" onClick={() => setCheckInOpen(true)} disabled={session.checkedIn}>Check in</Btn>
            <Btn variant="ghost" size="sm" onClick={() => setCheckOutOpen(true)}>Check out</Btn>
          </div>
        }
      />

      {pending.length ? (
        <div className="hint-banner" style={{ marginBottom: 12 }}>
          {pending.length} auto check-out{pending.length === 1 ? '' : 's'} still need a checkout photo.
          <Btn size="sm" variant="ghost" style={{ marginLeft: 8 }} onClick={() => setProofRow(pending[0])}>Complete now</Btn>
        </div>
      ) : null}

      <Card pad={false} title={range === 'today' ? 'Daily register' : 'Attendance history'}
        actions={
          <div className="row">
            <Btn size="sm" variant={range === 'today' ? 'primary' : 'ghost'} onClick={() => setRange('today')}>Today</Btn>
            <Btn size="sm" variant={range === '7' ? 'primary' : 'ghost'} onClick={() => setRange('7')}>7 days</Btn>
            <Btn size="sm" variant={range === '30' ? 'primary' : 'ghost'} onClick={() => setRange('30')}>30 days</Btn>
            {range === 'today' ? (
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 150 }} />
            ) : null}
            <input placeholder="Filter user id" value={userId} onChange={(e) => setUserId(e.target.value)} style={{ width: 170 }} />
            <Btn size="sm" variant="ghost" onClick={() => setQuery({ date, userId: userId.trim() })}>Apply</Btn>
          </div>
        }>
        {error ? <div className="hint-banner" style={{ margin: 16 }}>{error.message}</div> : null}
        {loading ? <Spinner label="Loading attendance…" /> : (
          <div style={{ padding: 16 }}>
            <Table
              columns={columns}
              rows={rows}
              empty={range === 'today' ? 'No attendance for this day.' : `No attendance in the last ${range} days.`}
              rowKey={(r, i) => `${r.userId}-${r.date}-${i}`}
            />
          </div>
        )}
      </Card>

      <CheckInModal
        open={checkInOpen}
        hub={session.hub}
        onClose={() => setCheckInOpen(false)}
        onDone={() => { if (onSession) onSession({ checkedIn: true }); setCheckInOpen(false); reload(); }}
      />

      <CheckOutModal
        open={checkOutOpen}
        onClose={() => setCheckOutOpen(false)}
        onDone={() => { if (onSession) onSession({ checkedIn: false }); setCheckOutOpen(false); reload(); }}
      />

      <ProofModal
        row={proofRow}
        onClose={() => setProofRow(null)}
        onDone={() => { setProofRow(null); reload(); }}
      />
    </>
  );
}

function CheckInModal({ open, hub, onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [useGeo, setUseGeo] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function submit() {
    if (!file) { setMsg('Select the attendance photo first.'); return; }
    setBusy(true); setMsg('Preparing photo…');
    try {
      const photo = await preparePhoto(file);
      const pos = useGeo ? await getPosition(12000).catch(() => null) : null;
      setMsg('Uploading…');
      await call('attendanceCheckIn', {
        photoBase64: photo.full,
        photoThumbBase64: photo.thumb,
        lat: pos ? pos.lat : 0,
        lng: pos ? pos.lng : 0,
        accuracy: pos ? pos.accuracy : 0,
        withinGeoFence: Boolean(pos),
        hubName: hub || '',
        clientRequestId: clientRequestId()
      }, { queue: false });
      toast.push('Check-in recorded.', 'ok');
      setFile(null); setMsg('');
      onDone();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Photo check-in" onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={submit} disabled={busy}>{busy ? 'Working…' : 'Check in'}</Btn></>}>
      <div className="hint-info">Capture a live selfie at the site. GPS accuracy and watermark metadata are stored with the proof.</div>
      <Field label="Attendance photo">
        <input type="file" accept="image/*" capture="user" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </Field>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={useGeo} onChange={(e) => setUseGeo(e.target.checked)} style={{ width: 'auto' }} />
        <span className="small">Attach GPS location (geofence check)</span>
      </label>
      {msg ? <div className="login-msg">{msg}</div> : null}
      <span className="muted small">Time: {formatWhen(new Date().toISOString())}</span>
    </Modal>
  );
}

function CheckOutModal({ open, onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [useGeo, setUseGeo] = useState(true);
  const [reason, setReason] = useState('MANUAL');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function submit() {
    if (!file) { setMsg('A checkout photo is mandatory for everyone.'); return; }
    setBusy(true); setMsg('Preparing photo…');
    try {
      const photo = await preparePhoto(file);
      const pos = useGeo ? await getPosition(12000).catch(() => null) : null;
      setMsg('Uploading…');
      await call('attendanceCheckOut', {
        photoBase64: photo.full,
        lat: pos ? pos.lat : 0,
        lng: pos ? pos.lng : 0,
        accuracy: pos ? pos.accuracy : 0,
        withinGeoFence: Boolean(pos),
        reason,
        source: 'WEB',
        clientRequestId: clientRequestId()
      }, { queue: false });
      toast.push('Checked out with photo proof.', 'ok');
      setFile(null); setMsg('');
      onDone();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title="Photo check-out" onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={submit} disabled={busy}>{busy ? 'Working…' : 'Check out'}</Btn></>}>
      <div className="hint-info">Checkout requires a live photo for every role. Shift metrics (jobs closed, holds, minutes) are captured automatically.</div>
      <Field label="Checkout photo (required)">
        <input type="file" accept="image/*" capture="user" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </Field>
      <Field label="Reason">
        <select value={reason} onChange={(e) => setReason(e.target.value)}>
          {CHECKOUT_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </Field>
      <label className="row" style={{ gap: 8 }}>
        <input type="checkbox" checked={useGeo} onChange={(e) => setUseGeo(e.target.checked)} style={{ width: 'auto' }} />
        <span className="small">Attach GPS location</span>
      </label>
      {msg ? <div className="login-msg">{msg}</div> : null}
    </Modal>
  );
}

function ProofModal({ row, onClose, onDone }) {
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  if (!row) return null;

  async function submit() {
    if (!file) { setMsg('Select a photo to complete this checkout.'); return; }
    setBusy(true); setMsg('Uploading…');
    try {
      const photo = await preparePhoto(file);
      await call('completeCheckoutPhoto', {
        attendanceId: row.pendingProofId,
        photoBase64: photo.full
      }, { queue: false });
      toast.push('Checkout photo attached.', 'ok');
      setFile(null); setMsg('');
      onDone();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Complete checkout proof · ${row.userId}`}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={submit} disabled={busy}>{busy ? 'Uploading…' : 'Attach photo'}</Btn></>}>
      <div className="hint-info">This auto check-out was recorded without a photo. Attach one now to clear the pending proof.</div>
      <Field label="Checkout photo">
        <input type="file" accept="image/*" capture="user" onChange={(e) => setFile(e.target.files?.[0] || null)} />
      </Field>
      {msg ? <div className="login-msg">{msg}</div> : null}
    </Modal>
  );
}
