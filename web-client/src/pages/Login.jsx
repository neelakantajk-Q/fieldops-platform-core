import { useEffect, useMemo, useState } from 'react';
import { ApiError, saveSession } from '../api.js';
import { pbFetch, pbLogin } from '../lib/pb.js';
import { getApiBaseUrl, setApiBaseUrl, BRAND } from '../config.js';
import { Btn, Field, Modal } from '../components.jsx';
import logo from '../assets/quantum-logo.png';

const REMEMBER_KEY = 'fieldops_remember_user';
const DEMO_USERS = [
  { username: 'admin', password: 'admin', role: 'Administrator' },
  { username: 'mod', password: '1', role: 'Moderator' },
  { username: 'user1', password: '5', role: 'Technician' }
];

function readRemembered() {
  try { return localStorage.getItem(REMEMBER_KEY) || ''; } catch (_) { return ''; }
}

export default function Login({ onLogin }) {
  const remembered = useMemo(readRemembered, []);
  const [username, setUsername] = useState(remembered);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(Boolean(remembered));
  const [endpoint, setEndpoint] = useState(getApiBaseUrl());
  const [showEndpoint, setShowEndpoint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState('');
  const [online, setOnline] = useState(null);
  const [netDetail, setNetDetail] = useState('Checking cloud service…');
  const [testing, setTesting] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [conflict, setConflict] = useState(null);

  async function checkHealth(base) {
    setTesting(true);
    try {
      const { ok } = await pbFetch('/api/health', { base: base || undefined });
      setOnline(ok);
      setNetDetail(ok ? 'Cloud service reachable · API healthy' : 'Cloud responded with an error');
      return ok;
    } catch (_) {
      setOnline(false);
      setNetDetail('Cloud service unreachable — check the PocketBase URL');
      return false;
    } finally {
      setTesting(false);
    }
  }

  useEffect(() => {
    checkHealth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      if (remember) localStorage.setItem(REMEMBER_KEY, username.trim());
      else localStorage.removeItem(REMEMBER_KEY);
    } catch (_) { /* storage may be blocked */ }
  }, [remember, username]);

  function fillDemo(u) {
    setUsername(u.username);
    setPassword(u.password);
    setMessage('');
  }

  async function doLogin(force = false) {
    if (!username.trim() || !password) {
      setMessage('Enter your username and password.');
      return;
    }
    setBusy(true);
    setMessage('');
    setProgress('Checking credentials…');
    try {
      if (endpoint.trim()) setApiBaseUrl(endpoint.trim());
      const res = await pbLogin(username.trim(), password, getApiBaseUrl(), force);

      if (res && res.sessionConflict) {
        setConflict({ device: res.activeDevice || 'another device' });
        setBusy(false);
        setProgress('');
        return;
      }

      setProgress('Opening session…');
      saveSession({
        token: res.sessionToken,
        userId: res.userId,
        username: res.username,
        fullName: res.fullName || res.username,
        businessCategory: res.businessCategory || '',
        role: res.role,
        hub: res.hub,
        scope: res.scope,
        moduleRights: res.moduleRights,
        expiresAt: res.expiresAt,
        sessionDate: '',
        checkedIn: Boolean(res.checkedIn)
      });
      onLogin();
    } catch (err) {
      const data = err && err.response;
      if (data && data.sessionConflict) {
        setConflict({ device: data.activeDevice || 'another device' });
        setBusy(false);
        setProgress('');
        return;
      }
      setMessage(err instanceof ApiError || (err && err.name === 'PbError')
        ? err.message
        : 'Unable to sign in. Check your credentials and the PocketBase server.');
      setProgress('');
      setBusy(false);
    }
  }

  async function testConnection() {
    if (endpoint.trim()) setApiBaseUrl(endpoint.trim());
    setMessage('');
    const ok = await checkHealth(endpoint.trim());
    setMessage(ok ? 'Connection OK — the cloud backend answered.' : 'Connection failed — verify the URL and CORS settings.');
  }

  return (
    <div className="auth-page">
      <div className={`status-strip ${online === false ? 'offline' : ''}`}>
        <strong>
          <span className="net-dot" />
          {online === null ? 'Connecting…' : online ? 'Cloud connected' : 'Working offline'}
        </strong>
        <span className="small strip-detail">{netDetail}</span>
        <span className="spacer" />
        <span className="chip bar-hide-sm">{BRAND.product} · Field Operations &amp; HRMS</span>
      </div>

      <div className="auth-shell">
        <aside className="auth-hero">
          <img className="hero-logo" src={logo} alt="Quantum EV" />
          <h1>Field operations, attendance and HRMS in one portal.</h1>
          <p>{BRAND.tagline}. PocketBase-backed attendance, job cards, vehicle uptime, CAPA holds and MIS reporting.</p>
          <div className="hero-points">
            <div className="hero-point"><b>GPS</b> geofenced attendance with photo proof</div>
            <div className="hero-point"><b>TAT</b> turnaround tracking with automatic holds</div>
            <div className="hero-point"><b>CAPA</b> vehicle uptime and compliance reporting</div>
            <div className="hero-point"><b>HRMS</b> shift cards, timelines and monthly summaries</div>
          </div>
        </aside>

        <main className="auth-main">
          <div className="auth-card">
            <div className="auth-brand">
              <img src={logo} alt="Quantum Field Operations" />
            </div>
            <h2>Sign In</h2>
            <p className="auth-sub">Field Operations &amp; HRMS · single-device sessions</p>

            <div className="stack">
              <Field label="Username">
                <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username"
                  placeholder="Enter username" />
              </Field>
              <Field label="Password">
                <div className="pw-wrap">
                  <input type={showPassword ? 'text' : 'password'} value={password}
                    onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
                    placeholder="Enter password"
                    onKeyDown={(e) => e.key === 'Enter' && doLogin(false)} />
                  <button type="button" className="pw-toggle" onClick={() => setShowPassword((v) => !v)}>
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </Field>

              <div className="auth-links">
                <label className="check">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                  Remember username
                </label>
                <button type="button" className="link-btn" onClick={() => setForgotOpen(true)}>Forgot password</button>
              </div>

              <div className={`msg ${message && message.indexOf('Connection OK') === 0 ? 'ok' : ''}`}>{message}</div>

              <Btn block onClick={() => doLogin(false)} disabled={busy}>
                {busy ? (progress || 'Signing in…') : 'Sign In'}
              </Btn>

              <div className="demo-hint">
                Demo:
                {DEMO_USERS.map((u) => (
                  <button key={u.username} type="button" className="demo-chip" title={`${u.role} — ${u.username}`}
                    onClick={() => fillDemo(u)}>
                    {u.username} / {u.password}
                  </button>
                ))}
              </div>

              <button type="button" className="api-toggle" onClick={() => setShowEndpoint((v) => !v)}>
                {showEndpoint ? 'Hide PocketBase server' : 'PocketBase server settings'}
              </button>
              {showEndpoint ? (
                <div className="api-panel">
                  <Field label="PocketBase URL" hint="e.g. https://your-instance.pocketbasecloud.com — no trailing slash.">
                    <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} spellCheck={false} className="mono" />
                  </Field>
                  <div className="conn-row">
                    <span className={`conn-dot ${online === null ? '' : online ? 'ok' : 'bad'}`} />
                    <span>{testing ? 'Testing connection…' : netDetail}</span>
                  </div>
                  <div className="row" style={{ marginTop: 10 }}>
                    <Btn variant="ghost" size="sm" onClick={testConnection} disabled={testing}>Test connection</Btn>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <p className="auth-foot">Quantum FieldOps · PocketBase 0.22 · single-device sessions</p>
        </main>
      </div>

      <Modal
        open={forgotOpen}
        title="Reset password"
        onClose={() => setForgotOpen(false)}
        footer={<Btn variant="ghost" onClick={() => setForgotOpen(false)}>Close</Btn>}
      >
        <p className="small" style={{ margin: 0 }}>
          Password resets are handled by your administrator or supervisor. Ask them to reset it from
          <b> Administration → Users</b>, then sign in with the new password.
        </p>
        <div className="hint-info">
          Tip: your username is the same as the one issued at onboarding (for example <span className="mono">admin</span>,
          <span className="mono"> mod</span> or <span className="mono"> user1</span>).
        </div>
      </Modal>

      <Modal
        open={Boolean(conflict)}
        title="Session already active"
        onClose={() => setConflict(null)}
        footer={(
          <>
            <Btn variant="ghost" onClick={() => setConflict(null)}>Cancel</Btn>
            <Btn onClick={() => { setConflict(null); doLogin(true); }}>Sign out other device</Btn>
          </>
        )}
      >
        <p className="small" style={{ margin: 0 }}>
          This account is already signed in on <b>{conflict && conflict.device}</b>. Sessions are limited to one
          device. Continue here and the other device will be signed out.
        </p>
      </Modal>
    </div>
  );
}
