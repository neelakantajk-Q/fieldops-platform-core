/**
 * Thin helper for the custom /api/fieldops/* routes.
 * Mirrors the pattern used by Inventory.jsx (session-token in the JSON body).
 */
import { getApiBaseUrl } from '../config.js';
import { currentToken } from './pb.js';

const base = getApiBaseUrl();

export async function fieldopsPost(path, body = {}) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.assign({ sessionToken: currentToken() }, body || {}))
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.code || `Request failed (HTTP ${res.status})`);
  return data;
}

export async function listRecords(name, extra = '') {
  const res = await fetch(`${base}/api/collections/${name}/records?perPage=200&sort=-created${extra ? '&' + extra : ''}`);
  const data = await res.json().catch(() => ({}));
  return data.items || [];
}
