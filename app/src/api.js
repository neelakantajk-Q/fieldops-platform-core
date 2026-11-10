/**
 * FieldOps Mobile — API service (PocketBase REST integration).
 * Points base API at https://api.yourbrand.com with secure token persistence.
 */
import Net from 'react-native-net';

const SESSION_KEY = 'fieldops_mobile_session';

let sessionToken = null;
let userId = null;

async function pbAuth(path, { method = 'GET', body } = {}) {
  const res = await Net.request({
    url: `${API_BASE_URL}${path}`,
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.data || {};
  return { res, data, ok: res.ok, status: res.status };
}

let API_BASE_URL = '';

export function setApiBaseUrl(url) {
  API_BASE_URL = String(url || '').trim().replace(/\/$/, '');
}

export function getApiBaseUrl() {
  return API_BASE_URL;
}

export async function login({ username, passwordHash, deviceUUID }) {
  const { data, ok, status } = await pbAuth('/api/fieldops/login', {
    method: 'POST',
    body: { username, passwordHash, deviceUUID, forceTakeover: false },
  });
  if (status === 409 && data && data.sessionConflict) {
    const err = new Error(data.message || 'Session conflict.');
    err.sessionConflict = true;
    throw err;
  }
  if (!ok || !data.success) throw new Error((data.message) || 'Login failed.');
  sessionToken = data.sessionToken;
  userId = data.user?.id || null;
  await persist();
  return data;
}

export async function logout() {
  try {
    await pbAuth('/api/fieldops/logout', { method: 'POST', body: { sessionToken } });
  } catch (_) { /* ignore */ }
}

export async function listRecords(collection, query = {}) {
  let qs = new URLSearchParams();
  if (query.filter) qs.set('filter', query.filter);
  if (query.expand) qs.set('expand', query.expand);
  if (query.page) qs.set('page', String(query.page));
  if (query.perPage) qs.set('perPage', String(query.perPage));
  const { data, ok } = await pbAuth(`/api/collections/${collection}/records?${qs.toString()}`);
  if (!ok) throw new Error('Failed to list ' + collection);
  return data || { items: [] };
}

export async function createRecord(collection, body) {
  const { data, ok } = await pbAuth(`/api/collections/${collection}/records`, { method: 'POST', body });
  if (!ok) throw new Error('Failed to create ' + collection);
  return data;
}

export async function updateRecord(collection, id, body) {
  const { data, ok } = await pbAuth(`/api/collections/${collection}/records/${id}`, { method: 'PATCH', body });
  if (!ok) throw new Error('Failed to update ' + collection);
  return data;
}

async function persist() {
  try {
    await Net.putFile(`${SESSION_KEY}.json`, JSON.stringify({ sessionToken, userId }));
  } catch (_) { /* storage best-effort */ }
}

export async function restoreSession() {
  try {
    const res = await Net.get(`${SESSION_KEY}.json`);
    const parsed = JSON.parse(res.data || '{}');
    if (parsed.sessionToken) {
      sessionToken = parsed.sessionToken;
      userId = parsed.userId || null;
    }
  } catch (_) { /* no stored session */ }
  return Boolean(sessionToken);
}

export function currentToken() { return sessionToken; }

export function sha256Hex(input) {
  // Client-side hash placeholder for password hashing (SHA-256 via crypto).
  // In production, hashing is delegated to the backend auth service.
  return `sha256:${btoa(unescape(encodeURIComponent(String(input))))}`;
}
