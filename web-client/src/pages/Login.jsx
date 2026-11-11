import { useState } from 'react';
import { ApiError, saveSession } from '../api.js';
import { pbLogin } from '../lib/pb.js';
import { deviceUuid } from '../lib/utils.js';
import { getApiBaseUrl, setApiBaseUrl, BRAND } from '../config.js';
import { Btn, Field } from '../components.jsx';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [endpoint, setEndpoint] = useState(getApiBaseUrl());
  const [showEndpoint, setShowEndpoint] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState('');

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
        setBusy(false);
        setProgress('');
        const active = res.activeDevice || 'another device';
        if (window.confirm(`This account is signed in on ${active}. Sign out that device and continue here?`)) {
          return doLogin(true);
        }
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
      setMessage(err instanceof ApiError ? err.message : 'Unable to sign in to PocketBase.');
      setProgress('');
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <aside className="login-hero">
        <div className="brand-mark">F</div>
        <div>
          <h1>Field operations, without the paperwork.</h1>
          <p>{BRAND.tagline}. PocketBase-backed attendance, job cards, vehicle uptime, CAPA holds and MIS reporting in one lean portal.</p>
        </div>
        <div className="hero-points">
          <div className="hero-point"><b>GPS</b> geofenced attendance with photo proof</div>
          <div className="hero-point"><b>TAT</b> turnaround tracking with automatic holds</div>
          <div className="hero-point"><b>CAPA</b> vehicle uptime and compliance reporting</div>
          <div className="hero-point"><b>Hierarchy</b> technician → hub in-charge → region → admin</div>
        </div>
      </aside>

      <main className="login-panel">
        <div className="login-card">
          <div className="row" style={{ marginBottom: 14 }}>
            <div className="brand-mark" style={{ width: 30, height: 30, fontSize: 14 }}>F</div>
            <strong>{BRAND.product}</strong>
          </div>
          <h2>Sign in</h2>
          <p className="muted small" style={{ marginTop: 2, marginBottom: 18 }}>
            PocketBase backend · single-device sessions.
          </p>

          <div className="stack">
            <Field label="Username">
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username"
                placeholder="admin / mod / user1" />
            </Field>
            <Field label="Password">
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password" placeholder="••••••••"
                onKeyDown={(e) => e.key === 'Enter' && doLogin(false)} />
            </Field>

            <div className="login-msg">{message}</div>

            <Btn block onClick={() => doLogin(false)} disabled={busy}>
              {busy ? (progress || 'Signing in…') : 'Sign in'}
            </Btn>

            <button type="button" className="api-toggle" onClick={() => setShowEndpoint((v) => !v)}>
              {showEndpoint ? 'Hide PocketBase server' : 'PocketBase server settings'}
            </button>
            {showEndpoint ? (
              <Field label="PocketBase URL" hint='e.g. https://your-space.hf.space (Hugging Face) — no trailing slash.'>
                <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} spellCheck={false} className="mono" />
              </Field>
            ) : null}
          </div>
        </div>
      </main>
    </div>
  );
}
