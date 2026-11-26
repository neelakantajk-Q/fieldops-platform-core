import { useMemo, useState } from 'react';
import { call } from '../api.js';
import { Badge, Btn, Card, Field, Modal, PageHeader, Spinner, Table, useAsync, useToast } from '../components.jsx';

const ROLE_OPTIONS = ['Technician', 'Supervisor', 'Moderator', 'Administrator'];
const SCOPES = { Technician: 'SELF', Supervisor: 'HUB', Moderator: 'REGION', Administrator: 'ALL' };

export default function Admin({ session }) {
  const toast = useToast();
  const [editing, setEditing] = useState(null); // null | user | {new:true}
  const users = useAsync(() => call('getUsers', {}), []);
  const settings = useAsync(() => call('getAdminSettings', {}), []);
  const rows = ((users.data && (users.data.users || [])) || []);

  const byHub = useMemo(() => rows
    .filter((u) => u.role === 'Supervisor' && u.hub)
    .reduce((acc, u) => { acc[u.hub] = u.fullName || u.username; return acc; }, {}), [rows]);

  async function setPassword(u) {
    const pwd = window.prompt(`New password for ${u.username}:`);
    if (!pwd) return;
    try {
      await call('adminSetPassword', { userId: u.userId || u.username, newPassword: pwd });
      toast.push('Password updated.', 'ok');
    } catch (err) { toast.push(err.message, 'bad'); }
  }

  return (
    <>
      <PageHeader title="Administration"
        subtitle="Users, hierarchy assignment (region / hub / role) and operational settings"
        actions={<Btn size="sm" onClick={() => setEditing({ new: true })}>Add user</Btn>} />

      <Card title="In-charge map" subtitle="Derived: supervisor per hub, moderator per region">
        <div className="grid cols-2">
          <div>
            <span className="field-label">Hub in-charges</span>
            {Object.keys(byHub).length
              ? <div className="stack">{Object.entries(byHub).map(([hub, name]) =>
                  <div key={hub} className="row between"><Badge tone="ok">{hub}</Badge><span className="small">{name}</span></div>)}</div>
              : <span className="muted small">No supervisors assigned yet.</span>}
          </div>
          <div>
            <span className="field-label">Region in-charges</span>
            {rows.filter((u) => u.role === 'Moderator').length
              ? <div className="stack">{rows.filter((u) => u.role === 'Moderator').map((u) =>
                  <div key={u.userId || u.username} className="row between"><Badge tone="info">{u.region || 'region'}</Badge><span className="small">{u.fullName || u.username}</span></div>)}</div>
              : <span className="muted small">No moderators assigned yet.</span>}
          </div>
        </div>
      </Card>

      <Card pad={false} title={`Users (${rows.length})`}>
        {users.loading ? <Spinner label="Loading users…" /> : null}
        {users.error ? <div className="hint-banner" style={{ margin: 16 }}>{users.error.message}</div> : null}
        {users.data ? (
          <div style={{ padding: 16 }}>
            <Table
              columns={[
                { key: 'username', label: 'User', render: (r) => <strong>{r.fullName || r.username}</strong> },
                { key: 'userId', label: 'ID', render: (r) => <span className="mono small">{r.userId || '—'}</span> },
                { key: 'role', label: 'Role', render: (r) => <Badge tone={r.role === 'Administrator' ? 'primary' : r.role === 'Moderator' ? 'info' : 'neutral'}>{r.role}</Badge> },
                { key: 'hub', label: 'Hub', render: (r) => r.hub || '—' },
                { key: 'region', label: 'Region', render: (r) => r.region || '—' },
                {
                  key: 'geofence', label: 'Zone',
                  render: (r) => {
                    const m = r.geofenceMode || 'INHERIT_HUB';
                    const tone = m === 'CUSTOM' ? 'info' : m === 'ROAMING' ? 'warn' : 'neutral';
                    const label = m === 'CUSTOM'
                      ? `Custom ${Math.round(Number(r.geofenceRadiusM) || 0)} m`
                      : m === 'ROAMING' ? 'Roaming' : 'Hub';
                    return <Badge tone={tone}>{label}</Badge>;
                  }
                },
                { key: 'status', label: 'Status', render: (r) => <span className={`badge ${r.status === 'Active' ? 'ok' : 'neutral'}`}>{r.status || 'Active'}</span> },
                {
                  key: 'actions', label: 'Actions',
                  render: (r) => (
                    <div className="row" style={{ gap: 6 }}>
                      <Btn size="sm" variant="ghost" onClick={() => setEditing(r)}>Edit</Btn>
                      <Btn size="sm" variant="ghost" onClick={() => setPassword(r)}>Password</Btn>
                    </div>
                  )
                }
              ]}
              rows={rows}
              empty="No users in scope."
              rowKey={(r) => r.userId || r.username}
            />
          </div>
        ) : null}
      </Card>

      {settings.data ? (
        <ConfigPanel settings={settings.data.settings || settings.data || {}} onSaved={() => settings.reload()} />
      ) : null}

      {editing ? <UserModal user={editing} session={session} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); users.reload(); }} /> : null}
    </>
  );
}

