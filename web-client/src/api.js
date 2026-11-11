/**
 * Unified API surface for the portal.
 *
 * Everything routes to the PocketBase backend (Hugging Face Space or
 * self-hosted) through the adapter in lib/pb.js. The same login/CRUD
 * contract is kept so pages stay backend-agnostic.
 */
import { pbCall, pbLogin, pbLogout, setToken, PbError } from './lib/pb.js';

export class ApiError extends PbError {}
export { pbLogin };

let session = loadSession();

export function loadSession() {
  try {
    return JSON.parse(localStorage.getItem('fieldops_session')) || null;
  } catch (_) {
    return null;
  }
}

export function saveSession(next) {
  session = next;
  setToken(next && next.token ? next.token : '');
  try {
    if (next) localStorage.setItem('fieldops_session', JSON.stringify(next));
    else localStorage.removeItem('fieldops_session');
  } catch (_) {}
  return session;
}

export function clearSession() {
  return saveSession(null);
}

export function currentSession() {
  return session;
}

export function isAuthenticated() {
  return Boolean(session && session.token);
}

/** Performs an action against PocketBase and returns the shaped response. */
export async function call(action, payload = {}) {
  const res = await pbCall(action, payload, session);
  return res;
}

/** Alias kept for pages that use the legacy verb. */
export async function post(action, payload = {}) {
  return call(action, payload);
}

/** Legacy helper: treat `{ok:true}` envelopes as success; throws otherwise. */
export function ensureOk(res) {
  if (!res) throw new ApiError('Empty response from the server.');
  const ok = res.ok === true || res.success === true;
  if (!ok && res.sessionConflict) return res;
  if (!ok) {
    throw new ApiError(res.message || res.error || 'Request failed.', res);
  }
  return res;
}

export { pbLogout as logoutBackend };