function UserModal({ user, session, onClose, onSaved }) {
  const toast = useToast();
  const isNew = Boolean(user.new);
  const [form, setForm] = useState({
    username: user.username || '',
    firstName: user.firstName || user.fullName || '',
    lastName: user.lastName || '',
    role: user.role || 'Technician',
    hub: user.hub || session.hub || '',
    region: user.region || '',
    phone: user.phone || '',
    geofenceMode: user.geofenceMode || 'INHERIT_HUB',
    geofenceLat: user.geofenceLat == null || user.geofenceLat === 0 ? '' : user.geofenceLat,
    geofenceLng: user.geofenceLng == null || user.geofenceLng === 0 ? '' : user.geofenceLng,
    geofenceRadiusM: user.geofenceRadiusM || 250,
    password: isNew ? '' : undefined
  });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save() {
    setBusy(true); setMsg('');
    try {
      if (isNew) {
        await call('adminCreateUser', {
          username: form.username,
          fullName: form.fullName,
          role: form.role,
          hub: form.hub,
          region: form.region,
          phone: form.phone,
          password: form.password,
          scope: SCOPES[form.role] || 'SELF'
        });
        toast.push('User created.', 'ok');
      } else {
        const canSetZone = user.userId !== session.userId &&
          user.role !== 'Administrator' && user.role !== 'Platform';
        if (canSetZone) {
          await call('adminSetGeofence', {
            userId: user.userId || user.username,
            mode: form.geofenceMode,
            lat: Number(form.geofenceLat),
            lng: Number(form.geofenceLng),
            radiusM: Number(form.geofenceRadiusM)
          });
        }
        await call('adminUpdateUser', {
          userId: user.userId || user.username,
          fullName: form.fullName,
          role: form.role,
          hub: form.hub,
          region: form.region,
          phone: form.phone
        });
        toast.push('User updated.', 'ok');
      }
      onSaved();
    } catch (err) {
      setMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open wide title={isNew ? 'Add user' : `Edit ${user.username}`} onClose={onClose}
      footer={<><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save user'}</Btn></>}>
      <div className="form-grid">
        <Field label="Username *"><input value={form.username} onChange={set('username')} readOnly={!isNew} /></Field>
        <Field label="First name"><input value={form.firstName} onChange={set('firstName')} /></Field>
        <Field label="Last name"><input value={form.lastName} onChange={set('lastName')} /></Field>
        <Field label="Role *" hint={`${form.role} scope = ${SCOPES[form.role]}`}>
          <select value={form.role} onChange={set('role')}>
            {(session.role === 'Administrator' ? ROLE_OPTIONS : ROLE_OPTIONS.filter((r) => r === 'Technician')).map((r) => <option key={r}>{r}</option>)}
          </select>
        </Field>
        <Field label="Hub" hint="Required for supervisors (they become the hub in-charge)"><input value={form.hub} onChange={set('hub')} /></Field>
        <Field label="Region" hint="Required for moderators (region in-charge)"><input value={form.region} onChange={set('region')} /></Field>
        {!isNew ? (
          <>
            <Field label="Geofence mode" hint="Tip: draw custom zones on Live Map → Geofences">
              <select value={form.geofenceMode} onChange={set('geofenceMode')}>
                <option value="INHERIT_HUB">Inherit hub radius</option>
                <option value="CUSTOM">Custom zone</option>
                <option value="ROAMING">Roaming (no limit)</option>
              </select>
            </Field>
            {form.geofenceMode === 'CUSTOM' ? (
              <>
                <Field label="Zone latitude">
                  <input type="number" step="0.000001" value={form.geofenceLat} onChange={set('geofenceLat')} />
                </Field>
                <Field label="Zone longitude">
                  <input type="number" step="0.000001" value={form.geofenceLng} onChange={set('geofenceLng')} />
                </Field>
                <Field label="Zone radius (m)" hint="25 to 5000 metres">
                  <input type="number" min="25" max="5000" step="5" value={form.geofenceRadiusM} onChange={set('geofenceRadiusM')} />
                </Field>
              </>
            ) : null}
          </>
        ) : null}
        <Field label="Phone"><input value={form.phone} onChange={set('phone')} /></Field>
        {isNew ? <Field label="Initial password *"><input type="password" value={form.password} onChange={set('password')} /></Field> : null}
      </div>
      {msg ? <div className="login-msg">{msg}</div> : null}
    </Modal>
  );
}

const CONFIG_FIELDS = [
  { key: 'gemini_api_key', label: 'Google Gemini API key', secret: true, hint: 'Powers voice-to-text and handwriting OCR. Stored server-side; shown masked.' },
  { key: 'gemini_model', label: 'Gemini model', placeholder: 'gemini-2.5-flash' },
  { key: 'google_maps_api_key', label: 'Google Maps API key', secret: true },
  { key: 'drive_client_id', label: 'Drive OAuth client ID', secret: true },
  { key: 'drive_client_secret', label: 'Drive OAuth client secret', secret: true },
  { key: 'drive_refresh_token', label: 'Drive refresh token', secret: true },
  { key: 'drive_archive_folder_id', label: 'Drive archive folder ID' },
  { key: 'archive_after_days', label: 'Hot to cold archive after (days)', placeholder: '30' },
  { key: 'app_base_url', label: 'Public app base URL', placeholder: 'https://example.com' }
];

function ConfigPanel({ settings, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({});
  const [extraKey, setExtraKey] = useState('');
  const [extraVal, setExtraVal] = useState('');
  const [busy, setBusy] = useState(false);

  const value = (k) => (form[k] === undefined ? '' : form[k]);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const isSet = (k) => Boolean(settings && settings[k]);

  async function save() {
    const update = {};
    Object.keys(form).forEach((k) => {
      if (String(form[k] || '').trim() !== '') update[k] = String(form[k]).trim();
    });
    if (extraKey.trim() && extraVal.trim()) update[extraKey.trim()] = extraVal.trim();
    if (!Object.keys(update).length) {
      toast.push('Nothing to save — enter a value first.', 'bad');
      return;
    }
    setBusy(true);
    try {
      await call('adminUpdateSettings', { update });
      toast.push('Configuration saved.', 'ok');
      setForm({}); setExtraKey(''); setExtraVal('');
      if (onSaved) onSaved();
    } catch (err) {
      toast.push(err.message, 'bad');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Configuration &amp; Secrets"
      subtitle="API keys and service credentials stored in the config table. Secret values are masked and never returned in full."
      actions={<Btn size="sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save configuration'}</Btn>}>
      <div className="form-grid">
        {CONFIG_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}
            hint={<span>{f.hint ? f.hint + ' ' : ''}{isSet(f.key)
              ? <Badge tone="ok">{String(settings[f.key])}</Badge>
              : <Badge tone="neutral">not set</Badge>}</span>}>
            <input
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              placeholder={isSet(f.key) ? 'Leave blank to keep current value' : (f.placeholder || '')}
              value={value(f.key)}
              onChange={set(f.key)}
            />
          </Field>
        ))}
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input style={{ maxWidth: 240 }} placeholder="custom key (e.g. smtp_password)" value={extraKey} onChange={(e) => setExtraKey(e.target.value)} />
        <input style={{ maxWidth: 320 }} type="password" autoComplete="off" placeholder="value" value={extraVal} onChange={(e) => setExtraVal(e.target.value)} />
      </div>
    </Card>
  );
}
